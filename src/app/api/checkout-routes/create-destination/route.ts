import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  createProduct,
  getProducts,
  getProductsCount,
  updateVariantSkus,
  type ShopifyCredentials,
} from "@/lib/shopify/client";
import {
  neutralizeProductForDestination,
  translateProductForDestination,
} from "@/lib/ai/product-neutralizer";
import {
  enqueueImageNeutralizeJobs,
  requestImageQueueDrain,
  type ImageNeutralizeItem,
} from "@/lib/jobs/image-neutralize-processor";
import { translateProductVariantOptionsToPortuguese } from "@/lib/products/variant-translation";
import { AI_COST, logAiUsage } from "@/lib/billing/usage";
import { createClient } from "@/lib/supabase/server";
import { lojaDoUsuario } from "@/lib/stores/authorize";

export const runtime = "nodejs";
export const maxDuration = 300;

function clampAiMediaLimit(value: unknown, fallback = 1) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), 20);
}

interface ConnectedVariant {
  id: string;
  title: string;
  sku?: string | null;
  price?: string;
  compareAtPrice?: string | null;
  selectedOptions?: { name: string; value: string }[];
}

interface ConnectedProduct {
  id: string;
  title: string;
  handle: string;
  status?: string;
  descriptionHtml?: string;
  tags?: string[];
  seo?: { title?: string; description?: string };
  images?: { nodes?: { url: string; altText?: string | null }[] };
  options?: { name: string; values?: string[] }[];
  variants?: { nodes?: ConnectedVariant[] };
}

interface DestinationProductInput {
  title: string;
  descriptionHtml: string;
  tags: string[];
  images: { src: string; altText: string }[];
  options?: string[];
  variants: {
    price: string;
    compareAtPrice?: string;
    options?: string[];
    inventoryTracked?: boolean;
    inventoryQuantity?: number;
    sku?: string;
  }[];
  seo: { title: string; description: string };
  publishToStorefront: boolean;
}

async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

function variantSignature(variant: ConnectedVariant) {
  return (variant.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean)
    .join(" / ")
    .toLowerCase();
}

function buildVariantMaps(
  sourceProduct: ConnectedProduct,
  targetProduct: { variants?: { nodes?: ConnectedVariant[] } } | null | undefined
) {
  const sourceVariants = sourceProduct.variants?.nodes || [];
  const targetVariants = targetProduct?.variants?.nodes || [];
  const targetBySignature = new Map(
    targetVariants.map((variant) => [variantSignature(variant), variant.id])
  );

  const skuMap: Record<string, string> = {};
  const variantMap: Record<string, string> = {};

  sourceVariants.forEach((sourceVariant, index) => {
    const targetId =
      targetBySignature.get(variantSignature(sourceVariant)) ||
      targetVariants[index]?.id;

    if (!targetId) return;

    variantMap[sourceVariant.id] = targetId;
    if (sourceVariant.sku?.trim()) {
      skuMap[sourceVariant.sku.trim()] = targetId;
    }
  });

  return { skuMap, variantMap };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90);
}

function toCreateProductInput(product: ConnectedProduct): DestinationProductInput {
  const variants = product.variants?.nodes || [];
  const optionNames =
    product.options
      ?.map((option) => option.name)
      .filter((name) => name && name !== "Title") || [];
  const hasOptions = variants.length > 1 && optionNames.length > 0;

  return {
    title: product.title,
    descriptionHtml: product.descriptionHtml || `<p>${product.title}</p>`,
    tags: product.tags || [],
    images:
      product.images?.nodes?.map((image) => ({
        src: image.url,
        altText: image.altText || product.title,
      })) || [],
    options: hasOptions ? optionNames : undefined,
    variants: variants.length
      ? variants.slice(0, 100).map((variant) => ({
          price: String(variant.price || "0.00"),
          compareAtPrice: variant.compareAtPrice
            ? String(variant.compareAtPrice)
            : undefined,
          // Copia o SKU da vitrine para a loja checkout: assim a conexao das
          // variantes acontece automaticamente por SKU (sku_map), mesmo apos
          // neutralizar/traduzir, sem precisar linkar produto por produto.
          sku: variant.sku?.trim() || undefined,
          options: hasOptions
            ? optionNames.map(
                (optionName) =>
                  variant.selectedOptions?.find((option) => option.name === optionName)
                    ?.value || "Default"
              )
            : undefined,
        }))
      : [{ price: "0.00" }],
    seo: {
      title: product.seo?.title || product.title,
      description: product.seo?.description || product.title,
    },
    publishToStorefront: true,
  };
}

