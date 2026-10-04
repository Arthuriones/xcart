import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { pixelCobrindoCheckout } from "@/lib/tracking/google-tag";

export const runtime = "nodejs";

// ============================================================================
// As contas Google da loja, para a tag do Google NO NAVEGADOR.
//
// GET /api/tracking/google-config?store=<uuid>&shop=<loja.myshopify.com>
//   -> [{ conta: "AW-123", labels: { view_item?, add_to_cart?, begin_checkout?, purchase? } }]
//
// Quem chama e o snippet do tema (xcart-click.js) e o Web Pixel do checkout
// (xcart-pixel.js). O Google Ads sai de la, pelo gtag.js -- nao do servidor.
//
// ------------------------- ESTE ENDPOINT E PUBLICO -------------------------
//
// So devolve o que ja seria publico na pagina da loja: o AW- e os rotulos de
// conversao estao no HTML de qualquer loja que usa a tag do Google. Nada de
// token, nome do destino, id de linha ou estado do lojista.
//
// A loja e conferida por id E dominio, como o coletor faz: o id sozinho
// deixaria alguem descobrir as contas de outra loja sabendo o uuid, e o
// dominio sozinho deixaria qualquer conta do xcart que cadastrasse o mesmo
// dominio pendurar o AW- dela na loja de outro.
//
// O header `x-xcart-pixel-checkout` diz ao tema se o Web Pixel esta cobrindo o
// checkout (1/0): cobrindo, o begin_checkout sai so do pixel.
// ============================================================================

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DOMINIO = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;

function responder(
  corpo: unknown,
  opcoes: { cacheSegundos: number; pixel?: boolean }
): NextResponse {
  const r = NextResponse.json(corpo, { status: 200 });
  // `*` e sem credenciais: dado publico, e o Web Pixel roda num iframe de
  // sandbox cuja origem nem e a da loja.
  r.headers.set("Access-Control-Allow-Origin", "*");
  r.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  r.headers.set("Access-Control-Expose-Headers", "x-xcart-pixel-checkout");
  // Curto: o lojista que cola um rotulo novo ve a tag usar em minutos, e a
  // CDN segura o volume -- e uma chamada por pagina de toda loja.
  r.headers.set(
    "Cache-Control",
    opcoes.cacheSegundos > 0
      ? `public, max-age=${opcoes.cacheSegundos}, s-maxage=${opcoes.cacheSegundos}`
      : "no-store"
  );
  if (opcoes.pixel !== undefined) {
    r.headers.set("x-xcart-pixel-checkout", opcoes.pixel ? "1" : "0");
  }
  return r;
}

export async function OPTIONS() {
  const r = new NextResponse(null, { status: 204 });
  r.headers.set("Access-Control-Allow-Origin", "*");
  r.headers.set("Access-Control-Allow-Methods", "GET, OPTIONS");
  r.headers.set("Access-Control-Max-Age", "86400");
  return r;
}

export async function GET(request: NextRequest) {
  const storeId = (request.nextUrl.searchParams.get("store") || "").trim();
  const loja = (request.nextUrl.searchParams.get("shop") || "").trim().toLowerCase();

  // Pedido mal formado nao chega ao banco. Responde lista vazia (e nao 4xx):
  // erro no console da loja do cliente e ruido que ele leria como defeito.
  if (!UUID.test(storeId) || !DOMINIO.test(loja)) {
    return responder([], { cacheSegundos: 300 });
  }

  try {
    const admin = createAdminClient();
    const { data: linha, error } = await admin
      .from("stores")
      .select("id")
      .eq("id", storeId)
      .eq("shop_domain", loja)
      .is("uninstalled_at", null)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!linha) return responder([], { cacheSegundos: 300 });

    const { data: cfg, error: erroCfg } = await admin
      .from("tracking_configs")
      .select("enabled, web_pixel_visto_em")
      .eq("store_id", storeId)
      .maybeSingle();
    if (erroCfg) throw new Error(erroCfg.message);

    // O interruptor da loja vale para o Google tambem: desligado, a tag nao
    // carrega.
    if (!cfg?.enabled) return responder([], { cacheSegundos: 300 });

    const { googleDaLoja } = await import("@/lib/tracking/destinos");
    const contas = await googleDaLoja(admin, storeId);
    return responder(contas, {
      cacheSegundos: 300,
      pixel: pixelCobrindoCheckout(cfg.web_pixel_visto_em),
    });
  } catch (e) {
    console.error("[tracking/google-config] falha ao ler", e);
    // Sem cache: o soluco do banco nao pode virar "loja sem Google" por 5 min.
    return responder([], { cacheSegundos: 0 });
  }
}
