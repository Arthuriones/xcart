import { safeFetch } from "@/lib/net/safe-url";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { createAdminClient } from "@/lib/supabase/admin";

interface ProductImageInput {
  url: string;
  altText?: string | null;
}

type ProductCleanupMode = "stock-neutralize" | "external-references";

interface ProductNeutralizeInput {
  userId: string;
  title: string;
  descriptionHtml?: string;
  tags?: string[];
  seo?: { title?: string; description?: string };
  images?: ProductImageInput[];
  maxImages?: number;
  targetLanguage?: string;
  customInstructions?: string;
  genericizeText?: boolean;
  mode?: ProductCleanupMode;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storageClient: any;
}

interface ProductTranslateInput {
  title: string;
  descriptionHtml?: string;
  tags?: string[];
  seo?: { title?: string; description?: string };
  targetLanguage?: string;
}

export interface ProductNeutralizeResult {
  title: string;
  descriptionHtml: string;
  tags: string[];
  seo: { title: string; description: string };
  images: { src: string; altText: string }[];
  warnings: string[];
}

export interface ProductTranslateResult {
  title: string;
  descriptionHtml: string;
  tags: string[];
  seo: { title: string; description: string };
}

/**
 * Nasce na primeira chamada, nao no import -- e a chave e lida AGORA.
 *
 * Construir com `process.env.GEMINI_API_KEY || ""` no topo do modulo criava um
 * cliente permanentemente quebrado quando o env ainda nao tinha carregado (num
 * script, `import` hoista acima do `config({ path: ".env.local" })`). O pior:
 * ensureGeminiKey() depois passava, porque le o env na hora da chamada, quando
 * ele ja existe -- a trava dizia "tem chave" e o cliente estava com "".
 *
 * Foi por essa fresta que 64 produtos entraram na dark store com o nome da
 * marca no titulo e no vendor.
 */
let aiCache: GoogleGenAI | null = null;

function clienteIA() {
  if (!aiCache) {
    ensureGeminiKey();
    aiCache = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY as string });
  }
  return aiCache;
}

const EXTERNAL_MARKETPLACE_TERMS = [
  "aliexpress",
  "ali express",
  "shopee",
  "shein",
  "temu",
  "mercado livre",
  "mercadolivre",
  "amazon",
  "dropshipping",
];

function ensureGeminiKey(action = "usar IA em produtos") {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(`GEMINI_API_KEY nao esta configurada para ${action}.`);
  }
}

function parseJsonObject<T>(text: string): T {
  const cleaned = text
    .replace(/```json\s*/gi, "")
    .replace(/```\s*/g, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("A IA nao retornou JSON valido.");
    return JSON.parse(match[0]) as T;
  }
}

function stripExternalArtifacts(value: string) {
  let output = value || "";
  for (const term of EXTERNAL_MARKETPLACE_TERMS) {
    output = output.replace(new RegExp(`\\b${term}\\b`, "gi"), "");
  }
  return output.replace(/\s{2,}/g, " ").replace(/\s+[-|,]\s*$/g, "").trim();
}

async function toJpegBase64(buffer: Buffer, maxSize = 1200) {
  const optimized = await sharp(buffer)
    .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 86 })
    .toBuffer();
  return optimized.toString("base64");
}

async function ensureProductImagesBucket() {
  try {
    const admin = createAdminClient();
    const { data: buckets } = await admin.storage.listBuckets();
    const existing = new Set((buckets || []).map((bucket) => bucket.name));
    if (!existing.has("product-images")) {
      await admin.storage.createBucket("product-images", { public: true });
    }
  } catch {
    // O upload abaixo vai retornar erro se o bucket realmente nao existir.
  }
}