function withInventorySettings(
  input: DestinationProductInput,
  inventory: { tracked: boolean; quantity?: number }
): DestinationProductInput {
  return {
    ...input,
    variants: input.variants.map((variant) => ({
      ...variant,
      inventoryTracked: inventory.tracked,
      ...(inventory.tracked && typeof inventory.quantity === "number"
        ? { inventoryQuantity: inventory.quantity }
        : {}),
    })),
  };
}

async function toDestinationProductInput({
  product,
  neutralize,
  translate,
  supabase,
  userId,
  targetLanguage,
  translateVariantOptions,
  neutralizationInstructions,
  aiMediaLimit,
  genericizeText,
  deferImages,
  heroOnly,
}: {
  product: ConnectedProduct;
  neutralize: boolean;
  translate: boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  userId: string;
  targetLanguage: string;
  translateVariantOptions: boolean;
  neutralizationInstructions: string;
  aiMediaLimit: number;
  genericizeText: boolean;
  // Quando true, neutraliza so o texto aqui; a imagem vira job de background.
  deferImages?: boolean;
  // Quando true, mantem apenas a imagem principal (loja checkout usa 1 imagem).
  heroOnly?: boolean;
}) {
  const base = translateVariantOptions
    ? translateProductVariantOptionsToPortuguese(toCreateProductInput(product))
    : toCreateProductInput(product);
  const input =
    heroOnly && base.images.length > 1
      ? { ...base, images: base.images.slice(0, 1) }
      : base;
  if (!neutralize && !translate) {
    return {
      productForLookup: product,
      productInput: input,
      neutralizationWarnings: [] as string[],
      translated: false,
    };
  }

  if (translate && !neutralize) {
    const translated = await translateProductForDestination({
      title: product.title,
      descriptionHtml: product.descriptionHtml,
      tags: product.tags,
      seo: product.seo,
      targetLanguage,
    });
    const productForLookup: ConnectedProduct = {
      ...product,
      title: translated.title,
      handle: slugify(translated.title) || product.handle,
      descriptionHtml: translated.descriptionHtml,
      tags: translated.tags,
      seo: translated.seo,
    };

    return {
      productForLookup,
      productInput: {
        ...input,
        title: translated.title,
        descriptionHtml: translated.descriptionHtml,
        tags: translated.tags,
        seo: translated.seo,
      },
      neutralizationWarnings: [] as string[],
      translated: true,
    };
  }

  const neutralized = await neutralizeProductForDestination({
    userId,
    title: product.title,
    descriptionHtml: product.descriptionHtml,
    tags: product.tags,
    seo: product.seo,
    images: product.images?.nodes?.map((image) => ({
      url: image.url,
      altText: image.altText,
    })),
    // maxImages = 0 => neutraliza so o texto; a imagem fica para a fila.
    maxImages: deferImages ? 0 : aiMediaLimit,
    storageClient: supabase,
    targetLanguage,
    customInstructions: neutralizationInstructions,
    genericizeText,
  });

  const productForLookup: ConnectedProduct = {
    ...product,
    title: neutralized.title,
    handle: slugify(neutralized.title) || product.handle,
    descriptionHtml: neutralized.descriptionHtml,
    tags: neutralized.tags,
    seo: neutralized.seo,
  };

  return {
    productForLookup,
    productInput: {
      ...input,
      title: neutralized.title,
      descriptionHtml: neutralized.descriptionHtml,
      tags: neutralized.tags,
      images:
        neutralized.images.length > 0
          ? [
              ...neutralized.images,
              ...input.images.slice(neutralized.images.length),
            ]
          : input.images,
      seo: neutralized.seo,
    },
    neutralizationWarnings: neutralized.warnings,
    translated: true,
  };
}

