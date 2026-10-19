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
// drena aqui, DEPOIS da das lojas e sem encostar nela: falha de uma nao para
// a outra.
// ============================================================================

const POR_EXECUCAO = 50;
const POR_EXECUCAO_CHECKOUT = 20;

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
    const r = await drenarFila(limite);

    // A fila do checkout externo: erro dela nao derruba a resposta das lojas.
    // Menor que a das lojas: as duas cabem nos 120 s, e o volume dela e de
    // compra (nao de pageview).
    let checkouts: Record<string, unknown>;
    try {
      checkouts = await drenarFilaDoCheckout(Math.min(limite, POR_EXECUCAO_CHECKOUT));
    } catch (e) {
      checkouts = { erro: e instanceof Error ? e.message : "falha ao drenar a fila do checkout" };
    }

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
    // Uma vez por hora, nao a cada 10 minutos: sao dois DELETE indexados e
    // repetir seis vezes por hora nao apaga nada a mais.
    let expurgo: string | null = null;
    let expurgoCheckouts: string | null = null;
    if (new Date().getUTCMinutes() < 10) {
      const { error } = await createAdminClient().rpc("purge_tracking");
      expurgo = error ? `falhou: ${error.message}` : "ok";
      // O do checkout externo (073): o payload da fila tem o hash do comprador.
      const rc = await createAdminClient().rpc("purge_checkout_externo_rastreio");
      expurgoCheckouts = rc.error ? `falhou: ${rc.error.message}` : "ok";
    }

    return NextResponse.json({ ok: true, ...r, expurgo, checkouts, expurgoCheckouts });
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
