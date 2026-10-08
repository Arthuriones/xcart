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

// ---------------------------------------------------------------------------
// Cupom do carrinho da vitrine -> `?discount=` do permalink.
//
// Documentado em shopify.dev/docs/apps/build/checkout/create-cart-permalinks:
// `discount=CODIGO`, varios separados por virgula -- por isso codigo com
// virgula nao passa (a doc diz que nao da para mandar). So o CODIGO viaja,
// nunca valor: quem calcula o desconto e a loja de checkout, com o cupom
// dela. Codigo que nao existe na loja de checkout nao vale la (a Shopify nao
// aplica); o lojista precisa criar o mesmo cupom nas duas lojas.
//
// A MESMA regra vive no loader (cupomValido / cuponsDoCarrinho em
// public/routed-checkout-loader.js) -- tests/roteamento-carrinho-levado.test.ts
// compara as duas. Mudou uma, muda a outra.
// ---------------------------------------------------------------------------

/** A Shopify aceita ate 5 codigos combinados num carrinho. */
export const MAX_CUPONS = 5;
/** Codigo de cupom de verdade e curto; o teto so barra lixo. */
export const MAX_CUPOM = 64;

/** Codigo aceito: ja aparado, 1..64, sem virgula e sem caractere de controle. */
export function cupomValido(codigo: unknown): codigo is string {
  return (
    typeof codigo === "string" &&
    codigo.length > 0 &&
    codigo.length <= MAX_CUPOM &&
    codigo.trim() === codigo &&
    codigo.indexOf(",") === -1 &&
    !/[\u0000-\u001f\u007f]/.test(codigo)
  );
}

/**
 * Lista de codigos vinda de fora (corpo do /resolve, publico). Nunca lanca:
 * entrada torta vira lista vazia. Apara, descarta o invalido e repete so uma
 * vez (cupom da Shopify nao diferencia maiuscula).
 */
export function normalizarCupons(entrada: unknown): string[] {
  if (!Array.isArray(entrada)) return [];
  const vistos = new Set<string>();
  const saida: string[] = [];
  for (const bruto of entrada.slice(0, 20)) {
    const codigo = typeof bruto === "string" ? bruto.trim() : bruto;
    if (!cupomValido(codigo)) continue;
    const chave = codigo.toLowerCase();
    if (vistos.has(chave)) continue;
    vistos.add(chave);
    saida.push(codigo);
    if (saida.length >= MAX_CUPONS) break;
  }
  return saida;
}

/**
 * NAO acrescente `attributes[...]` aqui.
 *
 * Ate 2026-09 esta funcao recebia `{ routed_checkout: <id da rota>,
 * routed_mode }` e os anexava a URL. Atributo de carrinho nao morre no
 * redirect: a Shopify grava no pedido como note_attributes e no landing_site,
 * onde fica visivel no admin da loja de checkout, em todo pedido, para sempre.
 * Nao dizia o dominio da vitrine, mas era um id estavel de rota carimbado em
 * cada venda -- e a loja de checkout nao deve saber de onde veio o comprador.
 *
 * Ninguem lia esses atributos: a atribuicao do track-fallback e do painel vem
 * do `targetId` que o loader manda no corpo da requisicao. E o caminho inline
 * do loader (o mais usado) ja montava a URL sem eles, entao os dois caminhos
 * produziam URLs diferentes para o mesmo carrinho.
 *
 * O cupom (`discount`) pode: e o codigo que o comprador digitou, criado pelo
 * lojista nas duas lojas -- nao identifica rota, vitrine nem comprador.
 */
export function buildCartPermalink(
  targetDomain: string,
  lines: { variantId: string; quantity: number }[],
  market?: { country?: string; locale?: string },
  extras?: { discountCodes?: unknown }
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
  // Markets). Sem country, a Shopify decide pelo comprador (geolocalizacao)
  // -- e o modo "pais do comprador" do destino (ver mercado.ts, que tambem
  // explica o que a doc confirma destes dois parametros).
  if (market?.country) url.searchParams.set("country", market.country);
  if (market?.locale) url.searchParams.set("locale", market.locale);

  const cupons = normalizarCupons(extras?.discountCodes);
  if (cupons.length > 0) url.searchParams.set("discount", cupons.join(","));

  return url.toString();
}
