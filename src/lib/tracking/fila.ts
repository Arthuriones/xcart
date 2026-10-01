import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarParaMeta,
  proximaTentativaEm,
  MAX_TENTATIVAS,
  type EventoCapi,
} from "@/lib/tracking/meta-capi";
import { rotuloDoEvento, type MapaDeRotulos } from "@/lib/tracking/eventos";

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
  /** LEGADO: rotulo da compra de antes do mapa. Lido so como fallback. */
  googleConversionLabel: string | null;
  /** Rotulo por evento. Evento ausente = o lojista nao pediu esse evento. */
  googleLabels: MapaDeRotulos | null;
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
        "store_id, enabled, meta_pixel_id, meta_test_event_code, google_conversion_id, google_conversion_label, google_labels"
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
      googleLabels: (cfg.google_labels as MapaDeRotulos | null) ?? null,
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
    /** Qual conta. Entra na chave de dedupe junto com store_id e event_id. */
    destinationId?: string | null;
    /**
     * Serve de fonte do nome e da chave de dedupe, iguais para todo destino.
     *
     * Só estes dois campos, e não `EventoCapi` inteiro: o evento de funil que
     * vem do navegador não tem user_data nem custom_data para preencher, e
     * exigir o tipo completo obrigaria o coletor a inventar campos.
     */
    evento: { event_name: string; event_id: string };
    orderId?: string | null;
    /** Só nos eventos de navegador. Alimenta o teto de abuso do coletor. */
    visitorId?: string | null;
    /** De onde a sessao veio. So diagnostico -- nao vai para destino nenhum. */
    referrer?: string | null;
    /** Token do checkout da Shopify, nos eventos que o Web Pixel manda. */
    checkoutToken?: string | null;
    /** O que vai para a API do destino. Omitido = o proprio evento (Meta). */
    payload?: unknown;
  }
): Promise<{ id: string | null; duplicado: boolean }> {
  const { data, error } = await admin
    .from("tracking_events")
    .insert({
      store_id: entrada.storeId,
      destination: entrada.destination,
      destination_id: entrada.destinationId ?? null,
      event_name: entrada.evento.event_name,
      event_id: entrada.evento.event_id,
      order_id: entrada.orderId ?? null,
      visitor_id: entrada.visitorId ?? null,
      referrer: entrada.referrer ?? null,
      checkout_token: entrada.checkoutToken ?? null,
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
/**
 * Tenta entregar uma linha da fila e grava o desfecho.
 *
 * Dirigido por DESTINO, nao por plataforma. A loja pode ter cinco contas Google
 * e dois pixels Meta, e cada linha da fila sabe de qual delas e -- o
 * `destination_id` tambem entra na chave de deduplicacao, senao dois destinos
 * da mesma plataforma colidiriam e o segundo sumiria como "duplicado".
 *
 * Todo destino ativo recebe todo evento que ele aceita. No Google isso e
 * seguro mesmo com varias contas: conversao cujo gclid nao pertence a conta e
 * DESCARTADA por ele, nao contada sem atribuicao. Entao a conta dona do clique
 * conta e as outras ignoram -- nao ha inflacao a evitar com roteamento.
 *
 * Erro permanente (token invalido, rotulo ausente) vai direto para 'falhou':
 * insistir so queima chamada e esconde o problema atras de uma fila que nunca
 * esvazia. O lojista precisa ver 'falhou' com o motivo.
 */
export async function entregar(
  admin: ReturnType<typeof createAdminClient>,
  linha: {
    id: string;
    store_id: string;
    destination: string;
    destination_id?: string | null;
    /** Decide QUAL rotulo usar: um por conversion action no Google. */
    event_name: string;
    payload: unknown;
    attempts: number;
  }
): Promise<{ ok: boolean; motivo?: string }> {
  const tentativas = linha.attempts + 1;

  const desistir = async (motivo: string) => {
    await admin
      .from("tracking_events")
      .update({ status: "falhou", attempts: tentativas, last_error: motivo })
      .eq("id", linha.id);
    return { ok: false, motivo };
  };

  if (!linha.destination_id) {
    // Linha de antes da migration 043. Nao ha como saber para QUAL conta ela
    // ia; reentregar chutando mandaria conversao para a conta errada.
    return desistir("linha sem destino: anterior aos destinos por conta");
  }

  const { destinoPorId, destinoAceita, porQueRecusa } = await import(
    "@/lib/tracking/destinos"
  );
  const destino = await destinoPorId(admin, linha.destination_id);
  if (!destino) return desistir("destino removido");

  // O interruptor da loja continua valendo por cima dos destinos.
  const carregado = await carregarConfig(admin, linha.store_id);
  if (!carregado?.config.enabled) {
    return desistir("rastreamento desligado para esta loja");
  }

  if (!destinoAceita(destino, linha.event_name)) {
    return desistir(porQueRecusa(destino, linha.event_name) || "destino nao aceita");
  }

  const gravarSucesso = async (
    resposta: Record<string, unknown> | null,
    aviso?: string | null
  ) => {
    await admin
      .from("tracking_events")
      .update({
        status: "enviado",
        attempts: tentativas,
        sent_at: new Date().toISOString(),
        last_error: aviso ?? null,
        response: resposta,
      })
      .eq("id", linha.id);
    return { ok: true };
  };

  const gravarFalha = async (
    erro: string,
    podeTentarDeNovo: boolean,
    resposta: Record<string, unknown> | null
  ) => {
    const acabou = !podeTentarDeNovo || tentativas >= MAX_TENTATIVAS;
    await admin
      .from("tracking_events")
      .update({
        status: acabou ? "falhou" : "pendente",
        attempts: tentativas,
        next_attempt_at: proximaTentativaEm(tentativas).toISOString(),
        last_error: erro.slice(0, 500),
        response: resposta,
      })
      .eq("id", linha.id);
    return { ok: false, motivo: erro };
  };

  // ---- Meta ---------------------------------------------------------------
  if (destino.plataforma === "meta") {
    const r = await enviarParaMeta(
      destino.conta,
      destino.token!,
      [linha.payload as EventoCapi],
      { testEventCode: destino.testEventCode }
    );
    return r.ok
      ? gravarSucesso((r.corpo ?? null) as Record<string, unknown> | null)
      : gravarFalha(
          r.erro ?? "falha desconhecida",
          r.podeTentarDeNovo,
          (r.corpo ?? null) as Record<string, unknown> | null
        );
  }

  // ---- Google -------------------------------------------------------------
  const { enviarParaGoogleAds } = await import("@/lib/tracking/google-ads");
  const conv = linha.payload as {
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    auid?: string | null;
    pageUrl?: string | null;
    orderId?: string;
    value?: number;
    currency?: string;
  };

  // Qualquer um dos tres serve de atribuicao; nenhum significa conversao que o
  // Google nao tem como ligar a anuncio.
  const temClique = conv.gclid || conv.gbraid || conv.wbraid || null;

  const r = await enviarParaGoogleAds({
    conversionId: destino.conta,
    label: rotuloDoEvento(destino.labels, linha.event_name)!,
    gclid: conv.gclid,
    gbraid: conv.gbraid,
    wbraid: conv.wbraid,
    auid: conv.auid,
    pageUrl: conv.pageUrl,
    orderId: conv.orderId,
    value: conv.value,
    currency: conv.currency,
  });

  const resposta = { url: r.url, status: r.status } as Record<string, unknown>;

  // "enviado" aqui e "o Google aceitou a requisicao". O endpoint responde 200
  // mesmo ignorando -- a confirmacao de verdade so existe na tela do Google
  // Ads. Guardar a URL permite repetir a chamada na mao para investigar.
  return r.ok
    ? gravarSucesso(
        resposta,
        temClique ? null : "sem gclid/gbraid/wbraid: conversao sem atribuicao a anuncio"
      )
    : gravarFalha(r.erro ?? "falha desconhecida", r.podeTentarDeNovo, resposta);
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
    .select("id, store_id, destination, destination_id, event_name, payload, attempts")
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
