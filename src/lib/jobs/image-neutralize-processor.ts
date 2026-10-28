import {
  neutralizeProductImage,
  deleteNeutralizedImageByUrl,
} from "@/lib/ai/product-neutralizer";
import {
  replaceProductHeroImage,
  waitForMediaReady,
  type ShopifyCredentials,
} from "@/lib/shopify/client";
import { createAdminClient } from "@/lib/supabase/admin";
import { AI_COST, logAiUsage } from "@/lib/billing/usage";
import { consumeCredits, refundCredits } from "@/lib/billing/credits";
import { FRASE_SEM_FOTOS, erroDoJobDeImagem } from "@/lib/ai/erro-ia-imagem";

export const IMAGE_JOB_TYPE = "neutralize_image";
const MAX_ATTEMPTS = 3;

type CleanupMode = "stock-neutralize" | "external-references";

export interface ImageNeutralizeItem {
  productId: string;
  imageUrl: string;
  title: string;
  mode?: CleanupMode;
  customInstructions?: string;
  targetLanguage?: string;
}

interface ImageJobPayload extends ImageNeutralizeItem {
  attempts?: number;
  step?: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

// Pool de concorrencia simples: roda `worker` em paralelo respeitando o limite.
async function runPool<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>
) {
  let cursor = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        await worker(items[index]);
      }
    }
  );
  await Promise.all(runners);
}

async function loadStoreCredentials(
  supabase: AdminClient,
  userId: string,
  storeId: string
): Promise<{ creds: ShopifyCredentials } | null> {
  const { data: store } = await supabase
    .from("stores")
    .select("shop_domain, client_id, client_secret, access_token")
    .eq("id", storeId)
    .eq("user_id", userId)
    .single();

  if (!store) return null;

  return {
    creds: {
      shopDomain: store.shop_domain,
      clientId: store.client_id,
      clientSecret: store.client_secret,
      accessToken: store.access_token,
    },
  };
}

// Enfileira 1 job de imagem por produto (resumivel: cada produto e uma linha).
export async function enqueueImageNeutralizeJobs(input: {
  userId: string;
  storeId: string;
  items: ImageNeutralizeItem[];
}): Promise<{ queued: number }> {
  const items = input.items.filter((item) => item.productId && item.imageUrl);
  if (items.length === 0) return { queued: 0 };

  const supabase = createAdminClient();
  const rows = items.map((item) => ({
    user_id: input.userId,
    store_id: input.storeId,
    type: IMAGE_JOB_TYPE,
    status: "pending",
    progress: {
      ...item,
      attempts: 0,
      step: "Aguardando",
    } satisfies ImageJobPayload,
  }));

  const { error } = await supabase.from("background_jobs").insert(rows);
  if (error) {
    throw new Error(`Falha ao enfileirar imagens: ${error.message}`);
  }

  return { queued: rows.length };
}

// Dispara (fire-and-forget) um ciclo de drenagem pela rota HTTP, que se
// auto-encadeia ate a fila esvaziar. Usa o cookie da requisicao original para
// autenticar. Independente do cliente manter a janela aberta.
export async function requestImageQueueDrain(input: {
  origin: string;
  cookie: string;
  storeId: string;
  chain?: boolean;
}): Promise<void> {
  try {
    await fetch(`${input.origin}/api/jobs/neutralize-images`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: input.cookie,
      },
      body: JSON.stringify({ storeId: input.storeId, chain: input.chain === true }),
    });
  } catch {
    // fire-and-forget: a fila tambem e retomada na proxima abertura da janela.
  }
}

// Cancela a fila de imagens de uma loja: marca os jobs pendentes como
// "canceled" para o dreno parar (os que ja estao "processing" terminam o lote
// atual e o loop encerra ao nao achar mais pendentes).
export async function cancelImageNeutralizeJobs(input: {
  userId: string;
  storeId: string;
}): Promise<{ canceled: number }> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("background_jobs")
    .update({ status: "canceled" })
    .eq("user_id", input.userId)
    .eq("store_id", input.storeId)
    .eq("type", IMAGE_JOB_TYPE)
    .eq("status", "pending")
    .select("id");
  if (error) return { canceled: 0 };
  return { canceled: (data || []).length };
}

