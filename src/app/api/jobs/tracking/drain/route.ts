import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { conferirDiagnosticos, drenarFila } from "@/lib/tracking/fila";

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
// O Google pela Data Manager sai SO daqui: o coletor e o webhook so agendam
// (6 h depois do evento, senao o Google recusa o clique como recente), e o
// diagnostico de cada envio tambem e conferido aqui.
// ============================================================================

const POR_EXECUCAO = 50;

/**
 * Diagnosticos do Google (Data Manager) por rodada.
 *
 * Cada um e uma consulta ao Google. 20 a cada 10 min sao 120 por hora, folga
 * para o volume de carrinho + checkout + compra COM clique das lojas de hoje;
 * o que sobrar fica para a rodada seguinte, porque a fila e por `conferir_em`.
 */
const DIAGNOSTICOS_POR_EXECUCAO = 20;

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

    // ---- diagnostico do Google --------------------------------------------
    //
    // Depois da fila e com erro proprio: a consulta ao Google (ou a coluna da
    // migration 054, se o deploy chegar antes dela) falhar nao pode fazer o
    // cron responder 500 com a fila ja drenada.
    let diagnostico: Awaited<ReturnType<typeof conferirDiagnosticos>> | string;
    try {
      diagnostico = await conferirDiagnosticos(DIAGNOSTICOS_POR_EXECUCAO);
    } catch (e) {
      diagnostico = `falhou: ${e instanceof Error ? e.message : String(e)}`;
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
    if (new Date().getUTCMinutes() < 10) {
      const { error } = await createAdminClient().rpc("purge_tracking");
      expurgo = error ? `falhou: ${error.message}` : "ok";
    }

    return NextResponse.json({ ok: true, ...r, diagnostico, expurgo });
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
