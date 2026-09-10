import { normalizeShopDomain } from "@/lib/shopify/domain";
import { fetchWithImportProxy } from "@/lib/import/proxy-fetch";
import { runWithConcurrency } from "@/lib/concurrency";
import { ensureVariantSku } from "@/lib/products/sku";

export interface PublicShopifyVariant {
  id: number;
  title: string;
  sku: string | null;
  price: string;
  compareAtPrice: string | null;
  optionValues: string[];
}

export interface PublicShopifyProduct {
  id: number;
  title: string;
  handle: string;
  descriptionHtml: string;
  vendor: string | null;
  productType: string | null;
  tags: string[];
  options: string[];
  images: { src: string; altText: string }[];
  variants: PublicShopifyVariant[];
  sourceUrl: string;
  collectionHandles?: string[];
}

export interface PublicShopifyCollection {
  id: number;
  title: string;
  handle: string;
  image?: string | null;
  productsUrl: string;
  // Campos que a /collections.json ja devolve e antes eram descartados.
  bodyHtml?: string | null;
  /** Ordenacao da colecao na origem: "manual", "best-selling", "price-asc"... */
  sortOrder?: string | null;
  productsCount?: number | null;
}

interface ProductsJsonImage {
  src?: string;
  alt?: string | null;
}

interface ProductsJsonOption {
  name?: string;
}

interface ProductsJsonVariant {
  id?: number;
  title?: string;
  sku?: string | null;
  price?: string | number;
  compare_at_price?: string | number | null;
  option1?: string | null;
  option2?: string | null;
  option3?: string | null;
}

interface ProductsJsonProduct {
  id?: number;
  title?: string;
  handle?: string;
  body_html?: string;
  vendor?: string | null;
  product_type?: string | null;
  tags?: string | string[];
  options?: ProductsJsonOption[];
  images?: ProductsJsonImage[];
  variants?: ProductsJsonVariant[];
}

interface CollectionsJsonCollection {
  id?: number;
  title?: string;
  handle?: string;
  image?: { src?: string | null } | string | null;
  body_html?: string | null;
  sort_order?: string | null;
  products_count?: number | null;
}

function normalizeTags(tags: string | string[] | undefined): string[] {
  if (Array.isArray(tags)) return tags.map((tag) => tag.trim()).filter(Boolean);
  return (tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeMoney(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric.toFixed(2) : "0.00";
}

function normalizeStorefrontCents(value: string | number | null | undefined): string {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric) || numeric <= 0) return "0.00";
  return (Number.isInteger(numeric) ? numeric / 100 : numeric).toFixed(2);
}

function productUrl(domain: string, handle: string): string {
  return `https://${domain}/products/${handle}`;
}

