import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarParaMeta,
  proximaTentativaEm,
  MAX_TENTATIVAS,
  type EventoCapi,
} from "@/lib/tracking/meta-capi";

// ============================================================================
// Fila de saida do rastreamento.
//
// O evento nasce 'pendente' no banco ANTES de qualquer chamada de rede. Se o
// envio falhar -- token vencido, limite de taxa, rede -- a linha continua la e
// o cron tenta de novo. Enviar direto e so logar o erro perderia conversao
// exatamente nos momentos em que mais se vende, que e quando o Meta limita.
// ============================================================================

export interface ConfigTracking {
  storeId: string;
  enabled: boolean;
  metaPixelId: string | null;
  metaTestEventCode: string | null;
  googleConversionId: string | null;
  googleConversionLabel: string | null;
}

/**
 * Configuracao + token da loja.
 *
 * O token mora em outra tabela, so acessivel pelo service role: RLS e por
 * LINHA, entao deixar o token na linha que o lojista le entregaria o token
 * junto. Ele compra midia -- vazar e prejuizo direto.
 */
export async function carregarConfig(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string
): Promise<{ config: ConfigTracking; token: string | null } | null> {
  const [{ data: cfg }, { data: seg }] = await Promise.all([
    admin
      .from("tracking_configs")
      .select(
        "store_id, enabled, meta_pixel_id, meta_test_event_code, google_conversion_id, google_conversion_label"
      )
      .eq("store_id", storeId)
      .maybeSingle(),
    admin
      .from("tracking_secrets")
      .select("meta_access_token")
      .eq("store_id", storeId)
      .maybeSingle(),
  ]);

  if (!cfg) return null;
  return {
    config: {
      storeId: cfg.store_id,
      enabled: Boolean(cfg.enabled),
      metaPixelId: cfg.meta_pixel_id,
      metaTestEventCode: cfg.meta_test_event_code,
      googleConversionId: cfg.google_conversion_id,
      googleConversionLabel: cfg.google_conversion_label,
    },
    token: seg?.meta_access_token ?? null,
  };
}

/**
 * Coloca o evento na fila.
 *
 * O indice unico (store_id, destination, event_id) E a trava contra duplicata:
 * reentrega de webhook e retentativa nossa nao podem virar duas conversoes.
 * Colisao devolve `duplicado`, sem erro -- e o caminho normal.
 */
export async function enfileirar(
  admin: ReturnType<typeof createAdminClient>,
  entrada: {
    storeId: string;
    destination: "meta" | "google" | "ga4";
    /** Serve de fonte do nome e da chave de dedupe, iguais para todo destino. */
    evento: EventoCapi;
    orderId?: string | null;
    /** O que vai para a API do destino. Omitido = o proprio evento (Meta). */
    payload?: unknown;
  }
): Promise<{ id: string | null; duplicado: boolean }> {
  const { data, error } = await admin
    .from("tracking_events")
    .insert({
      store_id: entrada.storeId,
      destination: entrada.destination,
      event_name: entrada.evento.event_name,
      event_id: entrada.evento.event_id,
      order_id: entrada.orderId ?? null,
      payload: (entrada.payload ?? entrada.evento) as Record<string, unknown>,
    })
    .select("id")
    .single();

  // 23505 = unique_violation: ja estava na fila.
  if (error?.code === "23505") return { id: null, duplicado: true };
  if (error) throw new Error(`falha ao enfileirar: ${error.message}`);
  return { id: data?.id ?? null, duplicado: false };
}

/**
 * Tenta entregar uma linha da fila e grava o desfecho.
 *
 * Erro permanente (token invalido, parametro errado) vai direto para 'falhou':
 * insistir so queima chamada e esconde o problema atras de uma fila que nunca
 * esvazia. O lojista precisa ver 'falhou' com o motivo.
 */
export async function entregar(
  admin: ReturnType<typeof createAdminClient>,
  linha: {
    id: string;
    store_id: string;
    destination: string;
    payload: unknown;
    attempts: number;
  }
): Promise<{ ok: boolean; motivo?: string }> {
  if (linha.destination === "google") {
    return entregarGoogle(admin, linha);
  }
  if (linha.destination !== "meta") {
    return { ok: false, motivo: "destino ainda nao implementado" };
  }

  const carregado = await carregarConfig(admin, linha.store_id);
  const pixel = carregado?.config.metaPixelId;
  const token = carregado?.token;

  if (!carregado?.config.enabled || !pixel || !token) {
    // Desligado ou sem credencial: nao e falha de rede, nao adianta repetir.
    await admin
      .from("tracking_events")
      .update({
        status: "falhou",
        attempts: linha.attempts + 1,
        last_error: !carregado?.config.enabled
          ? "rastreamento desligado para esta loja"
          : "pixel ou token ausente",
      })
      .eq("id", linha.id);
    return { ok: false, motivo: "sem configuracao" };
  }

  const r = await enviarParaMeta(pixel, token, [linha.payload as EventoCapi], {
    testEventCode: carregado.config.metaTestEventCode,
  });

  const tentativas = linha.attempts + 1;

  if (r.ok) {
    await admin
      .from("tracking_events")
      .update({
        status: "enviado",
        attempts: tentativas,
        sent_at: new Date().toISOString(),
        last_error: null,
        response: (r.corpo ?? null) as Record<string, unknown> | null,
      })
      .eq("id", linha.id);
    return { ok: true };
  }

  const desistir = !r.podeTentarDeNovo || tentativas >= MAX_TENTATIVAS;
  await admin
    .from("tracking_events")
    .update({
      status: desistir ? "falhou" : "pendente",
      attempts: tentativas,
      next_attempt_at: proximaTentativaEm(tentativas).toISOString(),
      last_error: r.erro?.slice(0, 500) ?? "falha desconhecida",
      response: (r.corpo ?? null) as Record<string, unknown> | null,
    })
    .eq("id", linha.id);

  return { ok: false, motivo: r.erro };
}