async function countByStatus(
  supabase: AdminClient,
  userId: string,
  storeId: string,
  status: string
) {
  const { count } = await supabase
    .from("background_jobs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("store_id", storeId)
    .eq("type", IMAGE_JOB_TYPE)
    .eq("status", status);
  return count || 0;
}

export interface ImageQueueProgress {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export async function getImageQueueProgress(input: {
  userId: string;
  storeId: string;
}): Promise<ImageQueueProgress> {
  const supabase = createAdminClient();
  const [pending, processing, completed, failed] = await Promise.all([
    countByStatus(supabase, input.userId, input.storeId, "pending"),
    countByStatus(supabase, input.userId, input.storeId, "processing"),
    countByStatus(supabase, input.userId, input.storeId, "completed"),
    countByStatus(supabase, input.userId, input.storeId, "failed"),
  ]);

  return {
    pending,
    processing,
    completed,
    failed,
    total: pending + processing + completed + failed,
  };
}

// Drena a fila de imagens de uma loja: processa lotes em paralelo ate esvaziar
// ou ate estourar o orcamento de tempo (para nao bater no maxDuration da rota).
export async function processImageNeutralizeJobs(input: {
  userId: string;
  storeId: string;
  concurrency?: number;
  timeBudgetMs?: number;
}): Promise<{
  processed: number;
  completed: number;
  failed: number;
  remaining: number;
}> {
  const supabase = createAdminClient();
  const concurrency = Math.min(Math.max(input.concurrency ?? 5, 1), 10);
  const timeBudgetMs = Math.min(
    Math.max(input.timeBudgetMs ?? 240000, 10000),
    280000
  );
  const start = Date.now();

  const summary = { processed: 0, completed: 0, failed: 0, remaining: 0 };

  const loaded = await loadStoreCredentials(supabase, input.userId, input.storeId);
  if (!loaded) {
    summary.remaining = await countByStatus(
      supabase,
      input.userId,
      input.storeId,
      "pending"
    );
    return summary;
  }

  const { creds } = loaded;
  const storageClient = createAdminClient();

  // Recupera jobs orfaos: ficaram marcados "processing" mas a invocacao
  // serverless morreu antes de terminar (sem isso eles nunca mais sao pegos,
  // pois a fila so busca status "pending"). updated_at e atualizado pelo
  // trigger do banco quando o job foi reivindicado.
  const staleCutoff = new Date(Date.now() - 4 * 60 * 1000).toISOString();
  await supabase
    .from("background_jobs")
    .update({ status: "pending" })
    .eq("user_id", input.userId)
    .eq("store_id", input.storeId)
    .eq("type", IMAGE_JOB_TYPE)
    .eq("status", "processing")
    .lt("updated_at", staleCutoff);

  while (Date.now() - start < timeBudgetMs) {
    const { data: batch } = await supabase
      .from("background_jobs")
      .select("id, progress")
      .eq("user_id", input.userId)
      .eq("store_id", input.storeId)
      .eq("type", IMAGE_JOB_TYPE)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(concurrency);

    const jobs = (batch || []) as { id: string; progress: ImageJobPayload }[];
    if (jobs.length === 0) break;

    // Marca o lote como em processamento (claim otimista).
    await supabase
      .from("background_jobs")
      .update({ status: "processing" })
      .in(
        "id",
        jobs.map((job) => job.id)
      );

    await runPool(jobs, concurrency, async (job) => {
      const payload = (job.progress || {}) as ImageJobPayload;
      let creditConsumed = false;
      // A etapa que falhou: so o erro do Gemini passa pela frase da IA fora --
      // o 429 do throttle da Shopify (replaceProductHeroImage) segue cru.
      let naIa = false;
      try {
        // Gating (Fase 5): debita 1 credito ANTES de gastar Gemini. Sem credito,
        // marca o job e nao chama a IA (zero custo). So bloqueia se
        // BILLING_ENFORCED=true; senao sempre passa e nao debita.
        const credit = await consumeCredits(input.userId, 1);
        if (!credit.ok) {
          await supabase
            .from("background_jobs")
            .update({
              status: "failed",
              progress: { ...payload, step: "Sem fotos com IA" },
              error: FRASE_SEM_FOTOS,
            })
            .eq("id", job.id);
          summary.failed += 1;
          return;
        }
        creditConsumed = credit.enforced;

        naIa = true;
        const neutral = await neutralizeProductImage({
          userId: input.userId,
          imageUrl: payload.imageUrl,
          title: payload.title,
          mode: payload.mode || "stock-neutralize",
          customInstructions: payload.customInstructions,
          targetLanguage: payload.targetLanguage,
          storageClient,
        });

        naIa = false;
        const mediaId = await replaceProductHeroImage(creds, payload.productId, {
          src: neutral.src,
          altText: payload.title,
        });

        // Assim que a Shopify terminar de ingerir (READY), a copia vive no CDN
        // dela e o buffer no Supabase nao e mais necessario: apaga na hora para
        // nao acumular Storage. Se nao ficar READY a tempo, deixa o arquivo (a
        // limpeza nao e critica) em vez de arriscar uma imagem quebrada.
        if (mediaId) {
          try {
            const status = await waitForMediaReady(creds, mediaId, {
              timeoutMs: 45000,
            });
            if (status === "READY") {
              await deleteNeutralizedImageByUrl(storageClient, neutral.src);
            }
          } catch {
            // silencioso: melhor deixar o buffer do que quebrar a imagem.
          }
        }

        await supabase
          .from("background_jobs")
          .update({
            status: "completed",
            progress: { ...payload, step: "Concluido" },
            result: { imageUrl: neutral.src },
            error: null,
          })
          .eq("id", job.id);
        summary.completed += 1;

        // Medicao: 1 imagem neutralizada = 1 credito (acao mais cara).
        await logAiUsage({
          userId: input.userId,
          storeId: input.storeId,
          action: "neutralize_image",
          costUsd: AI_COST.image,
          creditsUsed: 1,
          metadata: { productId: payload.productId, mode: payload.mode },
        });
      } catch (error) {
        // Debitou mas a neutralizacao falhou: devolve o credito (so cobra no
        // sucesso). Numa retentativa o credito e debitado de novo.
        if (creditConsumed) await refundCredits(input.userId, 1);
        const attempts = (payload.attempts || 0) + 1;
        // Erro da IA que e nosso (saldo pre-pago do Google, cota): o lojista le
        // a nossa frase, nunca o texto do Google -- e o alerta do operador
        // (alertas/avaliar.ts, ia_imagem_fora_do_ar) conta por ela.
        const cru = error instanceof Error ? error.message : "Falha ao neutralizar imagem.";
        const message = naIa ? erroDoJobDeImagem(cru).texto : cru;
        const exhausted = attempts >= MAX_ATTEMPTS;
        await supabase
          .from("background_jobs")
          .update({
            status: exhausted ? "failed" : "pending",
            progress: {
              ...payload,
              attempts,
              step: exhausted ? "Falhou" : "Vai retentar",
            },
            error: message,
          })
          .eq("id", job.id);
        if (exhausted) summary.failed += 1;
      } finally {
        summary.processed += 1;
      }
    });
  }

  summary.remaining = await countByStatus(
    supabase,
    input.userId,
    input.storeId,
    "pending"
  );
  return summary;
}
