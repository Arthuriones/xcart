import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  enviarParaMeta,
  proximaTentativaEm,
  MAX_TENTATIVAS,
  type EventoCapi,
} from "@/lib/tracking/meta-capi";
import type { Destino } from "@/lib/tracking/destinos";
import { PREFIXO_CHECKOUT_EXPRESSO } from "@/lib/tracking/eventos";

// ============================================================================
// Fila de saida do rastreamento.
//
// O evento nasce 'pendente' no banco ANTES de qualquer chamada de rede. Se o
// envio falhar -- token vencido, limite de taxa, rede -- a linha continua la e
// o cron tenta de novo. Enviar direto e so logar o erro perderia conversao
// exatamente nos momentos em que mais se vende, que e quando o Meta limita.
//
// SO O META PASSA POR AQUI. O Google Ads sai do NAVEGADOR, pela tag do Google
// (gtag.js), no snippet do tema e no Web Pixel do checkout -- ver
// /api/tracking/google-config. Nada entra na fila para destination 'google'.
// ============================================================================

/**
 * O interruptor da loja.
 *
 * Isto e tudo o que sobrou de `tracking_configs` para o caminho de envio: pixel,
 * conta, rotulo e token viraram LINHA em `tracking_destinations` na migration
 * 043, porque a loja pode ter cinco contas de Google e dois pixels Meta. Quem
 * resolve destino e `src/lib/tracking/destinos.ts`.
 *
 * O interruptor continua valendo por cima de todos eles: desligar a loja para o
 * envio sem precisar desativar destino por destino.
 */
