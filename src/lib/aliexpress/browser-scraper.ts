import { chromium } from "playwright-core";
import { safeFetch } from "@/lib/net/safe-url";
import type {
  AliExpressProduct,
  AliExpressVariant,
  AliExpressVariantOption,
} from "@/types";

const BROWSER_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

const MTOP_PDP_ENDPOINT = "/h5/mtop.aliexpress.pdp.pc.query/1.0/";
const IS_VERCEL = Boolean(process.env.VERCEL);

type LambdaChromium = {
  args: string[];
  executablePath: () => Promise<string>;
};

async function launchAliBrowser() {
  if (!IS_VERCEL) {
    return chromium.launch({ 
      headless: true, // You can set this to false if you want to see the browser opening
      channel: "chrome", // Uses the real Google Chrome installed on the computer to bypass bot detection
    });
  }

  try {
    const chromiumModule = await import("@sparticuz/chromium");
    const lambdaChromium = (chromiumModule.default ??
      chromiumModule) as unknown as LambdaChromium;
    const executablePath = await lambdaChromium.executablePath();

    return chromium.launch({
      headless: true,
      executablePath,
      args: [...lambdaChromium.args, "--no-sandbox", "--disable-setuid-sandbox"],
    });
  } catch (error) {
    console.warn("[aliexpress.browser] lambda chromium bootstrap failed", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
}

export async function scrapeProductWithBrowser(
  url: string
): Promise<AliExpressProduct | null> {
  const browser = await launchAliBrowser();
  const context = await browser.newContext({
    locale: "pt-BR",
    userAgent: BROWSER_USER_AGENT,
    extraHTTPHeaders: {
      "accept-language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
    },
  });
  const page = await context.newPage();

  let pdpResult: Record<string, unknown> | null = null;
  let resolvePayload: (() => void) | null = null;
  const payloadReady = new Promise<void>((resolve) => {
    resolvePayload = resolve;
  });

  page.on("response", async (response) => {
    const responseUrl = response.url();
    if (!responseUrl.includes(MTOP_PDP_ENDPOINT)) return;

    try {
      const body = await response.text();
      const parsed = parseMtopPayload(body);
      if (!parsed) return;
      const ret = Array.isArray(parsed.ret) ? parsed.ret.join(",") : "";
      if (!ret.includes("SUCCESS")) return;

      const data = asRecord(parsed.data);
      const result = asRecord(data?.result);
      if (!result) return;

      pdpResult = result;
      resolvePayload?.();
    } catch {
      // ignore response parse failures
    }
  });

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });

    await Promise.race([payloadReady, page.waitForTimeout(18_000)]);

    if (!pdpResult) {
      return null;
    }

    const product = await buildProductFromPdpResult(pdpResult);
    if (!product.title || product.images.length === 0) return null;

    return product;
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}

type MtopPayload = {
  ret?: string[];
  data?: {
    result?: Record<string, unknown>;
  };
};

function parseMtopPayload(body: string): MtopPayload | null {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed) as MtopPayload;
    } catch {
      return null;
    }
  }

  const start = trimmed.indexOf("(");
  const end = trimmed.lastIndexOf(")");
  if (start === -1 || end === -1 || end <= start) return null;

  const jsonChunk = trimmed.slice(start + 1, end);
  try {
    return JSON.parse(jsonChunk) as MtopPayload;
  } catch {
    return null;
  }
}

async function buildProductFromPdpResult(
  result: Record<string, unknown>
): Promise<AliExpressProduct> {
  const title =
    readString(asRecord(result.PRODUCT_TITLE), ["text", "subject"]) ||
    readString(asRecord(asRecord(result.GLOBAL_DATA)?.globalData), ["subject"]) ||
    "";

  const ratingModule = asRecord(result.PC_RATING);
  const rating = parseNumber(readUnknown(ratingModule, ["rating", "star", "score"]));
  const orders = parseOrders(
    readString(ratingModule, ["otherText", "orderCountText", "tradeCountText"]) || ""
  );

  const skuModule = asRecord(result.SKU);
  const priceModule = asRecord(result.PRICE);
  const headerImage = asRecord(result.HEADER_IMAGE_PC);
  const propsModule = asRecord(result.PRODUCT_PROP_PC);
  const descModule = asRecord(result.DESC);

  const {
    variantOptions,
    variants,
  } = parseVariantsAndOptions(skuModule, priceModule);

  const images = collectImages(headerImage, variantOptions);

  const targetPriceInfo = asRecord(priceModule?.targetSkuPriceInfo);
  const priceFromTarget = pickSalePrice(targetPriceInfo);
  const originalPriceFromTarget = pickOriginalPrice(targetPriceInfo);

  const variantPrices = variants.map((v) => v.price).filter((value) => value > 0);
  const variantOriginalPrices = variants
    .map((v) => v.originalPrice)
    .filter((value) => value > 0);

  const price =
    priceFromTarget ||
    (variantPrices.length > 0 ? Math.min(...variantPrices) : 0);
  const originalPrice =
    originalPriceFromTarget ||
    (variantOriginalPrices.length > 0 ? Math.max(...variantOriginalPrices) : price);

  const specs = extractSpecs(propsModule);
  const description = await extractDescriptionHtml(descModule);

  const normalizedVariants =
    variants.length > 0
      ? variants
      : [
          {
            sku: "",
            properties: {},
            price,
            originalPrice: originalPrice || price,
            stock: 0,
          },
        ];

  return {
    title: cleanTitle(title),
    description,
    price,
    originalPrice: originalPrice || price,
    images,
    specs,
    rating,
    orders,
    variantOptions,
    variants: normalizedVariants,
  };
}

