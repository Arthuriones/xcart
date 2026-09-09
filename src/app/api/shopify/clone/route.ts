import { NextRequest, NextResponse } from "next/server";
import { after } from "next/server";
import {
  createProduct,
  getProducts,
  syncProductCollections,
  type ShopifyCredentials,
} from "@/lib/shopify/client";
import {
  enqueueImageNeutralizeJobs,
  requestImageQueueDrain,
  type ImageNeutralizeItem,
} from "@/lib/jobs/image-neutralize-processor";
import { optimizeProduct } from "@/lib/gemini/client";
import {
  neutralizeProductForDestination,
  removeExternalReferencesForDestination,
} from "@/lib/ai/product-neutralizer";
import { applyLogoToProductImages } from "@/lib/images/apply-logo";
import {
  attachCollectionsToProducts,
  type PublicShopifyProduct,
  fetchPublicShopifyCollections,
  fetchPublicShopifyProduct,
  fetchPublicShopifyProducts,
  fetchPublicShopifyProductsByHandles,
  normalizePublicShopifyDomain,
  productsToCsv,
  toShopifyCreateProductInput,
} from "@/lib/shopify/public-store";
import {
  fetchWooCommerceProducts,
  isWooCommerceStore,
} from "@/lib/import/woocommerce";
import {
  fetchShoplazzaProducts,
  isShoplazzaStore,
} from "@/lib/import/shoplazza";
import { createClient } from "@/lib/supabase/server";
import { lojaDoUsuario } from "@/lib/stores/authorize";
import { createAdminClient } from "@/lib/supabase/admin";
import { translateProductVariantOptionsToPortuguese } from "@/lib/products/variant-translation";
import { AI_COST, logAiUsage } from "@/lib/billing/usage";
import { checkAndConsumeFreeClone } from "@/lib/billing/access";
import type { StoreContext } from "@/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type CloneAction = "preview" | "export-json" | "export-csv" | "apply";
type DuplicatePolicy = "skip" | "create";

function clampAiMediaLimit(value: unknown, fallback = 1) {
  const numeric = Number(value ?? fallback);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(Math.max(Math.floor(numeric), 1), 20);
}

interface SyncedVariant {
  id: string;
  sku?: string | null;
  selectedOptions?: { name: string; value: string }[];
}

async function getAuthenticatedUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user?.id || null;
}

function toStoreContext(store: {
  name?: string | null;
  niche?: string | null;
  target_audience?: string | null;
  brand_voice?: string | null;
  store_description?: string | null;
  target_language?: string | null;
}): StoreContext | null {
  if (!store.niche) return null;
  return {
    name: store.name || "Loja",
    niche: store.niche,
    targetAudience: store.target_audience || "",
    brandVoice: store.brand_voice || "",
    storeDescription: store.store_description || "",
    targetLanguage: store.target_language || "pt-BR",
  };
}

async function buildCreateInputForTarget(
  product: PublicShopifyProduct,
  context: StoreContext | null,
  publishToStorefront: boolean,
  translateProduct: boolean,
  translateVariantOptions: boolean,
  inventory: { tracked: boolean; quantity?: number },
  customPrompt?: string
) {
  let input = {
    ...toShopifyCreateProductInput(product),
    publishToStorefront,
  };
  input.variants = input.variants.map((variant) => ({
    ...variant,
    inventoryTracked: inventory.tracked,
    ...(inventory.tracked && typeof inventory.quantity === "number"
      ? { inventoryQuantity: inventory.quantity }
      : {}),
  }));
  if (translateVariantOptions) {
    input = translateProductVariantOptionsToPortuguese(input);
  }

  if (!translateProduct || !context || !process.env.GEMINI_API_KEY) return input;

  const optimized = await optimizeProduct(
    {
      title: product.title,
      original_url: product.sourceUrl,
      description: product.descriptionHtml,
      price: Number(product.variants[0]?.price || 0),
      originalPrice: Number(
        product.variants[0]?.compareAtPrice || product.variants[0]?.price || 0
      ),
      images: product.images.map((image) => image.src),
      specs: {
        vendor: product.vendor || "",
        productType: product.productType || "",
      },
      rating: 0,
      orders: 0,
      variantOptions: product.options.map((option) => ({
        name: option,
        values: [
          ...new Set(
            product.variants
              .flatMap((variant) => variant.optionValues)
              .filter(Boolean)
          ),
        ].map((name) => ({ name })),
      })),
      variants: product.variants.map((variant) => ({
        sku: variant.sku || String(variant.id),
        properties: Object.fromEntries(
          product.options.map((option, index) => [
            option,
            variant.optionValues[index] || "",
          ])
        ),
        price: Number(variant.price || 0),
        originalPrice: Number(variant.compareAtPrice || variant.price || 0),
        stock: 0,
      })),
    },
    context,
    customPrompt
  );

  return {
    ...input,
    title: optimized.title,
    descriptionHtml: optimized.description,
    tags: optimized.tags,
    seo: {
      title: optimized.seoTitle,
      description: optimized.seoDescription,
    },
  };
}