function toPublicProduct(
  domain: string,
  product: ProductsJsonProduct
): PublicShopifyProduct | null {
  const id = Number(product.id);
  const title = (product.title || "").trim();
  const handle = (product.handle || "").trim();

  if (!Number.isFinite(id) || !title || !handle) return null;

  const options =
    product.options
      ?.map((option) => option.name?.trim())
      .filter((name): name is string => Boolean(name && name !== "Title")) || [];

  const images =
    product.images
      ?.map((image) => ({
        src: image.src || "",
        altText: image.alt || title,
      }))
      .filter((image) => /^https:\/\//i.test(image.src)) || [];

  const variants =
    product.variants
      ?.map((variant) => {
        const variantId = Number(variant.id);
        if (!Number.isFinite(variantId)) return null;

        return {
          id: variantId,
          title: variant.title || "Default Title",
          sku: variant.sku || null,
          price: normalizeMoney(variant.price),
          compareAtPrice: variant.compare_at_price
            ? normalizeMoney(variant.compare_at_price)
            : null,
          optionValues: [variant.option1, variant.option2, variant.option3]
            .map((value) => (value || "").trim())
            .filter((value) => value && value !== "Default Title"),
        };
      })
      .filter((variant): variant is PublicShopifyVariant => Boolean(variant)) || [];

  return {
    id,
    title,
    handle,
    descriptionHtml: product.body_html || "",
    vendor: product.vendor || null,
    productType: product.product_type || null,
    tags: normalizeTags(product.tags),
    options,
    images,
    variants:
      variants.length > 0
        ? variants
        : [
            {
              id,
              title: "Default Title",
              sku: null,
              price: "0.00",
              compareAtPrice: null,
              optionValues: [],
            },
          ],
    sourceUrl: productUrl(domain, handle),
  };
}

export function normalizePublicShopifyDomain(input: string): string | null {
  return normalizeShopDomain(input);
}

function extractProductHandle(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const match = url.pathname.match(/\/products\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    const match = value.match(/\/products\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

function extractCollectionHandle(input: string): string | null {
  const value = input.trim();
  if (!value) return null;

  try {
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    const match = url.pathname.match(/\/collections\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  } catch {
    const match = value.match(/\/collections\/([^/?#]+)/i);
    return match?.[1] ? decodeURIComponent(match[1]) : null;
  }
}

function normalizeCollection(
  domain: string,
  collection: CollectionsJsonCollection
): PublicShopifyCollection | null {
  const id = Number(collection.id);
  const title = (collection.title || "").trim();
  const handle = (collection.handle || "").trim();
  if (!Number.isFinite(id) || !title || !handle) return null;

  const rawImage = collection.image;
  const image =
    typeof rawImage === "string" ? rawImage : rawImage?.src || null;

  return {
    id,
    title,
    handle,
    image,
    productsUrl: `https://${domain}/collections/${handle}`,
    bodyHtml: collection.body_html || null,
    sortOrder: collection.sort_order || null,
    productsCount:
      typeof collection.products_count === "number"
        ? collection.products_count
        : null,
  };
}

function normalizeStorefrontProduct(
  domain: string,
  product: ProductsJsonProduct & {
    description?: string;
    type?: string;
    tags?: string[] | string;
    images?: (ProductsJsonImage | string)[];
    options?: (ProductsJsonOption | { name?: string } | string)[];
    variants?: (ProductsJsonVariant & {
      featured_image?: { src?: string | null } | null;
    })[];
  },
  handleOverride?: string
): PublicShopifyProduct | null {
  return toPublicProduct(domain, {
    ...product,
    handle: product.handle || handleOverride,
    body_html: product.body_html || product.description || "",
    product_type: product.product_type || product.type || null,
    images:
      product.images?.map((image) =>
        typeof image === "string" ? { src: image, alt: product.title || "" } : image
      ) || [],
    options:
      product.options?.map((option) =>
        typeof option === "string" ? { name: option } : option
      ) || [],
    variants:
      product.variants?.map((variant) => ({
        ...variant,
        price: normalizeStorefrontCents(variant.price),
        compare_at_price: variant.compare_at_price
          ? normalizeStorefrontCents(variant.compare_at_price)
          : null,
      })) || [],
  });
}

export async function fetchPublicShopifyCollections(
  source: string
): Promise<{ domain: string; collections: PublicShopifyCollection[] }> {
  const domain = normalizePublicShopifyDomain(source);
  if (!domain) {
    throw new Error("Informe um dominio Shopify valido.");
  }

  try {
    const res = await fetchWithImportProxy(`https://${domain}/collections.json?limit=250`, {
      headers: {
        accept: "application/json",
        "user-agent": "ShopifyCreator/1.0 (+https://shopify.dev)",
      },
      cache: "no-store",
    });

    if (!res.ok) return { domain, collections: [] };

    const data = (await res.json()) as {
      collections?: CollectionsJsonCollection[];
      smart_collections?: CollectionsJsonCollection[];
      custom_collections?: CollectionsJsonCollection[];
    };
    const rawCollections =
      data.collections || data.smart_collections || data.custom_collections || [];

    return {
      domain,
      collections: rawCollections
        .map((collection) => normalizeCollection(domain, collection))
        .filter((collection): collection is PublicShopifyCollection => Boolean(collection)),
    };
  } catch {
    return { domain, collections: [] };
  }
}

async function fetchCollectionProductHandles(
  domain: string,
  collectionHandle: string
) {
  const handles = new Set<string>();

  for (let page = 1; page <= 20; page += 1) {
    try {
      const res = await fetchWithImportProxy(
        `https://${domain}/collections/${collectionHandle}/products.json?limit=250&page=${page}`,
        {
          headers: {
            accept: "application/json",
            "user-agent": "ShopifyCreator/1.0 (+https://shopify.dev)",
          },
          cache: "no-store",
        }
      );

      if (!res.ok) break;
      const data = (await res.json()) as { products?: ProductsJsonProduct[] };
      const pageProducts = Array.isArray(data.products) ? data.products : [];
      if (pageProducts.length === 0) break;
      pageProducts.forEach((product) => {
        if (product.handle) handles.add(product.handle);
      });
      if (pageProducts.length < 250) break;
    } catch {
      break;
    }
  }

  return handles;
}

// Quantas colecoes sao lidas em paralelo. Cada uma pode paginar ate 20 vezes,
// entao antes (laco sequencial) o pior caso era ~1000 requisicoes em serie —
// a causa real dos timeouts de preview em loja grande.
const COLLECTION_ATTACH_CONCURRENCY = 8;
// Com as leituras em paralelo da para cobrir bem mais colecoes do que as 50
// originais sem estourar o tempo da rota.
const COLLECTION_ATTACH_LIMIT = 200;

export async function attachCollectionsToProducts(
  source: string,
  products: PublicShopifyProduct[],
  collections?: PublicShopifyCollection[]
) {
  const domain = normalizePublicShopifyDomain(source);
  if (!domain || products.length === 0) return products;

  const sourceCollections =
    collections || (await fetchPublicShopifyCollections(source)).collections;
  if (sourceCollections.length === 0) return products;

  const productsByHandle = new Map(
    products.map((product) => [product.handle, new Set<string>()])
  );

  const scoped = sourceCollections.slice(0, COLLECTION_ATTACH_LIMIT);
  const perCollection = await runWithConcurrency(
    scoped,
    COLLECTION_ATTACH_CONCURRENCY,
    (collection) => fetchCollectionProductHandles(domain, collection.handle)
  );

  scoped.forEach((collection, index) => {
    perCollection[index]?.forEach((handle) => {
      productsByHandle.get(handle)?.add(collection.handle);
    });
  });

  return products.map((product) => ({
    ...product,
    collectionHandles: Array.from(productsByHandle.get(product.handle) || []),
  }));
}

export async function fetchPublicShopifyProduct(
  source: string
): Promise<{ domain: string; product: PublicShopifyProduct }> {
  const domain = normalizePublicShopifyDomain(source);
  const handle = extractProductHandle(source);
  if (!domain || !handle) {
    throw new Error("Informe uma URL de produto Shopify valida.");
  }

  const jsonUrl = `https://${domain}/products/${handle}.json`;
  const jsonRes = await fetchWithImportProxy(jsonUrl, {
    headers: {
      accept: "application/json",
      "user-agent": "ShopifyCreator/1.0 (+https://shopify.dev)",
    },
    cache: "no-store",
  });

  if (jsonRes.ok) {
    const data = (await jsonRes.json()) as { product?: ProductsJsonProduct };
    const product = data.product ? toPublicProduct(domain, data.product) : null;
    if (product) return { domain, product };
  }

  const jsRes = await fetchWithImportProxy(`https://${domain}/products/${handle}.js`, {
    headers: {
      accept: "application/json",
      "user-agent": "ShopifyCreator/1.0 (+https://shopify.dev)",
    },
    cache: "no-store",
  });

  if (!jsRes.ok) {
    throw new Error("Nao foi possivel ler o produto publico da Shopify.");
  }

  const jsProduct = (await jsRes.json()) as Parameters<typeof normalizeStorefrontProduct>[1];
  const product = normalizeStorefrontProduct(domain, jsProduct, handle);
  if (!product) {
    throw new Error("Produto Shopify retornou dados incompletos.");
  }

  return { domain, product };
}

export async function fetchPublicShopifyProductsByHandles(
  source: string,
  handles: string[]
): Promise<{ domain: string; products: PublicShopifyProduct[] }> {
  const domain = normalizePublicShopifyDomain(source);
  if (!domain) {
    throw new Error("Informe um dominio Shopify valido.");
  }

  const products: PublicShopifyProduct[] = [];
  for (const handle of [...new Set(handles.map((item) => item.trim()).filter(Boolean))]) {
    try {
      const result = await fetchPublicShopifyProduct(`https://${domain}/products/${handle}`);
      products.push(result.product);
    } catch {
      // Continua importando os demais produtos selecionados.
    }
  }

  return { domain, products };
}

export async function fetchPublicShopifyProducts(
  source: string,
  options?: { limit?: number; maxPages?: number; page?: number; pageSize?: number }
): Promise<{ domain: string; products: PublicShopifyProduct[] }> {
  const domain = normalizePublicShopifyDomain(source);
  if (!domain) {
    throw new Error("Informe um dominio Shopify valido.");
  }

  const limit = Math.min(Math.max(Math.floor(options?.limit || 250), 1), 5000);
  const collectionHandle = extractCollectionHandle(source);
  const singlePage = options?.page
    ? Math.max(Math.floor(options.page), 1)
    : null;
  const pageSize = Math.min(
    Math.max(Math.floor(options?.pageSize || (singlePage ? limit : 250)), 1),
    250
  );
  const maxPages = singlePage
    ? 1
    : Math.min(
        Math.max(
          Math.floor(options?.maxPages || Math.ceil(limit / pageSize)),
          1
        ),
        200
      );
  const products: PublicShopifyProduct[] = [];

  for (let offset = 0; offset < maxPages && products.length < limit; offset += 1) {
    const page = singlePage || offset + 1;
    const path = collectionHandle
      ? `/collections/${encodeURIComponent(collectionHandle)}/products.json`
      : "/products.json";
    const url = `https://${domain}${path}?limit=${pageSize}&page=${page}`;
    const res = await fetchWithImportProxy(url, {
      headers: {
        accept: "application/json",
        "user-agent": "ShopifyCreator/1.0 (+https://shopify.dev)",
      },
      cache: "no-store",
    });

    if (!res.ok) {
      if (page === 1) {
        throw new Error(
          collectionHandle
            ? `Nao foi possivel ler produtos publicos da colecao "${collectionHandle}" (${res.status}).`
            : `Nao foi possivel ler produtos publicos da loja (${res.status}).`
        );
      }
      break;
    }

    const data = (await res.json()) as { products?: ProductsJsonProduct[] };
    const pageProducts = Array.isArray(data.products) ? data.products : [];
    if (pageProducts.length === 0) break;

    for (const product of pageProducts) {
      const normalized = toPublicProduct(domain, product);
      if (normalized) {
        products.push(
          collectionHandle
            ? { ...normalized, collectionHandles: [collectionHandle] }
            : normalized
        );
      }
      if (products.length >= limit) break;
    }
  }

  return { domain, products };
}

// Indice SKU -> variantId numerico de uma loja, lido do products.json publico.
// Cacheado em memoria por dominio para nao refazer a cada checkout (TTL curto).
const skuIndexCache = new Map<
  string,
  { at: number; index: Map<string, number> }
>();
const SKU_INDEX_TTL_MS = 30 * 60 * 1000;

/**
 * Teto de dominios no cache.
 *
 * Nao havia nenhum: o TTL so era conferido na LEITURA do mesmo dominio, entao
 * entrada de dominio que nunca mais fosse consultado ficava para sempre. Cada
 * uma guarda o indice SKU -> variantId de ate 5000 produtos (as lojas desta
 * conta chegam a 2671 variantes), numa instancia serverless que fica quente
 * por horas.
 *
 * E o /resolve e publico: quem tiver tokens de rotas diferentes faz o cache
 * crescer de proposito.
 */
const MAX_DOMINIOS_NO_CACHE = 40;

/** Tira o que expirou e, se ainda estiver cheio, o mais antigo. */
function podarCacheDeSku() {
  const agora = Date.now();
  for (const [dominio, entrada] of skuIndexCache) {
    if (agora - entrada.at >= SKU_INDEX_TTL_MS) skuIndexCache.delete(dominio);
  }
  while (skuIndexCache.size >= MAX_DOMINIOS_NO_CACHE) {
    // Map itera na ordem de insercao: o primeiro e o mais antigo.
    const maisAntigo = skuIndexCache.keys().next();
    if (maisAntigo.done) break;
    skuIndexCache.delete(maisAntigo.value);
  }
}

async function buildSkuIndex(domain: string): Promise<Map<string, number>> {
  const { products } = await fetchPublicShopifyProducts(domain, { limit: 5000 });
  const index = new Map<string, number>();
  for (const product of products) {
    for (const variant of product.variants) {
      const sku = variant.sku?.trim().toLowerCase();
      if (sku && !index.has(sku)) index.set(sku, variant.id);
    }
  }
  return index;
}

// Resolve varios SKUs de uma vez para o variantId numerico da loja destino.
// Usa cache; em caso de falha de rede devolve um mapa vazio (o chamador trata).
export async function resolveVariantIdsBySku(
  source: string,
  skus: string[]
): Promise<Map<string, number>> {
  const domain = normalizePublicShopifyDomain(source);
  if (!domain || skus.length === 0) return new Map();

  const cached = skuIndexCache.get(domain);
  let index = cached && Date.now() - cached.at < SKU_INDEX_TTL_MS
    ? cached.index
    : null;
  if (!index) {
    try {
      index = await buildSkuIndex(domain);
      podarCacheDeSku();
      skuIndexCache.set(domain, { at: Date.now(), index });
    } catch {
      return new Map();
    }
  }

  const result = new Map<string, number>();
  for (const sku of skus) {
    const key = sku.trim().toLowerCase();
    const variantId = key ? index.get(key) : undefined;
    if (variantId) result.set(sku, variantId);
  }
  return result;
}

export function toShopifyCreateProductInput(product: PublicShopifyProduct) {
  return {
    title: product.title,
    descriptionHtml: product.descriptionHtml || "<p></p>",
    tags: product.tags,
    // vendor e productType eram descartados aqui embora createProduct os aceite.
    // productType e o campo nativo de categoria da Shopify (e o unico sinal de
    // categoria que sobrevive a uma importacao WooCommerce).
    vendor: product.vendor || undefined,
    productType: product.productType || undefined,
    images: product.images.slice(0, 20),
    options: product.options.length > 0 ? product.options : undefined,
    variants: product.variants.slice(0, 100).map((variant, index) => ({
      price: variant.price,
      compareAtPrice: variant.compareAtPrice || undefined,
      options: variant.optionValues,
      // SKU e a chave do checkout roteado — gera um estavel quando falta.
      sku: ensureVariantSku(variant.sku, product.handle, index),
    })),
    seo: {
      title: product.title.slice(0, 70),
      description: product.descriptionHtml
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 160),
    },
  };
}

export function productsToCsv(products: PublicShopifyProduct[]): string {
  const header = [
    "Handle",
    "Title",
    "Body (HTML)",
    "Vendor",
    "Type",
    "Tags",
    "Variant SKU",
    "Variant Price",
    "Variant Compare At Price",
    "Image Src",
  ];

  const escape = (value: unknown) =>
    `"${String(value ?? "").replace(/"/g, '""')}"`;

  const rows = products.flatMap((product) => {
    const firstImage = product.images[0]?.src || "";
    return product.variants.map((variant) => [
      product.handle,
      product.title,
      product.descriptionHtml,
      product.vendor || "",
      product.productType || "",
      product.tags.join(", "),
      variant.sku || "",
      variant.price,
      variant.compareAtPrice || "",
      firstImage,
    ]);
  });

  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}