function parseVariantsAndOptions(
  skuModule: Record<string, unknown> | null,
  priceModule: Record<string, unknown> | null
): {
  variantOptions: AliExpressVariantOption[];
  variants: AliExpressVariant[];
  valueIdLookup: Map<string, { propertyName: string; valueName: string }>;
  propIdLookup: Map<string, string>;
} {
  const variantOptions: AliExpressVariantOption[] = [];
  const valueIdLookup = new Map<string, { propertyName: string; valueName: string }>();
  const propIdLookup = new Map<string, string>();

  const skuProperties = asArray(skuModule?.skuProperties);
  for (const prop of skuProperties) {
    const propRecord = asRecord(prop);
    if (!propRecord) continue;

    const propertyName =
      readString(propRecord, ["skuPropertyName", "propertyName", "name"]) || "Opcao";
    const propertyId = String(
      readUnknown(propRecord, ["skuPropertyId", "propertyId", "id"]) || ""
    );
    if (propertyId) {
      propIdLookup.set(propertyId, propertyName);
    }

    const optionValues: AliExpressVariantOption["values"] = [];
    const seenValues = new Set<string>();
    const values = asArray(propRecord.skuPropertyValues);
    for (const value of values) {
      const valueRecord = asRecord(value);
      if (!valueRecord) continue;

      const valueName =
        readString(valueRecord, [
          "propertyValueDisplayName",
          "propertyValueDefinitionName",
          "propertyValueName",
          "name",
        ]) || "Valor";
      if (seenValues.has(valueName)) continue;
      seenValues.add(valueName);

      const image = normalizeImageUrl(
        readString(valueRecord, ["skuPropertyImagePath", "image", "url"])
      );

      optionValues.push({
        name: valueName,
        ...(image ? { image } : {}),
      });

      const valueId = String(
        readUnknown(valueRecord, [
          "propertyValueIdLong",
          "propertyValueId",
          "valueId",
          "id",
        ]) || ""
      );
      if (valueId) {
        valueIdLookup.set(valueId, { propertyName, valueName });
      }
    }

    if (optionValues.length > 0) {
      variantOptions.push({
        name: propertyName,
        values: optionValues,
      });
    }
  }

  const priceMap = buildPriceMap(priceModule);
  const targetPriceInfo = asRecord(priceModule?.targetSkuPriceInfo);
  const fallbackPrice = pickSalePrice(targetPriceInfo);
  const fallbackOriginal = pickOriginalPrice(targetPriceInfo) || fallbackPrice;

  const variants: AliExpressVariant[] = [];
  const skuPaths = asArray(skuModule?.skuPaths);
  for (const skuPath of skuPaths) {
    const pathRecord = asRecord(skuPath);
    if (!pathRecord) continue;

    const skuId =
      String(readUnknown(pathRecord, ["skuIdStr", "skuId", "id"]) || "") || "";
    const stock = parseNumber(readUnknown(pathRecord, ["skuStock", "stock", "quantity"]));

    const properties = parseVariantProperties(
      pathRecord,
      propIdLookup,
      valueIdLookup
    );
    const priceInfo = priceMap.get(skuId);
    const price = priceInfo?.price || fallbackPrice;
    const originalPrice = priceInfo?.originalPrice || fallbackOriginal || price;

    if (price > 0) {
      variants.push({
        sku: skuId,
        properties,
        price,
        originalPrice,
        stock,
      });
    }
  }

  return { variantOptions, variants, valueIdLookup, propIdLookup };
}

