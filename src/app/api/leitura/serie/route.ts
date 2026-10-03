import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { montarSerieDiaria } from "@/lib/leitura/serie-diaria";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/serie -- serie diaria do Lucro no filtro global (cookie):
 * periodo atual, anterior e lucro por loja por dia. So leitura, pela sessao
 * (RLS). Resposta: { moeda, intervalos, atual, anterior, porLoja }.
 *
 * A tela Lucro monta isto no servidor (page.tsx); a rota existe para quem
 * precisar da serie sem a pagina.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para ver o lucro." }, { status: 401 });
  }
  try {
    const base = await lerBaseLucro();
    if (!base) {
      return NextResponse.json({ moeda: null, intervalos: null, atual: [], anterior: [], porLoja: [] });
    }
    const serie = montarSerieDiaria(base.entrada);
    return NextResponse.json(
      { moeda: base.entrada.moeda, intervalos: base.entrada.intervalos, ...serie },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[leitura/serie]", e);
    return NextResponse.json({ erro: "A série do lucro não respondeu agora." }, { status: 500 });
  }
}
