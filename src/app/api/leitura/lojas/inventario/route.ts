import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerInventarioLoja } from "@/lib/leitura/resumo-lojas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/lojas/inventario?loja=<uuid> -- o que a remocao da loja
 * apagaria, contado de verdade. So leitura, pela sessao (RLS) e conferindo o
 * dono. O dialogo de remover chama isto ao abrir; quem apaga continua sendo o
 * DELETE /api/stores/[storeId].
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para continuar." }, { status: 401 });
  }
  const loja = request.nextUrl.searchParams.get("loja") ?? "";
  try {
    const inventario = await lerInventarioLoja(loja);
    if (!inventario) {
      return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
    }
    return NextResponse.json({ inventario }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[leitura/lojas/inventario]", e);
    return NextResponse.json({ erro: "Não deu para contar o que sai agora." }, { status: 500 });
  }
}