// Busca por SKU exato, sem depender de nada gerado por IA.
//
// Serve como pre-checagem barata antes de traduzir/neutralizar: os SKUs vem da
// vitrine e nao mudam com a IA, entao se o produto ja existe no destino da para
// pular a chamada ao Gemini inteira. Antes a IA rodava SEMPRE, mesmo em
// re-execucoes onde 100% dos produtos ja existiam.
async function findExistingBySku(
  creds: ShopifyCredentials,
  sourceProduct: ConnectedProduct
): Promise<ConnectedProduct | null> {
  const sourceSkus = (sourceProduct.variants?.nodes || [])
    .map((variant) => variant.sku?.trim())
    .filter(Boolean) as string[];
  if (sourceSkus.length === 0) return null;

  const sourceSkuSet = new Set(sourceSkus);
  const skuResult = await getProducts(creds, {
    first: 50,
    query: `sku:${sourceSkus[0]}`,
  });
  const candidates = (skuResult?.products?.nodes || []) as ConnectedProduct[];
  // A busca `sku:` da Shopify e tokenizada — confirmar match exato (ver
  // comentario em findExistingProduct).
  return (
    candidates.find((product) =>
      (product.variants?.nodes || []).some(
        (variant) => variant.sku && sourceSkuSet.has(variant.sku.trim())
      )
    ) || null
  );
}

