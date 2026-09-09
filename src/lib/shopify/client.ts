import { normalizeShopDomain } from "@/lib/shopify/domain";
import { ShopDomainError, assertShopDomainPublico } from "@/lib/shopify/safe-shop";
import { htmlSeguroDaIa } from "@/lib/ai/sanitize-html";

const SHOPIFY_API_VERSION = "2024-10";

// Cache de tokens por loja (em memória — reseta no restart do server)
const tokenCache = new Map<
  string,
  { accessToken: string; expiresAt: number }
>();

type ShopifyClientErrorCode =
  | "INVALID_DOMAIN"
  | "INVALID_CREDENTIALS"
  // App existe mas nao esta instalado na loja: o caller deve mandar o usuario
  // para o fluxo de OAuth. Antes isso era detectado casando a frase em
  // portugues "nao esta instalado" na mensagem — qualquer ajuste de copy
  // (inclusive acentuar) quebrava silenciosamente a instalacao.
  | "APP_NOT_INSTALLED"
  | "REQUEST_FAILED";

export class ShopifyClientError extends Error {
  code: ShopifyClientErrorCode;
  statusCode: number;

  constructor(
    message: string,
    code: ShopifyClientErrorCode,
    statusCode: number
  ) {
    super(message);
    this.name = "ShopifyClientError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export interface ShopifyCredentials {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string | null;
}

function getOperationName(query: string): string {
  const match = query.match(/\b(query|mutation)\s+([A-Za-z0-9_]+)/);
  return match?.[2] || "unknown_operation";
}

function sanitizeErrorText(input: string): string {
  return input
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function looksLikeMissingPublicationScope(reason: string): boolean {
  const normalized = reason.toLowerCase();
  return (
    normalized.includes("read_publications") ||
    (normalized.includes("access denied") && normalized.includes("publications"))
  );
}

async function getInstalledAccessScopes(
  creds: ShopifyCredentials
): Promise<string[]> {
  try {
    const query = `
      query getInstalledScopes {
        currentAppInstallation {
          accessScopes {
            handle
          }
        }
      }
    `;
    const data = await shopifyGraphQL(creds, query);
    const scopes =
      data?.currentAppInstallation?.accessScopes?.map(
        (scope: { handle?: string }) => scope.handle || ""
      ) || [];
    return scopes.filter(Boolean);
  } catch {
    return [];
  }
}

function looksLikeHtml(contentType: string, body: string): boolean {
  const lowerType = contentType.toLowerCase();
  const lowerBody = body.toLowerCase();

  return (
    lowerType.includes("text/html") ||
    lowerBody.includes("<html") ||
    lowerBody.includes("<script") ||
    lowerBody.includes("<!doctype html")
  );
}

/**
 * Hostname aprovado para falar com a Admin API desta loja.
 *
 * Todas as chamadas passam por aqui: o dominio vem de `stores.shop_domain`,
 * que o usuario digita, e sem esta trava ele escolhia para qual host o
 * servidor mandaria o client_secret e o access token. Ver safe-shop.ts.
 */
async function hostDaLoja(shopDomain: string): Promise<string> {
  try {
    return await assertShopDomainPublico(shopDomain);
  } catch (e) {
    if (e instanceof ShopDomainError) {
      throw new ShopifyClientError(e.message, "INVALID_DOMAIN", 400);
    }
    throw e;
  }
}

async function getAccessToken(creds: ShopifyCredentials): Promise<string> {
  const normalizedShopDomain = await hostDaLoja(creds.shopDomain);

  const cacheKey = `${normalizedShopDomain}:${creds.clientId}`;
  if (creds.accessToken) {
    tokenCache.set(cacheKey, {
      accessToken: creds.accessToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
    return creds.accessToken;
  }

  const cached = tokenCache.get(cacheKey);

  // Renova 5 min antes de expirar
  if (cached && cached.expiresAt > Date.now() + 5 * 60 * 1000) {
    return cached.accessToken;
  }

  const res = await fetch(
    `https://${normalizedShopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
      }),
    }
  );

  if (!res.ok) {
    const contentType = res.headers.get("content-type") || "";
    const body = await res.text();
    const lowerBody = body.toLowerCase();
    const isMyShopifyDomain = /\.myshopify\.com$/i.test(normalizedShopDomain);

    console.warn("[shopify/getAccessToken] falhou", {
      status: res.status,
      contentType,
      shopDomain: normalizedShopDomain,
      isMyShopifyDomain,
    });

    if (lowerBody.includes("application_cannot_be_found")) {
      throw new ShopifyClientError(
        "App nao esta instalado nessa loja. Crie o app no dev.shopify.com, gere o link de Custom Distribution para esta loja e instale antes de conectar.",
        "APP_NOT_INSTALLED",
        401
      );
    }

    if (
      res.status === 401 ||
      res.status === 403 ||
      lowerBody.includes("invalid_client") ||
      lowerBody.includes("invalid client")
    ) {
      throw new ShopifyClientError(
        "Client ID ou Client Secret invalidos. Verifique as credenciais do app no Shopify.",
        "INVALID_CREDENTIALS",
        401
      );
    }

    // If the domain is a valid .myshopify.com but we got 404/HTML, the app
    // is almost certainly not installed yet (Shopify returns the storefront
    // HTML page instead of an API response in this scenario).
    if (
      isMyShopifyDomain &&
      (res.status === 404 || looksLikeHtml(contentType, body))
    ) {
      throw new ShopifyClientError(
        "App nao esta instalado nessa loja. Instale o app primeiro: no dev.shopify.com, va em seu App > Distribution > gere o link de Custom Distribution e instale na loja.",
        "APP_NOT_INSTALLED",
        401
      );
    }

    // Non-.myshopify.com domains that return 404/HTML are actually invalid domains
    if (
      res.status === 404 ||
      looksLikeHtml(contentType, body) ||
      lowerBody.includes("cloudflare")
    ) {
      throw new ShopifyClientError(
        `Nao foi possivel acessar o dominio "${creds.shopDomain}". Tente usar o dominio interno ".myshopify.com" da loja.`,
        "INVALID_DOMAIN",
        400
      );
    }

    // O corpo da resposta NAO volta para o usuario.
    //
    // Ele voltava, dentro da mensagem de erro, e /api/shopify/connect repassa
    // essa mensagem no JSON. Com um shop_domain apontando para dentro da
    // infra, isso entregava 220 caracteres de qualquer endpoint interno na
    // tela -- o lado "leitura" de um SSRF. A trava de dominio fecha a ida; nao
    // devolver o corpo fecha a volta, e uma nao depende da outra.
    console.error("[shopify/getAccessToken] resposta inesperada", {
      status: res.status,
      shopDomain: normalizedShopDomain,
      bodySnippet: sanitizeErrorText(body),
    });
    throw new ShopifyClientError(
      `Falha ao autenticar na Shopify (status ${res.status}).`,
      "REQUEST_FAILED",
      502
    );
  }

  const data = await res.json();
  const accessToken: string = data.access_token;
  const expiresIn: number = data.expires_in || 86399;

  tokenCache.set(cacheKey, {
    accessToken,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return accessToken;
}

// GET na Admin REST API. Alguns recursos (ex.: shipping_zones) nao existem no
// GraphQL sem escopos extras, e a REST responde bem para leitura.
export async function shopifyRestGet<T>(
  creds: ShopifyCredentials,
  path: string
): Promise<T> {
  const normalizedShopDomain = await hostDaLoja(creds.shopDomain);
  const accessToken = await getAccessToken(creds);

  const res = await fetch(
    `https://${normalizedShopDomain}/admin/api/${SHOPIFY_API_VERSION}/${path}`,
    { headers: { "X-Shopify-Access-Token": accessToken } }
  );
  if (!res.ok) {
    throw new ShopifyClientError(
      `Falha ao ler ${path} (HTTP ${res.status}).`,
      "REQUEST_FAILED",
      res.status
    );
  }
  return (await res.json()) as T;
}

export async function shopifyGraphQL(
  creds: ShopifyCredentials,
  query: string,
  variables?: Record<string, unknown>
) {
  const normalizedShopDomain = await hostDaLoja(creds.shopDomain);
  const accessToken = await getAccessToken(creds);

  const url = `https://${normalizedShopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;

  // Ate 4 tentativas com backoff quando a Shopify limita (429 HTTP ou erro
  // GraphQL THROTTLED). Necessario porque criamos varios produtos em paralelo.
  const MAX_THROTTLE_RETRIES = 4;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": accessToken,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (!res.ok) {
      if (res.status === 402) {
        throw new ShopifyClientError(
          "A Shopify recusou a chamada API com 402 Payment Required. Normalmente isso acontece quando a loja esta pausada, congelada, sem plano ativo ou com restricao de billing. Ative um plano/trial valido nessa loja e tente novamente.",
          "REQUEST_FAILED",
          402
        );
      }

      if (res.status === 429 && attempt < MAX_THROTTLE_RETRIES) {
        const retryAfter = Number(res.headers.get("retry-after")) || 0;
        const waitMs = retryAfter > 0 ? retryAfter * 1000 : (attempt + 1) * 1500;
        await new Promise((resolve) => setTimeout(resolve, waitMs));
        continue;
      }

      const body = await res.text().catch(() => "");
      const details = sanitizeErrorText(body);
      throw new ShopifyClientError(
        details
          ? `Shopify API error: ${res.status} ${res.statusText} - ${details}`
          : `Shopify API error: ${res.status} ${res.statusText}`,
        "REQUEST_FAILED",
        res.status
      );
    }

    const json = await res.json();
    if (json.errors) {
      // Throttle do GraphQL vem como 200 com erro THROTTLED: espera e retenta.
      const throttled = JSON.stringify(json.errors).includes("THROTTLED");
      if (throttled && attempt < MAX_THROTTLE_RETRIES) {
        await new Promise((resolve) =>
          setTimeout(resolve, (attempt + 1) * 1500)
        );
        continue;
      }
      console.error("[shopifyGraphQL] GraphQL errors", {
        shopDomain: normalizedShopDomain,
        operation: getOperationName(query),
        errors: json.errors,
      });
      throw new Error(`Shopify GraphQL error: ${JSON.stringify(json.errors)}`);
    }

    return json.data;
  }
}

export async function getShopInfo(creds: ShopifyCredentials) {
  const query = `{
    shop {
      name
      email
      primaryDomain { url host }
      currencyCode
      plan { displayName }
    }
  }`;
  return shopifyGraphQL(creds, query);
}

export async function getThemes(creds: ShopifyCredentials) {
  const query = `{
    themes(first: 10) {
      nodes { id name role }
    }
  }`;
  return shopifyGraphQL(creds, query);
}

async function getOnlineStorePublicationId(
  creds: ShopifyCredentials
): Promise<string | null> {
  const query = `
    query getPublications {
      publications(first: 30) {
        nodes {
          id
          name
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query);
  const nodes = data?.publications?.nodes as { id: string; name: string }[] | undefined;

  if (!nodes || nodes.length === 0) {
    return null;
  }

  const byName = nodes.find((publication) =>
    /online store|loja virtual|tienda online/i.test(publication.name)
  );

  return byName?.id || nodes[0].id || null;
}

async function publishProductToStorefront(
  creds: ShopifyCredentials,
  productId: string
) {
  try {
    const publicationId = await getOnlineStorePublicationId(creds);
    if (!publicationId) {
      return { ok: false, reason: "Nenhuma publication encontrada na loja." };
    }

    const mutation = `
      mutation publishablePublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) {
          userErrors { field message }
        }
      }
    `;

    const data = await shopifyGraphQL(creds, mutation, {
      id: productId,
      input: [{ publicationId }],
    });

    const errors = data?.publishablePublish?.userErrors as
      | { field?: string[]; message: string }[]
      | undefined;

    if (errors && errors.length > 0) {
      console.warn("[shopify.publishProductToStorefront] userErrors", {
        shopDomain: creds.shopDomain,
        productId,
        errors,
      });
      return {
        ok: false,
        reason: errors.map((error) => error.message).join(" | "),
      };
    }

    return { ok: true, publicationId };
  } catch (error) {
    let reason =
      error instanceof Error
        ? error.message
        : "Falha ao publicar no canal da loja.";

    if (looksLikeMissingPublicationScope(reason)) {
      const scopes = await getInstalledAccessScopes(creds);
      const scopesText = scopes.length > 0 ? scopes.join(", ") : "indisponivel";
      reason =
        `Scopes insuficientes para publicar no Online Store. ` +
        `Adicione read_publications e write_publications, reinstale o app e reconecte a loja. ` +
        `Scopes atuais: ${scopesText}`;
    }

    console.error("[shopify.publishProductToStorefront] failed", {
      shopDomain: creds.shopDomain,
      productId,
      reason,
    });
    return { ok: false, reason };
  }
}

async function getPrimaryInventoryLocationId(creds: ShopifyCredentials) {
  const query = `
    query getInventoryLocation {
      locations(first: 1, query: "active:true") {
        nodes {
          id
          name
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query);
  return data?.locations?.nodes?.[0]?.id as string | undefined;
}

async function getProductInventoryItems(
  creds: ShopifyCredentials,
  productId: string
) {
  const query = `
    query getProductInventoryItems($id: ID!) {
      product(id: $id) {
        variants(first: 100) {
          nodes {
            id
            inventoryItem {
              id
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query, { id: productId });
  return (
    data?.product?.variants?.nodes as
      | { id?: string; inventoryItem?: { id?: string } | null }[]
      | undefined
  ) || [];
}

async function applyInitialInventoryQuantities(
  creds: ShopifyCredentials,
  productId: string,
  quantitiesByVariantIndex: (number | undefined)[]
) {
  // Antes esta funcao saia aqui quando nao vinha quantidade — e era o bug:
  // o inventory item nascia sem vinculo com nenhuma location. A Shopify trata
  // item orfao como indisponivel, entao a vitrine mostrava "esgotado" e o
  // /cart/add.js recusava com 422, enquanto o Admin dizia availableForSale:true.
  // Agora, sem quantidade, ativamos no local primario com 0 — que com
  // tracked:false e o que produz "sempre disponivel" de verdade.
  const warnings: string[] = [];

  try {
    const locationId = await getPrimaryInventoryLocationId(creds);
    if (!locationId) {
      return ["Estoque inicial nao aplicado: nenhuma location ativa encontrada na Shopify."];
    }

    const variants = await getProductInventoryItems(creds, productId);

    // Vincula toda variante ao local, com ou sem quantidade informada.
    // inventoryActivate cria o vinculo; inventorySetQuantities sozinho falha
    // quando o item ainda nao existe naquele local.
    const ativar = `
      mutation inventoryActivate($inventoryItemId: ID!, $locationId: ID!, $available: Int) {
        inventoryActivate(inventoryItemId: $inventoryItemId, locationId: $locationId, available: $available) {
          userErrors { field message }
        }
      }
    `;
    for (const [index, v] of variants.entries()) {
      const inventoryItemId = v?.inventoryItem?.id;
      if (!inventoryItemId) continue;
      const quantidade = quantitiesByVariantIndex[index];
      try {
        const r = await shopifyGraphQL(creds, ativar, {
          inventoryItemId,
          locationId,
          available: typeof quantidade === "number" ? quantidade : 0,
        });
        const ue = r?.inventoryActivate?.userErrors || [];
        if (ue.length) {
          warnings.push(
            `Variante ${index + 1}: nao foi possivel vincular ao local (${ue[0].message}).`
          );
        }
      } catch (error) {
        warnings.push(
          `Variante ${index + 1}: falha ao vincular ao local (${
            error instanceof Error ? error.message.slice(0, 90) : "erro"
          }).`
        );
      }
    }

    const hasQuantity = quantitiesByVariantIndex.some(
      (quantity) => typeof quantity === "number"
    );
    // Sem quantidade informada, o inventoryActivate acima ja resolveu tudo.
    if (!hasQuantity) return warnings;

    const quantities = quantitiesByVariantIndex
      .map((quantity, index) => {
        const inventoryItemId = variants[index]?.inventoryItem?.id;
        if (typeof quantity !== "number" || !inventoryItemId) return null;
        return {
          inventoryItemId,
          locationId,
          quantity,
          compareQuantity: null,
        };
      })
      .filter(
        (
          item
        ): item is {
          inventoryItemId: string;
          locationId: string;
          quantity: number;
          compareQuantity: null;
        } => Boolean(item)
      );

    if (quantities.length === 0) {
      return ["Estoque inicial nao aplicado: variantes sem inventory item retornado pela Shopify."];
    }

    const mutation = `
      mutation inventorySetQuantities($input: InventorySetQuantitiesInput!) {
        inventorySetQuantities(input: $input) {
          userErrors {
            field
            message
          }
        }
      }
    `;

    const result = await shopifyGraphQL(creds, mutation, {
      input: {
        ignoreCompareQuantity: true,
        name: "available",
        reason: "correction",
        referenceDocumentUri: `gid://xcart/ProductClone/${productId.split("/").pop() || Date.now()}`,
        quantities,
      },
    });

    const errors = result?.inventorySetQuantities?.userErrors as
      | { field?: string[]; message: string }[]
      | undefined;
    if (errors?.length) {
      warnings.push(
        `Estoque inicial nao aplicado: ${errors
          .map((error) =>
            error.field?.length
              ? `${error.field.join(".")}: ${error.message}`
              : error.message
          )
          .join(" | ")}`
      );
    }
  } catch (error) {
    warnings.push(
      `Estoque inicial nao aplicado: ${
        error instanceof Error ? error.message : "erro desconhecido"
      }`
    );
  }

  return warnings;
}

// Converte o sort_order da /collections.json publica para o enum
// CollectionSortOrder da Admin API.
function toCollectionSortOrder(value: string | null | undefined): string | null {
  const map: Record<string, string> = {
    manual: "MANUAL",
    "best-selling": "BEST_SELLING",
    "alpha-asc": "ALPHA_ASC",
    "alpha-desc": "ALPHA_DESC",
    "price-asc": "PRICE_ASC",
    "price-desc": "PRICE_DESC",
    "created-desc": "CREATED_DESC",
    created: "CREATED",
  };
  return map[(value || "").trim().toLowerCase()] || null;
}

export async function syncProductCollections(
  creds: ShopifyCredentials,
  input: {
    collections: {
      handle: string;
      title: string;
      bodyHtml?: string | null;
      image?: string | null;
      sortOrder?: string | null;
    }[];
    assignments: { collectionHandle: string; productIds: string[] }[];
  }
) {
  type ShopifyUserError = { field?: string[]; message: string };

  function formatErrors(errors: ShopifyUserError[] | undefined) {
    return (errors || [])
      .map((error) =>
        error.field?.length
          ? `${error.field.join(".")}: ${error.message}`
          : error.message
      )
      .join(" | ");
  }

  async function findCollectionByHandle(handle: string) {
    const query = `
      query findCollection($query: String!) {
        collections(first: 1, query: $query) {
          nodes {
            id
            title
            handle
          }
        }
      }
    `;
    const data = await shopifyGraphQL(creds, query, {
      query: `handle:${handle}`,
    });
    return data?.collections?.nodes?.[0] as
      | { id: string; title: string; handle: string }
      | undefined;
  }

  async function createCollection(collection: {
    handle: string;
    title: string;
    bodyHtml?: string | null;
    image?: string | null;
    sortOrder?: string | null;
  }) {
    const mutation = `
      mutation collectionCreate($input: CollectionInput!) {
        collectionCreate(input: $input) {
          collection {
            id
            title
            handle
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const result = await shopifyGraphQL(creds, mutation, {
      input: {
        title: collection.title,
        handle: collection.handle,
        // Antes so title+handle eram enviados: descricao, imagem e ordenacao da
        // colecao de origem eram perdidas. Sem sortOrder a Shopify assume
        // BEST_SELLING, que numa loja nova (zero vendas) fica arbitraria.
        // bodyHtml vem da colecao do site de origem: HTML de terceiro.
        ...(collection.bodyHtml
          ? { descriptionHtml: htmlSeguroDaIa(collection.bodyHtml) }
          : {}),
        ...(collection.image ? { image: { src: collection.image } } : {}),
        ...(toCollectionSortOrder(collection.sortOrder)
          ? { sortOrder: toCollectionSortOrder(collection.sortOrder) }
          : {}),
      },
    });
    const errors = result?.collectionCreate?.userErrors as
      | ShopifyUserError[]
      | undefined;
    if (errors?.length) {
      throw new Error(formatErrors(errors) || "Falha ao criar colecao.");
    }
    return result?.collectionCreate?.collection as
      | { id: string; title: string; handle: string }
      | undefined;
  }

  async function ensureCollection(collection: {
    handle: string;
    title: string;
    bodyHtml?: string | null;
    image?: string | null;
    sortOrder?: string | null;
  }) {
    const existing = await findCollectionByHandle(collection.handle);
    if (existing?.id) return existing;
    return createCollection(collection);
  }

  function isAlreadyInCollectionError(message: string) {
    const normalized = message.toLowerCase();
    return (
      normalized.includes("already") ||
      normalized.includes("ja esta") ||
      normalized.includes("já está")
    );
  }

  async function runAddProducts(collectionId: string, productIds: string[]) {
    const mutation = `
      mutation collectionAddProducts($id: ID!, $productIds: [ID!]!) {
        collectionAddProducts(id: $id, productIds: $productIds) {
          collection {
            id
          }
          userErrors {
            field
            message
          }
        }
      }
    `;
    const result = await shopifyGraphQL(creds, mutation, {
      id: collectionId,
      productIds: [...new Set(productIds)].filter(Boolean),
    });
    const errors = result?.collectionAddProducts?.userErrors as
      | ShopifyUserError[]
      | undefined;
    return errors || [];
  }

  async function addProducts(collectionId: string, productIds: string[]) {
    const uniqueProductIds = [...new Set(productIds)].filter(Boolean);
    const errors = await runAddProducts(collectionId, uniqueProductIds);
    if (!errors.length) return "";

    if (uniqueProductIds.length === 1) {
      const blockingErrors = errors.filter(
        (error) => !isAlreadyInCollectionError(error.message)
      );
      return formatErrors(blockingErrors);
    }

    const warnings: string[] = [];
    for (const productId of uniqueProductIds) {
      const singleErrors = await runAddProducts(collectionId, [productId]);
      const blockingErrors = singleErrors.filter(
        (error) => !isAlreadyInCollectionError(error.message)
      );
      const warning = formatErrors(blockingErrors);
      if (warning) warnings.push(warning);
    }
    return warnings.join(" | ");
  }

  const collectionByHandle = new Map(
    input.collections
      .filter((collection) => collection.handle && collection.title)
      .map((collection) => [collection.handle, collection])
  );
  const warnings: string[] = [];
  const synced: { handle: string; productCount: number }[] = [];

  for (const assignment of input.assignments) {
    const productIds = [...new Set(assignment.productIds)].filter(Boolean);
    if (productIds.length === 0) continue;

    const sourceCollection =
      collectionByHandle.get(assignment.collectionHandle) || {
        handle: assignment.collectionHandle,
        title: assignment.collectionHandle.replace(/[-_]+/g, " "),
      };

    try {
      const collection = await ensureCollection(sourceCollection);
      if (!collection?.id) {
        warnings.push(`Colecao ${sourceCollection.title} nao retornou ID.`);
        continue;
      }
      const publication = await publishProductToStorefront(creds, collection.id);
      if (!publication.ok && publication.reason) {
        warnings.push(
          `${sourceCollection.title}: colecao criada, mas nao publicada no Online Store (${publication.reason})`
        );
      }
      const addWarning = await addProducts(collection.id, productIds);
      if (addWarning) {
        warnings.push(`${sourceCollection.title}: ${addWarning}`);
      } else {
        synced.push({
          handle: sourceCollection.handle,
          productCount: productIds.length,
        });
      }
    } catch (error) {
      warnings.push(
        `${sourceCollection.title}: ${
          error instanceof Error ? error.message : "falha ao sincronizar"
        }`
      );
    }
  }

  return { synced, warnings };
}

// Carimba SKUs em variantes JA existentes (productVariantsBulkUpdate).
// Usado para conectar produtos da dark store criados antes do SKU automatico,
// sem precisar recriar nada — a conexao por SKU passa a funcionar.
export async function updateVariantSkus(
  creds: ShopifyCredentials,
  productId: string,
  updates: { variantId: string; sku: string }[]
) {
  const variants = updates
    .filter((update) => update.variantId && update.sku?.trim())
    .map((update) => ({
      id: update.variantId,
      inventoryItem: { sku: update.sku.trim() },
    }));

  if (variants.length === 0) return { updated: 0 };

  const query = `
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { field message }
      }
    }
  `;

  const result = await shopifyGraphQL(creds, query, { productId, variants });
  const errors = result?.productVariantsBulkUpdate?.userErrors as
    | { message: string }[]
    | undefined;
  if (errors?.length) {
    throw new Error(errors.map((error) => error.message).join(" | "));
  }

  return { updated: variants.length };
}

export async function createProduct(
  creds: ShopifyCredentials,
  input: {
    title: string;
    descriptionHtml: string;
    tags: string[];
    categoryId?: string | null;
    productType?: string | null;
    /**
     * Marca do produto. Na loja VITRINE ela e informacao de venda: e o que
     * aparece na pagina, no filtro por marca e na busca. Na loja de checkout
     * ela costuma ficar de fora, junto com o resto da neutralizacao.
     */
    vendor?: string | null;
    metafields?: {
      namespace: string;
      key: string;
      type: string;
      value: string;
    }[];
    images: { src: string; altText: string }[];
    variants: {
      price: string;
      compareAtPrice?: string;
      options?: string[];
      inventoryQuantity?: number;
      inventoryTracked?: boolean;
      sku?: string;
    }[];
    options?: string[]; // nomes das opções: ["Cor", "Tamanho"]
    seo?: { title: string; description: string };
    publishToStorefront?: boolean;
  }
) {
  type ShopifyUserError = { field?: string[]; message: string };
  type CreateProductVariantInput = {
    price: string | number;
    compareAtPrice?: string | number;
    options?: string[];
    inventoryQuantity?: number;
    inventoryTracked?: boolean;
    sku?: string;
  };

  // Monta o bloco inventoryItem incluindo SKU e/ou rastreamento quando houver.
  // O SKU e a chave que permite conectar a variante da vitrine a da dark store
  // automaticamente (sku_map), sem linkar produto por produto.
  function buildInventoryItem(variant: {
    inventoryTracked?: boolean;
    sku?: string;
  }) {
    const item: { tracked?: boolean; sku?: string } = {};
    if (typeof variant.inventoryTracked === "boolean") {
      item.tracked = variant.inventoryTracked;
    }
    if (variant.sku && variant.sku.trim()) {
      item.sku = variant.sku.trim();
    }
    return Object.keys(item).length ? { inventoryItem: item } : {};
  }

  function assertNoUserErrors(
    errors: ShopifyUserError[] | undefined,
    context: string
  ) {
    if (!errors || errors.length === 0) return;
    throw new Error(
      `${context}: ${errors
        .map((error) =>
          error.field?.length
            ? `${error.field.join(".")}: ${error.message}`
            : error.message
        )
        .join(" | ")}`
    );
  }

  function normalizePrice(value: string | number | null | undefined) {
    if (typeof value === "number") {
      const numeric = value > 999 && Number.isInteger(value) ? value / 100 : value;
      return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
    }

    const raw = String(value ?? "")
      .trim()
      .replace(/[^\d,.-]/g, "");
    const normalized =
      raw.includes(",") && !raw.includes(".")
        ? raw.replace(/\./g, "").replace(",", ".")
        : raw.replace(/,/g, "");
    const numeric = Number(normalized || 0);
    return Number.isFinite(numeric) ? numeric.toFixed(2) : "0.00";
  }

  function normalizeInventoryQuantity(value: unknown) {
    if (value === null || value === undefined || value === "") return undefined;
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return undefined;
    return Math.max(0, Math.floor(numeric));
  }

  function buildProductOptions() {
    if (!hasMultipleVariants || !input.options?.length) return undefined;
    return input.options.map((optionName, optionIndex) => {
      const values = [
        ...new Set(
          normalizedVariants
            .map((variant) => variant.options?.[optionIndex])
            .filter((value): value is string => Boolean(value?.trim()))
        ),
      ];
      return {
        name: optionName,
        values: (values.length ? values : ["Default"]).map((name) => ({ name })),
      };
    });
  }

  const shouldPublishToStorefront = input.publishToStorefront !== false;
  const sourceVariants: CreateProductVariantInput[] =
    input.variants.length > 0 ? input.variants : [{ price: "0.00" }];
  const normalizedVariants = sourceVariants.map((variant) => ({
    ...variant,
    price: normalizePrice(variant.price),
    compareAtPrice: variant.compareAtPrice
      ? normalizePrice(variant.compareAtPrice)
      : undefined,
    inventoryQuantity: normalizeInventoryQuantity(variant.inventoryQuantity),
    inventoryTracked:
      typeof variant.inventoryTracked === "boolean"
        ? variant.inventoryTracked
        : false,
    sku: variant.sku?.trim() || undefined,
  }));
  const hasMultipleVariants =
    normalizedVariants.length > 1 && Boolean(input.options?.length);

  // Passo 1: Criar produto com opções se houver variantes
  const createQuery = `
    mutation productCreate($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          handle
          variants(first: 1) { nodes { id } }
          options { id name position values }
        }
        userErrors { field message }
      }
    }
  `;

  const productInput: Record<string, unknown> = {
    title: input.title,
    // ==================================================================
    // Ponto unico onde HTML entra num produto da Shopify.
    //
    // Duas origens chegam aqui e NENHUMA era limpa:
    //   1. saida da IA (optimizeProduct / neutralizador);
    //   2. o proprio descriptionHtml RASPADO do site de origem, que e o
    //      fallback quando a IA nao roda -- ou seja, HTML de terceiro
    //      publicado direto, sem modelo nenhum no meio.
    //
    // Sanitizar aqui, e nao em cada chamador, e o que garante que nenhum
    // caminho novo escape. Ver src/lib/ai/sanitize-html.ts.
    // ==================================================================
    descriptionHtml: htmlSeguroDaIa(input.descriptionHtml),
    tags: input.tags,
    seo: input.seo,
    status: shouldPublishToStorefront ? "ACTIVE" : "DRAFT",
  };
  if (input.categoryId) {
    productInput.category = input.categoryId;
  }
  if (input.productType) {
    productInput.productType = input.productType;
  }
  if (input.vendor) {
    productInput.vendor = input.vendor;
  }
  if (input.metafields?.length) {
    productInput.metafields = input.metafields;
  }
  const productOptions = buildProductOptions();
  if (productOptions) {
    productInput.productOptions = productOptions;
  }

  const createResult = await shopifyGraphQL(creds, createQuery, {
    input: productInput,
  });

  const product = createResult.productCreate?.product;
  const userErrors = createResult.productCreate?.userErrors;
  assertNoUserErrors(userErrors, "Falha ao criar produto na Shopify");
  if (!product?.id) {
    throw new Error("Produto criado mas sem ID retornado");
  }

  // Passo 2: Configurar variantes
  let defaultVariantId = product.variants?.nodes?.[0]?.id;
  if (!defaultVariantId) {
    const refreshedProduct = await getProductById(creds, product.id).catch(() => null);
    defaultVariantId = refreshedProduct?.variants?.nodes?.[0]?.id;
  }

  if (hasMultipleVariants) {
    // Atualizar a primeira variante default e criar as adicionais
    if (!defaultVariantId) {
      throw new Error("Produto criado, mas a Shopify nao retornou a variante para aplicar o preco.");
    }

    const variantsToCreate = normalizedVariants.slice(1).map((v) => ({
      price: v.price,
      ...(v.compareAtPrice ? { compareAtPrice: v.compareAtPrice } : {}),
      ...buildInventoryItem(v),
      optionValues: (v.options || []).map((val, i) => ({
        optionName: input.options![i],
        name: val,
      })),
    }));

    // Atualizar variante default com opções da primeira variante
    const firstVariant = normalizedVariants[0];
    const bulkInput = [
      {
        id: defaultVariantId,
        price: firstVariant.price,
        ...(firstVariant.compareAtPrice ? { compareAtPrice: firstVariant.compareAtPrice } : {}),
        ...buildInventoryItem(firstVariant),
        optionValues: (firstVariant.options || []).map((val, i) => ({
          optionName: input.options![i],
          name: val,
        })),
      },
    ];

    const bulkQuery = `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }
    `;
    const updateResult = await shopifyGraphQL(creds, bulkQuery, {
      productId: product.id,
      variants: bulkInput,
    });
    assertNoUserErrors(
      updateResult?.productVariantsBulkUpdate?.userErrors,
      "Falha ao aplicar preco da primeira variante"
    );

    // Criar variantes adicionais
    if (variantsToCreate.length > 0) {
      const createVariantsQuery = `
        mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkCreate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { field message }
          }
        }
      `;
      const createVariantsResult = await shopifyGraphQL(creds, createVariantsQuery, {
        productId: product.id,
        variants: variantsToCreate,
      });
      assertNoUserErrors(
        createVariantsResult?.productVariantsBulkCreate?.userErrors,
        "Falha ao criar variantes com preco"
      );
    }
  } else if (normalizedVariants.length > 0) {
    if (!defaultVariantId) {
      throw new Error("Produto criado, mas a Shopify nao retornou a variante para aplicar o preco.");
    }

    // Produto simples — só atualizar preço da variante default
    const variant = normalizedVariants[0];
    const variantQuery = `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }
    `;
    const variantResult = await shopifyGraphQL(creds, variantQuery, {
      productId: product.id,
      variants: [{
        id: defaultVariantId,
        price: variant.price,
        ...(variant.compareAtPrice ? { compareAtPrice: variant.compareAtPrice } : {}),
        ...buildInventoryItem(variant),
      }],
    });
    assertNoUserErrors(
      variantResult?.productVariantsBulkUpdate?.userErrors,
      "Falha ao aplicar preco do produto"
    );
  }

  // Passo 3: Adicionar imagens via productCreateMedia
  if (input.images.length > 0) {
    const mediaQuery = `
      mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
        productCreateMedia(productId: $productId, media: $media) {
          media { id alt }
          mediaUserErrors { field message }
        }
      }
    `;
    await shopifyGraphQL(creds, mediaQuery, {
      productId: product.id,
      media: input.images.map((img) => ({
        originalSource: img.src,
        alt: img.altText,
        mediaContentType: "IMAGE",
      })),
    });
  }

  const inventoryWarnings = await applyInitialInventoryQuantities(
    creds,
    product.id,
    normalizedVariants.map((variant) => variant.inventoryQuantity)
  );

  let storefrontPublication:
    | { ok: boolean; publicationId?: string; reason?: string }
    | undefined;

  if (shouldPublishToStorefront) {
    storefrontPublication = await publishProductToStorefront(creds, product.id);
  }

  const syncedProduct = await getProductById(creds, product.id).catch(() => null);

  return {
    ...createResult,
    syncedProduct,
    storefrontPublication,
    inventoryWarnings,
  };
}

// Adiciona variantes a um produto JA EXISTENTE (ex.: faltam alguns tamanhos
// de um produto que ja foi clonado pro destino). Usado pelo reparo de rota:
// quando so algumas variantes de um produto da vitrine nao tem par na dark
// store, mas o produto em si ja existe la.
export async function addProductVariants(
  creds: ShopifyCredentials,
  productId: string,
  optionNames: string[],
  variants: {
    price: string | number;
    sku?: string;
    optionValues: string[];
  }[]
) {
  const mutation = `
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        productVariants { id sku }
        userErrors { field message }
      }
    }
  `;
  const input = variants.map((variant) => ({
    price: typeof variant.price === "number" ? variant.price.toFixed(2) : variant.price,
    ...(variant.sku?.trim() ? { inventoryItem: { sku: variant.sku.trim() } } : {}),
    optionValues: variant.optionValues
      .map((value, index) => (value ? { optionName: optionNames[index], name: value } : null))
      .filter((value): value is { optionName: string; name: string } => Boolean(value)),
  }));

  const data = await shopifyGraphQL(creds, mutation, { productId, variants: input });
  const errors = data?.productVariantsBulkCreate?.userErrors as
    | { field?: string[]; message: string }[]
    | undefined;
  if (errors?.length) {
    throw new Error(
      `Falha ao adicionar variantes: ${errors.map((error) => error.message).join(" | ")}`
    );
  }
  return (data?.productVariantsBulkCreate?.productVariants || []) as {
    id: string;
    sku: string | null;
  }[];
}

const POLICY_TYPE_MAP: Record<string, string> = {
  refund: "REFUND_POLICY",
  privacy: "PRIVACY_POLICY",
  terms: "TERMS_OF_SERVICE",
  shipping: "SHIPPING_POLICY",
};

export async function updateStorePolicies(
  creds: ShopifyCredentials,
  policies: { type: string; body: string }[]
) {
  const results = [];
  for (const policy of policies) {
    const shopifyType = POLICY_TYPE_MAP[policy.type] || policy.type.toUpperCase();
    const query = `
      mutation shopPolicyUpdate($shopPolicy: ShopPolicyInput!) {
        shopPolicyUpdate(shopPolicy: $shopPolicy) {
          shopPolicy { id type body }
          userErrors { field message }
        }
      }
    `;
    const variables = {
      shopPolicy: {
        type: shopifyType,
        body: policy.body,
      },
    };
    const result = await shopifyGraphQL(creds, query, variables);
    results.push(result);
  }
  return results;
}

export async function getProducts(
  creds: ShopifyCredentials,
  optionsOrFirst:
    | number
    | {
        first?: number;
        status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
        query?: string;
        after?: string | null;
      } = 50
) {
  const parsedOptions =
    typeof optionsOrFirst === "number"
      ? { first: optionsOrFirst }
      : optionsOrFirst;

  const safeFirst = Math.min(Math.max(1, Math.floor(parsedOptions.first ?? 50)), 250);
  const filters: string[] = [];

  if (parsedOptions.status) {
    filters.push(`status:${parsedOptions.status}`);
  }
  if (parsedOptions.query?.trim()) {
    filters.push(parsedOptions.query.trim());
  }

  const queryFilter = filters.join(" ");
  const query = `
    query getProducts($first: Int!, $query: String, $after: String) {
      products(first: $first, query: $query, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          title
          handle
          status
          descriptionHtml
          tags
          productType
          category { id name fullName }
          metafields(first: 20, namespace: "custom") {
            nodes {
              namespace
              key
              type
              value
            }
          }
          seo { title description }
          images(first: 12) { nodes { url altText } }
          options {
            name
            values
          }
          variants(first: 50) {
            nodes {
              id
              title
              sku
              price
              compareAtPrice
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;
  return shopifyGraphQL(creds, query, {
    first: safeFirst,
    query: queryFilter || null,
    after: parsedOptions.after || null,
  });
}

// Conta os produtos de uma loja (para barra de progresso de import/clone).
export async function getProductsCount(
  creds: ShopifyCredentials,
  options?: { status?: "ACTIVE" | "DRAFT" | "ARCHIVED"; query?: string }
): Promise<number> {
  const filters: string[] = [];
  if (options?.status) filters.push(`status:${options.status}`);
  if (options?.query?.trim()) filters.push(options.query.trim());
  const queryFilter = filters.join(" ");

  const query = `
    query getProductsCount($query: String) {
      productsCount(query: $query) { count }
    }
  `;
  const result = await shopifyGraphQL(creds, query, {
    query: queryFilter || null,
  });
  const count = Number(result?.productsCount?.count);
  return Number.isFinite(count) ? count : 0;
}

export async function getProductById(creds: ShopifyCredentials, productId: string) {
  const query = `
    query getProductById($id: ID!) {
      product(id: $id) {
        id
        title
        handle
        status
        descriptionHtml
        tags
        productType
        category { id name fullName }
        metafields(first: 20, namespace: "custom") {
          nodes {
            namespace
            key
            type
            value
          }
        }
        seo { title description }
        images(first: 20) { nodes { url altText } }
        options {
          name
          values
        }
        variants(first: 100) {
          nodes {
            id
            title
            sku
            price
            compareAtPrice
            selectedOptions { name value }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query, { id: productId });
  return data?.product || null;
}

export async function getProductsByIds(
  creds: ShopifyCredentials,
  productIds: string[]
) {
  const ids = [...new Set(productIds)].filter(Boolean).slice(0, 50);
  if (ids.length === 0) return [];

  const query = `
    query getProductsByIds($ids: [ID!]!) {
      nodes(ids: $ids) {
        ... on Product {
          id
          title
          handle
          status
          descriptionHtml
          tags
          productType
          category { id name fullName }
          metafields(first: 20, namespace: "custom") {
            nodes {
              namespace
              key
              type
              value
            }
          }
          seo { title description }
          images(first: 20) { nodes { url altText } }
          options {
            name
            values
          }
          variants(first: 100) {
            nodes {
              id
              title
              sku
              price
              compareAtPrice
              selectedOptions { name value }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query, { ids });
  return (data?.nodes || []).filter(Boolean);
}

export interface ShopifyTaxonomyCategoryMatch {
  id: string;
  name: string;
  fullName: string;
  isLeaf?: boolean;
  isArchived?: boolean;
}

export interface ShopifyTaxonomyAttributeValue {
  id: string;
  name: string;
}

export interface ShopifyTaxonomyAttributeMatch {
  id: string;
  name: string;
  type: string;
  values: ShopifyTaxonomyAttributeValue[];
}

export interface ShopifyStandardMetafieldTemplate {
  id: string;
  name: string;
  namespace: string;
  key: string;
  ownerTypes: string[];
  type: string;
}

export interface ShopifyProductMetafieldInput {
  namespace: string;
  key: string;
  type: string;
  value: string;
  label?: string;
  displayValue?: string;
  definitionTemplateId?: string;
}

const SHOPIFY_CLIENT_CACHE_TTL_MS = 10 * 60 * 1000;
const metafieldDefinitionCache = new Map<string, number>();
const taxonomyCategoryCache = new Map<
  string,
  { expiresAt: number; value: ShopifyTaxonomyCategoryMatch[] }
>();
const categoryMetafieldDataCache = new Map<
  string,
  {
    expiresAt: number;
    value: {
      attributes: ShopifyTaxonomyAttributeMatch[];
      templates: ShopifyStandardMetafieldTemplate[];
    };
  }
>();

type ShopifyMetafieldDefinitionOwnerType = "PRODUCT" | "PRODUCTVARIANT";

function cachedShopKey(creds: ShopifyCredentials) {
  return normalizeShopDomain(creds.shopDomain) || creds.shopDomain;
}

function isCacheFresh(expiresAt?: number) {
  return typeof expiresAt === "number" && expiresAt > Date.now();
}

function metafieldDefinitionName(field: ShopifyProductMetafieldInput) {
  return field.key
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .slice(0, 80);
}

async function ensureStandardProductMetafieldDefinition(
  creds: ShopifyCredentials,
  field: ShopifyProductMetafieldInput
) {
  const cacheKey = `${cachedShopKey(creds)}:standard-product:${field.definitionTemplateId || `${field.namespace}.${field.key}`}`;
  if (isCacheFresh(metafieldDefinitionCache.get(cacheKey))) return null;

  const mutation = field.definitionTemplateId
    ? `
      mutation enableStandardMetafieldDefinition($id: ID!, $ownerType: MetafieldOwnerType!, $pin: Boolean!) {
        standardMetafieldDefinitionEnable(id: $id, ownerType: $ownerType, pin: $pin) {
          createdDefinition { id namespace key }
          userErrors { field message }
        }
      }
    `
    : `
      mutation enableStandardMetafieldDefinition($namespace: String!, $key: String!, $ownerType: MetafieldOwnerType!, $pin: Boolean!) {
        standardMetafieldDefinitionEnable(namespace: $namespace, key: $key, ownerType: $ownerType, pin: $pin) {
          createdDefinition { id namespace key }
          userErrors { field message }
        }
      }
    `;

  const variables = field.definitionTemplateId
    ? {
        id: field.definitionTemplateId,
        ownerType: "PRODUCT",
        pin: false,
      }
    : {
        namespace: field.namespace,
        key: field.key,
        ownerType: "PRODUCT",
        pin: false,
      };

  const enabled = await shopifyGraphQL(creds, mutation, variables);
  const userErrors = enabled?.standardMetafieldDefinitionEnable?.userErrors as
    | { field?: string[]; message: string }[]
    | undefined;

  if (userErrors?.length) {
    const alreadyExists = userErrors.some((error) =>
      /already exists|taken|ja existe|jÃ¡ existe|enabled|active/i.test(error.message)
    );
    if (!alreadyExists) {
      return `${field.namespace}.${field.key}: ${userErrors
        .map((error) => error.message)
        .join(" | ")}`;
    }
  }

  metafieldDefinitionCache.set(cacheKey, Date.now() + SHOPIFY_CLIENT_CACHE_TTL_MS);
  return null;
}

async function ensureMetafieldDefinitions(
  creds: ShopifyCredentials,
  fields: ShopifyProductMetafieldInput[],
  ownerType: ShopifyMetafieldDefinitionOwnerType
) {
  const uniqueFields = Array.from(
    new Map(fields.map((field) => [`${field.namespace}.${field.key}`, field])).values()
  );
  const warnings: string[] = [];

  for (const field of uniqueFields) {
    if (ownerType === "PRODUCT" && field.namespace === "shopify") {
      try {
        const warning = await ensureStandardProductMetafieldDefinition(creds, field);
        if (warning) warnings.push(warning);
      } catch (error) {
        warnings.push(
          `${field.namespace}.${field.key}: ${
            error instanceof Error ? error.message : "falha ao ativar definicao padrao"
          }`
        );
      }
      continue;
    }

    const cacheKey = `${cachedShopKey(creds)}:${ownerType.toLowerCase()}:${field.namespace}.${field.key}:${field.type}`;
    if (isCacheFresh(metafieldDefinitionCache.get(cacheKey))) continue;

    const existingQuery = `
      query getMetafieldDefinition($ownerType: MetafieldOwnerType!, $namespace: String, $key: String) {
        metafieldDefinitions(ownerType: $ownerType, namespace: $namespace, key: $key, first: 1) {
          nodes { id namespace key type { name } }
        }
      }
    `;

    try {
      const existing = await shopifyGraphQL(creds, existingQuery, {
        ownerType,
        namespace: field.namespace,
        key: field.key,
      });
      if (existing?.metafieldDefinitions?.nodes?.[0]?.id) {
        metafieldDefinitionCache.set(
          cacheKey,
          Date.now() + SHOPIFY_CLIENT_CACHE_TTL_MS
        );
        continue;
      }

      const createMutation = `
        mutation createProductMetafieldDefinition($definition: MetafieldDefinitionInput!) {
          metafieldDefinitionCreate(definition: $definition) {
            createdDefinition { id namespace key }
            userErrors { field message }
          }
        }
      `;
      const created = await shopifyGraphQL(creds, createMutation, {
        definition: {
          ownerType,
          namespace: field.namespace,
          key: field.key,
          name: metafieldDefinitionName(field),
          type: field.type,
          pin: true,
        },
      });
      const userErrors = created?.metafieldDefinitionCreate?.userErrors as
        | { field?: string[]; message: string }[]
        | undefined;
      if (userErrors?.length) {
        const alreadyExists = userErrors.some((error) =>
          /already exists|taken|ja existe|já existe/i.test(error.message)
        );
        if (alreadyExists) {
          metafieldDefinitionCache.set(
            cacheKey,
            Date.now() + SHOPIFY_CLIENT_CACHE_TTL_MS
          );
        } else {
          warnings.push(
            `${field.namespace}.${field.key}: ${userErrors
              .map((error) => error.message)
              .join(" | ")}`
          );
        }
      } else {
        metafieldDefinitionCache.set(
          cacheKey,
          Date.now() + SHOPIFY_CLIENT_CACHE_TTL_MS
        );
      }
    } catch (error) {
      warnings.push(
        `${field.namespace}.${field.key}: ${
          error instanceof Error ? error.message : "falha ao criar definicao"
        }`
      );
    }
  }

  return warnings;
}

export async function ensureProductMetafieldDefinitions(
  creds: ShopifyCredentials,
  fields: ShopifyProductMetafieldInput[]
) {
  return ensureMetafieldDefinitions(creds, fields, "PRODUCT");
}

export async function ensureProductVariantMetafieldDefinitions(
  creds: ShopifyCredentials,
  fields: ShopifyProductMetafieldInput[]
) {
  return ensureMetafieldDefinitions(creds, fields, "PRODUCTVARIANT");
}

export async function setProductMetafields(
  creds: ShopifyCredentials,
  productId: string,
  fields: ShopifyProductMetafieldInput[]
) {
  if (fields.length === 0) return { metafields: [], userErrors: [] };

  const definitionWarnings = await ensureProductMetafieldDefinitions(creds, fields);
  const mutation = `
    mutation setProductMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value }
        userErrors { field message code }
      }
    }
  `;
  const result = await shopifyGraphQL(creds, mutation, {
    metafields: fields.map((field) => ({
      ownerId: productId,
      namespace: field.namespace,
      key: field.key,
      type: field.type,
      value: field.value,
    })),
  });
  const userErrors = result?.metafieldsSet?.userErrors as
    | { field?: string[]; message: string; code?: string }[]
    | undefined;

  if (userErrors?.length) {
    throw new Error(
      [
        ...definitionWarnings,
        ...userErrors.map((err) =>
          err.field?.length ? `${err.field.join(".")}: ${err.message}` : err.message
        ),
      ].join(" | ")
    );
  }

  return {
    ...result?.metafieldsSet,
    definitionWarnings,
  };
}

export async function setProductVariantMetafields(
  creds: ShopifyCredentials,
  variantIds: string[],
  fields: ShopifyProductMetafieldInput[]
) {
  const uniqueVariantIds = [...new Set(variantIds)].filter(Boolean);
  if (uniqueVariantIds.length === 0 || fields.length === 0) {
    return { metafields: [], userErrors: [] };
  }

  const definitionWarnings = await ensureProductVariantMetafieldDefinitions(
    creds,
    fields
  );
  const mutation = `
    mutation setProductVariantMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key type value ownerType }
        userErrors { field message code }
      }
    }
  `;
  const batchedInputs = uniqueVariantIds.flatMap((variantId) =>
    fields.map((field) => ({
      ownerId: variantId,
      namespace: field.namespace,
      key: field.key,
      type: field.type,
      value: field.value,
    }))
  );

  const metafields: unknown[] = [];
  const allUserErrors: { field?: string[]; message: string; code?: string }[] = [];

  for (let index = 0; index < batchedInputs.length; index += 25) {
    const result = await shopifyGraphQL(creds, mutation, {
      metafields: batchedInputs.slice(index, index + 25),
    });
    const userErrors = result?.metafieldsSet?.userErrors as
      | { field?: string[]; message: string; code?: string }[]
      | undefined;
    if (userErrors?.length) {
      allUserErrors.push(...userErrors);
    }
    if (Array.isArray(result?.metafieldsSet?.metafields)) {
      metafields.push(...result.metafieldsSet.metafields);
    }
  }

  if (allUserErrors.length) {
    throw new Error(
      [
        ...definitionWarnings,
        ...allUserErrors.map((err) =>
          err.field?.length ? `${err.field.join(".")}: ${err.message}` : err.message
        ),
      ].join(" | ")
    );
  }

  return {
    metafields,
    definitionWarnings,
    userErrors: [],
  };
}

export async function searchShopifyTaxonomyCategories(
  creds: ShopifyCredentials,
  search: string,
  first = 5
): Promise<ShopifyTaxonomyCategoryMatch[]> {
  const queryText = search.trim();
  if (!queryText) return [];
  const cacheKey = `${cachedShopKey(creds)}:${first}:${queryText.toLowerCase()}`;
  const cached = taxonomyCategoryCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const query = `
    query searchTaxonomyCategories($search: String!, $first: Int!) {
      taxonomy {
        categories(search: $search, first: $first) {
          nodes {
            id
            name
            fullName
            isLeaf
            isArchived
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query, {
    search: queryText,
    first: Math.min(Math.max(Math.floor(first), 1), 20),
  });

  const nodes = data?.taxonomy?.categories?.nodes || [];
  const matches = nodes
    .map((node: Partial<ShopifyTaxonomyCategoryMatch>) => ({
      id: String(node.id || ""),
      name: String(node.name || ""),
      fullName: String(node.fullName || node.name || ""),
      isLeaf: node.isLeaf,
      isArchived: node.isArchived,
    }))
    .filter(
      (node: ShopifyTaxonomyCategoryMatch) =>
        node.id && node.name && node.isArchived !== true
    );

  taxonomyCategoryCache.set(cacheKey, {
    expiresAt: Date.now() + SHOPIFY_CLIENT_CACHE_TTL_MS,
    value: matches,
  });

  return matches;
}

export async function getShopifyCategoryMetafieldData(
  creds: ShopifyCredentials,
  categoryId: string
): Promise<{
  attributes: ShopifyTaxonomyAttributeMatch[];
  templates: ShopifyStandardMetafieldTemplate[];
}> {
  if (!categoryId) return { attributes: [], templates: [] };

  const cacheKey = `${cachedShopKey(creds)}:${categoryId}:category-metafields`;
  const cached = categoryMetafieldDataCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const query = `
    query getCategoryMetafieldData($categoryId: ID!, $categoryConstraintValue: String!) {
      node(id: $categoryId) {
        ... on TaxonomyCategory {
          attributes(first: 50) {
            nodes {
              __typename
              ... on TaxonomyChoiceListAttribute {
                id
                name
                values(first: 250) {
                  nodes { id name }
                }
              }
              ... on TaxonomyMeasurementAttribute {
                id
                name
                options { key value }
              }
              ... on TaxonomyAttribute {
                id
              }
            }
          }
        }
      }
      standardMetafieldDefinitionTemplates(
        first: 100
        constraintStatus: CONSTRAINED_ONLY
        constraintSubtype: { key: "category", value: $categoryConstraintValue }
      ) {
        nodes {
          id
          name
          namespace
          key
          ownerTypes
          type { name }
        }
      }
    }
  `;

  const data = await shopifyGraphQL(creds, query, {
    categoryId,
    categoryConstraintValue: categoryId,
  });
  const attributes =
    data?.node?.attributes?.nodes?.map(
      (node: {
        id?: string;
        name?: string;
        __typename?: string;
        values?: { nodes?: { id?: string; name?: string }[] };
        options?: { key?: string; value?: string }[];
      }) => ({
        id: String(node.id || ""),
        name: String(node.name || ""),
        type: String(node.__typename || "TaxonomyAttribute"),
        values: [
          ...((node.values?.nodes || []).map((value) => ({
            id: String(value.id || ""),
            name: String(value.name || ""),
          })) || []),
          ...((node.options || []).map((option) => ({
            id: String(option.key || option.value || ""),
            name: String(option.value || option.key || ""),
          })) || []),
        ].filter((value) => value.id && value.name),
      })
    ) || [];
  const templates =
    data?.standardMetafieldDefinitionTemplates?.nodes
      ?.map(
        (node: {
          id?: string;
          name?: string;
          namespace?: string;
          key?: string;
          ownerTypes?: string[];
          type?: { name?: string };
        }) => ({
          id: String(node.id || ""),
          name: String(node.name || ""),
          namespace: String(node.namespace || ""),
          key: String(node.key || ""),
          ownerTypes: Array.isArray(node.ownerTypes) ? node.ownerTypes : [],
          type: String(node.type?.name || ""),
        })
      )
      .filter(
        (template: ShopifyStandardMetafieldTemplate) =>
          template.id &&
          template.namespace &&
          template.key &&
          template.type &&
          template.ownerTypes.includes("PRODUCT")
      ) || [];
  const value = { attributes, templates };

  categoryMetafieldDataCache.set(cacheKey, {
    expiresAt: Date.now() + SHOPIFY_CLIENT_CACHE_TTL_MS,
    value,
  });

  return value;
}

export async function updateProductTaxonomy(
  creds: ShopifyCredentials,
  input: {
    productId: string;
    categoryId?: string | null;
    productType?: string | null;
    metafields?: ShopifyProductMetafieldInput[];
    variantIds?: string[];
  }
) {
  if (!input.categoryId && !input.productType && !input.metafields?.length) {
    return { skipped: true };
  }

  let productResult = null;

  if (input.categoryId || input.productType) {
    const mutation = `
      mutation updateProductTaxonomy($product: ProductUpdateInput!) {
        productUpdate(product: $product) {
          product {
            id
            title
            productType
            category { id name fullName }
          }
          userErrors { field message }
        }
      }
    `;

    const payload: Record<string, unknown> = { id: input.productId };
    if (input.categoryId) {
      payload.category = input.categoryId;
    }
    if (input.productType) {
      payload.productType = input.productType;
    }

    const result = await shopifyGraphQL(creds, mutation, { product: payload });
    const userErrors = result?.productUpdate?.userErrors as
      | { field?: string[]; message: string }[]
      | undefined;

    if (userErrors && userErrors.length > 0) {
      throw new Error(
        userErrors
          .map((err) =>
            err.field?.length ? `${err.field.join(".")}: ${err.message}` : err.message
          )
          .join(" | ")
      );
    }

    productResult = result?.productUpdate?.product || null;
  }

  let metafieldsResult = null;
  let variantMetafieldsResult = null;
  const metafieldsWarnings: string[] = [];

  if (input.metafields?.length) {
    const standardShopifyMetafields = input.metafields.filter(
      (field) => field.namespace === "shopify"
    );
    const otherProductMetafields = input.metafields.filter(
      (field) => field.namespace !== "shopify"
    );

    try {
      if (standardShopifyMetafields.length > 0) {
        metafieldsResult = await setProductMetafields(
          creds,
          input.productId,
          standardShopifyMetafields
        );
      }
    } catch (error) {
      if (!input.categoryId && !input.productType && otherProductMetafields.length === 0) {
        throw error;
      }

      metafieldsWarnings.push(
        error instanceof Error
          ? `Metacampos padrao da Shopify nao foram salvos: ${error.message}`
          : "Metacampos padrao da Shopify nao foram salvos."
      );
    }

    try {
      if (otherProductMetafields.length > 0) {
        const extraMetafieldsResult = await setProductMetafields(
          creds,
          input.productId,
          otherProductMetafields
        );
        metafieldsResult = metafieldsResult || extraMetafieldsResult;
      }
    } catch (error) {
      if (!input.categoryId && !input.productType && standardShopifyMetafields.length === 0) {
        throw error;
      }

      metafieldsWarnings.push(
        error instanceof Error
          ? `Metacampos complementares nao foram salvos: ${error.message}`
          : "Metacampos complementares nao foram salvos."
      );
    }

    const googleShoppingMetafields = input.metafields.filter(
      (field) => field.namespace === "mm-google-shopping"
    );
    if (input.variantIds?.length && googleShoppingMetafields.length) {
      try {
        variantMetafieldsResult = await setProductVariantMetafields(
          creds,
          input.variantIds,
          googleShoppingMetafields
        );
      } catch (error) {
        metafieldsWarnings.push(
          error instanceof Error
            ? `Metacampos do produto aplicados, mas metacampos das variantes nao foram salvos: ${error.message}`
            : "Metacampos do produto aplicados, mas metacampos das variantes nao foram salvos."
        );
      }
    }
  }

  return {
    ...(productResult || {}),
    metafieldsResult,
    variantMetafieldsResult,
    metafieldsWarning: metafieldsWarnings.length
      ? metafieldsWarnings.join(" ")
      : null,
  };
}

export async function updateShopifyProduct(
  creds: ShopifyCredentials,
  input: {
    productId: string;
    title: string;
    descriptionHtml: string;
    tags: string[];
    seo?: { title?: string; description?: string };
    status?: "ACTIVE" | "DRAFT" | "ARCHIVED";
    categoryId?: string | null;
    productType?: string | null;
    metafields?: {
      namespace: string;
      key: string;
      type: string;
      value: string;
    }[];
    variants?: {
      id: string;
      price: string;
      compareAtPrice?: string | null;
    }[];
    images?: { src: string; altText: string }[];
    publishToStorefront?: boolean;
  }
) {
  const nextStatus =
    input.status ?? (input.publishToStorefront === false ? "DRAFT" : "ACTIVE");

  const mutation = `
    mutation productUpdate($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        product {
          id
          title
          handle
          status
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const result = await shopifyGraphQL(creds, mutation, {
    product: {
      id: input.productId,
      title: input.title,
      // Mesma trava do create: ver o comentario longo la.
      descriptionHtml: htmlSeguroDaIa(input.descriptionHtml),
      tags: input.tags,
      seo: input.seo,
      status: nextStatus,
      ...(input.categoryId
        ? { category: input.categoryId }
        : {}),
      ...(input.productType ? { productType: input.productType } : {}),
      ...(input.metafields?.length ? { metafields: input.metafields } : {}),
    },
  });

  const userErrors = result?.productUpdate?.userErrors as
    | { field?: string[]; message: string }[]
    | undefined;
  if (userErrors && userErrors.length > 0) {
    throw new Error(userErrors.map((err) => err.message).join(" | "));
  }

  let variantsUpdate:
    | {
        productVariants?: { id: string }[];
        userErrors?: { field?: string[]; message: string }[];
      }
    | undefined;
  if (input.variants && input.variants.length > 0) {
    const variantsMutation = `
      mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
        productVariantsBulkUpdate(productId: $productId, variants: $variants) {
          productVariants { id }
          userErrors { field message }
        }
      }
    `;

    const variantsPayload = input.variants.map((variant) => {
      const payload: {
        id: string;
        price: string;
        compareAtPrice?: string | null;
      } = {
        id: variant.id,
        price: variant.price,
      };

      if (variant.compareAtPrice !== undefined) {
        payload.compareAtPrice = variant.compareAtPrice;
      }

      return payload;
    });

    const variantsResult = await shopifyGraphQL(creds, variantsMutation, {
      productId: input.productId,
      variants: variantsPayload,
    });

    variantsUpdate = variantsResult?.productVariantsBulkUpdate as
      | {
          productVariants?: { id: string }[];
          userErrors?: { field?: string[]; message: string }[];
        }
      | undefined;

    if (variantsUpdate?.userErrors && variantsUpdate.userErrors.length > 0) {
      throw new Error(variantsUpdate.userErrors.map((err) => err.message).join(" | "));
    }
  }

  let storefrontPublication:
    | { ok: boolean; publicationId?: string; reason?: string }
    | undefined;
  if (nextStatus === "ACTIVE" && input.publishToStorefront !== false) {
    storefrontPublication = await publishProductToStorefront(creds, input.productId);
  }

  if (input.images && input.images.length > 0) {
    try {
      const mediaQuery = `query { product(id: "${input.productId}") { media(first: 50) { nodes { id } } } }`;
      const mediaRes = await shopifyGraphQL(creds, mediaQuery);
      const mediaIds = mediaRes?.product?.media?.nodes?.map((n: { id: string }) => n.id) || [];
      
      if (mediaIds.length > 0) {
        const deleteMutation = `mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) { productDeleteMedia(productId: $productId, mediaIds: $mediaIds) { deletedMediaIds } }`;
        await shopifyGraphQL(creds, deleteMutation, { productId: input.productId, mediaIds });
      }
      
      const createMutation = `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) { productCreateMedia(productId: $productId, media: $media) { media { id } } }`;
      await shopifyGraphQL(creds, createMutation, {
        productId: input.productId,
        media: input.images.map((img) => ({ originalSource: img.src, alt: img.altText, mediaContentType: "IMAGE" }))
      });
    } catch (err) {
      console.warn("[shopify.updateShopifyProduct] Failed to sync media:", err);
    }
  }

  return {
    ...result,
    variantsUpdate,
    storefrontPublication,
  };
}

// Substitui a imagem do produto pela versao neutralizada.
// A dark store usa 1 imagem por produto, entao apagamos toda a midia
// existente e adicionamos a nova como hero.
export async function replaceProductHeroImage(
  creds: ShopifyCredentials,
  productId: string,
  image: { src: string; altText?: string }
): Promise<string | null> {
  const mediaQuery = `query { product(id: "${productId}") { media(first: 50) { nodes { id } } } }`;
  const mediaRes = await shopifyGraphQL(creds, mediaQuery);
  const mediaIds: string[] =
    mediaRes?.product?.media?.nodes?.map((node: { id: string }) => node.id) || [];

  if (mediaIds.length > 0) {
    const deleteMutation = `mutation productDeleteMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { field message }
      }
    }`;
    await shopifyGraphQL(creds, deleteMutation, { productId, mediaIds });
  }

  const createMutation = `mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
    productCreateMedia(productId: $productId, media: $media) {
      media { id }
      mediaUserErrors { field message }
    }
  }`;
  const createRes = await shopifyGraphQL(creds, createMutation, {
    productId,
    media: [
      {
        originalSource: image.src,
        alt: image.altText || "",
        mediaContentType: "IMAGE",
      },
    ],
  });

  const errors = createRes?.productCreateMedia?.mediaUserErrors as
    | { message: string }[]
    | undefined;
  if (errors && errors.length > 0) {
    throw new Error(errors.map((err) => err.message).join(" | "));
  }

  return createRes?.productCreateMedia?.media?.[0]?.id || null;
}

// Aguarda a Shopify terminar de ingerir a midia (status READY). Enquanto nao
// estiver READY, o originalSource (ex.: URL do Supabase) ainda pode ser
// buscado pela Shopify; so depois de READY a copia no CDN dela esta garantida
// e o arquivo de origem pode ser apagado com seguranca.
export async function waitForMediaReady(
  creds: ShopifyCredentials,
  mediaId: string,
  options?: { timeoutMs?: number; intervalMs?: number }
): Promise<"READY" | "FAILED" | "TIMEOUT"> {
  const timeoutMs = Math.min(Math.max(options?.timeoutMs ?? 45000, 2000), 120000);
  const intervalMs = Math.min(Math.max(options?.intervalMs ?? 2000, 500), 10000);
  const query = `query mediaStatus($id: ID!) {
    node(id: $id) { ... on MediaImage { status } }
  }`;
  const start = Date.now();
  for (;;) {
    const data = await shopifyGraphQL(creds, query, { id: mediaId }).catch(
      () => null
    );
    const status = data?.node?.status as string | undefined;
    if (status === "READY") return "READY";
    if (status === "FAILED") return "FAILED";
    if (Date.now() - start >= timeoutMs) return "TIMEOUT";
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

export async function getMenus(creds: ShopifyCredentials) {
  const query = `
    query {
      menus(first: 10) {
        nodes {
          id
          title
          handle
          itemsCount
          items(first: 20) {
            id
            title
            url
            type
            items(first: 10) {
              id
              title
              url
              type
            }
          }
        }
      }
    }
  `;
  return shopifyGraphQL(creds, query);
}

function resolveMenuItemType(url: string): string {
  if (url === "/") return "FRONTPAGE";
  if (url.startsWith("/collections")) return "CATALOG";
  if (url.startsWith("/policies")) return "SHOP_POLICY";
  if (url.startsWith("/pages")) return "PAGE";
  return "HTTP";
}

export interface MenuItemInput {
  title: string;
  /** Caminho relativo. Ignorado quando ha resourceId -- a Shopify monta o link. */
  url?: string;
  type?: string;
  /**
   * gid do recurso apontado (colecao, pagina, politica).
   *
   * Sem ele, um item que aponta para /collections/nike volta como
   * "collection not found": os tipos COLLECTION, PAGE e SHOP_POLICY sao
   * resolvidos por ID, nao por caminho. O tipo CATALOG, que o mapeamento por
   * URL escolhia sozinho, e a pagina de TODOS os produtos -- nao uma colecao.
   */
  resourceId?: string;
  items?: MenuItemInput[];
}

function mapMenuItems(items: MenuItemInput[]): Record<string, unknown>[] {
  return items.map((item) => {
    const mapeado: Record<string, unknown> = {
      title: item.title,
      type: item.type || resolveMenuItemType(item.url || ""),
    };
    if (item.resourceId) mapeado.resourceId = item.resourceId;
    else if (item.url) mapeado.url = item.url;
    if (item.items?.length) mapeado.items = mapMenuItems(item.items);
    return mapeado;
  });
}

export async function createMenu(
  creds: ShopifyCredentials,
  input: { title: string; handle: string; items: MenuItemInput[] }
) {
  const query = `
    mutation menuCreate($title: String!, $handle: String!, $items: [MenuItemCreateInput!]!) {
      menuCreate(title: $title, handle: $handle, items: $items) {
        menu {
          id
          title
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;
  return shopifyGraphQL(creds, query, {
    title: input.title,
    handle: input.handle,
    items: mapMenuItems(input.items),
  });
}

/**
 * Reescreve um menu que ja existe.
 *
 * Toda loja Shopify nasce com "main-menu" e "footer" prontos, entao montar a
 * navegacao de uma loja nova e quase sempre atualizar, nao criar -- menuCreate
 * falharia no handle repetido.
 */
export async function updateMenu(
  creds: ShopifyCredentials,
  input: { id: string; title: string; handle: string; items: MenuItemInput[] }
) {
  const query = `
    mutation menuUpdate($id: ID!, $title: String!, $handle: String!, $items: [MenuItemUpdateInput!]!) {
      menuUpdate(id: $id, title: $title, handle: $handle, items: $items) {
        menu { id handle }
        userErrors { field message }
      }
    }
  `;
  const result = await shopifyGraphQL(creds, query, {
    id: input.id,
    title: input.title,
    handle: input.handle,
    items: mapMenuItems(input.items),
  });
  const erros = result?.menuUpdate?.userErrors as { message: string }[] | undefined;
  if (erros?.length) {
    throw new Error(`Falha ao atualizar o menu: ${erros.map((e) => e.message).join(" | ")}`);
  }
  return result;
}

export async function createPages(
  creds: ShopifyCredentials,
  pages: { title: string; body: string; handle?: string }[]
): Promise<{ id: string; title: string; handle: string }[]> {
  const query = `
    mutation pageCreate($page: PageCreateInput!) {
      pageCreate(page: $page) {
        page {
          id
          title
          handle
        }
        userErrors {
          field
          message
        }
      }
    }
  `;

  const createdPages: { id: string; title: string; handle: string }[] = [];

  for (const page of pages) {
    const variables: Record<string, unknown> = {
      page: {
        title: page.title,
        body: page.body,
        ...(page.handle ? { handle: page.handle } : {}),
      },
    };

    const result = await shopifyGraphQL(creds, query, variables);
    const userErrors = result.pageCreate?.userErrors;
    if (userErrors?.length > 0) {
      const isHandleTaken = userErrors.some(
        (e: { message: string }) => e.message.includes("already been taken")
      );
      if (isHandleTaken) {
        // Page already exists — skip silently
        createdPages.push({ id: "", title: page.title, handle: page.handle || "" });
        continue;
      }
      throw new Error(
        `Erro ao criar página "${page.title}": ${JSON.stringify(userErrors)}`
      );
    }

    const created = result.pageCreate?.page;
    if (created) {
      createdPages.push(created);
    }
  }

  return createdPages;
}

/**
 * Garante a inscricao no webhook app/uninstalled.
 *
 * Chamado logo depois da troca do code por token, que e o unico momento em que
 * temos certeza de que o app acabou de ser instalado nesta loja.
 *
 * `webhookSubscriptionCreate` e idempotente do lado da Shopify para o par
 * (topico, endereco): reinstalar nao gera assinatura duplicada, devolve
 * userError de "ja existe". Por isso o erro nao sobe -- desinscricao pendente
 * nao pode derrubar uma instalacao que deu certo.
 */
export async function ensureUninstallWebhook(
  creds: ShopifyCredentials,
  callbackUrl: string
): Promise<{ ok: boolean; message?: string }> {
  const mutation = `
    mutation inscreverUninstall($topic: WebhookSubscriptionTopic!, $sub: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $sub) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL(creds, mutation, {
      topic: "APP_UNINSTALLED",
      sub: { callbackUrl, format: "JSON" },
    });
    const erros = data?.webhookSubscriptionCreate?.userErrors || [];
    if (erros.length > 0) {
      const texto = erros.map((e: { message?: string }) => e.message).join("; ");
      // "already exists" e o caso normal de reinstalacao.
      const jaExiste = /already|taken|exists/i.test(texto);
      return { ok: jaExiste, message: texto };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : "falha" };
  }
}
