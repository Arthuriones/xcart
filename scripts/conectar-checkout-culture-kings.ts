/**
 * Leva o catalogo da vitrine para a loja de checkout e cria a rota.
 *
 * Modo "so conectar" com neutralizacao PARCIAL, que foi o pedido: o texto
 * perde a marca, a foto continua a original. A neutralizacao de imagem gera
 * arte nova com IA e custa caro; enquanto o catalogo ainda vai mudar, gastar
 * isso e jogar credito fora.
 *
 * O que NAO muda, nunca: o SKU. Ele e a unica chave que liga a variante da
 * vitrine a do checkout depois que titulo e foto foram reescritos. Mexer nele
 * quebra a rota inteira.
 *
 * Fase 1 -- copia os produtos, com o texto passado pelo neutralizador.
 * Fase 2 -- casa variante por SKU e grava a rota + o destino.
 *
 * A fase 1 roda em PARALELO porque o gargalo e a espera, nao a maquina: a
 * chamada de texto ao Gemini leva ~13s por produto, e em fila os 228 dariam
 * mais de uma hora quase toda ela parada esperando resposta. Com 6 em voo o
 * tempo cai para algo em torno de 12 minutos.
 *
 * E retomavel de proposito: le os SKUs que ja existem no destino e so trabalha
 * no que falta. Pode parar e religar sem duplicar produto.
 *
 * Uso:  npx tsx scripts/conectar-checkout-culture-kings.ts [--aplicar] [--limite=N] [--paralelo=6]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { createProduct, shopifyGraphQL, type ShopifyCredentials } from "../src/lib/shopify/client";

config({ path: ".env.local" });



const VITRINE = "vvq0qq-ih.myshopify.com";
const CHECKOUT = "imftvs-gc.myshopify.com";
const IDIOMA = "en-AU";
const APLICAR = process.argv.includes("--aplicar");
const LIMITE = Number((process.argv.find((a) => a.startsWith("--limite=")) || "--limite=0").split("=")[1]);
/** Quantos produtos em voo ao mesmo tempo. Acima de ~8 a Shopify comeca a
 *  responder 429 e o ganho vira espera de backoff. */
const PARALELO = Number((process.argv.find((a) => a.startsWith("--paralelo=")) || "--paralelo=6").split("=")[1]);

interface Variante { id: string; sku: string | null; price: string; compareAtPrice: string | null; title: string; selectedOptions: { name: string; value: string }[] }
interface Produto {
  id: string; title: string; descriptionHtml: string; vendor: string; productType: string; tags: string[];
  options: { name: string }[];
  media: { nodes: { preview?: { image?: { url: string; altText: string | null } } }[] };
  variants: { nodes: Variante[] };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function credenciais(admin: any, dominio: string) {
  const { data } = await admin.from("stores")
    .select("id, user_id, name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", dominio).single();
  if (!data) throw new Error(`loja ${dominio} nao encontrada`);
  const d = data as unknown as { id: string; user_id: string; name: string; shop_domain: string; client_id: string; client_secret: string; access_token: string | null };
  return {
    row: d,
    creds: { shopDomain: d.shop_domain, clientId: d.client_id, clientSecret: d.client_secret, accessToken: d.access_token } as ShopifyCredentials,
  };
}

async function lerCatalogo(creds: ShopifyCredentials): Promise<Produto[]> {
  const todos: Produto[] = [];
  let cursor: string | null = null;
  for (;;) {
    const d: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: Produto[] } } =
      await shopifyGraphQL(creds, `query($cursor:String){
        products(first:50, after:$cursor){
          pageInfo { hasNextPage endCursor }
          nodes {
            id title descriptionHtml vendor productType tags
            options { name }
            media(first:10){ nodes { ... on MediaImage { preview { image { url altText } } } } }
            variants(first:100){ nodes { id sku price compareAtPrice title selectedOptions { name value } } }
          }
        }
      }`, { cursor });
    todos.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return todos;
}

/** Variantes da loja destino, indexadas por SKU. */
async function variantesPorSku(creds: ShopifyCredentials) {
  const mapa = new Map<string, string>();
  let cursor: string | null = null;
  for (;;) {
    const d: { productVariants: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { id: string; sku: string | null }[] } } =
      await shopifyGraphQL(creds, `query($cursor:String){
        productVariants(first:250, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes { id sku } }
      }`, { cursor });
    for (const v of d.productVariants.nodes) if (v.sku) mapa.set(v.sku.trim(), v.id);
    if (!d.productVariants.pageInfo.hasNextPage) break;
    cursor = d.productVariants.pageInfo.endCursor;
  }
  return mapa;
}

