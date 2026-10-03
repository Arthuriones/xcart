import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { montarPorCampanha } from "@/lib/leitura/por-campanha";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/campanhas -- gasto, impressoes, cliques e compras
 * reportadas pela plataforma, por campanha, no periodo atual do filtro global
 * (cookie). So leitura, pela sessao (RLS).
 * Resposta: { moeda, intervalo, linhas }.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para ver as campanhas." }, { status: 401 });
  }
  try {
    const base = await lerBaseLucro();
    if (!base) return NextResponse.json({ moeda: null, intervalo: null, linhas: [] });
    const linhas = montarPorCampanha({
      contas: base.contas,
      gastos: base.gastosCampanha,
      cambio: base.entrada.cambio,
      moeda: base.entrada.moeda,
      intervalo: base.entrada.intervalos.atual,
      lojaIds: base.lojaIds,
    });
    return NextResponse.json(
      { moeda: base.entrada.moeda, intervalo: base.entrada.intervalos.atual, linhas },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[leitura/campanhas]", e);
    return NextResponse.json({ erro: "As campanhas não responderam agora." }, { status: 500 });
  }
}
