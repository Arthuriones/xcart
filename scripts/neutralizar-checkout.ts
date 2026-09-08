// dotenv ANTES de qualquer import do app: o cliente do Gemini le a chave na
// carga do modulo, e import de ES module e icado para antes do corpo do
// arquivo. Foi exatamente esse o bug que deixou 64 produtos entrarem na loja
// de checkout com o nome da marca no titulo.
import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

/**
 * Neutraliza o texto de produtos que ja estao na loja de checkout.
 *
 * O healRoute so neutraliza na CRIACAO. Quando a neutralizacao falha ali -- por
 * chave ausente, por limite da API -- o produto e criado com o titulo original
 * e ninguem volta para consertar. Numa loja de checkout, titulo com marca e o
 * problema que a loja de checkout existe para evitar.
 *
 * Uso:  npx tsx scripts/neutralizar-checkout.ts <shop_domain> [--aplicar]
 */
const MARCAS =
  /\b(nike|adidas|vans|converse|new balance|puma|fila|asics|palladium|dc|jordan|reebok|originals)\b/i;

async function main() {
  const dominio = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  if (!dominio) {
    console.error("uso: npx tsx scripts/neutralizar-checkout.ts <shop_domain> [--aplicar]");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const { shopifyGraphQL } = await import("../src/lib/shopify/client");
  const { neutralizeProductForDestination } = await import(
    "../src/lib/ai/product-neutralizer"
  );

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: loja } = await admin
    .from("stores")
    .select("user_id, name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", dominio)
    .single();
  if (!loja) throw new Error(`loja ${dominio} nao encontrada`);

  const creds = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };

  // Lista os produtos com marca no titulo.
  const busca = `query Catalogo($cursor: String) {
    products(first: 100, after: $cursor) {
      pageInfo { hasNextPage endCursor }
      nodes { id title descriptionHtml tags vendor }
    }
  }`;

  const alvos: { id: string; title: string; descriptionHtml: string; tags: string[] }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const d: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        nodes: { id: string; title: string; descriptionHtml: string; tags: string[]; vendor: string }[];
      };
    } = await shopifyGraphQL(creds, busca, { cursor });
    for (const p of d.products.nodes) {
      if (MARCAS.test(p.title) || (p.vendor && MARCAS.test(p.vendor))) {
        alvos.push({ id: p.id, title: p.title, descriptionHtml: p.descriptionHtml, tags: p.tags });
      }
    }
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }

  console.log(`${loja.name}: ${alvos.length} produtos com marca no titulo ou no vendor`);
  if (!aplicar) {
    alvos.slice(0, 8).forEach((p) => console.log(`  ${p.title.slice(0, 64)}`));
    console.log("\n(simulacao — rode com --aplicar para neutralizar)");
    return;
  }

  const mutacao = `mutation Neutralizar($input: ProductInput!) {
    productUpdate(input: $input) { product { id } userErrors { field message } }
  }`;

  let feitos = 0;
  const falhas: string[] = [];
  for (const p of alvos) {
    try {
      const limpo = await neutralizeProductForDestination({
        userId: loja.user_id,
        title: p.title,
        descriptionHtml: p.descriptionHtml,
        tags: p.tags,
        // Sem imagem: aqui e so texto. Imagem consome credito e e outra decisao.
        images: [],
        genericizeText: true,
        targetLanguage: "es-CL",
        storageClient: admin,
      });

      const r = await shopifyGraphQL(creds, mutacao, {
        input: {
          id: p.id,
          title: limpo.title,
          descriptionHtml: limpo.descriptionHtml,
          tags: limpo.tags,
          // Vendor vazio: numa loja de checkout a marca nao e informacao de
          // venda, e rastro.
          vendor: "",
          seo: { title: limpo.seo.title, description: limpo.seo.description },
        },
      });
      const erros = r?.productUpdate?.userErrors as { message: string }[] | undefined;
      if (erros?.length) throw new Error(erros.map((e) => e.message).join(" | "));

      feitos += 1;
      if (feitos % 10 === 0) console.log(`  ${feitos}/${alvos.length}…`);
    } catch (erro) {
      falhas.push(`${p.title.slice(0, 40)}: ${erro instanceof Error ? erro.message : erro}`);
    }
  }

  console.log(`\nneutralizados ${feitos} | falhas ${falhas.length}`);
  falhas.slice(0, 5).forEach((f) => console.log(`  ${f}`));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