type TargetCreateInput = Awaited<ReturnType<typeof buildCreateInputForTarget>>;

function toTransformedPreviewProduct(
  product: PublicShopifyProduct,
  productInput: TargetCreateInput,
  prepared: Awaited<ReturnType<typeof prepareCreateInputForImport>>
) {
  return {
    source: {
      title: product.title,
      handle: product.handle,
      images: product.images,
      variants: product.variants,
    },
    transformed: {
      title: prepared.productInput.title,
      descriptionHtml: prepared.productInput.descriptionHtml,
      tags: prepared.productInput.tags || [],
      seo: prepared.productInput.seo,
      images: prepared.productInput.images || [],
      variants: prepared.productInput.variants || [],
      options: prepared.productInput.options || [],
      publishToStorefront: prepared.productInput.publishToStorefront,
    },
    neutralized: prepared.neutralized,
    logoAppliedCount: prepared.logoAppliedCount,
    warnings: prepared.warnings,
    originalInput: productInput,
  };
}

async function prepareCreateInputForImport(input: {
  userId: string;
  targetStoreId: string;
  productInput: TargetCreateInput;
  targetLanguage: string;
  neutralizeProducts: boolean;
  removeExternalReferences: boolean;
  aiMediaLimit: number;
  genericizeText: boolean;
  neutralizationInstructions: string;
  customPrompt: string;
  applyLogoToImages: boolean;
  // Quando true, neutraliza apenas o TEXTO aqui; a imagem vira job de background.
  deferImageNeutralization?: boolean;
  // Quando true, mantem apenas a imagem principal (loja checkout usa 1 imagem).
  heroOnly?: boolean;
}) {
  let productInput = input.productInput;
  const warnings: string[] = [];
  let neutralized = false;
  let logoAppliedCount = 0;
  let storageClient: ReturnType<typeof createAdminClient> | null = null;

  function getStorageClient() {
    storageClient ||= createAdminClient();
    return storageClient;
  }

  if (input.heroOnly && productInput.images.length > 1) {
    productInput = { ...productInput, images: productInput.images.slice(0, 1) };
  }

  if (input.neutralizeProducts || input.removeExternalReferences) {
    const cleanupInput = {
      userId: input.userId,
      title: productInput.title,
      descriptionHtml: productInput.descriptionHtml,
      tags: productInput.tags,
      seo: productInput.seo,
      images: productInput.images.map((image) => ({
        url: image.src,
        altText: image.altText,
      })),
      // maxImages = 0 => neutraliza so o texto (imagem fica para a fila).
      maxImages: input.deferImageNeutralization ? 0 : input.aiMediaLimit,
      storageClient: getStorageClient(),
      targetLanguage: input.targetLanguage,
      customInstructions:
        input.neutralizationInstructions || input.customPrompt,
      genericizeText: input.genericizeText,
    };
    const neutralizedProduct = input.removeExternalReferences
      ? await removeExternalReferencesForDestination(cleanupInput)
      : await neutralizeProductForDestination(cleanupInput);

    productInput = {
      ...productInput,
      title: neutralizedProduct.title,
      descriptionHtml: neutralizedProduct.descriptionHtml,
      tags: neutralizedProduct.tags,
      seo: neutralizedProduct.seo,
      images:
        neutralizedProduct.images.length > 0
          ? [
              ...neutralizedProduct.images,
              ...productInput.images.slice(neutralizedProduct.images.length),
            ]
          : productInput.images,
    };
    warnings.push(...neutralizedProduct.warnings);
    neutralized = true;
  }

  // Em modo fila a imagem sera substituida depois; nao aplica logo agora.
  if (input.applyLogoToImages && !input.deferImageNeutralization) {
    const branded = await applyLogoToProductImages({
      userId: input.userId,
      storeId: input.targetStoreId,
      images: productInput.images,
      storageClient: getStorageClient(),
      maxImages: 20,
    });
    productInput = {
      ...productInput,
      images: branded.images,
    };
    logoAppliedCount = branded.appliedCount;
    warnings.push(...branded.warnings);
  }

  return { productInput, warnings, neutralized, logoAppliedCount };
}

