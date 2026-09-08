import { safeFetch } from "@/lib/net/safe-url";
import * as cheerio from "cheerio";
import type {
  AliExpressProduct,
  AliExpressVariant,
  AliExpressVariantOption,
} from "@/types";
import { scrapeProductWithBrowser } from "./browser-scraper";
import { createAdminClient } from "@/lib/supabase/admin";
import { applyProxyTemplate } from "@/lib/import/proxy-fetch";

const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];
const DEFAULT_REGION_COOKIE = "aep_usuc_f=site=bra&region=BR&b_locale=pt_BR&c_tp=BRL";

const PRODUCT_IMAGE_PATH_HINTS = ["/kf/", "/imgextra/", "/bao/uploaded/"];
const BLOCKED_IMAGE_HINTS = [
  "404",
  "not-found",
  "flag",
  "country",
  "icon",
  "logo",
  "avatar",
  "placeholder",
  "no_photo",
  "nophoto",
  "default",
  "loading",
  "sprite",
  "lazy",
];
const BLOCKED_PAGE_HINTS = [
  "captcha interception",
  "slide to verify",
  "unusual traffic",
  "robot check",
  "____tmd____",
  "x5secdata",
  "fail_sys_user_validate",
  "rgv587_error",
  "/punish?",
];
const DB_SECRET_KEYS = [
  "BRIGHTDATA_API_KEY",
  "BRIGHTDATA_ZONE",
  "BRIGHTDATA_COUNTRY",
  "BRIGHTDATA_PROXY_HOST",
  "BRIGHTDATA_PROXY_PORT",
  "BRIGHTDATA_PROXY_USERNAME",
  "BRIGHTDATA_PROXY_PASSWORD",
  "BRIGHTDATA_PROXY_INSECURE_TLS",
] as const;
const DB_SECRETS_CACHE_MS = 120000;

type FetchAttempt = {
  url: string;
  status?: number;
  blocked: boolean;
  notFound: boolean;
  error?: string;
};
type BrightDataConfig = {
  apiKey: string;
  zone: string;
  country: string;
};
type BrightDataNativeProxyConfig = {
  host: string;
  port: string;
  username: string;
  password: string;
  insecureTls: boolean;
};
type SecretMap = Record<string, string>;

let cachedSecrets: { value: SecretMap; expiresAt: number } | null = null;

export async function scrapeProduct(url: string): Promise<AliExpressProduct> {
  const cleanUrl = normalizeUrl(url);

  const browserProduct = await scrapeProductWithBrowser(cleanUrl).catch((error) => {
    console.warn("[aliexpress.scraper] browser scrape failed", {
      url: cleanUrl,
      reason: error instanceof Error ? error.message : String(error),
    });
    return null;
  });
  if (browserProduct && browserProduct.title && browserProduct.images.length > 0) {
    return browserProduct;
  }

  const html = await fetchBestAliExpressHtml(cleanUrl);
  const product = parseProductPage(html);

  if (!product.title || isLikelyInvalidProduct(product)) {
    throw new Error(
      "Nao foi possivel extrair este anuncio. O AliExpress pode ter retornado uma pagina invalida (404/bloqueio)."
    );
  }

  if (product.images.length === 0) {
    throw new Error("Nao foi possivel extrair as imagens do produto.");
  }

  return product;
}

