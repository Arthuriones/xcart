import { NextRequest, NextResponse } from "next/server";
import { safeFetch, UnsafeUrlError } from "@/lib/net/safe-url";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

type LogoPosition =
  | "top-left"
  | "top-center"
  | "top-right"
  | "center-left"
  | "center"
  | "center-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-right";

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

function asNumber(value: unknown, fallback: number): number {
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

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
      const admin = createAdminClient();
      const { data: buckets } = await admin.storage.listBuckets();
      const hasProductImages = (buckets || []).some(
        (bucket) => bucket.name === "product-images"
      );
      if (!hasProductImages) {
        await admin.storage.createBucket("product-images", { public: true });
      }
    } catch {
      // segue o fluxo; o upload vai falhar com erro explicito se o bucket realmente nao existir
    }

    const body = await request.json();
    const imageUrl = typeof body.imageUrl === "string" ? body.imageUrl : "";
    const storeId = typeof body.storeId === "string" ? body.storeId : "";
    const positionInput = typeof body.position === "string" ? body.position : "";
    const logoScalePercent = clamp(asNumber(body.logoScalePercent, 20), 8, 40);
    const marginPercent = clamp(asNumber(body.marginPercent, 3), 0, 10);
    const logoOpacityPercent = clamp(asNumber(body.logoOpacityPercent, 100), 20, 100);
    const customLogoPath = typeof body.logoPath === "string" ? body.logoPath.trim() : "";

    if (!imageUrl || !storeId) {
      return NextResponse.json(
        { error: "imageUrl e storeId sao obrigatorios." },
        { status: 400 }
      );
    }

    const position: LogoPosition = VALID_POSITIONS.has(positionInput as LogoPosition)
      ? (positionInput as LogoPosition)
      : "bottom-right";

    // Determine which logo to use: custom per-image or store default
    let logoPathToUse = customLogoPath;
    if (!logoPathToUse) {
      const { data: store } = await supabase
        .from("stores")
        .select("logo_path")
        .eq("id", storeId)
        .eq("user_id", user.id)
        .single();

      if (!store?.logo_path) {
        return NextResponse.json(
          { error: "Logo nao configurada. Configure a loja primeiro." },
          { status: 400 }
        );
      }
      logoPathToUse = store.logo_path;
    }

    const { data: logoData, error: logoError } = await supabase.storage
      .from("store-logos")
      .download(logoPathToUse);

    if (logoError || !logoData) {
      return NextResponse.json(
        { error: "Erro ao carregar a logo da loja." },
        { status: 500 }
      );
    }

    const logoBuffer = Buffer.from(await logoData.arrayBuffer());

    // imageUrl vem crua do corpo do POST -- mesmo buraco de /api/image/generate.
    // safeFetch resolve o DNS e revalida cada redirect.
    let imgRes: Response;
    try {
      imgRes = await safeFetch(String(imageUrl), { signal: AbortSignal.timeout(15000) });
    } catch (e) {
      if (e instanceof UnsafeUrlError) {
        return NextResponse.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    if (!imgRes.ok) {
      return NextResponse.json(
        { error: "Erro ao baixar a imagem do produto." },
        { status: 400 }
      );
    }

    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    const image = sharp(imgBuffer);
    const metadata = await image.metadata();
    const width = metadata.width || 800;
    const height = metadata.height || 800;

    const logoWidth = Math.max(24, Math.round(width * (logoScalePercent / 100)));
    const resizedLogo = await sharp(logoBuffer)
      .ensureAlpha()
      .resize({ width: logoWidth, fit: "inside", withoutEnlargement: true })
      .png()
      .toBuffer();

    const logoWithOpacity = await applyOpacityToLogo(resizedLogo, logoOpacityPercent);
    const logoMeta = await sharp(logoWithOpacity).metadata();
    const finalLogoWidth = logoMeta.width || logoWidth;
    const finalLogoHeight = logoMeta.height || Math.round(logoWidth / 3);

    const marginX = Math.round(width * (marginPercent / 100));
    const marginY = Math.round(height * (marginPercent / 100));
    const coords = getPositionCoordinates(
      position,
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
      .composite([
        {
          input: logoWithOpacity,
          top,
          left,
        },
      ])
      .png()
      .toBuffer();

    const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-branded.png`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(fileName, result, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      return NextResponse.json({ error: "Erro ao salvar imagem." }, { status: 500 });
    }

    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);

    return NextResponse.json({ url: urlData.publicUrl });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Erro ao gerar imagem";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