function variantSignature(optionValues: string[]) {
  return optionValues.join(" / ").toLowerCase();
}

function buildVariantMaps(
  sourceProduct: PublicShopifyProduct,
  syncedProduct: { variants?: { nodes?: SyncedVariant[] } } | null | undefined
) {
  const targetVariants = syncedProduct?.variants?.nodes || [];
  const bySignature = new Map(
    targetVariants.map((variant) => [
      variantSignature((variant.selectedOptions || []).map((option) => option.value)),
      variant.id,
    ])
  );
  const byIndex = targetVariants.map((variant) => variant.id);

  const skuMap: Record<string, string> = {};
  const variantMap: Record<string, string> = {};

  sourceProduct.variants.forEach((sourceVariant, index) => {
    const targetId =
      bySignature.get(variantSignature(sourceVariant.optionValues)) || byIndex[index];

    if (!targetId) return;

    variantMap[String(sourceVariant.id)] = targetId;
    variantMap[`gid://shopify/ProductVariant/${sourceVariant.id}`] = targetId;

    if (sourceVariant.sku) {
      skuMap[sourceVariant.sku] = targetId;
    }
  });

  return { skuMap, variantMap };
}

async function findExistingProduct(
  creds: ShopifyCredentials,
  sourceProduct: PublicShopifyProduct
) {
  const queries = [`handle:${sourceProduct.handle}`, sourceProduct.title]
    .map((query) => query.trim())
    .filter(Boolean);

  for (const query of queries) {
    const result = await getProducts(creds, { first: 10, query });
    const nodes = result?.products?.nodes || [];
    const exact = nodes.find(
      (product: { handle?: string; title?: string }) =>
        product.handle === sourceProduct.handle || product.title === sourceProduct.title
    );
    if (exact) return exact;
  }

  return null;
}

async function recordCloneRun(input: {
  userId: string;
  sourceDomain: string;
  targetStoreId?: string | null;
  action: CloneAction;
  status: "completed" | "failed";
  productCount: number;
  result?: Record<string, unknown>;
  error?: string;
}) {
  const supabase = await createClient();
  await supabase.from("clone_runs").insert({
    user_id: input.userId,
    source_domain: input.sourceDomain,
    target_store_id: input.targetStoreId || null,
    action: input.action,
    status: input.status,
    product_count: input.productCount,
    result: input.result || {},
    error: input.error || null,
  });
}

async function insertRoutingConfig(input: {
  userId: string;
  sourceStoreId: string;
  targetStoreId: string;
  name: string;
  skuMap: Record<string, string>;
  variantMap: Record<string, string>;
}) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routed_checkout_configs")
    .insert({
      user_id: input.userId,
      source_store_id: input.sourceStoreId,
      target_store_id: input.targetStoreId,
      name: input.name,
      mode: "enterprise_static",
      sku_map: input.skuMap,
      variant_map: input.variantMap,
      settings: { generatedBy: "shopify_clone" },
    })
    .select("id, public_token")
    .single();

  if (error) {
    throw new Error("Produtos criados, mas falhou ao criar rota de checkout.");
  }

  return data;
}

