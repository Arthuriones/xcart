import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { gerarCodigoDoPixel } from "@/lib/tracking/pixel-checkout";
import { getPublicAppUrl } from "@/lib/public-url";

export const runtime = "nodejs";

// ============================================================================
// O codigo do Custom Pixel de uma loja, para o lojista copiar.
//
// Por que e copiar e colar, e nao um botao que instala: `webPixelCreate` pela
// Admin API responde "No extension found" -- ela so funciona para app que
// declara uma Web Pixel Extension e faz deploy pelo Shopify CLI. Enquanto o
// xcart nao tiver essa extensao, o Custom Pixel colado no admin e o unico
// caminho, e ele roda no MESMO sandbox.
//
// Depois de colado nao ha mais nada a fazer: o pixel se anuncia no primeiro
// evento que manda, e o coletor carimba `web_pixel_visto_em` sozinho.
// ============================================================================

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const storeId = request.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }

  // Cliente do usuario + user_id: o codigo carrega o id da LINHA de loja, e
  // entregar o de outro deixaria eventos irem para a conta de anuncios errada.
  const { data: loja } = await supabase
    .from("stores")
    .select("id, shop_domain")
    .eq("id", storeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!loja) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    dominio: loja.shop_domain,
    codigo: gerarCodigoDoPixel({
      shopDomain: loja.shop_domain,
      storeId: loja.id,
      origemDoApp: getPublicAppUrl(),
    }),
  });
}
