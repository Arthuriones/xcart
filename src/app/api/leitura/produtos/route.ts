import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { montarPorProduto } from "@/lib/leitura/por-produto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/produtos -- lucro ANTES do anuncio por SKU, no periodo
 * atual do filtro global (cookie). So leitura, pela sessao (RLS).
 * Resposta: { moeda, intervalo, linhas, receitaSemItem }.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para ver o lucro." }, { status: 401 });
  }
  try {
    const base = await lerBaseLucro();
    if (!base) return NextResponse.json({ moeda: null, intervalo: null, linhas: [], receitaSemItem: 0 });
    const resultado = montarPorProduto(base.entrada);
    return NextResponse.json(
      { moeda: base.entrada.moeda, intervalo: base.entrada.intervalos.atual, ...resultado },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[leitura/produtos]", e);
    return NextResponse.json({ erro: "O lucro por produto não respondeu agora." }, { status: 500 });
  }
}