export async function POST(request: NextRequest) {
  const userId = await getAuthenticatedUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const source = typeof body.source === "string" ? body.source : "";
  const action = (body.action || "preview") as CloneAction;
  const targetStoreId =
    typeof body.targetStoreId === "string" ? body.targetStoreId : "";
  const sourceStoreId =
    typeof body.sourceStoreId === "string" ? body.sourceStoreId : "";
  const requestedLimit = Number(body.limit || 250);
  const limit = Math.min(
    Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : 250, 1),
    5000
  );
  const requestedPage = Number(body.page || 0);
  const page =
    Number.isFinite(requestedPage) && requestedPage > 0
      ? Math.floor(requestedPage)
      : undefined;
  const requestedPageSize = Number(body.pageSize || limit);
  const pageSize = Math.min(
    Math.max(
      Number.isFinite(requestedPageSize) ? Math.floor(requestedPageSize) : limit,
      1
    ),
    250
  );
  const shouldRecordRun = body.recordRun !== false;
  const publishToStorefront = body.publishToStorefront !== false;
  const translateProduct =
    body.translateProduct === true || body.translateProducts === true;
  const neutralizeProducts = body.neutralizeProducts === true;
  const removeExternalReferences = body.removeExternalReferences === true;
  // "queue": neutraliza texto na hora e processa a imagem em background (fila).
  const imageNeutralizeMode =
    body.imageNeutralizeMode === "queue" ? "queue" : "inline";
  const deferImageNeutralization =
    (neutralizeProducts || removeExternalReferences) &&
    imageNeutralizeMode === "queue";
  // loja checkout usa 1 imagem por produto; o modo fila forca hero unico.
  const heroOnly = body.heroOnly === true || deferImageNeutralization;
  const aiMediaLimit = clampAiMediaLimit(body.aiMediaLimit ?? body.maxImages, 1);
  const genericizeText = body.genericizeText !== false;
  const neutralizationInstructions =
    typeof body.neutralizationInstructions === "string"
      ? body.neutralizationInstructions.trim().slice(0, 1200)
      : "";
  const customPrompt =
    typeof body.customPrompt === "string"
      ? body.customPrompt.trim().slice(0, 2000)
      : "";
  const applyLogoToImages = body.applyLogoToImages === true || body.applyLogo === true;
  const translateVariantOptions = body.translateVariantOptions === true;
  const duplicatePolicy: DuplicatePolicy =
    body.duplicatePolicy === "create" ? "create" : "skip";
  const createRoutingConfig = Boolean(body.createRoutingConfig);
  const importMode = body.importMode === "single" ? "single" : "bulk";
  const selectedProductHandles = Array.isArray(body.productHandles)
    ? body.productHandles
        .map((handle: unknown) => String(handle).trim())
        .filter(Boolean)
    : [];
  const sourceCollections = Array.isArray(body.collections)
    ? body.collections
        .map((collection: unknown) => {
          if (!collection || typeof collection !== "object") return null;
          const item = collection as { handle?: unknown; title?: unknown };
          const handle = String(item.handle || "").trim();
          const title = String(item.title || handle).trim();
          return handle ? { handle, title } : null;
        })
        .filter(
          (collection: { handle: string; title: string } | null): collection is {
            handle: string;
            title: string;
          } => Boolean(collection)
        )
    : [];
  const productCollections =
    body.productCollections &&
    typeof body.productCollections === "object" &&
    !Array.isArray(body.productCollections)
      ? (body.productCollections as Record<string, unknown>)
      : {};
  const applyCollections = body.applyCollections !== false;
  // Escopo opcional: importar apenas os produtos de uma colecao da origem.
  const collectionHandle =
    typeof body.collectionHandle === "string" ? body.collectionHandle.trim() : "";
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

  if (!source) {
    return NextResponse.json(
      { error: "Informe a loja Shopify de origem." },
      { status: 400 }
    );
  }

  if (!["preview", "export-json", "export-csv", "apply"].includes(action)) {
    return NextResponse.json({ error: "Acao invalida." }, { status: 400 });
  }

  // Trava do trial: clonar (apply) so e liberado para quem assinou OU na 1a
  // loja gratuita. Preview/export nao consomem o trial.
  if (action === "apply" && targetStoreId) {
    const permission = await checkAndConsumeFreeClone(userId, targetStoreId);
    if (!permission.allowed) {
      return NextResponse.json(
        {
          error:
            "Você já usou sua clonagem gratuita. Assine o Pro para clonar mais lojas.",
          code: "subscribe_required",
        },
        { status: 402 }
      );
    }
  }

  try {
    let domain = "";
    let products: PublicShopifyProduct[] = [];
    let skipShopifyCollections = false;

    if (selectedProductHandles.length > 0) {
      const result = await fetchPublicShopifyProductsByHandles(
        source,
        selectedProductHandles
      );
      domain = result.domain;
      products = result.products;
    } else if (importMode === "single") {
      const result = await fetchPublicShopifyProduct(source);
      domain = result.domain;
      products = [result.product];
    } else if (collectionHandle) {
      // Colecao escolhida (Shopify): le os produtos so dela via URL da colecao.
      const normalizedDomain = normalizePublicShopifyDomain(source);
      const fetchSource = normalizedDomain
        ? `https://${normalizedDomain}/collections/${collectionHandle}`
        : source;
      const result = await fetchPublicShopifyProducts(fetchSource, {
        limit,
        page,
        pageSize: page ? pageSize : undefined,
      });
      domain = result.domain;
      products = result.products;
    } else {
      // Auto-detecta a plataforma: tenta Shopify e, se nao for, WooCommerce.
      // Ambos devolvem o mesmo shape, entao o resto do fluxo nao muda.
      const fetchOpts = {
        limit,
        page,
        pageSize: page ? pageSize : undefined,
      };
      try {
        const result = await fetchPublicShopifyProducts(source, fetchOpts);
        domain = result.domain;
        products = result.products;
      } catch (shopifyError) {
        if (await isWooCommerceStore(source)) {
          const result = await fetchWooCommerceProducts(source, fetchOpts);
          domain = result.domain;
          products = result.products;
          skipShopifyCollections = true;
        } else if (await isShoplazzaStore(source)) {
          const result = await fetchShoplazzaProducts(source, fetchOpts);
          domain = result.domain;
          products = result.products;
          skipShopifyCollections = true; // pula leitura de colecoes (so existe no Shopify)
        } else {
          throw shopifyError;
        }
      }
    }
    // Colecoes/categorias da origem so existem no Shopify; pula no Woo.
    const shouldReadCollections =
      !skipShopifyCollections &&
      (action === "preview" ||
        action === "export-json" ||
        (action === "apply" &&
          applyCollections &&
          sourceCollections.length === 0 &&
          Object.keys(productCollections).length === 0));
    const collectionsResult = shouldReadCollections
      ? await fetchPublicShopifyCollections(source)
      : { collections: [] };
    if (collectionsResult.collections.length > 0) {
      if (collectionHandle) {
        // Escopo por colecao: todos os produtos vieram de /collections/<handle>,
        // entao a associacao ja e conhecida. Varrer as demais colecoes aqui era
        // trabalho de rede puro (ate 20 requisicoes por colecao) sem ganho.
        products = products.map((product) => ({
          ...product,
          collectionHandles: [collectionHandle],
        }));
      } else {
        products = await attachCollectionsToProducts(
          source,
          products,
          collectionsResult.collections
        );
      }
    }

    if (action === "preview" && body.transformPreview === true) {
      if (!targetStoreId) {
        return NextResponse.json(
          { error: "Selecione a loja de destino para visualizar a transformacao." },
          { status: 400 }
        );
      }

      const product = products[0];
      if (!product) {
        return NextResponse.json(
          { error: "Nenhum produto encontrado para visualizar." },
          { status: 404 }
        );
      }

      const targetStore = await lojaDoUsuario(targetStoreId);
      if (!targetStore) {
        return NextResponse.json(
          { error: "Loja de destino nao encontrada." },
          { status: 404 }
        );
      }

      const targetContext = toStoreContext(targetStore);
      const productInput = await buildCreateInputForTarget(
        product,
        targetContext,
        publishToStorefront,
        translateProduct,
        translateVariantOptions,
        inventory,
        customPrompt
      );
      const prepared = await prepareCreateInputForImport({
        userId,
        targetStoreId,
        targetLanguage: targetContext?.targetLanguage || "pt-BR",
        neutralizeProducts,
        removeExternalReferences,
        aiMediaLimit,
        genericizeText,
        neutralizationInstructions,
        customPrompt,
        applyLogoToImages,
        deferImageNeutralization,
        heroOnly,
        productInput,
      });

      return NextResponse.json({
        sourceDomain: domain,
        count: products.length,
        products,
        collections: collectionsResult.collections,
        transformedPreview: toTransformedPreviewProduct(product, productInput, prepared),
      });
    }

    if (action === "export-csv") {
      if (shouldRecordRun) {
        await recordCloneRun({
          userId,
          sourceDomain: domain,
          targetStoreId: targetStoreId || null,
          action,
          status: "completed",
          productCount: products.length,
          result: { count: products.length },
        });
      }

      return new NextResponse(productsToCsv(products), {
        headers: {
          "content-type": "text/csv; charset=utf-8",
          "content-disposition": `attachment; filename="${domain}-products.csv"`,
        },
      });
    }

    if (action === "export-json" || action === "preview") {
      if (shouldRecordRun) {
        await recordCloneRun({
          userId,
          sourceDomain: domain,
          targetStoreId: targetStoreId || null,
          action,
          status: "completed",
          productCount: products.length,
          result: { count: products.length },
        });
      }

      return NextResponse.json({
        sourceDomain: domain,
        count: products.length,
        products,
        collections: collectionsResult.collections,
      });
    }

    if (!targetStoreId) {
      return NextResponse.json(
        { error: "Selecione a loja de destino." },
        { status: 400 }
      );
    }

    const targetStore = await lojaDoUsuario(targetStoreId);
    if (!targetStore) {
      return NextResponse.json(
        { error: "Loja de destino nao encontrada." },
        { status: 404 }
      );
    }

    const targetCreds = {
      shopDomain: targetStore.shop_domain,
      clientId: targetStore.client_id,
      clientSecret: targetStore.client_secret,
      accessToken: targetStore.access_token,
    };
    const targetContext = toStoreContext(targetStore);
    const created: { sourceHandle: string; result: unknown }[] = [];
    const skipped: { sourceHandle: string; existingProductId: string }[] = [];
    const failed: { sourceHandle: string; error: string }[] = [];
    const transformed: {
      sourceHandle: string;
      neutralized: boolean;
      logoAppliedCount: number;
      warnings: string[];
    }[] = [];
    const aggregateSkuMap: Record<string, string> = {};
    const aggregateVariantMap: Record<string, string> = {};
    const imageQueueItems: ImageNeutralizeItem[] = [];
    const collectionProductIds = new Map<string, Set<string>>();
    const collectionsForSync =
      sourceCollections.length > 0
        ? sourceCollections
        : collectionsResult.collections.map((collection) => ({
            handle: collection.handle,
            title: collection.title,
            // Recria a colecao no destino com a mesma descricao, imagem e
            // ordenacao da origem (antes so handle+title iam, entao toda
            // colecao nascia sem descricao e com ordenacao BEST_SELLING).
            bodyHtml: collection.bodyHtml,
            image: collection.image,
            sortOrder: collection.sortOrder,
          }));

    function assignProductToCollections(product: PublicShopifyProduct, productId?: string) {
      if (!applyCollections || !productId) return;
      const explicitCollections = productCollections[product.handle];
      const collectionHandles = Array.isArray(explicitCollections)
        ? explicitCollections.map((handle) => String(handle).trim()).filter(Boolean)
        : product.collectionHandles || [];

      for (const collectionHandle of collectionHandles) {
        if (!collectionProductIds.has(collectionHandle)) {
          collectionProductIds.set(collectionHandle, new Set<string>());
        }
        collectionProductIds.get(collectionHandle)?.add(productId);
      }
    }

    for (const product of products) {
      if (request.signal.aborted) {
        break;
      }
      try {
        if (duplicatePolicy === "skip") {
          const existing = await findExistingProduct(targetCreds, product);
          if (existing?.id) {
            skipped.push({
              sourceHandle: product.handle,
              existingProductId: existing.id,
            });
            const maps = buildVariantMaps(product, existing);
            Object.assign(aggregateSkuMap, maps.skuMap);
            Object.assign(aggregateVariantMap, maps.variantMap);
            assignProductToCollections(product, existing.id);
            continue;
          }
        }

        const prepared = await prepareCreateInputForImport({
          userId,
          targetStoreId,
          targetLanguage: targetContext?.targetLanguage || "pt-BR",
          neutralizeProducts,
          removeExternalReferences,
          aiMediaLimit,
          genericizeText,
          neutralizationInstructions,
          customPrompt,
          applyLogoToImages,
          deferImageNeutralization,
          heroOnly,
          productInput: await buildCreateInputForTarget(
            product,
            targetContext,
            publishToStorefront,
            translateProduct,
            translateVariantOptions,
            inventory,
            customPrompt
          ),
        });
        const result = await createProduct(targetCreds, prepared.productInput);
        const maps = buildVariantMaps(product, result?.syncedProduct);
        Object.assign(aggregateSkuMap, maps.skuMap);
        Object.assign(aggregateVariantMap, maps.variantMap);
        assignProductToCollections(product, result?.syncedProduct?.id);
        created.push({ sourceHandle: product.handle, result });

        // Modo fila: produto entra com a imagem original; o hero neutralizado
        // sera trocado em background.
        const createdProductId = result?.syncedProduct?.id;
        const heroSource = prepared.productInput.images?.[0]?.src;
        if (deferImageNeutralization && createdProductId && heroSource) {
          imageQueueItems.push({
            productId: createdProductId,
            imageUrl: heroSource,
            title: prepared.productInput.title,
            mode: removeExternalReferences
              ? "external-references"
              : "stock-neutralize",
            customInstructions: neutralizationInstructions || customPrompt,
            targetLanguage: targetContext?.targetLanguage || "pt-BR",
          });
        }
        if (
          prepared.neutralized ||
          prepared.logoAppliedCount > 0 ||
          prepared.warnings.length > 0
        ) {
          transformed.push({
            sourceHandle: product.handle,
            neutralized: prepared.neutralized,
            logoAppliedCount: prepared.logoAppliedCount,
            warnings: prepared.warnings,
          });
        }
      } catch (error) {
        failed.push({
          sourceHandle: product.handle,
          error:
            error instanceof Error
              ? error.message
              : "Falha ao criar produto.",
        });
      }
    }

    // Medicao (Fase 2): registra volume de clone e custo de texto da neutralizacao/
    // traducao. A imagem (cara) e medida na fila de imagens, por imagem.
    if (action === "apply") {
      const neutralizedCount = transformed.filter((t) => t.neutralized).length;
      if (created.length > 0) {
        await logAiUsage({
          userId,
          storeId: targetStoreId,
          action: "clone",
          costUsd: 0,
          metadata: { count: created.length, source: domain },
        });
      }
      if (neutralizedCount > 0) {
        await logAiUsage({
          userId,
          storeId: targetStoreId,
          action: "neutralize_text",
          costUsd: AI_COST.text * neutralizedCount,
          metadata: { count: neutralizedCount, aggregate: true },
        });
      }
    }

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
        console.error("[api/shopify/clone] enqueue images error", error);
      }
    }

    let routingConfig:
      | { id?: string; public_token?: string }
      | null = null;
    const collectionSync =
      collectionProductIds.size > 0
        ? await syncProductCollections(targetCreds, {
            collections: collectionsForSync,
            assignments: Array.from(collectionProductIds.entries()).map(
              ([collectionHandle, productIds]) => ({
                collectionHandle,
                productIds: Array.from(productIds),
              })
            ),
          })
        : null;

    if (createRoutingConfig && sourceStoreId && targetStoreId) {
      routingConfig = await insertRoutingConfig({
        userId,
        sourceStoreId,
        targetStoreId,
        name: `Clone ${domain} -> ${targetStore.shop_domain}`,
        skuMap: aggregateSkuMap,
        variantMap: aggregateVariantMap,
      });
    }

    if (shouldRecordRun) {
      await recordCloneRun({
        userId,
        sourceDomain: domain,
        targetStoreId,
        action,
        status: failed.length === products.length ? "failed" : "completed",
        productCount: products.length,
        result: {
          createdCount: created.length,
          skippedCount: skipped.length,
          failedCount: failed.length,
          neutralizedCount: transformed.filter((item) => item.neutralized).length,
          logoAppliedCount: transformed.reduce(
            (total, item) => total + item.logoAppliedCount,
            0
          ),
          skuMapCount: Object.keys(aggregateSkuMap).length,
          variantMapCount: Object.keys(aggregateVariantMap).length,
          routingConfig,
          collectionSync,
        },
        error:
          failed.length === products.length
            ? "Todos os produtos falharam ao clonar."
            : undefined,
      });
    }

    return NextResponse.json({
      sourceDomain: domain,
      attempted: products.length,
      createdCount: created.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
      neutralizedCount: transformed.filter((item) => item.neutralized).length,
      logoAppliedCount: transformed.reduce(
        (total, item) => total + item.logoAppliedCount,
        0
      ),
      skuMapCount: Object.keys(aggregateSkuMap).length,
      variantMapCount: Object.keys(aggregateVariantMap).length,
      imageQueueCount,
      skuMap: aggregateSkuMap,
      variantMap: aggregateVariantMap,
      collectionSync,
      routingConfig,
      created,
      skipped,
      failed,
      transformed,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao clonar loja.";
    if (shouldRecordRun) {
      await recordCloneRun({
        userId,
        sourceDomain: source,
        targetStoreId: targetStoreId || null,
        action,
        status: "failed",
        productCount: 0,
        error: message,
      }).catch(() => undefined);
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
