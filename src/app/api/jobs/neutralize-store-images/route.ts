import { NextRequest, NextResponse } from "next/server";
import { getProducts, type ShopifyCredentials } from "@/lib/shopify/client";
import { createClient } from "@/lib/supabase/server";
import {
  cancelImageNeutralizeJobs,
  enqueueImageNeutralizeJobs,
  getImageQueueProgress,
  requestImageQueueDrain,
  type ImageNeutralizeItem,
} from "@/lib/jobs/image-neutralize-processor";
import { billingEnforced, getCreditBalance } from "@/lib/billing/credits";

export const runtime = "nodejs";
export const maxDuration = 120;

interface StoreProduct {
  id: string;
  title: string;
  images?: { nodes?: { url: string }[] };
}

// Detecta imagens que ja foram neutralizadas por nos (ficam no bucket
// product-images do Supabase), para nao reprocessar e gastar a toa.
function isAlreadyNeutralized(url: string) {
  return url.includes("/product-images/");
}

async function getStore(storeId: string, userId: string) {
  const supabase = await createClient();
  const { data: store } = await supabase
    .from("stores")
    .select("*")
    .eq("id", storeId)
    .eq("user_id", userId)
    .single();
  return store;
}

// GET ?storeId= -> progresso da fila (reaproveita o contador da fila de imagens).
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const storeId = request.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId obrigatorio." }, { status: 400 });
  }
  const progress = await getImageQueueProgress({ userId: user.id, storeId });
  return NextResponse.json({ progress });
}

// DELETE ?storeId= -> cancela a fila (marca pendentes como cancelados).
export async function DELETE(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const storeId = request.nextUrl.searchParams.get("storeId");
  if (!storeId) {
    return NextResponse.json({ error: "storeId obrigatorio." }, { status: 400 });
  }
  const { canceled } = await cancelImageNeutralizeJobs({
    userId: user.id,
    storeId,
  });
  const progress = await getImageQueueProgress({ userId: user.id, storeId });
  return NextResponse.json({ canceled, progress });
}

// POST { storeId, mode?, customInstructions? } -> enfileira a troca da foto
// principal de TODOS os produtos da loja e dispara o dreno auto-encadeavel.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const storeId = typeof body.storeId === "string" ? body.storeId : "";
  const mode =
    body.mode === "external-references" ? "external-references" : "stock-neutralize";
  const customInstructions =
    typeof body.customInstructions === "string"
      ? body.customInstructions.trim().slice(0, 1200)
      : "";
  const includeProcessed = body.includeProcessed === true;
  // dryRun: so calcula quantas imagens seriam trocadas (pra UI mostrar a
  // estimativa de creditos antes do clique), sem enfileirar nada.
  const dryRun = body.dryRun === true;

  if (!storeId) {
    return NextResponse.json({ error: "Selecione a loja." }, { status: 400 });
  }

  const store = await getStore(storeId, user.id);
  if (!store) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  const creds: ShopifyCredentials = {
    shopDomain: store.shop_domain,
    clientId: store.client_id,
    clientSecret: store.client_secret,
    accessToken: store.access_token,
  };
  const targetLanguage = store.target_language || "pt-BR";

  try {
    // Pagina todos os produtos da loja coletando a foto principal de cada um.
    const items: ImageNeutralizeItem[] = [];
    let after: string | null = null;
    let totalProducts = 0;
    let alreadyClean = 0;
    for (let page = 0; page < 60; page += 1) {
      const data = await getProducts(creds, { first: 250, after });
      const nodes = (data?.products?.nodes || []) as StoreProduct[];
      for (const product of nodes) {
        totalProducts += 1;
        const heroUrl = product.images?.nodes?.[0]?.url;
        if (!heroUrl) continue;
        if (!includeProcessed && isAlreadyNeutralized(heroUrl)) {
          alreadyClean += 1;
          continue;
        }
        items.push({
          productId: product.id,
          imageUrl: heroUrl,
          title: product.title,
          mode,
          customInstructions,
          targetLanguage,
        });
      }
      const pageInfo = data?.products?.pageInfo;
      if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
      after = pageInfo.endCursor;
    }

    if (items.length === 0) {
      return NextResponse.json({
        queued: 0,
        totalProducts,
        alreadyClean,
        estimatedCredits: 0,
        message:
          alreadyClean > 0
            ? "Todas as imagens ja foram trocadas."
            : "Nenhum produto com imagem encontrado.",
      });
    }

    const enforced = billingEnforced();
    const balance = enforced ? await getCreditBalance(user.id) : null;

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalProducts,
        alreadyClean,
        estimatedCredits: items.length,
        billingEnforced: enforced,
        creditBalance: balance,
      });
    }

    // Gating (Fase 5): quando a cobranca esta ligada, so enfileira ate o saldo
    // de creditos (1 imagem = 1 credito). Evita criar milhares de jobs que
    // falhariam por falta de credito; informa quantos ficaram de fora.
    let creditsShort = 0;
    let queueItems = items;
    if (enforced && balance !== null && items.length > balance) {
      creditsShort = items.length - balance;
      queueItems = items.slice(0, Math.max(0, balance));
    }

    if (queueItems.length === 0) {
      return NextResponse.json({
        queued: 0,
        totalProducts,
        alreadyClean,
        creditsShort,
        message: "Faltam fotos com IA para trocar as imagens. Compre mais em Assinatura.",
      });
    }

    const { queued } = await enqueueImageNeutralizeJobs({
      userId: user.id,
      storeId,
      items: queueItems,
    });

    const origin = request.nextUrl.origin;
    const cookie = request.headers.get("cookie") || "";
    // Dispara o dreno auto-encadeavel (drena ate esvaziar, sem depender do
    // cliente manter a janela aberta).
    await requestImageQueueDrain({ origin, cookie, storeId });

    return NextResponse.json({ queued, totalProducts, alreadyClean, creditsShort });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao enfileirar imagens.",
      },
      { status: 500 }
    );
  }
}