export async function rastreamentoLigado(
  admin: ReturnType<typeof createAdminClient>,
  storeId: string
): Promise<boolean> {
  const { data, error } = await admin
    .from("tracking_configs")
    .select("enabled")
    .eq("store_id", storeId)
    .maybeSingle();
  // Erro de banco NAO e "desligado". Tratar como desligado fazia o webhook
  // responder 200 'rastreamento desligado' num soluco do Supabase -- e com 200
  // a Shopify nao reentrega, entao a compra sumia de vez.
  if (error) throw new Error(`falha ao ler o interruptor da loja: ${error.message}`);
  return Boolean(data?.enabled);
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
    /** So o Meta. O Google vai pelo navegador (gtag.js), fora da fila. */
    destination: "meta";
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
    /**
     * Quando o cron pode mandar. Omitido = ja (o default da coluna). So o
     * checkout expresso adia: ver ATRASO_CHECKOUT_EXPRESSO_MS.
     */
    proximaTentativaEm?: Date | null;
    /**
     * O clientId da Shopify, para o pixel achar a linha e cancelar. So na do
     * checkout expresso (migration 057): fora dela a coluna nem vai no INSERT.
     */
    shopifyClientId?: string | null;
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
      ...(entrada.proximaTentativaEm
        ? { next_attempt_at: entrada.proximaTentativaEm.toISOString() }
        : {}),
      ...(entrada.shopifyClientId ? { shopify_client_id: entrada.shopifyClientId } : {}),
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
 * Dirigido por DESTINO. A loja pode ter dois pixels Meta, e cada linha da fila
 * sabe de qual deles e -- o `destination_id` tambem entra na chave de
 * deduplicacao, senao dois destinos colidiriam e o segundo sumiria como
 * "duplicado".
 *
 * Linha 'google' que ainda esteja na fila (de antes de o Google ir para o
 * navegador) fecha como 'falhou' com o motivo, sem sair: o alerta de compra
 * perdida (R3) so olha o Meta.
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
    event_name: string;
    /** O id do evento. So o drain manda; sem ele vale o do payload. */
    event_id?: string | null;
    payload: unknown;
    attempts: number;
  },
  /**
   * O que o chamador JA carregou.
   *
   * Existe por escala, nao por elegancia. O caminho quente -- o coletor, que
   * roda em todo pageview de toda loja -- ja leu o destino (com token) e o
   * interruptor da loja antes de chegar aqui. Sem isto, `entregar` relia os
   * dois: mais TRES idas ao banco por destino, em cima de um pageview que ja
   * fazia dezessete.
   *
   * O cron continua chamando sem nada: la so existe o id da linha, e reler e
   * justamente o certo -- a configuracao pode ter mudado desde que o evento
   * entrou na fila.
   */
  jaCarregado?: {
    destino?: Destino | null;
    lojaLigada?: boolean;
  }
): Promise<{ ok: boolean; motivo?: string }> {
  const tentativas = linha.attempts + 1;

  // Todo desfecho grava SO sobre linha ainda 'pendente'. O coletor fecha o
  // checkout expresso cancelado ('enviado' sem sent_at) a qualquer momento,
  // inclusive enquanto esta linha esta no meio do envio; sem o filtro, o
  // sucesso gravava por cima e a falha retentavel a devolvia a 'pendente' --
  // e o cron a mandava na rodada seguinte.
  const desistir = async (motivo: string) => {
    await admin
      .from("tracking_events")
      .update({ status: "falhou", attempts: tentativas, last_error: motivo })
      .eq("id", linha.id)
      .eq("status", "pendente");
    return { ok: false, motivo };
  };

  if (linha.destination !== "meta") {
    return desistir("o Google vai pelo navegador (tag do Google), não pelo servidor");
  }

  if (!linha.destination_id) {
    // Linha de antes da migration 043. Nao ha como saber para QUAL conta ela
    // ia; reentregar chutando mandaria conversao para a conta errada.
    return desistir("linha sem destino: anterior aos destinos por conta");
  }

  const { destinoPorId, destinoAceita, porQueRecusa } = await import(
    "@/lib/tracking/destinos"
  );
  const destino =
    jaCarregado?.destino ?? (await destinoPorId(admin, linha.destination_id));
  if (!destino) return desistir("destino removido");

  // O interruptor da loja continua valendo por cima dos destinos.
  const ligada =
    jaCarregado?.lojaLigada ?? (await rastreamentoLigado(admin, linha.store_id));
  if (!ligada) {
    return desistir("rastreamento desligado para esta loja");
  }

  if (!destinoAceita(destino)) {
    return desistir(porQueRecusa(destino) || "destino nao aceita");
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
      .eq("id", linha.id)
      .eq("status", "pendente");
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
      .eq("id", linha.id)
      .eq("status", "pendente");
    return { ok: false, motivo: erro };
  };

  // O checkout expresso pode ter sido cancelado DEPOIS de o drain ler a fila: a
  // rodada leva ate 50 linhas e 2 minutos, sem marcar o que pegou. Rele o
  // status logo antes de mandar. So nele: e a unica linha que alguem fecha de
  // fora, e reler toda linha seria uma ida ao banco a mais por evento.
  const eventId =
    linha.event_id ?? (linha.payload as { event_id?: unknown } | null)?.event_id;
  if (typeof eventId === "string" && eventId.startsWith(PREFIXO_CHECKOUT_EXPRESSO)) {
    const { data: atual, error } = await admin
      .from("tracking_events")
      .select("status")
      .eq("id", linha.id)
      .maybeSingle();
    // Sem conseguir reler, nao manda: a linha segue pendente e volta na
    // proxima rodada. Mandar no escuro era o IC dobrado que isto evita.
    if (error) return { ok: false, motivo: `falha ao reler o expresso: ${error.message}` };
    if (atual?.status !== "pendente") {
      return { ok: false, motivo: "expresso cancelado antes do envio" };
    }
  }

  // ---- Meta ---------------------------------------------------------------
  const r = await enviarParaMeta(
    destino.conta,
    destino.token!,
    [linha.payload as EventoCapi],
    { testEventCode: destino.testEventCode }
  );
  // Aviso para quem le a linha. A TELA nao depende dele: a RPC conta o sem
  // clique pelo payload (migration 051), entao reescrever esta frase nao
  // muda contagem nenhuma.
  const semClique = !(linha.payload as EventoCapi)?.user_data?.fbc;
  return r.ok
    ? gravarSucesso(
        (r.corpo ?? null) as Record<string, unknown> | null,
        // Sem fbc o Meta ainda casa por _fbp, IP, user agent e e-mail: o
        // que falta e so o clique no anuncio dele.
        semClique ? "sem fbc: nao veio de clique em anuncio do Meta" : null
      )
    : gravarFalha(
        r.erro ?? "falha desconhecida",
        r.podeTentarDeNovo,
        (r.corpo ?? null) as Record<string, unknown> | null
      );
}

/**
 * Uma passada da fila. Chamado pelo cron.
 *
 * So 'pendente' com next_attempt_at vencido. E o que segura o checkout
 * expresso pelo atraso dele, e o que deixa de fora a linha que o pixel
 * cancelou (fechada como 'enviado' sem sent_at -- ver o coletor).
 */
export async function drenarFila(limite = 50): Promise<{
  pegos: number;
  enviados: number;
  falharam: number;
}> {
  const admin = createAdminClient();
  const { data: linhas } = await admin
    .from("tracking_events")
    .select(
      "id, store_id, destination, destination_id, event_name, event_id, payload, attempts"
    )
    .eq("status", "pendente")
    .lte("next_attempt_at", new Date().toISOString())
    .order("next_attempt_at", { ascending: true })
    .limit(limite);

  let enviados = 0;
  let falharam = 0;
  for (const linha of linhas || []) {
    // Uma linha com erro de banco nao pode abortar a rodada: as outras 49 nao
    // tem nada a ver com ela. A linha continua 'pendente' e volta na proxima.
    try {
      const r = await entregar(admin, linha);
      if (r.ok) enviados += 1;
      else falharam += 1;
    } catch (e) {
      console.error("[tracking/drain] falha ao entregar linha", linha.id, e);
      falharam += 1;
    }
  }
  return { pegos: (linhas || []).length, enviados, falharam };
}