async function fetchBestAliExpressHtml(url: string): Promise<string> {
  const dbSecrets = await loadDbSecrets();
  const directCandidates = buildDirectCandidateUrls(url);
  const candidates = buildCandidateUrls(directCandidates);
  const attempts: FetchAttempt[] = [];
  let lastStatus = 0;

  for (const candidate of candidates) {
    try {
      // URL montada a partir do link colado pelo usuario: trava de SSRF.
      const res = await safeFetch(candidate, {
        headers: buildAliHeaders(url),
        signal: AbortSignal.timeout(20000),
        redirect: "follow",
      });

      lastStatus = res.status;
      if (!res.ok) {
        attempts.push({
          url: candidate,
          status: res.status,
          blocked: false,
          notFound: false,
        });
        continue;
      }

      const html = await res.text();
      const notFound = isLikelyNotFoundPage(html);
      const blocked = isLikelyBlockedPage(html);
      attempts.push({
        url: candidate,
        status: res.status,
        blocked,
        notFound,
      });

      if (notFound || blocked) continue;

      return html;
    } catch (error) {
      attempts.push({
        url: candidate,
        blocked: false,
        notFound: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const brightDataConfig = getBrightDataConfig(dbSecrets);
  if (brightDataConfig) {
    for (const candidate of directCandidates) {
      try {
        const brightData = await fetchWithBrightData(candidate, brightDataConfig);
        const notFound = isLikelyNotFoundPage(brightData.html);
        const blocked = isLikelyBlockedPage(brightData.html);
        attempts.push({
          url: `brightdata:${candidate}`,
          status: brightData.statusCode,
          blocked,
          notFound,
        });

        if (notFound || blocked) continue;

        return brightData.html;
      } catch (error) {
        attempts.push({
          url: `brightdata:${candidate}`,
          blocked: false,
          notFound: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  const brightDataNativeProxy = getBrightDataNativeProxyConfig(dbSecrets);
  if (brightDataNativeProxy) {
    for (const candidate of directCandidates) {
      try {
        const proxyResponse = await fetchWithBrightDataNativeProxy(
          candidate,
          buildAliHeaders(url),
          brightDataNativeProxy
        );
        const notFound = isLikelyNotFoundPage(proxyResponse.html);
        const blocked = isLikelyBlockedPage(proxyResponse.html);
        attempts.push({
          url: `brightdata-native:${candidate}`,
          status: proxyResponse.statusCode,
          blocked,
          notFound,
        });

        if (notFound || blocked) continue;

        return proxyResponse.html;
      } catch (error) {
        attempts.push({
          url: `brightdata-native:${candidate}`,
          blocked: false,
          notFound: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  console.warn("[aliexpress.scraper] html fetch failed", {
    sourceUrl: url,
    attempts,
  });

  const brightDataAttempts = attempts.filter((attempt) =>
    attempt.url.startsWith("brightdata:")
  );
  const brightDataNativeAttempts = attempts.filter((attempt) =>
    attempt.url.startsWith("brightdata-native:")
  );
  const attemptMessages = [...brightDataAttempts, ...brightDataNativeAttempts]
    .map((attempt) => `${attempt.status || "n/a"}:${attempt.error || ""}`.toLowerCase())
    .join(" | ");

  if (attemptMessages.includes("407")) {
    throw new Error(
      "Bright Data retornou erro 407 (proxy auth/conta). Verifique billing/conta ativa e credenciais da zona no Bright Data."
    );
  }

  if (brightDataAttempts.some((attempt) => attempt.error?.includes("response sem HTML"))) {
    throw new Error(
      "A zona do Bright Data informada nao retornou HTML via API. Use uma zona Web Unlocker para BRIGHTDATA_API_KEY/BRIGHTDATA_ZONE ou mantenha apenas BRIGHTDATA_PROXY_*."
    );
  }

  if (attempts.some((attempt) => attempt.blocked)) {
    throw new Error(
      "AliExpress bloqueou a requisicao no servidor (captcha/anti-bot). Configure IMPORT_FETCH_PROXY_URL, GLOBAL_FETCH_PROXY_URL, ALIEXPRESS_FETCH_PROXY_URL, BRIGHTDATA_API_KEY/BRIGHTDATA_ZONE ou BRIGHTDATA_PROXY_* no deploy."
    );
  }

  throw new Error(
    lastStatus
      ? `Erro ao acessar AliExpress (${lastStatus}).`
      : "Nao foi possivel acessar o anuncio no AliExpress."
  );
}

function buildDirectCandidateUrls(inputUrl: string): string[] {
  const directUrls = new Set<string>();
  directUrls.add(inputUrl);

  try {
    const parsed = new URL(inputUrl);
    if (!parsed.searchParams.has("gatewayAdapt")) {
      parsed.searchParams.set("gatewayAdapt", "4itemAdapt");
      directUrls.add(parsed.toString());
    }
  } catch {
    // ignore
  }

  const productId = extractAliProductId(inputUrl);
  if (productId) {
    directUrls.add(`https://www.aliexpress.com/item/${productId}.html?gatewayAdapt=4itemAdapt`);
    directUrls.add(`https://pt.aliexpress.com/item/${productId}.html?gatewayAdapt=4itemAdapt`);
    directUrls.add(`https://m.aliexpress.com/item/${productId}.html`);
    directUrls.add(`https://www.aliexpress.com/i/${productId}.html`);
    directUrls.add(`https://pt.aliexpress.com/i/${productId}.html`);
  }

  return [...directUrls];
}

function buildCandidateUrls(directUrls: string[]): string[] {
  const proxyTemplate =
    process.env.IMPORT_FETCH_PROXY_URL?.trim() ||
    process.env.GLOBAL_FETCH_PROXY_URL?.trim() ||
    process.env.ALIEXPRESS_FETCH_PROXY_URL?.trim();
  if (!proxyTemplate) return directUrls;

  const urls = new Set<string>(directUrls);
  for (const directUrl of directUrls) urls.add(applyProxyTemplate(proxyTemplate, directUrl));
  return [...urls];
}

function buildAliHeaders(refererUrl: string): Record<string, string> {
  return {
    "User-Agent": USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    "Cache-Control": "no-cache",
    Pragma: "no-cache",
    Referer: refererUrl,
    "Sec-Fetch-Dest": "document",
    "Sec-Fetch-Mode": "navigate",
    "Sec-Fetch-Site": "none",
    "Upgrade-Insecure-Requests": "1",
    Cookie: DEFAULT_REGION_COOKIE,
  };
}

function getBrightDataConfig(dbSecrets: SecretMap): BrightDataConfig | null {
  const apiKey = resolveSecret("BRIGHTDATA_API_KEY", dbSecrets);
  const zone = resolveSecret("BRIGHTDATA_ZONE", dbSecrets);
  if (!apiKey || !zone) return null;
  const country = resolveSecret("BRIGHTDATA_COUNTRY", dbSecrets);

  return {
    apiKey,
    zone,
    country: country ? country.toLowerCase() : "br",
  };
}

function getBrightDataNativeProxyConfig(
  dbSecrets: SecretMap
): BrightDataNativeProxyConfig | null {
  const username = resolveSecret("BRIGHTDATA_PROXY_USERNAME", dbSecrets);
  const password = resolveSecret("BRIGHTDATA_PROXY_PASSWORD", dbSecrets);
  if (!username || !password) return null;

  return {
    host: resolveSecret("BRIGHTDATA_PROXY_HOST", dbSecrets) || "brd.superproxy.io",
    port: resolveSecret("BRIGHTDATA_PROXY_PORT", dbSecrets) || "33335",
    username,
    password,
    insecureTls:
      (resolveSecret("BRIGHTDATA_PROXY_INSECURE_TLS", dbSecrets) || "true").toLowerCase() ===
      "true",
  };
}

async function loadDbSecrets(): Promise<SecretMap> {
  const now = Date.now();
  if (cachedSecrets && cachedSecrets.expiresAt > now) {
    return cachedSecrets.value;
  }

  try {
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("app_secrets")
      .select("key,value")
      .in("key", [...DB_SECRET_KEYS]);

    if (error) {
      console.warn("[aliexpress.scraper] failed to load app_secrets", {
        reason: error.message,
      });
      return {};
    }

    const map: SecretMap = {};
    for (const row of data ?? []) {
      const key = String(row.key || "").trim();
      const value = String(row.value || "").trim();
      if (key && value) {
        map[key] = value;
      }
    }

    cachedSecrets = {
      value: map,
      expiresAt: now + DB_SECRETS_CACHE_MS,
    };
    return map;
  } catch (error) {
    console.warn("[aliexpress.scraper] app_secrets unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return {};
  }
}

function resolveSecret(key: (typeof DB_SECRET_KEYS)[number], dbSecrets: SecretMap): string {
  const envValue = process.env[key]?.trim();
  if (envValue) return envValue;

  const dbValue = dbSecrets[key]?.trim();
  return dbValue || "";
}

async function fetchWithBrightData(
  targetUrl: string,
  config: BrightDataConfig
): Promise<{ html: string; statusCode: number }> {
  const response = await fetch("https://api.brightdata.com/request", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      zone: config.zone,
      url: targetUrl,
      method: "GET",
      format: "raw",
      country: config.country,
    }),
    signal: AbortSignal.timeout(30000),
  });

  const payload = await response.text();
  if (!response.ok) {
    throw new Error(`Bright Data request failed (${response.status})`);
  }

  const extracted = extractBrightDataHtml(payload);
  if (!extracted) {
    throw new Error("Bright Data response sem HTML");
  }

  return {
    html: extracted.html,
    statusCode: extracted.statusCode || response.status,
  };
}

async function fetchWithBrightDataNativeProxy(
  targetUrl: string,
  headers: Record<string, string>,
  config: BrightDataNativeProxyConfig
): Promise<{ html: string; statusCode: number }> {
  const proxyUrl = `http://${encodeURIComponent(config.username)}:${encodeURIComponent(
    config.password
  )}@${config.host}:${config.port}`;

  const undiciModule = await import("undici");
  const agent = new undiciModule.ProxyAgent({
    uri: proxyUrl,
    requestTls: { rejectUnauthorized: !config.insecureTls },
  });

  try {
    const requestInit = {
      headers,
      signal: AbortSignal.timeout(30000),
      redirect: "follow" as RequestRedirect,
      dispatcher: agent,
    };
    const response = await safeFetch(targetUrl, requestInit as RequestInit);
    const html = await response.text();
    return {
      html,
      statusCode: response.status,
    };
  } finally {
    await agent.close();
  }
}

function extractBrightDataHtml(
  payload: string
): { html: string; statusCode?: number } | null {
  const parsed = safeJsonParse(payload);
  if (!parsed || typeof parsed !== "object") {
    if (payload.includes("<html") || payload.includes("<!DOCTYPE html")) {
      return { html: payload };
    }
    return null;
  }

  const record = parsed as Record<string, unknown>;
  const statusCode = toFiniteNumber(record.status_code) || undefined;
  const objectOf = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;

  const bodyCandidates = [
    record.body,
    objectOf(record.data)?.body,
    objectOf(record.result)?.body,
    objectOf(record.response)?.body,
  ];

  for (const candidate of bodyCandidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return { html: candidate, statusCode };
    }
  }

  return null;
}

function toFiniteNumber(value: unknown): number | 0 {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function extractAliProductId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const pathMatch = parsed.pathname.match(/\/item\/(\d{8,})\.html/i);
    if (pathMatch?.[1]) return pathMatch[1];

    const queryCandidates = [
      parsed.searchParams.get("productId"),
      parsed.searchParams.get("itemId"),
      parsed.searchParams.get("id"),
    ];
    const queryId = queryCandidates.find((value) => value && /^\d{8,}$/.test(value));
    if (queryId) return queryId;

    const text = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    const looseMatch = text.match(/(\d{10,})/);
    if (looseMatch?.[1]) return looseMatch[1];
  } catch {
    return null;
  }

  return null;
}

function isLikelyNotFoundPage(html: string): boolean {
  const sample = html.slice(0, 8000).toLowerCase();
  return (
    /<title>\s*404/i.test(html) ||
    sample.includes("404 page") ||
    sample.includes("page not found") ||
    sample.includes("sorry, this page") ||
    sample.includes("oops! looks like the page") ||
    sample.includes("the page you requested can not be found")
  );
}

function isLikelyBlockedPage(html: string): boolean {
  const sample = html.slice(0, 20000).toLowerCase();
  return BLOCKED_PAGE_HINTS.some((hint) => sample.includes(hint));
}

function isLikelyInvalidProduct(product: AliExpressProduct): boolean {
  const title = product.title.toLowerCase();
  return (
    title.startsWith("404") ||
    title.includes("page not found") ||
    title.includes("not found") ||
    title === "404 page"
  );
}
function normalizeUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("URL invalida. Cole o link completo do produto.");
  }

  const allowedHosts = [
    "aliexpress.com",
    "www.aliexpress.com",
    "pt.aliexpress.com",
    "m.aliexpress.com",
    "br.aliexpress.com",
  ];

  if (!allowedHosts.includes(parsed.hostname)) {
    throw new Error("URL deve ser do AliExpress");
  }

  parsed.protocol = "https:";
  return parsed.toString();
}

function emptyProduct(): AliExpressProduct {
  return {
    title: "",
    description: "",
    price: 0,
    originalPrice: 0,
    images: [],
    specs: {},
    rating: 0,
    orders: 0,
    variantOptions: [],
    variants: [],
  };
}

function parseProductPage(html: string): AliExpressProduct {
  const $ = cheerio.load(html);
  let productData = emptyProduct();

  const jsonCandidates: Record<string, unknown>[] = [];

  $("script").each((_, el) => {
    const type = ($(el).attr("type") || "").toLowerCase();
    const scriptText = $(el).html() || "";

    if (!scriptText.trim()) return;

    if (type.includes("ld+json")) {
      const parsed = safeJsonParse(scriptText);
      if (Array.isArray(parsed)) {
        parsed.forEach((item) => {
          if (item && typeof item === "object") {
            jsonCandidates.push(item as Record<string, unknown>);
          }
        });
      } else if (parsed && typeof parsed === "object") {
        jsonCandidates.push(parsed as Record<string, unknown>);
      }
    }

    const markerMatches = [
      ...findMarkerMatches(scriptText, /runParams\s*=\s*/g),
      ...findMarkerMatches(scriptText, /__INIT_DATA__\s*=\s*/g),
      ...findMarkerMatches(scriptText, /__INITIAL_STATE__\s*=\s*/g),
      ...findMarkerMatches(scriptText, /_init_data_\s*=\s*/g),
      ...findMarkerMatches(scriptText, /window\._d_c_\.DCData\s*=\s*/g),
      ...findMarkerMatches(scriptText, /window\._page_config_\.prefetch\s*=\s*/g),
      ...findMarkerMatches(scriptText, /window\.__next_f\s*=\s*/g),
      ...findMarkerMatches(scriptText, /data\s*:\s*/g),
    ];

    for (const markerIndex of markerMatches) {
      const candidate = extractBalancedObject(scriptText, markerIndex);
      if (!candidate) continue;
      const parsed = safeJsonParse(candidate);
      if (parsed && typeof parsed === "object") {
        jsonCandidates.push(parsed as Record<string, unknown>);
      }
    }
  });

  for (const candidate of jsonCandidates) {
    productData = mergeProductData(productData, extractFromData(candidate));
  }

  if (!productData.title) {
    productData.title =
      $('meta[property="og:title"]').attr("content")?.trim() ||
      $('meta[property="twitter:title"]').attr("content")?.trim() ||
      $('h1[data-pl="product-title"]').text().trim() ||
      $("h1.product-title-text").text().trim() ||
      $("title").text().split("|")[0]?.trim() ||
      "";
  }

  if (!productData.description) {
    productData.description =
      $('meta[property="og:description"]').attr("content")?.trim() ||
      $('meta[name="description"]').attr("content")?.trim() ||
      "";
  }

  productData.title = cleanProductTitle(productData.title);

  const domImages = collectDomImages($);
  const htmlImages = collectImageUrlsFromText(html);
  productData.images = uniqueImages([
    ...productData.images,
    ...domImages,
    ...htmlImages,
  ]);

  if (!productData.price) {
    const priceText =
      $(".product-price-value").first().text() ||
      $('[data-pl="product-price"]').text() ||
      $('[data-pl="product-price-current"]').text() ||
      $(".uniform-banner-box-price").text() ||
      $('[class*="price--current"]').first().text() ||
      $('[class*="product-price"]').first().text() ||
      $('[class*="Price_current"]').first().text() ||
      $('span[itemprop="price"]').attr("content") ||
      $('meta[itemprop="price"]').attr("content") ||
      "";
    productData.price = parseNumber(priceText) || 0;
  }

  // Try to get price from variant list when base price is still 0
  if (!productData.price && productData.variants.length > 0) {
    const variantPrices = productData.variants
      .map((v) => v.price)
      .filter((p) => p > 0);
    if (variantPrices.length > 0) {
      productData.price = Math.min(...variantPrices);
    }
  }

  if (!productData.originalPrice) {
    productData.originalPrice = productData.price;
  }

  if (!productData.price) {
    console.warn("[aliexpress.scraper] price is 0 after all extraction", {
      title: productData.title?.slice(0, 80),
      variantCount: productData.variants.length,
      variantPrices: productData.variants.slice(0, 5).map((v) => v.price),
    });
  }

  return productData;
}

function findMarkerMatches(text: string, regex: RegExp): number[] {
  const matches: number[] = [];
  regex.lastIndex = 0;

  let match: RegExpExecArray | null = regex.exec(text);
  while (match) {
    matches.push(match.index + match[0].length);
    match = regex.exec(text);
  }

  return matches;
}

function extractBalancedObject(text: string, fromIndex: number): string | null {
  const start = text.indexOf("{", fromIndex);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const char = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === "{") depth++;
    if (char === "}") depth--;

    if (depth === 0) {
      return text.slice(start, i + 1);
    }
  }

  return null;
}

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function cleanProductTitle(title: string): string {
  return title
    .replace(/\s*[-|\u2013]\s*AliExpress.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function collectDomImages($: cheerio.CheerioAPI): string[] {
  const images = new Set<string>();

  const push = (value: string | undefined) => {
    const normalized = normalizeImageUrl(value);
    if (normalized) images.add(normalized);
  };

  push($('meta[property="og:image"]').attr("content"));
  push($('meta[property="twitter:image"]').attr("content"));

  const selectors = [
    'img[src*="alicdn.com/kf/"]',
    'img[data-src*="alicdn.com/kf/"]',
    'img[data-origin-src*="alicdn.com/kf/"]',
    'img[src*="alicdn.com/imgextra/"]',
    'img[src*="aliexpress-media.com"]',
  ];

  $(selectors.join(",")).each((_, img) => {
    const node = $(img);
    push(node.attr("src"));
    push(node.attr("data-src"));
    push(node.attr("data-origin-src"));
    push(node.attr("data-ks-lazyload"));

    const srcSet = node.attr("srcset");
    if (srcSet) {
      srcSet
        .split(",")
        .map((part) => part.trim().split(" ")[0])
        .forEach(push);
    }
  });

  return [...images];
}

function decodeAliText(text: string): string {
  return text
    .replace(/\\u002f/gi, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/\\\//g, "/");
}

function collectImageUrlsFromText(text: string): string[] {
  const images = new Set<string>();
  const normalizedText = decodeAliText(text);
  const regex =
    /(https?:\/\/|\/\/)[^"'\\s]+?(?:alicdn\.com|aliexpress-media\.com)[^"'\\s]+?\.(?:jpg|jpeg|png|webp|avif)(?:[^"'\\s]*)/gi;
  let match: RegExpExecArray | null = regex.exec(normalizedText);

  while (match) {
    const normalized = normalizeImageUrl(match[0]);
    if (normalized) images.add(normalized);
    match = regex.exec(normalizedText);
  }

  return [...images];
}

function normalizeImageUrl(url?: string | null): string | null {
  if (!url) return null;

  let value = url.trim();
  if (!value) return null;

  value = value
    .replace(/&amp;/gi, "&")
    .replace(/\\\//g, "/")
    .replace(/\\u0026/gi, "&")
    .replace(/\\u003d/gi, "=")
    .replace(/^http:\/\//i, "https://");

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  if (!value.startsWith("https://")) return null;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.toLowerCase();
    const isAliCdn = host.includes("alicdn.com");
    const isAliExpressMedia = host.includes("aliexpress-media.com");
    const isAliExpressHost = host.includes("aliexpress.com");

    if (!isAliCdn && !isAliExpressMedia && !isAliExpressHost) {
      return null;
    }

    if (!PRODUCT_IMAGE_PATH_HINTS.some((hint) => path.includes(hint))) {
      return null;
    }

    if (BLOCKED_IMAGE_HINTS.some((hint) => path.includes(hint))) {
      return null;
    }

    if (looksLikeTinyImage(parsed.pathname)) {
      return null;
    }
  } catch {
    return null;
  }

  value = value
    .replace(/\.jpg_\d+x\d+\.jpg$/i, ".jpg")
    .replace(/\.jpeg_\d+x\d+\.jpeg$/i, ".jpeg")
    .replace(/\.png_\d+x\d+\.png$/i, ".png")
    .replace(/\.webp_\d+x\d+\.webp$/i, ".webp")
    .replace(/_\d+x\d+\.(jpg|jpeg|png|webp)$/i, ".$1")
    .replace(/\?.*$/, "");

  return value;
}

function uniqueImages(images: string[]): string[] {
  return [...new Set(images.map((img) => normalizeImageUrl(img)).filter(Boolean) as string[])];
}

function looksLikeTinyImage(pathname: string): boolean {
  const match = pathname.match(/(\d{2,4})x(\d{2,4})/);
  if (!match) return false;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return false;
  return width <= 120 && height <= 120;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return 0;
  
  const firstPart = value.split("-")[0];
  const extracted = firstPart.replace(/[^\d.,]/g, '');
  if (!extracted) return 0;

  let normalized = extracted;
  const lastComma = normalized.lastIndexOf(',');
  const lastDot = normalized.lastIndexOf('.');
  
  if (lastComma > -1 && lastDot > -1) {
    if (lastComma > lastDot) {
      normalized = normalized.replace(/\./g, '').replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  } else if (lastComma > -1) {
    const parts = normalized.split(',');
    if (parts.length === 2 && parts[1].length <= 2) {
      normalized = normalized.replace(',', '.');
    } else {
      normalized = normalized.replace(/,/g, '');
    }
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function extractFromData(data: Record<string, unknown>): AliExpressProduct {
  const result = emptyProduct();
  const imageCandidates = new Set<string>();

  // Map de propertyValueId -> { name, propertyName, image }
  const propValueMap = new Map<string, { name: string; propertyName: string; image?: string }>();

  const pushImage = (value: unknown) => {
    if (typeof value === "string") {
      const normalized = normalizeImageUrl(value);
      if (normalized) imageCandidates.add(normalized);
      return;
    }

    if (Array.isArray(value)) {
      value.forEach(pushImage);
      return;
    }

    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      const knownUrlKeys = [
        "imagePath",
        "imageUrl",
        "imgUrl",
        "src",
        "url",
        "skuPropertyImagePath",
      ];
      for (const key of knownUrlKeys) {
        if (record[key]) {
          pushImage(record[key]);
        }
      }
    }
  };

  const walk = (obj: unknown) => {
    if (!obj || typeof obj !== "object") return;
    const record = obj as Record<string, unknown>;

    // Schema.org ld+json Product
    if (record["@type"] === "Product" || record["@type"] === "product") {
      if (typeof record.name === "string" && !result.title) {
        result.title = record.name;
      }
      if (typeof record.description === "string" && !result.description) {
        result.description = record.description;
      }
      const offers = record.offers as Record<string, unknown> | undefined;
      if (offers && !result.price) {
        const offerPrice = parseNumber(offers.price) || parseNumber(offers.lowPrice);
        if (offerPrice > 0) {
          result.price = offerPrice;
          if (!result.originalPrice) {
            result.originalPrice = parseNumber(offers.highPrice) || offerPrice;
          }
        }
      }
    }

    if (typeof record.subject === "string" && !result.title) {
      result.title = record.subject;
    }
    if (typeof record.description === "string" && !result.description) {
      result.description = record.description;
    }

    // Broad price field detection — covers many AliExpress data structures
    if (!result.price) {
      const priceFields = [
        "minPrice", "min_price", "salePrice", "sale_price",
        "activityAmount", "actSkuCalPrice", "currentPrice",
        "price", "formattedActivityPrice", "formatedActivityPrice",
        "discountPrice", "promotionPrice",
      ];
      for (const field of priceFields) {
        if (record[field]) {
          const parsed = parseNumber(record[field]);
          if (parsed > 0) {
            result.price = parsed;
            break;
          }
          // Handle nested { value, currency } objects
          const nested = record[field] as Record<string, unknown>;
          if (nested && typeof nested === "object") {
            const nestedValue = parseNumber(nested.value) || parseNumber(nested.formatedAmount) || parseNumber(nested.amountText);
            if (nestedValue > 0) {
              result.price = nestedValue;
              break;
            }
          }
        }
      }
    }
    if (!result.originalPrice) {
      const origFields = [
        "maxPrice", "max_price", "originalPrice", "original_price",
        "comparePrice", "compareAtPrice", "skuCalPrice", "retailPrice",
      ];
      for (const field of origFields) {
        if (record[field]) {
          const parsed = parseNumber(record[field]);
          if (parsed > 0) {
            result.originalPrice = parsed;
            break;
          }
          const nested = record[field] as Record<string, unknown>;
          if (nested && typeof nested === "object") {
            const nestedValue = parseNumber(nested.value) || parseNumber(nested.formatedAmount) || parseNumber(nested.amountText);
            if (nestedValue > 0) {
              result.originalPrice = nestedValue;
              break;
            }
          }
        }
      }
    }
    if (record.averageStar && !result.rating) {
      result.rating = parseNumber(record.averageStar);
    }
    if (record.tradeCount && !result.orders) {
      result.orders = parseNumber(record.tradeCount);
    }

    if (Array.isArray(record.attrList)) {
      for (const attr of record.attrList) {
        const a = attr as Record<string, string>;
        if (a.attrName && a.attrValue) {
          result.specs[a.attrName] = a.attrValue;
        }
      }
    }

    if (Array.isArray(record.productSKUPropertyList) && result.variantOptions.length === 0) {
      for (const prop of record.productSKUPropertyList) {
        const p = prop as Record<string, unknown>;
        const propName = (p.skuPropertyName as string) || "";
        const values = p.skuPropertyValues as Record<string, unknown>[] | undefined;
        if (!propName || !Array.isArray(values)) continue;

        const option: AliExpressVariantOption = { name: propName, values: [] };
        for (const val of values) {
          const v = val as Record<string, unknown>;
          const valueName =
            (v.propertyValueDisplayName as string) ||
            (v.propertyValueName as string) ||
            "";
          const image = normalizeImageUrl(v.skuPropertyImagePath as string);
          const valueId = String(v.propertyValueId || v.propertyValueIdLong || "");

          if (valueName) {
            option.values.push({ name: valueName, image: image || undefined });
            if (valueId) {
              propValueMap.set(valueId, {
                name: valueName,
                propertyName: propName,
                image: image || undefined,
              });
            }
          }
        }
        if (option.values.length > 0) result.variantOptions.push(option);
      }
    }

    if (Array.isArray(record.skuPriceList) && result.variants.length === 0) {
      for (const sku of record.skuPriceList) {
        const s = sku as Record<string, unknown>;
        const skuAttr = (s.skuAttr as string) || (s.skuPropIds as string) || "";
        const skuVal = (s.skuVal as Record<string, unknown>) || s;

        const sv = skuVal as Record<string, unknown>;
        const skuActivity = sv.skuActivityAmount as Record<string, unknown> | undefined;
        const skuAmount = sv.skuAmount as Record<string, unknown> | undefined;
        const price =
          parseNumber(skuActivity?.amountText) ||
          parseNumber(sv.actSkuCalPrice) ||
          parseNumber(skuAmount?.amountText) ||
          parseNumber(sv.skuCalPrice);
        const originalPrice =
          parseNumber(skuAmount?.amountText) ||
          parseNumber(sv.skuCalPrice) ||
          price;
        const stock = parseNumber(s.skuStock) || parseNumber(s.availQuantity) || 0;

        const properties: Record<string, string> = {};
        if (skuAttr) {
          const parts = skuAttr.split(";");
          for (const part of parts) {
            const match = part.match(/:(\d+)/g);
            if (match && match.length >= 2) {
              const valueId = match[match.length - 1].slice(1);
              const mapped = propValueMap.get(valueId);
              if (mapped) {
                properties[mapped.propertyName] = mapped.name;
              }
            }

            const hashMatch = part.match(/#(.+)/);
            if (hashMatch) {
              const propId = part.split(":")[0];
              const foundProp = result.variantOptions.find((opt) =>
                propValueMap.size > 0 ? true : opt.values.some((v) => v.name === hashMatch[1])
              );
              if (foundProp && !properties[foundProp.name]) {
                properties[foundProp.name] = hashMatch[1];
              } else if (!Object.values(properties).includes(hashMatch[1])) {
                properties[`prop_${propId}`] = hashMatch[1];
              }
            }
          }
        }

        if (price > 0) {
          result.variants.push({
            sku: (s.skuId as string) || String(s.skuIdStr || ""),
            properties,
            price,
            originalPrice,
            stock,
          });
        }
      }
    }

    for (const [key, value] of Object.entries(record)) {
      if (
        /(imagepathlist|imagelist|imageurl|imagepath|mainimage|gallery|skuimage|skupropertyimagepath|picurl|thumb)/i.test(
          key
        )
      ) {
        pushImage(value);
      }
    }

    for (const value of Object.values(record)) {
      if (typeof value === "object") walk(value);
    }
  };

  walk(data);
  result.images = uniqueImages([...imageCandidates]);
  return result;
}

function mergeVariantOptions(
  a: AliExpressVariantOption[],
  b: AliExpressVariantOption[]
): AliExpressVariantOption[] {
  const map = new Map<string, AliExpressVariantOption>();

  for (const option of [...a, ...b]) {
    if (!map.has(option.name)) {
      map.set(option.name, { name: option.name, values: [] });
    }
    const current = map.get(option.name)!;
    for (const value of option.values) {
      if (!current.values.some((v) => v.name === value.name)) {
        current.values.push(value);
      }
    }
  }

  return [...map.values()];
}

function mergeVariants(a: AliExpressVariant[], b: AliExpressVariant[]): AliExpressVariant[] {
  const bySku = new Map<string, AliExpressVariant>();
  [...a, ...b].forEach((variant) => {
    if (variant.sku) bySku.set(variant.sku, variant);
  });
  return [...bySku.values()];
}

function mergeProductData(existing: AliExpressProduct, incoming: AliExpressProduct): AliExpressProduct {
  return {
    title: existing.title || incoming.title,
    description: existing.description || incoming.description,
    price: existing.price || incoming.price,
    originalPrice: existing.originalPrice || incoming.originalPrice || existing.price || incoming.price,
    images: uniqueImages([...existing.images, ...incoming.images]),
    specs: { ...incoming.specs, ...existing.specs },
    rating: existing.rating || incoming.rating,
    orders: existing.orders || incoming.orders,
    variantOptions: mergeVariantOptions(existing.variantOptions, incoming.variantOptions),
    variants: mergeVariants(existing.variants, incoming.variants),
  };
}