async function findExistingProduct(
  creds: ShopifyCredentials,
  sourceProduct: ConnectedProduct
) {
  // Primeiro tenta casar por SKU: e o sinal mais confiavel de que o mesmo
  // produto ja existe no destino, evitando falso positivo por titulo generico
  // igual (ex.: varios produtos com "Zapatilla Urbana Unisex Negro").
  const sourceSkus = (sourceProduct.variants?.nodes || [])
    .map((variant) => variant.sku?.trim())
    .filter(Boolean) as string[];
  if (sourceSkus.length > 0) {
    const sourceSkuSet = new Set(sourceSkus);
    const skuQuery = `sku:${sourceSkus[0]}`;
    const skuResult = await getProducts(creds, { first: 50, query: skuQuery });
    const candidates = (skuResult?.products?.nodes || []) as ConnectedProduct[];
    // A busca `sku:` da Shopify e tokenizada: ela quebra o SKU no "-" e casa
    // pelo tamanho (ex.: buscar "MODELO-035" tambem retorna "OUTRO-035"). Por
    // isso NAO basta pegar o primeiro resultado — precisamos confirmar que algum
    // candidato tem uma variante com o SKU EXATO do produto de origem. Sem isso,
    // dois modelos diferentes eram fundidos no mesmo produto do destino e as
    // variantes com opcao colidente (mesma cor+tamanho) eram descartadas pela
    // Shopify, deixando SKUs sem mapeamento na rota.
    const exactBySku = candidates.find((product) =>
      (product.variants?.nodes || []).some(
        (variant) => variant.sku && sourceSkuSet.has(variant.sku.trim())
      )
    );
    if (exactBySku) return exactBySku;
  }

  // Fallback: busca por handle exato (mais seguro que titulo).
  // Nao usa titulo como critério para evitar colisao entre produtos com
  // nomes genéricos identicos.
  const handleQuery = `handle:${sourceProduct.handle}`;
  const handleResult = await getProducts(creds, { first: 5, query: handleQuery });
  const byHandle = (handleResult?.products?.nodes || []) as ConnectedProduct[];
  const exact = byHandle.find((product) => product.handle === sourceProduct.handle);
  return exact || null;
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const supabase = await createClient();

  const body = await request.json().catch(() => ({}));
  const sourceStoreId =
    typeof body.sourceStoreId === "string" ? body.sourceStoreId : "";
  const targetStoreId =
    typeof body.targetStoreId === "string" ? body.targetStoreId : "";
  const neutralizeProducts = body.neutralizeProducts === true;
  // Modo da imagem:
  // - "queue": neutraliza texto na hora e troca a imagem em background (fila).
  // - "none": neutraliza so o texto; a imagem original e mantida (o usuario
  //   recria depois num app da Shopify). Mais rapido e sem custo de imagem.
  // - "inline": neutraliza imagem na hora (mais lento por produto).
  const imageNeutralizeMode =
    body.imageNeutralizeMode === "queue"
      ? "queue"
      : body.imageNeutralizeMode === "none"
        ? "none"
        : "inline";
  const queueImages = neutralizeProducts && imageNeutralizeMode === "queue";
  const skipImages = neutralizeProducts && imageNeutralizeMode === "none";
  // deferImages = neutraliza so o texto aqui (maxImages 0) e mantem a imagem
  // original no produto. Vale tanto para "queue" (troca depois) quanto "none".
  const deferImages = queueImages || skipImages;
  // loja checkout usa 1 imagem por produto; modo fila/none forca hero unico.
  const heroOnly = body.heroOnly === true || deferImages;
  const aiMediaLimit = clampAiMediaLimit(body.aiMediaLimit ?? body.maxImages, 1);
  const genericizeText = body.genericizeText !== false;
  const neutralizationInstructions =
    typeof body.neutralizationInstructions === "string"
      ? body.neutralizationInstructions.trim().slice(0, 1200)
      : "";
  const translateProducts =
    body.translateProducts === true || body.translateProduct === true;
  const translateVariantOptions = body.translateVariantOptions === true;
  const inventoryMode = body.inventoryMode === "tracked" ? "tracked" : "not_tracked";
  const inventoryQuantityRaw = Number(body.inventoryQuantity ?? 0);
  const inventoryQuantity =
    inventoryMode === "tracked" && Number.isFinite(inventoryQuantityRaw)
      ? Math.max(0, Math.floor(inventoryQuantityRaw))
      : undefined;
  const inventory = {
    tracked: inventoryMode === "tracked",
    quantity: inventoryQuantity,
  };
  // Paginacao por cursor: o cliente processa um lote por vez e mostra progresso.
  const cursor = typeof body.cursor === "string" && body.cursor ? body.cursor : null;
  const withCount = body.withCount === true;
  // Lote menor quando a imagem e gerada inline (mais lento por produto).
  const inlineImageWork = neutralizeProducts && !deferImages;
  const requestedPageSize = Number(body.pageSize || (inlineImageWork ? 8 : 20));
  const pageSize = Math.min(
    Math.max(Number.isFinite(requestedPageSize) ? Math.floor(requestedPageSize) : 20, 1),
    inlineImageWork ? 10 : 50
  );
  // Override de idioma de saida (ex.: "es" para loja do Chile). Cai no idioma
  // configurado na loja destino e, por fim, em pt-BR.
  const targetLanguageOverride =
    typeof body.targetLanguage === "string" && body.targetLanguage.trim()
      ? body.targetLanguage.trim().slice(0, 16)
      : "";

  if (!sourceStoreId || !targetStoreId) {
    return NextResponse.json(
      { error: "Selecione vitrine e loja checkout." },
      { status: 400 }
    );
  }

  if (sourceStoreId === targetStoreId) {
    return NextResponse.json(
      { error: "A loja checkout precisa ser diferente da vitrine." },
      { status: 400 }
    );
  }

  const [sourceStore, targetStore] = await Promise.all([
    lojaDoUsuario(sourceStoreId),
    lojaDoUsuario(targetStoreId),
  ]);

  if (!sourceStore || !targetStore) {
    return NextResponse.json(
      { error: "Uma das lojas selecionadas nao foi encontrada." },
      { status: 404 }
    );
  }

  const sourceCreds = {
    shopDomain: sourceStore.shop_domain,
    clientId: sourceStore.client_id,
    clientSecret: sourceStore.client_secret,
    accessToken: sourceStore.access_token,
  };
  const targetCreds = {
    shopDomain: targetStore.shop_domain,
    clientId: targetStore.client_id,
    clientSecret: targetStore.client_secret,
    accessToken: targetStore.access_token,
  };

  const targetLanguage =
    targetLanguageOverride || targetStore.target_language || "pt-BR";

  // Contagem rapida (sem processar nada): a UI mostra "0 de N" na hora,
  // antes do primeiro lote pesado de IA, pra nao parecer travado.
  if (body.countOnly === true) {
    const totalCountOnly = await getProductsCount(sourceCreds).catch(() => null);
    return NextResponse.json({ totalCount: totalCountOnly });
  }

  const sourceData = await getProducts(sourceCreds, {
    first: pageSize,
    after: cursor,
  });
  const sourceProducts = (sourceData?.products?.nodes || []) as ConnectedProduct[];
  const pageInfo = (sourceData?.products?.pageInfo || {}) as {
    hasNextPage?: boolean;
    endCursor?: string | null;
  };
  const totalCount = withCount
    ? await getProductsCount(sourceCreds).catch(() => null)
    : null;
  const created: { sourceHandle: string; targetProductId?: string }[] = [];
  const skipped: { sourceHandle: string; targetProductId?: string }[] = [];
  const failed: { sourceHandle: string; error: string }[] = [];
  const neutralized: { sourceHandle: string; title: string; warnings: string[] }[] = [];
  const translated: { sourceHandle: string; title: string }[] = [];
  const skuMap: Record<string, string> = {};
  const variantMap: Record<string, string> = {};
  const imageQueueItems: ImageNeutralizeItem[] = [];

  // userId ja foi garantido nao-nulo pelo guard no inicio; capturado aqui para
  // manter o tipo string dentro do closure processOne.
  const resolvedUserId: string = userId;

  async function processOne(product: ConnectedProduct) {
    if (request.signal.aborted) return;
    try {
      // Pre-checagem barata: os SKUs vem da vitrine e nao mudam com a IA, entao
      // se o produto ja existe no destino nao ha motivo para traduzir/
      // neutralizar antes de descobrir isso. Numa re-execucao com o catalogo ja
      // criado isso evita uma chamada de IA por produto.
      const alreadyThere = await findExistingBySku(targetCreds, product);
      if (alreadyThere?.id) {
        const maps = buildVariantMaps(product, alreadyThere);
        Object.assign(skuMap, maps.skuMap);
        Object.assign(variantMap, maps.variantMap);
        const skuUpdates = Object.entries(maps.skuMap).map(([sku, variantId]) => ({
          variantId,
          sku,
        }));
        if (skuUpdates.length > 0) {
          try {
            await updateVariantSkus(targetCreds, alreadyThere.id, skuUpdates);
          } catch {
            // SKU duplicado/limite nao deve derrubar a operacao.
          }
        }
        skipped.push({
          sourceHandle: product.handle,
          targetProductId: alreadyThere.id,
        });
        return;
      }

      const destination = await toDestinationProductInput({
        product,
        neutralize: neutralizeProducts,
        translate: translateProducts,
        supabase,
        userId: resolvedUserId,
        targetLanguage,
        translateVariantOptions,
        neutralizationInstructions,
        aiMediaLimit,
        genericizeText,
        deferImages,
        heroOnly,
      });

      // Medicao do custo de texto (imagem e medida na fila). deferImages cobre
      // os modos "queue" e "none" (so texto aqui). Inline tambem gera texto.
      if (neutralizeProducts) {
        await logAiUsage({
          userId: resolvedUserId,
          storeId: targetStoreId,
          action: "neutralize_text",
          costUsd: AI_COST.text,
          metadata: { handle: product.handle },
        });
        // Modo inline: a imagem foi neutralizada agora (nao na fila) -> mede aqui.
        if (!deferImages) {
          await logAiUsage({
            userId: resolvedUserId,
            storeId: targetStoreId,
            action: "neutralize_image",
            costUsd: AI_COST.image,
            creditsUsed: 1,
            metadata: { handle: product.handle, inline: true },
          });
        }
      } else if (translateProducts && destination.translated) {
        await logAiUsage({
          userId: resolvedUserId,
          storeId: targetStoreId,
          action: "translate",
          costUsd: AI_COST.text,
          metadata: { handle: product.handle },
        });
      }

      const existing = await findExistingProduct(
        targetCreds,
        destination.productForLookup
      );
      if (existing?.id) {
        const maps = buildVariantMaps(product, existing);
        Object.assign(skuMap, maps.skuMap);
        Object.assign(variantMap, maps.variantMap);
        // Carimba os SKUs da vitrine nas variantes ja existentes da loja checkout,
        // pra que a conexao por SKU passe a funcionar sem recriar o produto.
        const skuUpdates = Object.entries(maps.skuMap).map(([sku, variantId]) => ({
          variantId,
          sku,
        }));
        if (skuUpdates.length > 0) {
          try {
            await updateVariantSkus(targetCreds, existing.id, skuUpdates);
          } catch (skuError) {
            // Nao falha a operacao inteira por causa de SKU duplicado/limite.
            console.warn(
              `Falha ao carimbar SKU em ${product.handle}:`,
              skuError instanceof Error ? skuError.message : skuError
            );
          }
        }
        skipped.push({ sourceHandle: product.handle, targetProductId: existing.id });
        return;
      }

      const result = await createProduct(
        targetCreds,
        withInventorySettings(destination.productInput, inventory)
      );
      const targetProduct = result?.syncedProduct as
        | { id?: string; variants?: { nodes?: ConnectedVariant[] } }
        | null
        | undefined;
      const maps = buildVariantMaps(product, targetProduct);
      Object.assign(skuMap, maps.skuMap);
      Object.assign(variantMap, maps.variantMap);
      created.push({
        sourceHandle: product.handle,
        targetProductId: targetProduct?.id,
      });

      // Modo fila: produto entra com a imagem original; o hero neutralizado
      // sera trocado em background. No modo "none" nao enfileira nada.
      const heroSource = destination.productInput.images?.[0]?.src;
      if (queueImages && targetProduct?.id && heroSource) {
        imageQueueItems.push({
          productId: targetProduct.id,
          imageUrl: heroSource,
          title: destination.productInput.title,
          mode: "stock-neutralize",
          customInstructions: neutralizationInstructions,
          targetLanguage,
        });
      }
      if (neutralizeProducts) {
        neutralized.push({
          sourceHandle: product.handle,
          title: destination.productInput.title,
          warnings: destination.neutralizationWarnings,
        });
      } else if (translateProducts && destination.translated) {
        translated.push({
          sourceHandle: product.handle,
          title: destination.productInput.title,
        });
      }
    } catch (error) {
      failed.push({
        sourceHandle: product.handle,
        error: error instanceof Error ? error.message : "Falha ao criar destino.",
      });
    }
  }

  // Pool de concorrencia: processa varios produtos do lote em paralelo. Em
  // sequencia, 20 produtos com chamada de IA + Shopify levavam ~2min e
  // estouravam o timeout da funcao (a barra ficava presa no 0). Em paralelo
  // cada lote volta em ~20-30s.
  const CONCURRENCY = 6;
  let nextIndex = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, sourceProducts.length) },
      async () => {
        while (nextIndex < sourceProducts.length) {
          if (request.signal.aborted) break;
          const current = sourceProducts[nextIndex++];
          await processOne(current);
        }
      }
    )
  );

  let imageQueueCount = 0;
  if (imageQueueItems.length > 0) {
    try {
      const { queued } = await enqueueImageNeutralizeJobs({
        userId,
        storeId: targetStoreId,
        items: imageQueueItems,
      });
      imageQueueCount = queued;
      const origin = request.nextUrl.origin;
      const cookie = request.headers.get("cookie") || "";
      after(() =>
        requestImageQueueDrain({ origin, cookie, storeId: targetStoreId })
      );
    } catch (error) {
      console.error(
        "[api/checkout-routes/create-destination] enqueue images error",
        error
      );
    }
  }

  return NextResponse.json({
    attempted: sourceProducts.length,
    createdCount: created.length,
    skippedCount: skipped.length,
    failedCount: failed.length,
    neutralizedCount: neutralized.length,
    translatedCount: translated.length,
    imageQueueCount,
    neutralizeProducts,
    translateProducts,
    targetLanguage,
    pageSize,
    nextCursor: pageInfo.endCursor || null,
    hasMore: Boolean(pageInfo.hasNextPage),
    totalCount,
    skuMap,
    variantMap,
    created,
    skipped,
    failed,
    neutralized,
    translated,
  });
}
