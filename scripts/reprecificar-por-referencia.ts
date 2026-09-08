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
 *   preco = clamp(arredonda_990(referencia * (1 - DESCONTO)), PISO, TETO)
 *
 * O PISO nao e detalhe. Sem ele, tenis que a referencia vende a 14.990 saem a
 * 12.990 CLP -- cerca de R$ 74 -- e ticket nesse nivel nao paga a operacao.
 *
 * Eu ja tirei esse piso uma vez, argumentando que o catalogo tinha camiseta e
 * kit de limpeza junto com tenis. Estava errado: aquilo e o catalogo da
 * REFERENCIA. A vitrine daqui e 100% Zapatillas, entao nao existe item barato
 * legitimo para proteger -- so tenis vendidos barato demais. Verifique o
 * product_type da loja que voce esta mexendo, nao o da que voce esta olhando.
 *
 * SKU sem par na referencia cai na media da categoria (marca + tipo), tirada
 * das variantes da vitrine que JA foram precificadas pela referencia. Sao
 * poucos itens -- cores que a referencia nao carrega -- e a media da categoria
 * os deixa coerentes com os vizinhos de prateleira em vez de presos no preco
 * velho.
 *
 * Uso:  npx tsx scripts/reprecificar-por-referencia.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, type ShopifyCredentials } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const REFERENCIA = "www.blockstore.cl";
/** A primeira e a vitrine: e dela que sai a tabela de precos das duas. */
const LOJAS = ["q2mdgs-ag.myshopify.com", "5sx1nu-sx.myshopify.com"];
const DESCONTO = 0.15;
const PISO = 39990;
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
  vendor: string;
  productType: string;
}

async function lerVariantes(creds: ShopifyCredentials): Promise<Variante[]> {
  const query = `query Catalogo($cursor: String) {
    productVariants(first: 250, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id sku price product { id vendor productType } }
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
          product: { id: string; vendor: string; productType: string };
        }[];
      };
    } = await shopifyGraphQL(creds, query, { cursor });
    for (const no of dados.productVariants.nodes) {
      todas.push({
        id: no.id,
        sku: no.sku,
        price: no.price,
        productId: no.product.id,
        vendor: no.product.vendor,
        productType: no.product.productType,
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
  const referencia = await precosDaReferencia();
  console.log(`${REFERENCIA}: ${referencia.size} SKUs com preco`);

  const vitrine = await credenciais(LOJAS[0]);
  const varsVitrine = await lerVariantes(vitrine);

  // ---- tabela de precos, por SKU, montada UMA vez sobre a vitrine ----
  //
  // A loja de checkout tem o catalogo neutralizado: marca e tipo la nao sao
  // confiaveis para agrupar. E de todo jeito as duas precisam do MESMO preco
  // para o mesmo SKU, senao o comprador ve um valor e paga outro.
  const preco = new Map<string, number>();
  const porCategoria = new Map<string, number[]>();

  for (const v of varsVitrine) {
    const base = v.sku ? referencia.get(v.sku) : undefined;
    if (!v.sku || !base) continue;
    const valor = Math.min(TETO, Math.max(PISO, noventa(base * (1 - DESCONTO))));
    preco.set(v.sku, valor);
    const chave = `${v.vendor}|${v.productType}`;
    const lista = porCategoria.get(chave) || [];
    lista.push(valor);
    porCategoria.set(chave, lista);
  }
  console.log(`${preco.size} SKUs precificados pela referencia`);

  // ---- o que a referencia nao cobre: media da categoria ----
  const orfaos = varsVitrine.filter((v) => v.sku && !preco.has(v.sku));
  const mediasUsadas = new Map<string, number>();
  for (const v of orfaos) {
    const chave = `${v.vendor}|${v.productType}`;
    const vizinhos = porCategoria.get(chave);
    if (!vizinhos?.length) continue;
    const media = noventa(vizinhos.reduce((a, b) => a + b, 0) / vizinhos.length);
    preco.set(v.sku!, media);
    mediasUsadas.set(chave, media);
  }
  if (orfaos.length) {
    console.log(`${orfaos.length} variantes sem par na referencia, pela media da categoria:`);
    for (const [chave, media] of mediasUsadas) {
      console.log(`  ${chave.replace("|", " / ")} -> ${media.toLocaleString("pt-BR")}`);
    }
  }

  for (const dominio of LOJAS) {
    const loja = dominio === LOJAS[0] ? vitrine : await credenciais(dominio);
    console.log(`\n== ${loja.nome} (${dominio}) ==`);
    const variantes = dominio === LOJAS[0] ? varsVitrine : await lerVariantes(loja);

    const porProduto = new Map<string, { id: string; price: string }[]>();
    let iguais = 0;
    let semPreco = 0;
    let noTeto = 0;
    const novos: number[] = [];

    for (const v of variantes) {
      const valor = v.sku ? preco.get(v.sku) : undefined;
      if (valor === undefined) {
        semPreco += 1;
        continue;
      }
      novos.push(valor);
      if (valor === TETO) noTeto += 1;
      if (Number(v.price) === valor) {
        iguais += 1;
        continue;
      }
      const lista = porProduto.get(v.productId) || [];
      lista.push({ id: v.id, price: String(valor) });
      porProduto.set(v.productId, lista);
    }

    const total = [...porProduto.values()].reduce((s, l) => s + l.length, 0);
    const medio = novos.length
      ? Math.round(novos.reduce((a, b) => a + b, 0) / novos.length)
      : 0;
    console.log(
      `  ${variantes.length} variantes | ${total} a mudar | ${iguais} ja corretas | ${semPreco} sem preco`
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
