import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { rechecarLoja } from "@/lib/leitura/tracking-diagnostico";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/tracking-diagnostico?loja=<id> -- confere de novo UMA loja
 * na Shopify (pedidos dos ultimos 7 dias, aviso de pedidos e tema), para o
 * "Tentar de novo" da Saude dos pixels. So leitura; o dono e conferido pela
 * sessao. Resposta: { diagnostico } (null = app desinstalado).
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para conferir a loja." }, { status: 401 });
  }
  const loja = request.nextUrl.searchParams.get("loja") ?? "";
  if (!loja) {
    return NextResponse.json({ erro: "Qual loja? Falta o parâmetro loja." }, { status: 400 });
  }
  try {
    const r = await rechecarLoja(loja);
    if (!r) {
      return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });
    }
    if (r.falhou) {
      return NextResponse.json(
        { erro: "A Shopify não respondeu a tempo. Tente de novo em instantes." },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { diagnostico: r.diagnostico },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[leitura/tracking-diagnostico]", e);
    return NextResponse.json({ erro: "A conferência não respondeu agora." }, { status: 500 });
  }
}
