/**
 * Reprecifica a operacao Block a partir do preco riscado.
 *
 * A importacao achatou o preco de venda em 29.990 CLP para TODAS as variantes
 * das duas lojas. O preco riscado, esse, sobreviveu intacto e varia de 39.990
 * a 109.990 -- e o valor real de cada tenis. Entao nao ha nada para inventar:
 * o preco de venda sai dele.
 *
 *   preco = clamp(arredonda_990(riscado * 0.70), 39.990, 79.990)
 *
 * O calculo roda UMA vez, sobre o catalogo da vitrine, indexado por SKU. As
 * duas lojas recebem o mesmo valor para o mesmo SKU -- se divergissem, o
 * comprador veria um preco na vitrine e pagaria outro no checkout.
 *
 * Uso:  npx tsx scripts/reprecificar-block.ts [--aplicar]
 * Sem --aplicar, so mostra o que faria.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, type ShopifyCredentials } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const VITRINE = "q2mdgs-ag.myshopify.com";
const CHECKOUT = "5sx1nu-sx.myshopify.com";
const DESCONTO = 0.3;
const PISO = 39990;
const TETO = 79990;

const APLICAR = process.argv.includes("--aplicar");

/** Termina em .990, como o resto do catalogo. */
function noventa(valor: number) {
  return Math.round((valor - 990) / 1000) * 1000 + 990;
}

function precoDe(riscado: number) {
  return Math.min(TETO, Math.max(PISO, noventa(riscado * (1 - DESCONTO))));
}

interface Variante {
  id: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  productId: string;
}

async function lerVariantes(creds: ShopifyCredentials): Promise<Variante[]> {
  const query = `query Catalogo($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        sku
        price
        compareAtPrice
        product { id }
      }
    }
  }`;

  const todas: Variante[] = [];
  let cursor: string | null = null;
  for (;;) {
    const dados: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        nodes: {
          id: string;
          sku: string | null;
          price: string;
          compareAtPrice: string | null;
          product: { id: string };
        }[];
      };
    } = await shopifyGraphQL(creds, query, { cursor });
    for (const no of dados.productVariants.nodes) {
      todas.push({
        id: no.id,
        sku: no.sku,
        price: no.price,
        compareAtPrice: no.compareAtPrice,
        productId: no.product.id,
      });
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
  const vitrine = await credenciais(VITRINE);
  const checkout = await credenciais(CHECKOUT);

  console.log(`Lendo ${vitrine.nome}…`);
  const varsVitrine = await lerVariantes(vitrine);
  console.log(`  ${varsVitrine.length} variantes`);

  // A tabela de precos sai do riscado da VITRINE, indexada por SKU. E a mesma
  // chave que o roteamento usa, entao as duas lojas casam por construcao.
  const precoPorSku = new Map<string, number>();
  let semRiscado = 0;
  for (const v of varsVitrine) {
    if (!v.sku) continue;
    const riscado = Number(v.compareAtPrice || 0);
    if (!riscado) {
      semRiscado += 1;
      continue;
    }
    precoPorSku.set(v.sku, precoDe(riscado));
  }
  console.log(`  ${precoPorSku.size} SKUs com preco calculado` + (semRiscado ? `, ${semRiscado} sem riscado (ficam como estao)` : ""));

  for (const loja of [vitrine, checkout]) {
    console.log(`\n== ${loja.nome} (${loja.shopDomain}) ==`);
    const variantes = loja.shopDomain === VITRINE ? varsVitrine : await lerVariantes(loja);

    const porProduto = new Map<string, { id: string; price: string }[]>();
    let iguais = 0;
    let semPar = 0;
    for (const v of variantes) {
      const novo = v.sku ? precoPorSku.get(v.sku) : undefined;
      if (novo === undefined) {
        semPar += 1;
        continue;
      }
      if (Number(v.price) === novo) {
        iguais += 1;
        continue;
      }
      const lista = porProduto.get(v.productId) || [];
      lista.push({ id: v.id, price: String(novo) });
      porProduto.set(v.productId, lista);
    }

    const total = [...porProduto.values()].reduce((s, l) => s + l.length, 0);
    console.log(`  ${variantes.length} variantes | ${total} a mudar | ${iguais} ja corretas | ${semPar} sem par por SKU`);

    if (!APLICAR) {
      const amostra = [...porProduto.values()].flat().slice(0, 5);
      amostra.forEach((v) => console.log(`    ex.: ${v.id.split("/").pop()} -> ${Number(v.price).toLocaleString("pt-BR")}`));
      continue;
    }

    let feitos = 0;
    for (const [productId, variants] of porProduto) {
      await gravar(loja, productId, variants);
      feitos += variants.length;
      if (feitos % 250 < variants.length) console.log(`    ${feitos}/${total}…`);
    }
    console.log(`  gravadas ${feitos} variantes`);
  }

  if (!APLICAR) console.log("\n(simulacao — rode com --aplicar para gravar)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
