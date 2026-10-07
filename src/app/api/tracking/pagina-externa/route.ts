import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { getPublicAppUrl } from "@/lib/public-url";

export const runtime = "nodejs";

// ============================================================================
// O kit da pagina externa (VSL, advertorial, pagina de oferta fora da Shopify):
// a tag da ponte e os produtos da loja, para a tela montar o link do checkout.
//
// Tudo no DOMINIO PERMANENTE (xxx.myshopify.com), nunca no dominio proprio:
// lojista troca de dominio toda hora, e a Shopify redireciona o permanente
// para o atual preservando a query (medido: /cart/1:1?attributes[...] chega
// inteiro do outro lado). A tag lista os dois, para link escrito a mao com o
// dominio proprio tambem ser reescrito.
//
// Lista leve de proposito: id, titulo e variantes. Nao e o getProducts (que
// traz descricao, imagens e metafields) -- aqui so se escolhe o que vender.
// ============================================================================

const QUERY = `
  query paginaExterna($after: String) {
    shop { primaryDomain { host } }
    products(first: 100, after: $after, query: "status:active", sortKey: TITLE) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        title
        variants(first: 50) { nodes { id title price } }
      }
    }
  }
`;

interface Resposta {
  shop?: { primaryDomain?: { host?: string | null } | null } | null;
  products?: {
    pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
    nodes?: {
      id?: string;
      title?: string;
      variants?: { nodes?: { id?: string; title?: string; price?: string }[] };
    }[];
  };
}

/** "gid://shopify/ProductVariant/123" -> "123". O permalink quer o numero. */
function numero(gid: string | undefined): string | null {
  const m = (gid || "").match(/\/(\d+)$/);
  return m ? m[1] : null;
}

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

  const { data: loja } = await supabase
    .from("stores")
    .select("id, shop_domain, client_id, client_secret, access_token")
    .eq("id", storeId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!loja) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }
  if (!loja.client_id || !loja.client_secret) {
    return NextResponse.json({ error: "Loja sem credencial do app." }, { status: 409 });
  }

  const creds = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };

  const produtos: { id: string; titulo: string; variantes: { id: string; titulo: string; preco: string }[] }[] = [];
  let dominioProprio: string | null = null;
  let after: string | null = null;
  try {
    // Ate 3 paginas (300 produtos): quem tem mais escolhe pela busca da tela.
    for (let pagina = 0; pagina < 3; pagina++) {
      const r = (await shopifyGraphQL(creds, QUERY, { after })) as Resposta;
      dominioProprio = dominioProprio || r.shop?.primaryDomain?.host || null;
      for (const p of r.products?.nodes || []) {
        const variantes = (p.variants?.nodes || [])
          .map((v) => ({ id: numero(v.id) || "", titulo: v.title || "", preco: v.price || "" }))
          .filter((v) => v.id);
        if (variantes.length) produtos.push({ id: numero(p.id) || p.id || "", titulo: p.title || "", variantes });
      }
      if (!r.products?.pageInfo?.hasNextPage || !r.products.pageInfo.endCursor) break;
      after = r.products.pageInfo.endCursor;
    }
  } catch (e) {
    console.error("[tracking/pagina-externa] Shopify nao respondeu", e);
    return NextResponse.json({ error: "A Shopify nao respondeu. Tente de novo." }, { status: 502 });
  }

  const permanente = loja.shop_domain;
  const destinos = [permanente, dominioProprio]
    .filter((d): d is string => !!d)
    .filter((d, i, a) => a.indexOf(d) === i);

  return NextResponse.json({
    ok: true,
    dominio: permanente,
    tag: `<script src="${getPublicAppUrl().replace(/\/+$/, "")}/xcart-bridge.js" data-xcart-destinos="${destinos.join(",")}" defer></script>`,
    produtos,
  });
}