(async () => {
  // O neutralizador instancia o cliente do Gemini no topo do modulo, lendo
  // GEMINI_API_KEY. Import estatico e icado para ANTES do config() la em cima,
  // entao ele subiria sem chave -- por isso entra aqui, ja com o .env lido.
  const { neutralizeProductForDestination } = await import("../src/lib/ai/product-neutralizer");

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const vit = await credenciais(admin, VITRINE);
  const chk = await credenciais(admin, CHECKOUT);

  console.log("vitrine :", vit.row.name);
  console.log("checkout:", chk.row.name);

  const catalogo = await lerCatalogo(vit.creds);
  const jaNoDestino = await variantesPorSku(chk.creds);
  const pendentes = catalogo.filter((p) =>
    p.variants.nodes.some((v) => v.sku && !jaNoDestino.has(v.sku.trim()))
  );
  const alvo = LIMITE > 0 ? pendentes.slice(0, LIMITE) : pendentes;

  console.log(`\nvitrine: ${catalogo.length} produtos`);
  console.log(`checkout: ${jaNoDestino.size} variantes ja la`);
  console.log(`a copiar: ${alvo.length} produtos`);

  if (!APLICAR) {
    console.log("\n--- ensaio. Rode com --aplicar. ---");
    if (alvo[0]) {
      console.log("\nexemplo do que sera neutralizado (so texto):");
      console.log("  antes:", alvo[0].title);
      const n = await neutralizeProductForDestination({
        userId: vit.row.user_id, title: alvo[0].title, descriptionHtml: alvo[0].descriptionHtml,
        tags: alvo[0].tags, images: [], genericizeText: true, targetLanguage: IDIOMA, storageClient: admin,
      });
      console.log("  depois:", n.title);
      console.log("  tags:", n.tags.slice(0, 8).join(", "));
    }
    return;
  }

  // ---------------------------------------------------------- fase 1
  let criados = 0;
  let processados = 0;
  const falhas: { title: string; erro: string }[] = [];

  async function copiar(p: Produto) {
    const limpo = await neutralizeProductForDestination({
      userId: vit.row.user_id,
      title: p.title,
      descriptionHtml: p.descriptionHtml,
      tags: p.tags,
      images: [], // <- foto NAO passa pela IA: a original e reaproveitada
      genericizeText: true,
      targetLanguage: IDIOMA,
      storageClient: admin,
    });

    const imagens = p.media.nodes
      .map((m) => m.preview?.image)
      .filter((x): x is { url: string; altText: string | null } => Boolean(x?.url))
      .map((img) => ({ src: img.url, altText: limpo.title }));

    await createProduct(chk.creds, {
      title: limpo.title,
      descriptionHtml: limpo.descriptionHtml,
      tags: limpo.tags,
      productType: p.productType,
      // sem vendor: e a marca que a loja de checkout precisa nao exibir
      images: imagens,
      options: p.options.map((o) => o.name),
      variants: p.variants.nodes
        .filter((v) => v.sku)
        .map((v) => ({
          sku: v.sku!.trim(),
          price: v.price,
          compareAtPrice: v.compareAtPrice || undefined,
          options: v.selectedOptions.map((o) => o.value),
          inventoryTracked: false,
        })),
      publishToStorefront: true,
    });
  }

  // Fila com N trabalhadores puxando do mesmo indice: mantem sempre N em voo,
  // em vez de esperar o lote inteiro terminar para comecar o proximo.
  let proximo = 0;
  async function trabalhador() {
    for (;;) {
      const i = proximo;
      proximo += 1;
      if (i >= alvo.length) return;
      const p = alvo[i];
      try {
        await copiar(p);
        criados += 1;
      } catch (e) {
        falhas.push({ title: p.title, erro: (e as Error).message.slice(0, 140) });
      }
      processados += 1;
      if (processados % 10 === 0 || processados === alvo.length) {
        console.log(`   ${processados}/${alvo.length} · ${criados} criados · ${falhas.length} falhas`);
      }
    }
  }

  console.log(`\ncopiando com ${PARALELO} em paralelo…`);
  await Promise.all(Array.from({ length: Math.min(PARALELO, alvo.length) }, trabalhador));

  console.log(`\nfase 1: ${criados} criados, ${falhas.length} falhas`);
  falhas.slice(0, 8).forEach((f) => console.log(`   ${f.title}: ${f.erro}`));

  // ---------------------------------------------------------- fase 2
  console.log("\nfase 2: casando por SKU…");
  const destino = await variantesPorSku(chk.creds);
  const skuMap: Record<string, string> = {};
  const variantMap: Record<string, string> = {};
  let semPar = 0;
  for (const p of catalogo) {
    for (const v of p.variants.nodes) {
      if (!v.sku) continue;
      const alvoId = destino.get(v.sku.trim());
      if (!alvoId) { semPar += 1; continue; }
      skuMap[v.sku.trim()] = alvoId;
      variantMap[v.id] = alvoId;
    }
  }
  const total = catalogo.reduce((a, p) => a + p.variants.nodes.filter((v) => v.sku).length, 0);
  const cobertura = total > 0 ? Math.round((Object.keys(variantMap).length / total) * 100) : 0;
  console.log(`   ${Object.keys(variantMap).length} de ${total} variantes casadas (${cobertura}%) · ${semPar} sem par`);

  const seguro = cobertura >= 95;
  const { data: rota, error } = await admin
    .from("routed_checkout_configs")
    .insert({
      user_id: vit.row.user_id,
      source_store_id: vit.row.id,
      target_store_id: chk.row.id,
      name: `${vit.row.name} -> ${chk.row.name}`,
      mode: "enterprise_static",
      public_token: randomUUID(),
      // Rota com cobertura ruim nasce desligada: melhor o dono ver o aviso
      // antes de mandar trafego para um checkout que perde linha de carrinho.
      enabled: seguro,
      sku_map: skuMap,
      variant_map: variantMap,
      settings: { generatedBy: "script_conectar_culture_kings" },
    })
    .select("id, public_token")
    .single();
  if (error) { console.log("ERRO ao criar rota:", error.message); return; }

  await admin.from("routed_checkout_targets").insert({
    route_id: rota.id,
    target_store_id: chk.row.id,
    weight: 1,
    enabled: true,
    sku_map: skuMap,
    variant_map: variantMap,
    settings: { generatedBy: "script_conectar_culture_kings" },
    position: 0,
  });

  console.log(`\nrota criada: ${rota.id}`);
  console.log(`token: ${rota.public_token}`);
  console.log(`estado: ${seguro ? "ATIVA" : "desligada (cobertura abaixo de 95%)"}`);
})();
