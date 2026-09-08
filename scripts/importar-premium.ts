/**
 * Traz para a vitrine os tenis premium que a referencia tem e a vitrine nao.
 *
 * A importacao original pegou 310 dos 1.576 tenis da referencia, e a amostra
 * ficou concentrada no meio da tabela: dos 98 modelos que ela vende acima de
 * 79.990, a vitrine tinha 34. Uma vitrine sem topo de catalogo nao parece uma
 * loja de verdade -- o comprador que chega pelo anuncio de um New Balance caro
 * nao encontra nada parecido.
 *
 * O preco ja nasce certo: -12% sobre o preco da referencia, com o preco dela
 * no riscado. Nao passa pelo piso nem por teto nenhum, porque piso so existe
 * para proteger o rabo barato e aqui nao ha rabo barato.
 *
 * A loja de CHECKOUT nao e tocada aqui. Quem cria os pares dela e o healRoute
 * -- o mesmo codigo do botao "Corrigir" --, que neutraliza o texto e grava o
 * mapa de SKU. Reimplementar isso aqui seria manter duas versoes da mesma
 * regra.
 *
 * Uso:  npx tsx scripts/importar-premium.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createProduct, type ShopifyCredentials } from "../src/lib/shopify/client";
import {
  fetchPublicShopifyProductsByHandles,
  toShopifyCreateProductInput,
} from "../src/lib/shopify/public-store";

config({ path: ".env.local" });

const REFERENCIA = "www.blockstore.cl";
const VITRINE = "q2mdgs-ag.myshopify.com";
const DESCONTO = 0.12;
/** So o topo: abaixo disso a vitrine ja tem representacao de sobra. */
const CORTE = 79990;

const APLICAR = process.argv.includes("--aplicar");

function noventa(valor: number) {
  return Math.round((valor - 990) / 1000) * 1000 + 990;
}

interface ProdutoPublico {
  handle: string;
  title: string;
  vendor: string;
  product_type: string;
  variants: { sku: string | null; price: string }[];
}

async function catalogo(dominio: string): Promise<ProdutoPublico[]> {
  const out: ProdutoPublico[] = [];
  for (let pagina = 1; pagina <= 20; pagina += 1) {
    const r = await fetch(`https://${dominio}/products.json?limit=250&page=${pagina}`, {
      headers: { "User-Agent": "Mozilla/5.0" },
    });
    if (!r.ok) break;
    const { products } = (await r.json()) as { products: ProdutoPublico[] };
    if (!products.length) break;
    out.push(...products);
  }
  return out;
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
  const [ref, meu] = await Promise.all([catalogo(REFERENCIA), catalogo(VITRINE)]);
  const meusSkus = new Set(
    meu.flatMap((p) => p.variants).map((v) => v.sku).filter(Boolean) as string[]
  );

  const faltam = ref.filter(
    (p) =>
      (p.product_type || "").toLowerCase() === "zapatillas" &&
      Number(p.variants[0]?.price) > CORTE &&
      !p.variants.some((v) => v.sku && meusSkus.has(v.sku))
  );

  console.log(`${faltam.length} produtos premium a importar`);
  console.log(`${faltam.reduce((a, p) => a + p.variants.length, 0)} variantes`);

  if (!APLICAR) {
    faltam.slice(0, 10).forEach((p) => {
      const base = Number(p.variants[0].price);
      console.log(
        `  ${String(base).padStart(7)} -> ${String(noventa(base * (1 - DESCONTO))).padStart(7)}  ${p.title.slice(0, 54)}`
      );
    });
    console.log("\n(simulacao — rode com --aplicar para importar)");
    return;
  }

  const vitrine = await credenciais(VITRINE);
  console.log(`\nimportando para ${vitrine.nome}…`);

  // Busca os produtos completos (descricao, imagens, opcoes) em lotes, para
  // nao segurar 64 respostas grandes na memoria de uma vez.
  const LOTE = 8;
  let criados = 0;
  const falhas: { handle: string; erro: string }[] = [];

  for (let i = 0; i < faltam.length; i += LOTE) {
    const handles = faltam.slice(i, i + LOTE).map((p) => p.handle);
    const { products } = await fetchPublicShopifyProductsByHandles(REFERENCIA, handles);

    for (const produto of products) {
      try {
        const input = toShopifyCreateProductInput(produto);
        await createProduct(vitrine, {
          ...input,
          publishToStorefront: true,
          variants: input.variants.map((v) => {
            const base = Number(v.price);
            return {
              ...v,
              price: String(noventa(base * (1 - DESCONTO))),
              // O preco da referencia vira o "de" riscado.
              compareAtPrice: String(base),
              // Sem controle de estoque: variante rastreada com 0 unidades
              // bloqueia a compra, e nao ha estoque real para informar.
              inventoryTracked: false,
            };
          }),
        });
        criados += 1;
        if (criados % 10 === 0) console.log(`  ${criados}/${faltam.length}…`);
      } catch (erro) {
        falhas.push({
          handle: produto.handle,
          erro: erro instanceof Error ? erro.message : String(erro),
        });
      }
    }
  }

  console.log(`\ncriados ${criados} produtos | falhas ${falhas.length}`);
  falhas.slice(0, 10).forEach((f) => console.log(`  ${f.handle}: ${f.erro.slice(0, 100)}`));
  console.log(
    "\nAgora rode o Corrigir da rota (ou o cron de hora em hora) para criar os pares na loja de checkout e gravar o mapa de SKU."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
