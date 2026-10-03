import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { buscar } from "@/lib/leitura/busca";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/busca?q= -- lojas e pedidos do usuario para o Ctrl K.
 * So leitura, pela sessao (RLS). Resposta: { lojas, pedidos }.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para buscar." }, { status: 401 });
  }
  const q = request.nextUrl.searchParams.get("q") ?? "";
  try {
    const resultado = await buscar(q);
    return NextResponse.json(resultado, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[leitura/busca]", e);
    return NextResponse.json({ erro: "A busca não respondeu agora." }, { status: 500 });
  }
}