/**
 * Entrega no Google Ads.
 *
 * O payload guardado na fila e o mesmo evento Purchase do CAPI -- reaproveitar
 * evita montar a venda duas vezes e garante que os dois destinos contam o
 * MESMO valor. Daqui saem so os campos que o endpoint do Google entende.
 *
 * `gclid` e o unico sinal que importa: sem ele a conversao chega mas nao se
 * liga a nenhum anuncio, e o Google Ads nao tem o que otimizar. Por isso a
 * ausencia dele vira aviso na linha, nao falha silenciosa.
 */
async function entregarGoogle(
  admin: ReturnType<typeof createAdminClient>,
  linha: { id: string; store_id: string; payload: unknown; attempts: number }
): Promise<{ ok: boolean; motivo?: string }> {
  const { enviarParaGoogleAds } = await import("@/lib/tracking/google-ads");
  const carregado = await carregarConfig(admin, linha.store_id);
  const cfg = carregado?.config;

  if (!cfg?.enabled || !cfg.googleConversionId || !cfg.googleConversionLabel) {
    await admin
      .from("tracking_events")
      .update({
        status: "falhou",
        attempts: linha.attempts + 1,
        last_error: !cfg?.enabled
          ? "rastreamento desligado para esta loja"
          : "conversion id ou label do Google ausente",
      })
      .eq("id", linha.id);
    return { ok: false, motivo: "sem configuracao" };
  }

  const conv = linha.payload as {
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    orderId?: string;
    value?: number;
    currency?: string;
  };
  // Qualquer um dos tres serve de atribuicao; nenhum significa conversao
  // orfa, que o Google conta mas nao liga a anuncio nenhum.
  const temClique = conv.gclid || conv.gbraid || conv.wbraid || null;

  const r = await enviarParaGoogleAds({
    conversionId: cfg.googleConversionId,
    label: cfg.googleConversionLabel,
    gclid: conv.gclid,
    gbraid: conv.gbraid,
    wbraid: conv.wbraid,
    orderId: conv.orderId,
    value: conv.value,
    currency: conv.currency,
  });

  const tentativas = linha.attempts + 1;

  if (r.ok) {
    await admin
      .from("tracking_events")
      .update({
        status: "enviado",
        attempts: tentativas,
        sent_at: new Date().toISOString(),
        // "enviado" aqui e "o Google aceitou a requisicao". O endpoint
        // responde 200 mesmo ignorando o conteudo -- a confirmacao de verdade
        // so existe na tela do Google Ads. Guardar a URL permite repetir a
        // chamada na mao para investigar.
        last_error: temClique
          ? null
          : "sem gclid/gbraid/wbraid: conversao sem atribuicao a anuncio",
        response: { url: r.url, status: r.status } as Record<string, unknown>,
      })
      .eq("id", linha.id);
    return { ok: true };
  }

  const desistir = !r.podeTentarDeNovo || tentativas >= MAX_TENTATIVAS;
  await admin
    .from("tracking_events")
    .update({
      status: desistir ? "falhou" : "pendente",
      attempts: tentativas,
      next_attempt_at: proximaTentativaEm(tentativas).toISOString(),
      last_error: r.erro?.slice(0, 500) ?? "falha desconhecida",
      response: { url: r.url, status: r.status } as Record<string, unknown>,
    })
    .eq("id", linha.id);
  return { ok: false, motivo: r.erro };
}

/** Uma passada da fila. Chamado pelo cron. */
export async function drenarFila(limite = 50): Promise<{
  pegos: number;
  enviados: number;
  falharam: number;
}> {
  const admin = createAdminClient();
  const { data: linhas } = await admin
    .from("tracking_events")
    .select("id, store_id, destination, payload, attempts")
    .eq("status", "pendente")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limite);

  let enviados = 0;
  let falharam = 0;
  for (const linha of linhas || []) {
    const r = await entregar(admin, linha);
    if (r.ok) enviados += 1;
    else falharam += 1;
  }
  return { pegos: (linhas || []).length, enviados, falharam };
}