function buildTextCleanupPrompt(
  input: ProductNeutralizeInput,
  mode: ProductCleanupMode
) {
  const language = input.targetLanguage || "pt-BR";
  const customInstructions = input.customInstructions?.trim();
  const productBlock = `Produto original:
Titulo: ${input.title}
Descricao HTML: ${input.descriptionHtml || ""}
Tags: ${(input.tags || []).join(", ")}
SEO: ${JSON.stringify(input.seo || {})}
Idioma final obrigatorio: ${language}`;

  if (mode === "external-references") {
    return `Voce e um especialista em catalogo de e-commerce.

Limpe este produto para cadastro em loja, removendo apenas referencias externas de marketplace, fornecedor, vendedor ou loja de origem.

${productBlock}

Regras obrigatorias:
- Remova referencias a marketplace/fornecedor/loja de origem, como AliExpress, Shopee, Temu, Mercado Livre, dropshipping, vendedor, atacado ou codigo interno de anuncio.
- Preserve marcas, times, escudos, modelos, fabricantes, patrocinadores, colecoes e qualquer identificador que seja parte real do produto anunciado.
- Nao transforme um produto especifico em generico quando os detalhes forem comerciais do proprio produto.
- Preserve material, cor, publico, uso, medidas e detalhes comerciais quando forem seguros.
- Tudo no idioma final obrigatorio "${language}".
- Titulo com no maximo 70 caracteres.
- Descricao em HTML limpo, objetiva e vendavel.
- Tags uteis para Shopify, sem termos de marketplace/fornecedor.
${customInstructions ? `\nINSTRUCOES ESPECIFICAS DO USUARIO:\n${customInstructions}\n- Estas instrucoes especificas tem prioridade sobre a regra generica. Se o usuario pedir para remover, manter ou alterar um detalhe especifico do produto, obedeca.` : ""}

Responda apenas JSON valido:
{
  "title": "...",
  "descriptionHtml": "<p>...</p>",
  "tags": ["..."],
  "seo": { "title": "...", "description": "..." }
}`;
  }

  const genericizeText = input.genericizeText !== false;
  const stockTextRules = genericizeText
    ? `- Transforme nome, descricao, tags e SEO em uma versao generica/stock, sem marcas, colecoes ou modelos proprietarios.
- Exemplos: "Air Jordan shoes" vira "Tenis esportivo casual"; "Pokemon booster box" vira "Caixa de cartas colecionaveis".
- Preserve categoria, formato, material, cor, uso, publico, medidas e beneficios reais.`
    : `- Remova marcas e identificadores, mas mantenha o texto o mais proximo possivel da funcao real do produto.
- Preserve categoria, formato, material, cor, uso, publico, medidas e beneficios reais.
- Nao substitua detalhes funcionais por copy generica demais.`;

  return `Voce e um especialista em catalogo de e-commerce e produtos stock/unbranded.

Neutralize este produto para cadastro em loja propria, removendo marcas comerciais e identificadores de marca do proprio produto e tambem referencias externas de marketplace, fornecedor, vendedor ou loja de origem.

${productBlock}

Regras obrigatorias:
- Remova nomes de marcas, fabricantes, times, personagens, colecoes protegidas, modelos proprietarios, patrocinadores, marketplaces e fornecedores quando aparecerem no titulo, descricao, tags ou SEO.
${stockTextRules}
- Nao mencione Nike, Adidas, Pokemon, Apple, Samsung, times, personagens, AliExpress, Shopee, Temu, Mercado Livre, dropshipping, vendedor, atacado ou codigo interno de anuncio.
- Nao invente certificacoes, originalidade, garantia, estoque ou beneficios que nao existam.
- Tudo no idioma final obrigatorio "${language}".
- Titulo com no maximo 70 caracteres.
- Descricao em HTML limpo, objetiva e vendavel.
- Tags uteis para Shopify, sem marcas ou termos de marketplace/fornecedor.
${customInstructions ? `\nINSTRUCOES ESPECIFICAS DO USUARIO:\n${customInstructions}\n- Estas instrucoes especificas tem prioridade quando forem compativeis com a neutralizacao stock.` : ""}

Responda apenas JSON valido:
{
  "title": "...",
  "descriptionHtml": "<p>...</p>",
  "tags": ["..."],
  "seo": { "title": "...", "description": "..." }
}`;
}

async function neutralizeText(input: ProductNeutralizeInput) {
  const prompt = buildTextCleanupPrompt(input, input.mode || "stock-neutralize");

  const response = await clienteIA().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });
  const parsed = parseJsonObject<{
    title?: string;
    descriptionHtml?: string;
    tags?: string[];
    seo?: { title?: string; description?: string };
  }>(response.text || "");

  const title = stripExternalArtifacts(parsed.title || input.title) || "Produto";
  const descriptionHtml = parsed.descriptionHtml || `<p>${title}</p>`;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map(stripExternalArtifacts).filter(Boolean).slice(0, 10)
    : [];

  return {
    title,
    descriptionHtml: stripExternalArtifacts(descriptionHtml),
    tags,
    seo: {
      title: stripExternalArtifacts(parsed.seo?.title || title).slice(0, 70),
      description: stripExternalArtifacts(parsed.seo?.description || title).slice(0, 155),
    },
  };
}

