import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { getPublicAppUrl } from "@/lib/public-url";
import {
  rastreiaCompra,
  scriptDaPonteDoCheckout,
  semMigration069,
  tabelaAusente,
  type IdPlataformaCheckout,
} from "@/lib/checkouts-externos/tipos";

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
//
// `?checkouts=1`: o botao da pagina pode levar a um checkout externo (Cakto)
// em vez da loja. Devolve os checkouts que rastreiam, com a tag da ponte de
// cada um (data-xcart-checkout) e se o rastreamento dele esta ligado. So o
// banco, pela sessao (RLS): nada da Shopify.
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

interface CheckoutDaPagina {
  id: string;
  nome: string;
  plataforma: IdPlataformaCheckout;
  ativo: boolean;
  /** Algum pixel (Meta ou TikTok) ligado: sem ele o coletor recusa o que a pagina mandar. */
  rastreando: boolean;
  tag: string;
}

/** Os checkouts do usuario que rastreiam (modelo venda), pela sessao. Sem a 069/073: o que der. */
async function checkoutsDaPagina(supabase: Awaited<ReturnType<typeof createClient>>): Promise<CheckoutDaPagina[]> {
  const { data, error } = await supabase
    .from("checkouts_externos")
    .select("id, nome, plataforma, ativo")
    .order("created_at", { ascending: true });
  if (error) {
    if (semMigration069(error)) return [];
    throw new Error(error.message);
  }
  const base = getPublicAppUrl();
  const linhas = ((data ?? []) as { id: string; nome: string; plataforma: string; ativo: boolean }[]).filter((c) =>
    rastreiaCompra(c.plataforma)
  );
  if (linhas.length === 0) return [];
  const ligados = new Set<string>();
  const { data: ds, error: erroDestinos } = await supabase
    .from("checkout_externo_destinos")
    .select("checkout_id")
    .eq("ativo", true)
    .in(
      "checkout_id",
      linhas.map((c) => c.id)
    );
  if (erroDestinos && !tabelaAusente(erroDestinos)) throw new Error(erroDestinos.message);
  for (const d of (ds ?? []) as { checkout_id: string }[]) ligados.add(String(d.checkout_id));
  return linhas.flatMap((c) => {
    const tag = scriptDaPonteDoCheckout(base, String(c.id), c.plataforma);
    return tag
      ? [{ id: String(c.id), nome: c.nome, plataforma: c.plataforma as IdPlataformaCheckout, ativo: Boolean(c.ativo), rastreando: ligados.has(String(c.id)), tag }]
      : [];
  });
}

/**
 * As vitrines das rotas em que esta loja e a de CHECKOUT. A mesma tag, colada
 * no tema delas, mede visita, produto e carrinho para esta loja
 * (xcart-bridge.js, 3b): e a vitrine que recebe o anuncio e o carrinho. Pela
 * sessao (RLS). Falhou, a tela segue sem a lista -- a tag nao depende dela.
 */
async function vitrinesDaLoja(
  supabase: Awaited<ReturnType<typeof createClient>>,
  storeId: string
): Promise<{ nome: string; dominio: string }[]> {
  try {
    const [destinos, legadas] = await Promise.all([
      supabase.from("routed_checkout_targets").select("route_id").eq("target_store_id", storeId),
      supabase.from("routed_checkout_configs").select("id").eq("target_store_id", storeId),
    ]);
    const rotas = [
      ...new Set([
        ...((destinos.data ?? []) as { route_id: string }[]).map((d) => d.route_id),
        ...((legadas.data ?? []) as { id: string }[]).map((r) => r.id),
      ]),
    ];
    if (!rotas.length) return [];
    const { data: configs } = await supabase.from("routed_checkout_configs").select("source_store_id").in("id", rotas);
    const ids = [
      ...new Set(((configs ?? []) as { source_store_id: string | null }[]).map((c) => c.source_store_id)),
    ].filter((id): id is string => Boolean(id) && id !== storeId);
    if (!ids.length) return [];
    const { data: lojas } = await supabase.from("stores").select("name, shop_domain").in("id", ids);
    return ((lojas ?? []) as { name: string | null; shop_domain: string }[]).map((l) => ({
      nome: l.name || l.shop_domain,
      dominio: l.shop_domain,
    }));
  } catch (e) {
    console.error("[tracking/pagina-externa] vitrines", e instanceof Error ? e.message : e);
    return [];
  }
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

  if (request.nextUrl.searchParams.get("checkouts") === "1") {
    try {
      return NextResponse.json({ ok: true, checkouts: await checkoutsDaPagina(supabase) });
    } catch (e) {
      console.error("[tracking/pagina-externa] checkouts", e instanceof Error ? e.message : e);
      return NextResponse.json({ error: "Não deu para ler os checkouts." }, { status: 500 });
    }
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
  // Em paralelo com a Shopify: so o banco.
  const vitrines = vitrinesDaLoja(supabase, loja.id);
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
    // Com a loja identificada a ponte tambem manda PageView e ViewContent da
    // pagina ao coletor (o servidor fala com o Meta e o TikTok).
    tag: `<script src="${getPublicAppUrl().replace(/\/+$/, "")}/xcart-bridge.js" data-xcart-destinos="${destinos.join(",")}" data-xcart-store="${loja.id}" data-xcart-shop="${permanente}" defer></script>`,
    produtos,
    vitrines: await vitrines,
  });
}
