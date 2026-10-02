import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ErroGraph } from "@/lib/ads/meta-graph";
import { classificarErroMeta } from "@/lib/ads/meta-mapear";
import { sincronizarContaMeta } from "@/lib/ads/meta-sync";
import type { AdAccountRow, SyncResposta } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Gasto do Meta (Insights) -> ad_spend_daily.
//
// Cron */15: busca ontem e hoje no fuso de cada conta; uma vez a cada ~20 h
// reprocessa 28 dias (o Meta corrige gasto atrasado e congela depois disso).
// Com sessao (botao "Atualizar agora"), so as contas do proprio usuario.
//
// Cada conta e travada por linha (sincronizando_desde): duas execucoes
// sobrepostas -- cron atrasado e clique no botao -- nao escrevem a mesma conta
// ao mesmo tempo. Trava com mais de 10 min e tida como morta (funcao que
// estourou o tempo nao chega no finally).
// ============================================================================

const ORCAMENTO_MS = 240_000;
const TRAVA_MORTA_MS = 10 * 60 * 1000;
const RECENTE_MS = 60 * 1000;
const PAUSA_ENTRE_CONTAS_MS = 300;

function segredoDoCron() {
  return process.env.CRON_SECRET || process.env.BULK_IMPORT_CRON_SECRET || "";
}

function cronAutorizado(request: NextRequest) {
  const esperado = segredoDoCron();
  if (!esperado) return false;
  return (
    request.headers.get("authorization") === `Bearer ${esperado}` ||
    request.headers.get("x-cron-secret") === esperado
  );
}

function esperar(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Erro -> texto para ultimo_erro (o lojista le na tela). Nunca leva URL/token. */
function textoDoErro(e: unknown): string {
  if (e instanceof ErroGraph) {
    switch (classificarErroMeta(e.codigo)) {
      case "token":
        return "Token do Meta recusado (190). Gere outro e cole em Contas de anúncio.";
      case "permissao":
        return "Sem permissão de leitura nesta conta (ads_read).";
      case "limite":
        return "Limite de taxa do Meta; tento de novo na próxima rodada.";
      default:
        return e.message.slice(0, 300);
    }
  }
  const msg = e instanceof Error ? e.message : "falha desconhecida";
  return msg.slice(0, 300);
}

async function executar(request: NextRequest) {
  const admin = createAdminClient();
  const inicio = Date.now();

  let query = admin
    .from("ad_accounts")
    .select("*")
    .eq("plataforma", "meta")
    .eq("ativo", true)
    // Conta sem loja ainda nao entra no lucro: nao gasta chamada com ela.
    .not("store_id", "is", null)
    .order("ultimo_sync_em", { ascending: true, nullsFirst: true });

  let somenteRecentes = false;
  if (!cronAutorizado(request)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // userId SEMPRE da sessao.
    query = query.eq("user_id", user.id);
    somenteRecentes = true;
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json<SyncResposta>(
      { ok: false, processadas: 0, puladas: 0, erros: [`falha ao ler as contas: ${error.message}`] },
      { status: 500 }
    );
  }

  const contas = (data ?? []) as AdAccountRow[];
  const resposta: SyncResposta = { ok: true, processadas: 0, puladas: 0, erros: [] };

  for (let i = 0; i < contas.length; i += 1) {
    const conta = contas[i];
    const rotulo = conta.nome || conta.external_id;

    if (Date.now() - inicio > ORCAMENTO_MS) {
      // Sem tempo: o resto fica para a proxima rodada (a ordem por
      // ultimo_sync_em garante que elas vao primeiro).
      resposta.puladas += contas.length - i;
      break;
    }

    // Botao apertado duas vezes seguidas nao repete a mesma leitura.
    if (
      somenteRecentes &&
      conta.ultimo_sync_em &&
      Date.now() - Date.parse(conta.ultimo_sync_em) < RECENTE_MS
    ) {
      resposta.puladas += 1;
      continue;
    }

    const agora = new Date();
    const agoraIso = agora.toISOString();
    const travaMorta = new Date(agora.getTime() - TRAVA_MORTA_MS).toISOString();

    const { data: travou, error: erroTrava } = await admin
      .from("ad_accounts")
      .update({ sincronizando_desde: agoraIso })
      .eq("id", conta.id)
      .or(`sincronizando_desde.is.null,sincronizando_desde.lt.${travaMorta}`)
      .select("id");
    if (erroTrava || !travou || travou.length === 0) {
      resposta.puladas += 1;
      continue;
    }

    let ultimoErro: string | null = null;
    try {
      const { data: segredo } = await admin
        .from("ad_account_secrets")
        .select("meta_access_token")
        .eq("ad_account_id", conta.id)
        .maybeSingle();
      const token = (segredo?.meta_access_token as string | null | undefined) ?? "";
      if (!token) {
        ultimoErro = "Sem token: cole o token em Contas de anúncio.";
      } else {
        await sincronizarContaMeta(admin, conta, token, agora);
        resposta.processadas += 1;
      }
    } catch (e) {
      ultimoErro = textoDoErro(e);
    } finally {
      // ultimo_sync_ok_em so e marcado no sucesso (dentro do sync): o alerta de
      // "gasto sem atualizar" le esse campo.
      await admin
        .from("ad_accounts")
        .update({
          ultimo_sync_em: new Date().toISOString(),
          sincronizando_desde: null,
          ...(ultimoErro ? { ultimo_erro: ultimoErro } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", conta.id);
    }

    if (ultimoErro) resposta.erros.push(`${rotulo}: ${ultimoErro}`);

    if (i < contas.length - 1) await esperar(PAUSA_ENTRE_CONTAS_MS);
  }

  resposta.ok = resposta.erros.length === 0;
  return NextResponse.json<SyncResposta>(resposta);
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
