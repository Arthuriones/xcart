import { dominioDeDestino } from "@/lib/net/url-guard";

export interface CheckoutRouteLine {
  sku?: string;
  sourceVariantId?: string | number;
  targetVariantId?: string | number;
  quantity?: number;
}

export interface CheckoutRouteMaps {
  skuMap?: Record<string, string | number>;
  variantMap?: Record<string, string | number>;
}

function numericVariantId(value: string | number | undefined): string | null {
  if (value === undefined || value === null) return null;
  const match = String(value).match(/(\d+)$/);
  return match?.[1] || null;
}

function variantLookupKeys(value: string | number | undefined): string[] {
  if (value === undefined || value === null || value === "") return [];
  const raw = String(value);
  const numeric = numericVariantId(value);
  return [
    raw,
    numeric ? `gid://shopify/ProductVariant/${numeric}` : "",
    numeric || "",
  ].filter((key, index, keys) => key && keys.indexOf(key) === index);
}

function lookupVariantMap(
  map: Record<string, string | number> | undefined,
  value: string | number | undefined
) {
  if (!map) return undefined;
  for (const key of variantLookupKeys(value)) {
    if (map[key] !== undefined) return map[key];
  }
  return undefined;
}

export function resolveCheckoutLines(
  lines: CheckoutRouteLine[],
  maps: CheckoutRouteMaps
) {
  return resolveCheckoutLinesDetailed(lines, maps)
    .filter((line) => line.variantId)
    .map((line) => ({ variantId: line.variantId as string, quantity: line.quantity }));
}

export interface ResolvedLineDetail {
  quantity: number;
  sku: string;
  variantId: string | null;
}

// Igual ao resolveCheckoutLines, mas devolve TODAS as linhas (resolvidas ou
// nao) com o SKU, para o chamador tentar um fallback (ex.: resolver por SKU no
// products.json publico da loja checkout quando o mapa nao cobre a variante).
export function resolveCheckoutLinesDetailed(
  lines: CheckoutRouteLine[],
  maps: CheckoutRouteMaps
): ResolvedLineDetail[] {
  // Indice do sku_map em minusculas para casar SKU sem depender de caixa.
  const lowerSkuMap: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(maps.skuMap || {})) {
    const lower = key.trim().toLowerCase();
    if (lower && lowerSkuMap[lower] === undefined) lowerSkuMap[lower] = value;
  }

  return lines.map((line) => {
    const quantity = Math.max(1, Math.floor(Number(line.quantity || 1)));
    const skuKey = String(line.sku || "").trim();
    const skuLower = skuKey.toLowerCase();
    const mapped =
      line.targetVariantId ||
      lookupVariantMap(maps.variantMap, line.sourceVariantId) ||
      (skuKey ? maps.skuMap?.[skuKey] ?? lowerSkuMap[skuLower] : undefined);
    return { quantity, sku: skuKey, variantId: numericVariantId(mapped) };
  });
}

// Deriva o mercado (pais/locale) do idioma da loja destino para o checkout
// abrir na moeda certa via Shopify Markets. Ex.: "es-CL" => country CL.
// Exige que a loja checkout tenha esse mercado/moeda configurado na Shopify.
export function marketParamsFromLanguage(
  language?: string | null
): { country?: string; locale?: string } {
  const lang = String(language || "").trim();
  if (!lang) return {};
  const [, region] = lang.split("-");
  return {
    country: region ? region.toUpperCase() : undefined,
    locale: lang,
  };
}

export function buildCartPermalink(
  targetDomain: string,
  lines: { variantId: string; quantity: number }[],
  attributes?: Record<string, string>,
  market?: { country?: string; locale?: string }
) {
  // Parser, nao regex: normalizeShopDomain aprovava "//evil.com", "ftp://evil.com/x"
  // e "evil.com." -- e o retorno desta funcao e a URL para onde o comprador vai.
  const domain = dominioDeDestino(targetDomain);
  if (!domain) {
    throw new Error("Dominio de checkout invalido.");
  }
  if (lines.length === 0) {
    throw new Error("Nenhum item pode ser roteado para o checkout.");
  }

  const cartPath = lines
    .map((line) => `${line.variantId}:${line.quantity}`)
    .join(",");
  const url = new URL(`https://${domain}/cart/${cartPath}`);

  // country/locale fazem o checkout abrir no mercado/moeda certos (Shopify
  // Markets). Sem isso, cai na moeda base da loja (ex.: USD).
  if (market?.country) url.searchParams.set("country", market.country);
  if (market?.locale) url.searchParams.set("locale", market.locale);

  for (const [key, value] of Object.entries(attributes || {})) {
    if (key && value) url.searchParams.set(`attributes[${key}]`, value);
  }

  return url.toString();
}
