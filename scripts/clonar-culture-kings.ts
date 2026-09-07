/**
 * Monta a vitrine Culture Kings a partir do catalogo publico da origem.
 *
 * REGRA DE SELECAO -- so entra o que o fornecedor consegue autentico:
 *
 *   - Marca global de calcado esportivo (Nike, Adidas, Jordan, Puma, Asics,
 *     Converse, Reebok, Crocs, Timberland, Hey Dude).
 *   - Tipo calcado (Lows, Mids, Hi-top, Slip-on).
 *
 * Fica de fora TUDO que e marca da propria Culture Kings ou exclusivo dela --
 * Loiter, Carre, Saint Morta, 73Studio, XXIII, Vouseti, American Thrift,
 * Bleacher Athletic, Worship, Represent, MNML e a linha "Culture Kings". Nao
 * ha fornecedor para essas: sao roupa de casa, e o pedido cairia sem produto.
 *
 * PRECO: copiado cru, em AUD, sem conversao. A loja precisa ESTAR em AUD na
 * Shopify -- preco la e numero puro na moeda da loja. Ver o aviso no fim.
 *
 * SKU: copiado exatamente. E a unica chave que liga a vitrine a loja de
 * checkout depois; sem ele o roteamento nao tem como casar as variantes.
 *
 * Uso:  npx tsx scripts/clonar-culture-kings.ts [--aplicar] [--limite=230]
 * Sem --aplicar, so mostra o que faria.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { createProduct, type ShopifyCredentials } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const ORIGEM = "https://www.culturekings.com.au";
const VITRINE = "vvq0qq-ih.myshopify.com";

const MARCAS = [
  "nike",
  "adidas",
  "jordan",
  "puma",
  "asics",
  "converse",
  "reebok",
  "crocs",
  "timberland",
  "hey dude",
];
const TIPOS = new Set(["lows", "mids", "hi-top", "slip-on"]);

const APLICAR = process.argv.includes("--aplicar");
const LIMITE = Number(
  (process.argv.find((a) => a.startsWith("--limite=")) || "--limite=230").split("=")[1]
);

const UA = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36",
};

interface VarianteOrigem {
  sku: string | null;
  price: string;
  compare_at_price: string | null;
  option1: string | null;
  option2: string | null;
  option3: string | null;
  available: boolean;
}

interface ProdutoOrigem {
  title: string;
  handle: string;
  body_html: string;
  vendor: string;
  product_type: string;
  tags: string[];
  published_at: string;
  images: { src: string; alt: string | null }[];
  options: { name: string; values: string[] }[];
  variants: VarianteOrigem[];
}

async function lerCatalogo(): Promise<ProdutoOrigem[]> {
  const todos: ProdutoOrigem[] = [];
  for (let pagina = 1; pagina <= 15; pagina += 1) {
    const r = await fetch(`${ORIGEM}/products.json?limit=250&page=${pagina}`, {
      headers: UA,
    });
    if (!r.ok) break;
    const j = (await r.json()) as { products: ProdutoOrigem[] };
    if (!j.products.length) break;
    todos.push(...j.products);
    await new Promise((s) => setTimeout(s, 400));
  }
  return todos;
}

function selecionar(todos: ProdutoOrigem[]) {
  const elegiveis = todos.filter((p) => {
    const marca = (p.vendor || "").trim().toLowerCase();
    const tipo = (p.product_type || "").trim().toLowerCase();
    return MARCAS.includes(marca) && TIPOS.has(tipo);
  });

  // Reparte o teto entre as marcas na proporcao do que cada uma tem, para a
  // vitrine nao virar uma loja da Nike com um Puma perdido no meio. Cada marca
  // leva no minimo 3, e dentro dela entram os lancamentos mais recentes.
  const porMarca = new Map<string, ProdutoOrigem[]>();
  for (const p of elegiveis) {
    const m = p.vendor.trim();
    const lista = porMarca.get(m) || [];
    lista.push(p);
    porMarca.set(m, lista);
  }
  for (const lista of porMarca.values()) {
    lista.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
  }

  const total = elegiveis.length;
  const escolhidos: ProdutoOrigem[] = [];
  for (const [, lista] of porMarca) {
    const cota = Math.max(3, Math.round((lista.length / total) * LIMITE));
    escolhidos.push(...lista.slice(0, cota));
  }
  // O arredondamento por marca pode passar do teto: corta os mais antigos.
  escolhidos.sort((a, b) => +new Date(b.published_at) - +new Date(a.published_at));
  return escolhidos.slice(0, LIMITE);
}

/** Tag de navegacao da origem nao serve para nada aqui; marca e cor, sim. */
function tagsUteis(p: ProdutoOrigem) {
  const limpas = p.tags.filter(
    (t) =>
      !t.startsWith("sync-") &&
      !t.startsWith("YGroup_") &&
      !t.startsWith("sort:") &&
      !t.startsWith("shopify_collection-") &&
      !t.startsWith("nav_category:") &&
      !t.startsWith("category_hierarchy-") &&
      !t.startsWith("size-") &&
      !t.startsWith("keywords:") &&
      t !== "third_party" &&
      t !== "can-sell-internationally"
  );
  return [...new Set([p.vendor, ...limpas])].slice(0, 20);
}

