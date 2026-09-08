import { safeFetch } from "@/lib/net/safe-url";
import type { SupabaseClient } from "@supabase/supabase-js";
import sharp from "sharp";

export type LogoPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

export interface ProductImageForLogo {
  src: string;
  altText: string;
}

export interface ApplyLogoOptions {
  userId: string;
  storeId: string;
  images: ProductImageForLogo[];
  storageClient: SupabaseClient;
  position?: LogoPosition;
  logoScalePercent?: number;
  marginPercent?: number;
  logoOpacityPercent?: number;
  logoPath?: string;
  maxImages?: number;
}

export interface ApplyLogoResult {
  images: ProductImageForLogo[];
  appliedCount: number;
  warnings: string[];
}

const VALID_POSITIONS = new Set<LogoPosition>([
  "top-left",
  "top-center",
  "top-right",
  "center-left",
  "center",
  "center-right",
  "bottom-left",
  "bottom-center",
  "bottom-right",
]);

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function asNumber(value: number | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getPositionCoordinates(
  position: LogoPosition,
  imageWidth: number,
  imageHeight: number,
  logoWidth: number,
  logoHeight: number,
  marginX: number,
  marginY: number
) {
  const centerLeft = Math.round((imageWidth - logoWidth) / 2);
  const centerTop = Math.round((imageHeight - logoHeight) / 2);

  switch (position) {
    case "top-left":
      return { left: marginX, top: marginY };
    case "top-center":
      return { left: centerLeft, top: marginY };
    case "top-right":
      return { left: imageWidth - logoWidth - marginX, top: marginY };
    case "center-left":
      return { left: marginX, top: centerTop };
    case "center":
      return { left: centerLeft, top: centerTop };
    case "center-right":
      return { left: imageWidth - logoWidth - marginX, top: centerTop };
    case "bottom-left":
      return { left: marginX, top: imageHeight - logoHeight - marginY };
    case "bottom-center":
      return { left: centerLeft, top: imageHeight - logoHeight - marginY };
    case "bottom-right":
    default:
      return {
        left: imageWidth - logoWidth - marginX,
        top: imageHeight - logoHeight - marginY,
      };
  }
}

async function ensureProductImagesBucket(storageClient: SupabaseClient) {
  try {
    const { data: buckets } = await storageClient.storage.listBuckets();
    const existing = new Set((buckets || []).map((bucket) => bucket.name));
    if (!existing.has("product-images")) {
      await storageClient.storage.createBucket("product-images", { public: true });
    }
  } catch {
    // O upload retornara erro explicito se o bucket realmente nao existir.
  }
}

async function applyOpacityToLogo(
  logoBuffer: Buffer,
  opacityPercent: number
): Promise<Buffer> {
  if (opacityPercent >= 100) {
    return logoBuffer;
  }

  const opacity = clamp(opacityPercent, 1, 100) / 100;
  const logoRaw = await sharp(logoBuffer)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const output = Buffer.from(logoRaw.data);
  for (let index = 3; index < output.length; index += 4) {
    output[index] = Math.round(output[index] * opacity);
  }

  return sharp(output, {
    raw: {
      width: logoRaw.info.width,
      height: logoRaw.info.height,
      channels: logoRaw.info.channels,
    },
  })
    .png()
    .toBuffer();
}

async function resolveLogoPath(input: ApplyLogoOptions) {
  if (input.logoPath?.trim()) return input.logoPath.trim();

  const { data: store } = await input.storageClient
    .from("stores")
    .select("logo_path")
    .eq("id", input.storeId)
    .eq("user_id", input.userId)
    .single();

  return typeof store?.logo_path === "string" ? store.logo_path : "";
}

async function buildBrandedImage(input: {
  userId: string;
  image: ProductImageForLogo;
  logoBuffer: Buffer;
  index: number;
  storageClient: SupabaseClient;
  position: LogoPosition;
  logoScalePercent: number;
  marginPercent: number;
  logoOpacityPercent: number;
}) {
  // A URL vem do catalogo importado, ou seja, de uma loja de origem que o
  // usuario escolheu -- nao e endereco nosso. Passa pela trava de SSRF, que
  // resolve o DNS e recusa destino em rede privada ou link-local.
  const imgRes = await safeFetch(input.image.src, {
    signal: AbortSignal.timeout(15000),
  });
  if (!imgRes.ok) {
    throw new Error("Erro ao baixar a imagem do produto.");
  }

  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
  const image = sharp(imgBuffer);
  const metadata = await image.metadata();
  const width = metadata.width || 800;
  const height = metadata.height || 800;

  const logoWidth = Math.max(
    24,
    Math.round(width * (input.logoScalePercent / 100))
  );
  const resizedLogo = await sharp(input.logoBuffer)
    .ensureAlpha()
    .resize({ width: logoWidth, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer();

  const logoWithOpacity = await applyOpacityToLogo(
    resizedLogo,
    input.logoOpacityPercent
  );
  const logoMeta = await sharp(logoWithOpacity).metadata();
  const finalLogoWidth = logoMeta.width || logoWidth;
  const finalLogoHeight = logoMeta.height || Math.round(logoWidth / 3);
  const marginX = Math.round(width * (input.marginPercent / 100));
  const marginY = Math.round(height * (input.marginPercent / 100));
  const coords = getPositionCoordinates(
    input.position,
    width,
    height,
    finalLogoWidth,
    finalLogoHeight,
    marginX,
    marginY
  );
  const top = clamp(coords.top, 0, Math.max(0, height - finalLogoHeight));
  const left = clamp(coords.left, 0, Math.max(0, width - finalLogoWidth));

  const result = await image
    .composite([{ input: logoWithOpacity, top, left }])
    .png()
    .toBuffer();

  const fileName = `${input.userId}/${Date.now()}-${input.index}-${Math.random()
    .toString(36)
    .slice(2, 8)}-branded.png`;
  const { error: uploadError } = await input.storageClient.storage
    .from("product-images")
    .upload(fileName, result, {
      contentType: "image/png",
      upsert: false,
    });

  if (uploadError) {
    throw new Error("Erro ao salvar imagem com logo.");
  }

  const { data: urlData } = input.storageClient.storage
    .from("product-images")
    .getPublicUrl(fileName);

  return {
    src: urlData.publicUrl,
    altText: input.image.altText,
  };
}

export async function applyLogoToProductImages(
  input: ApplyLogoOptions
): Promise<ApplyLogoResult> {
  const sourceImages = input.images.slice(0, input.maxImages || 20);
  if (sourceImages.length === 0) {
    return { images: input.images, appliedCount: 0, warnings: [] };
  }

  await ensureProductImagesBucket(input.storageClient);

  const logoPath = await resolveLogoPath(input);
  if (!logoPath) {
    return {
      images: input.images,
      appliedCount: 0,
      warnings: ["Logo nao configurada para a loja selecionada."],
    };
  }

  const { data: logoData, error: logoError } = await input.storageClient.storage
    .from("store-logos")
    .download(logoPath);

  if (logoError || !logoData) {
    return {
      images: input.images,
      appliedCount: 0,
      warnings: ["Erro ao carregar a logo da loja."],
    };
  }

  const logoBuffer = Buffer.from(await logoData.arrayBuffer());
  const position = VALID_POSITIONS.has(input.position || "bottom-right")
    ? input.position || "bottom-right"
    : "bottom-right";
  const logoScalePercent = clamp(asNumber(input.logoScalePercent, 20), 8, 40);
  const marginPercent = clamp(asNumber(input.marginPercent, 3), 0, 10);
  const logoOpacityPercent = clamp(asNumber(input.logoOpacityPercent, 100), 20, 100);
  const warnings: string[] = [];
  const brandedImages: ProductImageForLogo[] = [];

  for (const [index, image] of sourceImages.entries()) {
    try {
      brandedImages.push(
        await buildBrandedImage({
          userId: input.userId,
          image,
          logoBuffer,
          index,
          storageClient: input.storageClient,
          position,
          logoScalePercent,
          marginPercent,
          logoOpacityPercent,
        })
      );
    } catch (error) {
      warnings.push(
        `${image.src}: ${
          error instanceof Error ? error.message : "Falha ao aplicar logo."
        }`
      );
      brandedImages.push(image);
    }
  }

  return {
    images: [...brandedImages, ...input.images.slice(sourceImages.length)],
    appliedCount: brandedImages.filter(
      (image, index) => image.src !== sourceImages[index]?.src
    ).length,
    warnings,
  };
}