function buildPriceMap(
  priceModule: Record<string, unknown> | null
): Map<string, { price: number; originalPrice: number }> {
  const map = new Map<string, { price: number; originalPrice: number }>();
  const sources = [
    asRecord(priceModule?.skuPriceInfoMap),
    asRecord(priceModule?.skuIdStrPriceInfoMap),
  ].filter(Boolean) as Record<string, unknown>[];

  for (const source of sources) {
    for (const [skuKey, rawInfo] of Object.entries(source)) {
      const info = asRecord(rawInfo);
      if (!info) continue;
      const skuId =
        String(readUnknown(info, ["skuIdStr", "skuId"]) || skuKey) || skuKey;
      const salePrice = pickSalePrice(info);
      const originalPrice = pickOriginalPrice(info) || salePrice;
      if (salePrice <= 0) continue;

      map.set(skuId, {
        price: salePrice,
        originalPrice,
      });
    }
  }

  return map;
}

function parseVariantProperties(
  skuPath: Record<string, unknown>,
  propIdLookup: Map<string, string>,
  valueIdLookup: Map<string, { propertyName: string; valueName: string }>
): Record<string, string> {
  const properties: Record<string, string> = {};

  const skuAttr = readString(skuPath, ["skuAttr"]) || "";
  if (skuAttr) {
    const tokens = skuAttr.split(";").map((part) => part.trim()).filter(Boolean);
    for (const token of tokens) {
      const [rawPath, displayName] = token.split("#");
      const [propId, valueId] = rawPath.split(":");
      const propName = propIdLookup.get(propId) || `prop_${propId}`;

      if (displayName?.trim()) {
        properties[propName] = displayName.trim();
        continue;
      }

      if (valueId) {
        const mapped = valueIdLookup.get(valueId);
        if (mapped) {
          properties[mapped.propertyName] = mapped.valueName;
        }
      }
    }
  }

  const rawPath = readString(skuPath, ["path"]) || "";
  if (rawPath) {
    const tokens = rawPath.split(";").map((part) => part.trim()).filter(Boolean);
    for (const token of tokens) {
      const [propId, valueId] = token.split(":");
      if (!propId || !valueId) continue;
      const mapped = valueIdLookup.get(valueId);
      if (mapped) {
        properties[mapped.propertyName] = mapped.valueName;
      } else {
        const propName = propIdLookup.get(propId) || `prop_${propId}`;
        if (!properties[propName]) {
          properties[propName] = valueId;
        }
      }
    }
  }

  return properties;
}

function collectImages(
  headerImage: Record<string, unknown> | null,
  variantOptions: AliExpressVariantOption[]
): string[] {
  const imageSet = new Set<string>();
  const push = (value: unknown) => {
    if (typeof value === "string") {
      const normalized = normalizeImageUrl(value);
      if (normalized) imageSet.add(normalized);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(push);
      return;
    }
    const record = asRecord(value);
    if (!record) return;
    push(record.url);
    push(record.imgUrl);
    push(record.imageUrl);
    push(record.originImageUrl);
    push(record.bigPicUrl);
    push(record.skuPropertyImagePath);
  };

  push(headerImage?.imagePathList);
  push(headerImage?.currentSkuImages);
  push(headerImage?.summImagePathList);
  push(headerImage?.mainImages);
  push(headerImage?.imgList);
  push(headerImage?.skuImagesMap);

  for (const option of variantOptions) {
    for (const value of option.values) {
      if (value.image) {
        imageSet.add(value.image);
      }
    }
  }

  return [...imageSet];
}

function extractSpecs(propsModule: Record<string, unknown> | null): Record<string, string> {
  const specs: Record<string, string> = {};
  const candidates = [
    ...asArray(propsModule?.showedProps),
    ...asArray(propsModule?.outerProps),
  ];

  for (const item of candidates) {
    const record = asRecord(item);
    if (!record) continue;
    const name = readString(record, ["attrName", "name", "key"]) || "";
    const value = readString(record, ["attrValue", "value"]) || "";
    if (!name || !value) continue;
    specs[name] = value;
  }

  return specs;
}

