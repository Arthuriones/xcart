import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerNotificacoes } from "@/lib/leitura/notificacoes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/notificacoes -- alertas abertos para o sino do topo.
 * So leitura, pela sessao (RLS). Resposta: { total, itens }.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para ver os alertas." }, { status: 401 });
  }
  try {
    const dados = await lerNotificacoes();
    return NextResponse.json(dados, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[leitura/notificacoes]", e);
    return NextResponse.json({ erro: "Os alertas não responderam agora." }, { status: 500 });
  }
}
