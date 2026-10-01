import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verificacao de webhook da Shopify.
 *
 * ============================== O QUE IMPORTA ==============================
 *
 * 1. CORPO CRU. A assinatura e sobre os BYTES que chegaram. `await req.json()`
 *    reserializa e muda espacos, ordem e escapes -- a conta da HMAC passa a dar
 *    outro resultado e webhook legitimo vira 401. Tem que ser `req.text()`, e o
 *    JSON so pode ser parseado DEPOIS de verificar.
 *
 * 2. BASE64, NAO HEX. O header X-Shopify-Hmac-Sha256 vem em base64. O callback
 *    de OAuth desta mesma app usa hex; sao formatos diferentes no mesmo
 *    fornecedor, e trocar um pelo outro falha sempre.
 *
 * 3. COMPARACAO EM TEMPO CONSTANTE. `===` em assinatura da para descobrir o
 *    valor byte a byte medindo a resposta.
 *
 * 4. QUAL SEGREDO. Aqui cada loja tem o proprio app (Client Credentials), logo
 *    o proprio client_secret. O segredo sai da loja identificada pelo header
 *    X-Shopify-Shop-Domain. Isso NAO e confiar no header: ele so escolhe qual
 *    chave testar. Sem o segredo daquela loja, a assinatura nao fecha.
 */

export interface CabecalhosWebhook {
  hmac: string | null;
  topic: string | null;
  shopDomain: string | null;
  webhookId: string | null;
  triggeredAt: string | null;
  apiVersion: string | null;
}

export function lerCabecalhos(headers: Headers): CabecalhosWebhook {
  return {
    hmac: headers.get("x-shopify-hmac-sha256"),
    topic: headers.get("x-shopify-topic"),
    shopDomain: headers.get("x-shopify-shop-domain"),
    webhookId: headers.get("x-shopify-webhook-id"),
    triggeredAt: headers.get("x-shopify-triggered-at"),
    apiVersion: headers.get("x-shopify-api-version"),
  };
}

/**
 * Confere a assinatura do corpo cru contra o client_secret da loja.
 *
 * `corpoCru` precisa ser exatamente o texto recebido, sem reserializar.
 */
export function assinaturaConfere(
  corpoCru: string,
  hmacRecebido: string | null,
  clientSecret: string
): boolean {
  if (!hmacRecebido || !clientSecret) return false;

  const esperado = createHmac("sha256", clientSecret).update(corpoCru, "utf8").digest();

  let recebido: Buffer;
  try {
    recebido = Buffer.from(hmacRecebido, "base64");
  } catch {
    return false;
  }

  // timingSafeEqual joga quando os tamanhos diferem; a guarda vem antes.
  if (recebido.length !== esperado.length) return false;
  return timingSafeEqual(recebido, esperado);
}

/**
 * Janela de replay: 72 horas.
 *
 * ERA 5 MINUTOS, E ISSO DESCARTAVA VENDA.
 *
 * A Shopify reentrega webhook que falhou 8 vezes ao longo de 4 horas, e o
 * `X-Shopify-Triggered-At` guarda a hora ORIGINAL do evento. Com 5 minutos, o
 * 503 que o proprio handler devolve para pedir reentrega nunca era aproveitado:
 * a reentrega chegava fora da janela e era recusada com 200, sem rastro. Atraso
 * da fila da Shopify em pico derrubava a compra ja na primeira entrega.
 *
 * Isto nao abre replay. A defesa real nunca foi a janela: e a tabela
 * shopify_webhook_events, cuja PK e o webhook_id e que nao e expurgada, e o
 * indice unico `purchase_<order_id>` da fila. Um webhook capturado e reenviado
 * cai num dos dois. A janela so corta o lixo muito velho antes de chegar la.
 */
export const JANELA_REPLAY_MS = 72 * 60 * 60 * 1000;

/**
 * Recusa entrega velha demais.
 *
 * Sozinho isto nao e defesa de replay -- a assinatura de um webhook capturado
 * continua valida para sempre. Quem resolve replay de verdade e a tabela de
 * webhook_id ja processado; a janela e o corte barato que evita nem chegar la.
 *
 * Sem o header, aceita: um topico futuro que nao o mande nao pode parar de
 * funcionar por causa desta checagem.
 */
export function dentroDaJanela(
  triggeredAt: string | null,
  agora: number = Date.now()
): boolean {
  if (!triggeredAt) return true;
  const quando = Date.parse(triggeredAt);
  if (Number.isNaN(quando)) return true;

  const atraso = agora - quando;
  // Assimetrica de proposito. Para TRAS, 72 h: reentrega legitima chega com a
  // hora original. Para a FRENTE, so o desvio de relogio: evento que diz ter
  // acontecido no futuro nao e reentrega de nada.
  if (atraso < -FOLGA_DE_RELOGIO_MS) return false;
  return atraso <= JANELA_REPLAY_MS;
}

/** Desvio de relogio tolerado entre a Shopify e o nosso servidor. */
export const FOLGA_DE_RELOGIO_MS = 5 * 60 * 1000;

/**
 * JSON do corpo cru, ou null se vier malformado. Nunca lanca.
 *
 * Array tambem e null: `typeof [] === "object"`, entao a checagem ingenua
 * deixava `[1,2]` passar como payload e o handler seguia lendo `payload.shop`
 * de um array -- undefined em silencio, em vez de recusa.
 */
export function corpoJson<T = Record<string, unknown>>(corpoCru: string): T | null {
  try {
    const valor: unknown = JSON.parse(corpoCru);
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return null;
    return valor as T;
  } catch {
    return null;
  }
}