async function extractDescriptionHtml(
  descModule: Record<string, unknown> | null
): Promise<string> {
  const descriptionUrl =
    readString(descModule, ["nativeDescUrl"]) ||
    readString(descModule, ["pcDescUrl"]) ||
    readString(descModule, ["msiteDescUrl"]) ||
    "";

  if (!descriptionUrl) {
    return "";
  }

  try {
    // descriptionUrl e RASPADA da pagina: quem controla e o site remoto, nao
    // nem o usuario. E o caso em que confiar no endereco menos faz sentido.
    const res = await safeFetch(descriptionUrl, {
      headers: {
        "User-Agent": BROWSER_USER_AGENT,
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7",
      },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return "";

    const contentType = res.headers.get("content-type") || "";
    const body = await res.text();
    if (!body.trim()) return "";

    if (!contentType.includes("json") && !body.trim().startsWith("{")) {
      return body.trim();
    }

    const json = JSON.parse(body) as {
      moduleList?: Array<{
        type?: string;
        data?: {
          content?: string;
          url?: string;
        };
      }>;
    };

    const modules = Array.isArray(json.moduleList) ? json.moduleList : [];
    if (modules.length === 0) return "";

    const chunks: string[] = [];
    for (const itemModule of modules) {
      const type = (itemModule.type || "").toLowerCase();
      if (type === "text" && itemModule.data?.content) {
        const text = escapeHtml(itemModule.data.content).replace(/\n+/g, "<br />");
        chunks.push(`<p>${text}</p>`);
      } else if (type === "image" && itemModule.data?.url) {
        const normalized = normalizeImageUrl(itemModule.data.url);
        if (normalized) {
          chunks.push(`<p><img src="${normalized}" alt="" /></p>`);
        }
      }
    }

    return chunks.join("\n");
  } catch {
    return "";
  }
}

function pickSalePrice(priceInfo: Record<string, unknown> | null): number {
  if (!priceInfo) return 0;

  return (
    parseNumber(readUnknown(priceInfo, ["salePrice", "value"])) ||
    parseNumber(readUnknown(asRecord(priceInfo.salePrice), ["value"])) ||
    parseNumber(readUnknown(asRecord(priceInfo.salePrice), ["formatedAmount"])) ||
    parseNumber(readUnknown(priceInfo, ["salePriceString", "salePriceLocal"])) ||
    parseNumber(readUnknown(priceInfo, ["activityAmount"])) ||
    parseNumber(readUnknown(asRecord(priceInfo.activityAmount), ["value", "formatedAmount"])) ||
    parseNumber(readUnknown(priceInfo, ["discountPrice", "promotionPrice", "currentPrice"])) ||
    parseNumber(readUnknown(asRecord(priceInfo.discountPrice), ["value", "formatedAmount"])) ||
    parseNumber(readUnknown(priceInfo, ["minPrice", "min_price"])) ||
    parseNumber(readUnknown(asRecord(priceInfo.minPrice), ["value", "formatedAmount"])) ||
    parseNumber(readUnknown(priceInfo, ["price"])) ||
    0
  );
}

function pickOriginalPrice(priceInfo: Record<string, unknown> | null): number {
  if (!priceInfo) return 0;

  return (
    parseNumber(readUnknown(asRecord(priceInfo.originalPrice), ["value"])) ||
    parseNumber(readUnknown(asRecord(priceInfo.originalPrice), ["formatedAmount"])) ||
    parseNumber(readUnknown(priceInfo, ["originalPriceString", "originalPriceLocal"])) ||
    0
  );
}

function parseOrders(text: string): number {
  if (!text) return 0;
  const match = text.match(/[\d.]+/);
  if (!match) return 0;
  const normalized = match[0].replace(/\./g, "");
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-|–]\s*AliExpress.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeImageUrl(url?: string | null): string | null {
  if (!url) return null;

  let value = url.trim();
  if (!value) return null;

  value = value
    .replace(/\\\//g, "/")
    .replace(/&amp;/gi, "&")
    .replace(/^http:\/\//i, "https://");

  if (value.startsWith("//")) {
    value = `https:${value}`;
  }

  if (!value.startsWith("https://")) return null;

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (
      !host.includes("alicdn.com") &&
      !host.includes("aliexpress-media.com") &&
      !host.includes("aliexpress.com")
    ) {
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
    .replace(/_\d+x\d+\.(jpg|jpeg|png|webp|avif)$/i, ".$1")
    .replace(/\?.*$/, "");

  return value;
}

function parseNumber(value: unknown): number {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value !== "string") return 0;

  const firstChunk = value.match(/\d[\d.,]*/)?.[0];
  if (!firstChunk) return 0;

  let normalized = firstChunk;
  const hasComma = normalized.includes(",");
  const hasDot = normalized.includes(".");

  if (hasComma && hasDot) {
    if (normalized.lastIndexOf(",") > normalized.lastIndexOf(".")) {
      normalized = normalized.replace(/\./g, "").replace(",", ".");
    } else {
      normalized = normalized.replace(/,/g, "");
    }
  } else if (hasComma && !hasDot) {
    const [, decimal = ""] = normalized.split(",");
    normalized =
      decimal.length > 0 && decimal.length <= 2
        ? normalized.replace(",", ".")
        : normalized.replace(/,/g, "");
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function readUnknown(
  record: Record<string, unknown> | null,
  keys: string[]
): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (key in record) return record[key];
  }
  return undefined;
}

function readString(
  record: Record<string, unknown> | null,
  keys: string[]
): string | null {
  const value = readUnknown(record, keys);
  return typeof value === "string" ? value : null;
}