function variantesDe(p: ProdutoOrigem) {
  return p.variants
    .filter((v) => v.sku && v.sku.trim())
    .map((v) => {
      const riscado = Number(v.compare_at_price || 0);
      return {
        sku: v.sku!.trim(),
        price: Number(v.price).toFixed(2),
        // A origem grava "0.00" quando nao ha promocao; isso viraria um
        // riscado de zero na vitrine.
        compareAtPrice: riscado > Number(v.price) ? riscado.toFixed(2) : undefined,
        options: [v.option1, v.option2, v.option3].filter(Boolean) as string[],
        // Sem rastreio de estoque: variante rastreada com 0 unidade bloqueia
        // a compra, e quem tem o estoque e o fornecedor, nao a loja.
        inventoryTracked: false,
      };
    });
}

(async () => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: loja } = await admin
    .from("stores")
    .select("name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", VITRINE)
    .single();
  if (!loja) throw new Error(`Loja ${VITRINE} nao encontrada.`);

  const creds: ShopifyCredentials = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };

  console.log("Lendo o catalogo da origem…");
  const todos = await lerCatalogo();
  const escolhidos = selecionar(todos);

  const porMarca = new Map<string, number>();
  let variantes = 0;
  for (const p of escolhidos) {
    porMarca.set(p.vendor, (porMarca.get(p.vendor) || 0) + 1);
    variantes += variantesDe(p).length;
  }

  console.log(`\nOrigem: ${todos.length} produtos`);
  console.log(`Selecionados: ${escolhidos.length} (teto ${LIMITE}) · ${variantes} variantes`);
  for (const [m, n] of [...porMarca].sort((a, b) => b[1] - a[1])) {
    console.log(`   ${String(n).padStart(3)}  ${m}`);
  }
  const precos = escolhidos.map((p) => Number(p.variants[0].price)).sort((a, b) => a - b);
  console.log(
    `Preco AUD: ${precos[0]} a ${precos[precos.length - 1]} (mediana ${precos[Math.floor(precos.length / 2)]})`
  );

  if (!APLICAR) {
    console.log("\n--- ensaio. Rode com --aplicar para gravar. ---");
    console.log("Primeiros 5:");
    escolhidos.slice(0, 5).forEach((p) => console.log(`   ${p.vendor} · ${p.title}`));
    return;
  }

  console.log(`\nCriando na vitrine ${VITRINE}…`);
  let criados = 0;
  const falhas: { title: string; erro: string }[] = [];

  for (const [i, p] of escolhidos.entries()) {
    try {
      await createProduct(creds, {
        title: p.title,
        descriptionHtml: p.body_html || "",
        vendor: p.vendor,
        productType: p.product_type,
        tags: tagsUteis(p),
        images: p.images.slice(0, 10).map((img) => ({
          src: img.src,
          altText: img.alt || p.title,
        })),
        options: p.options.map((o) => o.name),
        variants: variantesDe(p),
        publishToStorefront: true,
      });
      criados += 1;
      if ((i + 1) % 10 === 0 || i === escolhidos.length - 1) {
        console.log(`   ${i + 1}/${escolhidos.length} · ${criados} criados · ${falhas.length} falhas`);
      }
    } catch (e) {
      falhas.push({ title: p.title, erro: (e as Error).message.slice(0, 140) });
    }
    // A Shopify limita chamadas; o cliente ja tenta de novo em 429, mas um
    // respiro entre produtos evita entrar no limite o tempo todo.
    await new Promise((s) => setTimeout(s, 350));
  }

  console.log(`\nPronto: ${criados} criados, ${falhas.length} falhas.`);
  falhas.slice(0, 10).forEach((f) => console.log(`   ${f.title}: ${f.erro}`));
})();