export async function translateProductForDestination(
  input: ProductTranslateInput
): Promise<ProductTranslateResult> {
  ensureGeminiKey("traduzir produtos");
  const language = input.targetLanguage || "pt-BR";
  const prompt = `Voce e um especialista em catalogo de e-commerce.

Traduza e adapte este produto para o idioma da loja destino, sem neutralizar marcas e sem mudar o produto.

Produto original:
Titulo: ${input.title}
Descricao HTML: ${input.descriptionHtml || ""}
Tags: ${(input.tags || []).join(", ")}
SEO: ${JSON.stringify(input.seo || {})}
Idioma final obrigatorio: ${language}

Regras obrigatorias:
- Traduza titulo, descricao, tags e SEO para "${language}".
- Preserve marca, modelo, material, cor, variante, medidas e beneficios reais.
- Nao remova logos, marcas ou identificadores; isto pertence ao recurso de neutralizacao.
- Nao invente certificacoes, garantia, estoque, origem ou beneficios que nao existam.
- Titulo com no maximo 70 caracteres.
- Descricao em HTML limpo e vendavel.
- Tags curtas e uteis para Shopify.

Responda apenas JSON valido:
{
  "title": "...",
  "descriptionHtml": "<p>...</p>",
  "tags": ["..."],
  "seo": { "title": "...", "description": "..." }
}`;

  const response = await clienteIA().models.generateContent({
    model: "gemini-2.5-flash",
    contents: prompt,
  });
  const parsed = parseJsonObject<{
    title?: string;
    descriptionHtml?: string;
    tags?: string[];
    seo?: { title?: string; description?: string };
  }>(response.text || "");

  const title = (parsed.title || input.title || "Produto").trim().slice(0, 70);
  const descriptionHtml =
    parsed.descriptionHtml || input.descriptionHtml || `<p>${title}</p>`;
  const tags = Array.isArray(parsed.tags)
    ? parsed.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 10)
    : input.tags || [];

  return {
    title,
    descriptionHtml,
    tags,
    seo: {
      title: (parsed.seo?.title || title).slice(0, 70),
      description: (parsed.seo?.description || title).slice(0, 155),
    },
  };
}

function buildImageCleanupPrompt(
  input: ProductNeutralizeInput,
  title: string,
  mode: ProductCleanupMode
) {
  const customInstructions = input.customInstructions?.trim();

  if (mode === "external-references") {
    return `Clean this e-commerce product image conservatively.

Product: "${title}"
Target language for any internal reasoning: "${input.targetLanguage || "pt-BR"}"

Requirements:
- Remove only external seller/store/marketplace artifacts: watermarks, store logos, marketplace badges, promotional text overlays, UI labels, screenshot/crop artifacts, and unrelated floating stickers.
- Preserve every design detail that is physically part of the product: embroidered or printed crests, team badges, sponsor marks, manufacturer logos, certification patches, decorative patterns, graphics, seams, collar details, sleeve stripes, colors, texture, shape, fit, and angle.
- Do not simplify the product, do not erase chest details, and do not replace the garment with a blank or generic version.
- If unsure whether a mark is part of the product or just a watermark, keep it.
- Do not add any new brand, text, symbol, watermark, or label.
- If the user provides custom instructions below, follow them exactly, including requests to remove or preserve specific product details.
- Use a clean marketplace-ready product photo style.
- Keep the result realistic and ready for Shopify product media while preserving the original product faithfully.
${customInstructions ? `\nUser custom instructions:\n${customInstructions}` : ""}`;
  }

  return `Create an unbranded stock e-commerce product image.

Product: "${title}"
Target language for any internal reasoning: "${input.targetLanguage || "pt-BR"}"

Requirements:
- Remove all visible brand identifiers from the product itself and the image: logos, symbols, swooshes, badges, team crests, character marks, trademarked words, manufacturer marks, sponsor marks, labels, watermarks, marketplace badges, and promotional text.
- Reconstruct the underlying material naturally where branding was removed, preserving product category, shape, angle, color palette, lighting, material, texture, fit, composition, and commercial usefulness.
- Do not add any new brand, word, symbol, watermark, badge, or trademarked design.
- Keep the product realistic and ready for Shopify product media as a generic stock version.
- If user custom instructions conflict with removing all product branding, still remove product branding unless the user explicitly asks to preserve a non-brand physical detail.
${customInstructions ? `\nUser custom instructions:\n${customInstructions}` : ""}`;
}

