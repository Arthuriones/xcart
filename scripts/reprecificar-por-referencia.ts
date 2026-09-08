/**
 * Reprecifica a operacao Block olhando a loja de referencia.
 *
 * A primeira versao deste script derivava o preco do compare_at do catalogo
 * importado. Isso estava errado: aquele riscado nao era o preco praticado, era
 * um "de" inflado. O resultado ficou 20,8% MAIS CARO que a loja de referencia
 * -- o oposto do que a operacao precisa.
 *
 * Agora a base e o preco publico da referencia, casado por SKU:
 *
 *   preco = min(TETO, arredonda_990(referencia * (1 - DESCONTO)))
 *
 * Sem piso de proposito. O catalogo tem camiseta e kit de limpeza junto com
 * tenis; um piso alto encareceria justamente os itens baratos, que e onde a
 * diferenca de preco mais aparece para o comprador.
 *
 * SKU sem par na referencia fica como esta -- inventar preco para ele seria
 * repetir o erro que este script veio consertar.
 *
 * Uso:  npx tsx scripts/reprecificar-por-referencia.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, type ShopifyCredentials } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const REFERENCIA = "www.blockstore.cl";
const LOJAS = ["q2mdgs-ag.myshopify.com", "5sx1nu-sx.myshopify.com"];
const DESCONTO = 0.15;
const TETO = 79990;

const APLICAR = process.argv.includes("--aplicar");

/** Termina em .990, como o resto do catalogo. */
function noventa(valor: number) {
  return Math.round((valor - 990) / 1000) * 1000 + 990;
}

/** Preco publico da referencia, por SKU. */
async function precosDaReferencia(): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();
  for (let pagina = 1; pagina <= 30; pagina += 1) {
    const r = await fetch(
      `https://${REFERENCIA}/products.json?limit=250&page=${pagina}`,
      { headers: { "User-Agent": "Mozilla/5.0" } }
    );
    if (!r.ok) break;
    const { products } = (await r.json()) as {
      products: { variants: { sku: string | null; price: string }[] }[];
    };
    if (!products.length) break;
    for (const p of products) {
      for (const v of p.variants) {
        const preco = Number(v.price);
        if (v.sku && preco > 0) mapa.set(v.sku, preco);
      }
    }
  }
  return mapa;
}

interface Variante {
  id: string;
  sku: string | null;
  price: string;
  productId: string;
}

async function lerVariantes(creds: ShopifyCredentials): Promise<Variante[]> {
  const query = `query Catalogo($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id sku price product { id } }
    }
  }`;

  const todas: Variante[] = [];
  let cursor: string | null = null;
  for (;;) {
    const dados: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        nodes: { id: string; sku: string | null; price: string; product: { id: string } }[];
      };
    } = await shopifyGraphQL(creds, query, { cursor });
    for (const no of dados.productVariants.nodes) {
      todas.push({ id: no.id, sku: no.sku, price: no.price, productId: no.product.id });
    }
    if (!dados.productVariants.pageInfo.hasNextPage) break;
    cursor = dados.productVariants.pageInfo.endCursor;
  }
  return todas;
}

async function gravar(
  creds: ShopifyCredentials,
  productId: string,
  variants: { id: string; price: string }[]
) {
  const query = `mutation Reprecificar($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
    productVariantsBulkUpdate(productId: $productId, variants: $variants) {
      productVariants { id }
      userErrors { field message }
    }
  }`;
  const r = await shopifyGraphQL(creds, query, { productId, variants });
  const erros = r?.productVariantsBulkUpdate?.userErrors as { message: string }[] | undefined;
  if (erros?.length) throw new Error(erros.map((e) => e.message).join(" | "));
}

async function credenciais(dominio: string): Promise<ShopifyCredentials & { nome: string }> {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data } = await admin
    .from("stores")
    .select("name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", dominio)
    .single();
  if (!data) throw new Error(`loja ${dominio} nao encontrada`);
  return {
    nome: data.name,
    shopDomain: data.shop_domain,
    clientId: data.client_id,
    clientSecret: data.client_secret,
    accessToken: data.access_token,
  };
}

async function main() {
  const referencia = await precosDaReferencia();
  console.log(`${REFERENCIA}: ${referencia.size} SKUs com preco`);

  for (const dominio of LOJAS) {
    const loja = await credenciais(dominio);
    console.log(`\n== ${loja.nome} (${dominio}) ==`);
    const variantes = await lerVariantes(loja);

    const porProduto = new Map<string, { id: string; price: string }[]>();
    let iguais = 0;
    let semPar = 0;
    let noTeto = 0;
    const novos: number[] = [];

    for (const v of variantes) {
      const base = v.sku ? referencia.get(v.sku) : undefined;
      if (!base) {
        semPar += 1;
        continue;
      }
      const preco = Math.min(TETO, noventa(base * (1 - DESCONTO)));
      novos.push(preco);
      if (preco === TETO) noTeto += 1;
      if (Number(v.price) === preco) {
        iguais += 1;
        continue;
      }
      const lista = porProduto.get(v.productId) || [];
      lista.push({ id: v.id, price: String(preco) });
      porProduto.set(v.productId, lista);
    }

    const total = [...porProduto.values()].reduce((s, l) => s + l.length, 0);
    const medio = novos.length
      ? Math.round(novos.reduce((a, b) => a + b, 0) / novos.length)
      : 0;
    console.log(
      `  ${variantes.length} variantes | ${total} a mudar | ${iguais} ja corretas | ${semPar} sem par na referencia`
    );
    console.log(`  preco medio ${medio.toLocaleString("pt-BR")} | ${noTeto} no teto`);

    if (!APLICAR) continue;

    let feitos = 0;
    for (const [productId, variants] of porProduto) {
      await gravar(loja, productId, variants);
      feitos += variants.length;
      if (feitos % 500 < variants.length) console.log(`    ${feitos}/${total}…`);
    }
    console.log(`  gravadas ${feitos} variantes`);
  }

  if (!APLICAR) console.log("\n(simulacao — rode com --aplicar para gravar)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
