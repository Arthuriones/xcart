import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { ehNegado } from "@/lib/financeiro/mapear-pedido";
import { sincronizarLoja, type LojaParaSync } from "@/lib/financeiro/shopify-pedidos";
import { ehUuid, type FinSyncStateRow, type SyncResposta } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Sincronizacao de pedidos (fin_orders), de 15 em 15 minutos.
//
// Cron: todas as lojas instaladas. Sessao ("Atualizar agora" na tela Lucro):
// so as lojas do usuario, opcionalmente uma (?loja=<uuid>).
//
// A Vercel pode disparar o mesmo cron duas vezes, ou pular um. Por isso a
// trava e por loja (sincronizando_desde, atomica no UPDATE) e a gravacao e
// upsert: rodar de novo so regrava a mesma foto.
// ============================================================================

/** Abaixo dos 300 s da funcao: sobra para fechar o estado da loja em curso. */
const ORCAMENTO_MS = 240_000;
/** Trava mais velha que isso e de execucao que morreu no meio. */
const TRAVA_VENCE_MS = 10 * 60 * 1000;
/** Loja sem read_orders: o cron so tenta de novo depois disso. */
const ESPERA_NEGADO_MS = 6 * 60 * 60 * 1000;
/** "Atualizar agora" repetido: nao martela a Shopify. */
const ESPERA_SESSAO_MS = 60 * 1000;

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

function mensagemDe(e: unknown): string {
  const bruta = e instanceof Error ? e.message : String(e ?? "falha desconhecida");
  // A mensagem vai para o banco e para a tela: nunca token. O client da Shopify
  // nao poe token na mensagem, mas um shpat_/shpca_ colado num erro nao passa.
  return bruta.replace(/shp[a-z]{2}_[A-Za-z0-9]+/g, "[token]").slice(0, 300);
}

function haMenosDe(iso: string | null, ms: number, agora: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && agora - t < ms;
}

const COLUNAS_LOJA = "id, user_id, shop_domain, client_id, client_secret, access_token";

async function executar(request: NextRequest) {
  const doCron = cronAutorizado(request);
  const admin = createAdminClient();

  let consulta = admin.from("stores").select(COLUNAS_LOJA).is("uninstalled_at", null);

  if (!doCron) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    // userId sempre da sessao; a loja do parametro so restringe dentro dela.
    consulta = consulta.eq("user_id", user.id);
    const loja = request.nextUrl.searchParams.get("loja");
    if (ehUuid(loja)) consulta = consulta.eq("id", loja.toLowerCase());
  }

  const { data: lojas, error: erroLojas } = await consulta;
  if (erroLojas) {
    return NextResponse.json(
      { ok: false, processadas: 0, puladas: 0, erros: [`lojas: ${erroLojas.message}`] } satisfies SyncResposta,
      { status: 500 }
    );
  }

  const resposta: SyncResposta = { ok: true, processadas: 0, puladas: 0, erros: [] };
  const inicio = Date.now();
  const limiteEm = inicio + ORCAMENTO_MS;

  for (const loja of (lojas ?? []) as LojaParaSync[]) {
    if (Date.now() > limiteEm) {
      resposta.puladas += 1;
      continue;
    }

    // a) linha de estado existe (primeira vez da loja)
    const { error: erroLinha } = await admin
      .from("fin_sync_state")
      .upsert({ store_id: loja.id, user_id: loja.user_id }, { onConflict: "store_id", ignoreDuplicates: true });
    if (erroLinha) {
      resposta.erros.push(`${loja.shop_domain}: ${mensagemDe(erroLinha.message)}`);
      continue;
    }

    // b) estado atual
    const { data: estado, error: erroEstado } = await admin
      .from("fin_sync_state")
      .select("*")
      .eq("store_id", loja.id)
      .maybeSingle<FinSyncStateRow>();
    if (erroEstado) {
      resposta.erros.push(`${loja.shop_domain}: ${mensagemDe(erroEstado.message)}`);
      continue;
    }

    // c) quando nao vale tentar agora
    const agora = Date.now();
    if (
      doCron &&
      estado?.ultimo_erro_tipo === "negado" &&
      haMenosDe(estado.ultimo_sync_em, ESPERA_NEGADO_MS, agora)
    ) {
      resposta.puladas += 1;
      continue;
    }
    if (!doCron && haMenosDe(estado?.ultimo_sync_em ?? null, ESPERA_SESSAO_MS, agora)) {
      resposta.puladas += 1;
      continue;
    }

    // d) trava atomica: so uma execucao por loja. Zero linhas = outra esta rodando.
    const travaVencida = new Date(agora - TRAVA_VENCE_MS).toISOString();
    const { data: travou, error: erroTrava } = await admin
      .from("fin_sync_state")
      .update({ sincronizando_desde: new Date(agora).toISOString() })
      .eq("store_id", loja.id)
      .or(`sincronizando_desde.is.null,sincronizando_desde.lt.${travaVencida}`)
      .select("store_id");
    if (erroTrava) {
      resposta.erros.push(`${loja.shop_domain}: ${mensagemDe(erroTrava.message)}`);
      continue;
    }
    if (!travou || travou.length === 0) {
      resposta.puladas += 1;
      continue;
    }

    // e) sincroniza
    try {
      const r = await sincronizarLoja(admin, loja, estado ?? null, undefined, limiteEm);

      const { count } = await admin
        .from("fin_orders")
        .select("store_id", { count: "exact", head: true })
        .eq("store_id", loja.id);

      const fim = new Date().toISOString();
      const { error: erroFim } = await admin
        .from("fin_sync_state")
        .update({
          ultimo_sync_em: fim,
          ultimo_sync_ok_em: fim,
          ultimo_erro: null,
          ultimo_erro_tipo: null,
          // Nunca volta a false: carga feita uma vez esta feita.
          ...(r.terminou ? { carga_inicial_ok: true } : {}),
          ...(typeof count === "number" ? { pedidos_total: count } : {}),
          sincronizando_desde: null,
          updated_at: fim,
        })
        .eq("store_id", loja.id);
      if (erroFim) throw new Error(`gravar estado: ${erroFim.message}`);

      resposta.processadas += 1;
    } catch (e) {
      const mensagem = mensagemDe(e);
      const fim = new Date().toISOString();
      // Erro nunca e engolido: vai para a resposta e para a tela (ultimo_erro).
      await admin
        .from("fin_sync_state")
        .update({
          ultimo_sync_em: fim,
          ultimo_erro: mensagem,
          ultimo_erro_tipo: ehNegado(e) ? "negado" : "falhou",
          // Falha numa rodada que retomava (a Shopify pode recusar o cursor
          // salvo): a proxima recomeca pelo caminho normal, nao falha sempre.
          ...(estado?.retomar_cursor ? { retomar_busca: null, retomar_cursor: null } : {}),
          sincronizando_desde: null,
          updated_at: fim,
        })
        .eq("store_id", loja.id);
      resposta.erros.push(`${loja.shop_domain}: ${mensagem}`);
    }
  }

  resposta.ok = resposta.erros.length === 0;
  return NextResponse.json(resposta);
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
