import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { drenarFila } from "@/lib/tracking/fila";
import { drenarFilaDoCheckout } from "@/lib/checkouts-externos/rastreio";

export const runtime = "nodejs";
export const maxDuration = 120;

// ============================================================================
// Retentativa da fila de rastreamento.
//
// O Purchase e enviado na hora em que o webhook chega, mas esse envio falha:
// limite de taxa do Meta (justamente no pico de venda), token vencido, rede.
// Sem este job, cada falha dessas some -- e conversao que some e otimizacao de
// campanha comprometida, porque o Meta deixa de ver as vendas que o anuncio
// gerou.
//
// De 10 em 10 minutos, e nao de hora em hora como os outros: evento de
// conversao envelhece. O Meta aceita ate 7 dias, mas quanto mais fresco, melhor
// a atribuicao.
//
// So o Meta e o TikTok passam por esta fila. O Google Ads sai do navegador,
// pela tag do Google (ver /api/tracking/google-config).
//
// A fila do checkout externo (Cakto, 073: checkout_externo_envios) tambem
// drena aqui, DEPOIS da das lojas e do expurgo, sem encostar nelas: falha de
// uma nao para a outra.
// ============================================================================

const POR_EXECUCAO = 50;
const POR_EXECUCAO_CHECKOUT = 20;
/** A fila do checkout para de pegar linha nova aqui: o maxDuration e 120 s, e cada envio leva ate ~5 s. */
const PRAZO_DO_CHECKOUT_MS = 100_000;

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

async function executar(request: NextRequest) {
  const inicio = Date.now();
  // Fora do cron, so admin: a fila tem evento de todas as lojas, e drenar
  // dispara envio para pixel de terceiro.
  if (!cronAutorizado(request)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = createAdminClient();
    const { data: me } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!me?.is_admin) {
      return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    }
  }

  const limite = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get("limit") || POR_EXECUCAO), 1),
    200
  );

  try {
    // ---- expurgo ----------------------------------------------------------
    //
    // `purge_tracking()` existe desde a migration 035, com comentario dizendo
    // "Chamado pelo cron". Nunca foi: nada no codigo chamava. A fila e a tabela
    // de identidades cresciam para sempre.
    //
    // Isso nao aparece com uma loja. Com muitas, e a primeira parede: cada
    // pageview rende uma linha POR DESTINO, e a linha pesa ~2,3 KB com indice.
    // Cem lojas de porte modesto passam de 10 GB por mes.
    //
    // Uma vez por hora, nao a cada 10 minutos: repetir seis vezes por hora nao
    // apaga nada a mais. Desde a 079 ele tambem ARQUIVA: a fila vira o
    // historico de 12 meses (tracking_historico, uma linha por evento) antes de
    // qualquer DELETE, e a fila fica curta -- funil 14 dias, compra 90 com o
    // payload resumido aos 8 (src/lib/tracking/retencao.ts).
    //
    // ANTES do drenarFila: ele nao tem prazo, e com o Meta ou o TikTok lentos
    // (5 s por envio, 50 envios) estourava os 120 s e o expurgo da hora nao
    // rodava. Aqui custa milissegundos (53 ms medidos em 24/10).
    let expurgo: string | null = null;
    let expurgoCheckouts: string | null = null;
    if (new Date().getUTCMinutes() < 10) {
      const { error } = await createAdminClient().rpc("purge_tracking");
      expurgo = error ? `falhou: ${error.message}` : "ok";
      // O do checkout externo (073): o payload da fila tem o hash do comprador.
      const rc = await createAdminClient().rpc("purge_checkout_externo_rastreio");
      expurgoCheckouts = rc.error ? `falhou: ${rc.error.message}` : "ok";
    }

    const r = await drenarFila(limite);

    // A fila do checkout externo, DEPOIS do expurgo: com o Meta ou o TikTok
    // lentos ela pode levar dezenas de segundos, e o expurgo das lojas so roda
    // nos 10 primeiros minutos da hora -- estourar os 120 s antes dele perdia
    // a hora inteira. Erro dela nao derruba a resposta das lojas, e ela para
    // de pegar linha nova perto do fim (a sobra fica pendente para a proxima).
    // O PageView e o InitiateCheckout da pagina de vendas (Fase D) saem na
    // hora pelo coletor; aqui so a sobra, e a compra passa na frente.
    let checkouts: Record<string, unknown>;
    try {
      checkouts = await drenarFilaDoCheckout(Math.min(limite, POR_EXECUCAO_CHECKOUT), inicio + PRAZO_DO_CHECKOUT_MS);
    } catch (e) {
      checkouts = { erro: e instanceof Error ? e.message : "falha ao drenar a fila do checkout" };
    }

    // Expurgo que falhou responde 500 com o mesmo corpo: o painel de Cron Jobs
    // da Vercel marca a execucao como falha. Com 200, o purge estourando os 8 s
    // do PostgREST (volta atras inteiro, toda hora) passava sem ninguem ver --
    // e a fila cresce ate o banco free virar so leitura.
    const expurgoFalhou = [expurgo, expurgoCheckouts].some((e) => e?.startsWith("falhou"));
    if (expurgoFalhou) console.error("[tracking/drain] expurgo falhou", { expurgo, expurgoCheckouts });
    return NextResponse.json(
      { ok: true, ...r, expurgo, checkouts, expurgoCheckouts },
      { status: expurgoFalhou ? 500 : 200 }
    );
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "falha ao drenar a fila";
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