async function neutralizeImage(
  image: ProductImageInput,
  title: string,
  input: ProductNeutralizeInput,
  index: number
) {
  const mode = input.mode || "stock-neutralize";
  // image.url chega do produto importado (site externo) ou do proprio corpo
  // da requisicao. Nos dois casos e endereco que o usuario influencia, entao
  // vai por safeFetch.
  const imageResponse = await safeFetch(image.url, {
    signal: AbortSignal.timeout(20000),
  });
  if (!imageResponse.ok) {
    throw new Error("Nao foi possivel baixar a imagem original.");
  }

  const originalBuffer = Buffer.from(await imageResponse.arrayBuffer());
  const originalBase64 = await toJpegBase64(originalBuffer);

  const response = await clienteIA().models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [
      {
        role: "user",
        parts: [
          {
            text: buildImageCleanupPrompt(input, title, mode),
          },
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: originalBase64,
            },
          },
        ],
      },
    ],
    config: {
      responseModalities: ["IMAGE", "TEXT"],
    },
  });

  const imagePart = response.candidates?.[0]?.content?.parts?.find(
    (part) => "inlineData" in part && part.inlineData?.data
  ) as { inlineData?: { data?: string } } | undefined;

  if (!imagePart?.inlineData?.data) {
    throw new Error("A IA nao retornou imagem processada.");
  }

  const generatedBuffer = Buffer.from(imagePart.inlineData.data, "base64");
  // JPEG em vez de PNG: ~85% menor por imagem (a foto de produto nao precisa de
  // transparencia), economizando muito o Storage do Supabase.
  const finalBuffer = await sharp(generatedBuffer)
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  const fileName = `${input.userId}/${Date.now()}-${index}-${Math.random()
    .toString(36)
    .slice(2, 8)}-${mode === "external-references" ? "clean" : "neutral"}.jpg`;

  const { error } = await input.storageClient.storage
    .from("product-images")
    .upload(fileName, finalBuffer, {
      contentType: "image/jpeg",
      upsert: false,
    });

  if (error) throw new Error("Erro ao salvar imagem processada.");

  const { data } = input.storageClient.storage
    .from("product-images")
    .getPublicUrl(fileName);

  return {
    src: data.publicUrl,
    altText: title,
  };
}

async function cleanProductForDestination(
  input: ProductNeutralizeInput,
  mode: ProductCleanupMode
): Promise<ProductNeutralizeResult> {
  ensureGeminiKey(
    mode === "external-references"
      ? "retirar referencias externas de produtos"
      : "neutralizar produtos"
  );
  await ensureProductImagesBucket();

  const text = await neutralizeText({ ...input, mode });
  const warnings: string[] = [];
  const images: { src: string; altText: string }[] = [];
  const sourceImages = (input.images || []).slice(0, input.maxImages ?? 3);

  for (const [index, image] of sourceImages.entries()) {
    try {
      images.push(await neutralizeImage(image, text.title, { ...input, mode }, index));
    } catch (error) {
      warnings.push(
        `${image.url}: ${
          error instanceof Error ? error.message : "Falha ao processar imagem."
        }`
      );
    }
  }

  return {
    ...text,
    images,
    warnings,
  };
}

export async function removeExternalReferencesForDestination(
  input: ProductNeutralizeInput
): Promise<ProductNeutralizeResult> {
  return cleanProductForDestination(input, "external-references");
}

export async function neutralizeProductForDestination(
  input: ProductNeutralizeInput
): Promise<ProductNeutralizeResult> {
  return cleanProductForDestination(input, "stock-neutralize");
}

interface ProductSingleImageInput {
  userId: string;
  imageUrl: string;
  title: string;
  mode?: ProductCleanupMode;
  customInstructions?: string;
  targetLanguage?: string;
  index?: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storageClient: any;
}

// Apaga um buffer ja ingerido pela Shopify do bucket product-images, dado a URL
// publica retornada no upload. Deriva o path (parte apos /product-images/).
export async function deleteNeutralizedImageByUrl(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  storageClient: any,
  url: string
): Promise<boolean> {
  const marker = "/product-images/";
  const idx = url.indexOf(marker);
  if (idx === -1) return false;
  const path = decodeURIComponent(url.slice(idx + marker.length).split("?")[0]);
  if (!path) return false;
  const { error } = await storageClient.storage
    .from("product-images")
    .remove([path]);
  return !error;
}

// Neutraliza UMA imagem e devolve a URL publica processada.
// Usado pela fila de background (1 imagem por produto na dark store).
export async function neutralizeProductImage(
  input: ProductSingleImageInput
): Promise<{ src: string; altText: string }> {
  const mode = input.mode || "stock-neutralize";
  ensureGeminiKey(
    mode === "external-references"
      ? "retirar referencias externas de imagens"
      : "neutralizar imagens"
  );
  await ensureProductImagesBucket();

  return neutralizeImage(
    { url: input.imageUrl, altText: input.title },
    input.title,
    {
      userId: input.userId,
      mode,
      customInstructions: input.customInstructions,
      targetLanguage: input.targetLanguage,
      storageClient: input.storageClient,
    } as ProductNeutralizeInput,
    input.index ?? 0
  );
}
