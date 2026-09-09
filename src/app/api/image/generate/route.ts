import { NextRequest, NextResponse } from "next/server";
import { GoogleGenAI } from "@google/genai";
import sharp from "sharp";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Mesma razao de product-neutralizer: a chave e lida na chamada, nao no
// import, para o cliente nunca nascer com a chave vazia.
let aiCache: GoogleGenAI | null = null;

function clienteIA() {
  if (!aiCache) {
    const chave = process.env.GEMINI_API_KEY;
    if (!chave) throw new Error("GEMINI_API_KEY ausente: nao da para gerar imagem.");
    aiCache = new GoogleGenAI({ apiKey: chave });
  }
  return aiCache;
}

async function toJpegBase64(buffer: Buffer, maxSize: number = 1200) {
  const optimized = await sharp(buffer)
    .resize({ width: maxSize, height: maxSize, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();
  return optimized.toString("base64");
}

async function loadStoreReferenceImages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  storeId: string
): Promise<string[]> {
  try {
    const { data: assets } = await supabase
      .from("store_assets")
      .select("file_path")
      .eq("store_id", storeId)
      .order("created_at", { ascending: false })
      .limit(4);

    if (!assets?.length) return [];

    const references: string[] = [];
    for (const asset of assets) {
      const { data: assetData, error } = await supabase.storage
        .from("store-assets")
        .download(asset.file_path);
      if (error || !assetData) continue;

      const buffer = Buffer.from(await assetData.arrayBuffer());
      references.push(await toJpegBase64(buffer, 1024));
    }

    return references;
  } catch {
    return [];
  }
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
      const existing = new Set((buckets || []).map((bucket) => bucket.name));
      if (!existing.has("store-assets")) {
        await admin.storage.createBucket("store-assets", { public: true });
      }
      if (!existing.has("store-logos")) {
        await admin.storage.createBucket("store-logos", { public: true });
      }
      if (!existing.has("product-images")) {
        await admin.storage.createBucket("product-images", { public: true });
      }
    } catch {
      // segue o fluxo normal; falhas de bucket serao retornadas no upload/download
    }

    const { imageUrl, productTitle, storeId } = await request.json();

    if (!imageUrl || !productTitle) {
      return NextResponse.json(
        { error: "imageUrl e productTitle obrigatórios" },
        { status: 400 }
      );
    }

    // Buscar logo da loja e materiais de referencia (opcional)
    let logoBuffer: Buffer | null = null;
    let referenceImages: string[] = [];
    if (storeId) {
      const { data: store } = await supabase
        .from("stores")
        .select("logo_path")
        .eq("id", storeId)
        .eq("user_id", user.id)
        .single();

      if (store?.logo_path) {
        const { data: logoData } = await supabase.storage
          .from("store-logos")
          .download(store.logo_path);
        if (logoData) {
          logoBuffer = Buffer.from(await logoData.arrayBuffer());
        }
      }

      referenceImages = await loadStoreReferenceImages(supabase, storeId);
    }

    // Baixar imagem original da origem importada
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!imgRes.ok) {
      return NextResponse.json({ error: "Erro ao baixar imagem original" }, { status: 400 });
    }
    const originalBuffer = Buffer.from(await imgRes.arrayBuffer());
    const originalBase64 = await toJpegBase64(originalBuffer);

    // Gerar imagem limpa com Gemini (visão + geração)
    const prompt = `You are a professional e-commerce product photographer and art director.

Look at this product image and recreate it as a clean, professional product photo.
${referenceImages.length > 0 ? "Also use the provided brand reference images to match visual style." : ""}

Product: "${productTitle}"

REQUIREMENTS:
- Remove ALL logos, watermarks, text overlays, and branding from AliExpress or any other marketplace
- Remove any Chinese text or characters
- Keep the EXACT same product, angle, and composition
- Use a clean white or light gradient background
- Professional studio lighting
- High quality, sharp details
- E-commerce ready (square aspect ratio)
- Keep the product shape and key details exactly recognizable
- If brand references are provided: match their palette, vibe, composition style, and premium feel
- DO NOT add any text, logos, or watermarks to the new image
- Make it look like a premium brand product photo

Generate the clean product image.`;

    const parts: Array<
      | { text: string }
      | { inlineData: { mimeType: string; data: string } }
    > = [
      { text: "Original product image to recreate:" },
      {
        inlineData: {
          mimeType: "image/jpeg",
          data: originalBase64,
        },
      },
    ];

    if (referenceImages.length > 0) {
      referenceImages.forEach((imgBase64, index) => {
        parts.push({ text: `Brand reference image ${index + 1}:` });
        parts.push({
          inlineData: {
            mimeType: "image/jpeg",
            data: imgBase64,
          },
        });
      });
    }

    parts.push({ text: prompt });

    const response = await clienteIA().models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: [
        {
          role: "user",
          parts,
        },
      ],
      config: {
        responseModalities: ["IMAGE", "TEXT"],
      },
    });

    // Extrair imagem gerada da resposta
    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      return NextResponse.json(
        { error: "IA não retornou imagem. Tente novamente." },
        { status: 500 }
      );
    }

    const imagePart = (candidate.content.parts as Array<{
      inlineData?: { data?: string };
    }>).find((part) => part.inlineData);
    if (!imagePart?.inlineData?.data) {
      return NextResponse.json(
        { error: "IA não gerou imagem. Tente novamente." },
        { status: 500 }
      );
    }

    const generatedBuffer = Buffer.from(imagePart.inlineData.data as string, "base64");

    // Aplicar logo da loja se disponível
    let finalBuffer: Buffer;
    if (logoBuffer) {
      const metadata = await sharp(generatedBuffer).metadata();
      const width = metadata.width || 800;
      const height = metadata.height || 800;

      const logoWidth = Math.round(width * 0.18);
      const resizedLogo = await sharp(logoBuffer).resize(logoWidth).png().toBuffer();
      const logoMeta = await sharp(resizedLogo).metadata();
      const logoH = logoMeta.height || 40;
      const padding = Math.round(width * 0.03);

      finalBuffer = await sharp(generatedBuffer)
        .composite([
          {
            input: resizedLogo,
            top: height - logoH - padding,
            left: width - logoWidth - padding,
          },
        ])
        .png()
        .toBuffer();
    } else {
      finalBuffer = generatedBuffer;
    }

    // Upload para Supabase Storage (URL permanente para Shopify)
    const fileName = `${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.png`;
    const { error: uploadError } = await supabase.storage
      .from("product-images")
      .upload(fileName, finalBuffer, {
        contentType: "image/png",
        upsert: false,
      });

    if (uploadError) {
      console.error("[image/generate] Upload error:", uploadError);
      return NextResponse.json(
        { error: "Erro ao salvar imagem gerada" },
        { status: 500 }
      );
    }

    const { data: urlData } = supabase.storage
      .from("product-images")
      .getPublicUrl(fileName);

    return NextResponse.json({ url: urlData.publicUrl });
  } catch (error) {
    console.error("[image/generate] Error:", error);
    const message = error instanceof Error ? error.message : "Erro ao gerar imagem";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
