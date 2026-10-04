import type { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Evento de TESTE e CONSENTIMENTO do visitante.
//
// TESTE
//
// O dono testa a propria loja: abre com ?gclid=TESTE_V4, adiciona ao carrinho,
// vai ao checkout. Ate aqui isso saia para o Google e para o Meta como conversao
// de verdade -- 26 dos 38 carrinhos com clique da Softnook numa semana eram
// teste, e o numero da tela nao batia com o Gerenciador por isso.
//
// Conta como teste:
//   - o link ?xcart_teste=1, que grava o cookie _xc_teste (?xcart_teste=0 limpa);
//   - click id com TEST/TESTE, que e o que o dono digita no lugar do gclid.
//
// Evento de teste e GRAVADO na fila, com payload.teste = true: e em Eventos ao
// vivo que o dono confere o proprio teste. Mas nao vai ao Google, e ao Meta so
// vai com o codigo de teste do destino (cai na aba Test Events, que nao conta
// como conversao). Sem codigo, nao vai.
//
// CONSENTIMENTO
//
// Lido da Customer Privacy API da Shopify, no tema e no Web Pixel:
//   'concedido' = marketing liberado; 'negado' = nao liberado; ausente = nao
//   deu para ler. Nunca e cravado: sem leitura, fica sem valor.
// Hoje so e GRAVADO (o Google vai precisar para a Data Manager API). O Meta
// segue igual: nada aqui bloqueia envio ao Meta por consentimento.
//
// O PAYLOAD DO META QUE SAI NAO GANHA CAMPO
//
// O payload do Meta e enviado CRU para a API deles, e chave desconhecida no
// evento derruba o evento inteiro ("Unexpected key"). Entao as marcas so entram
// onde o payload e nosso: Google, e linha que nao sai. O Meta em modo teste
// (com codigo) ja e teste pelo destino.
// ============================================================================

export type Consentimento = "concedido" | "negado";

export interface Marcas {
  teste: boolean;
  consentimento: Consentimento | null;
}

/**
 * O click id e de teste?
 *
 * "test", em qualquer caixa, no comeco ou logo depois de `_`, `-` ou `.`:
 * TESTE_V4, TESTE-PONTE-SO, teste123, ATC-TEST, e o _fbc montado com um
 * fbclid de teste (fb.1.<ts>.TESTE). Um gclid de verdade e aleatorio; exigir o
 * separador antes deixa o acaso em menos de 1 a cada 300 mil.
 */
export function clickIdDeTeste(valor: unknown): boolean {
  if (typeof valor !== "string") return false;
  return /(^|[._-])test/i.test(valor.trim());
}

/** Marca explicita (cookie do ?xcart_teste=1) ou algum click id de teste. */
export function ehTeste(marca: unknown, clickIds: readonly unknown[] = []): boolean {
  if (marca === true || marca === "1" || marca === "true") return true;
  return clickIds.some(clickIdDeTeste);
}

/** So os dois valores conhecidos. Qualquer outra coisa e "nao sei". */
export function lerConsentimento(valor: unknown): Consentimento | null {
  return valor === "concedido" || valor === "negado" ? valor : null;
}

/**
 * Este destino recebe o evento?
 *
 * Fora de teste, sempre. Em teste, so o Meta com codigo de teste: ali o evento
 * cai na aba Test Events e nao conta como conversao.
 */
export function enviaAoDestino(
  destino: { plataforma: string; testEventCode?: string | null },
  teste: boolean
): boolean {
  if (!teste) return true;
  return destino.plataforma === "meta" && Boolean(destino.testEventCode?.trim());
}

/**
 * O payload que vai para a fila, com as marcas.
 *
 * Meta que sai: intocado (ver o cabecalho). O resto ganha `teste` quando e
 * teste e `consentimento` quando foi lido.
 */
export function payloadComMarcas<T extends object>(
  plataforma: string,
  payload: T,
  marcas: Marcas,
  envia: boolean
): T {
  if (plataforma === "meta" && envia) return payload;
  return {
    ...payload,
    ...(marcas.teste ? { teste: true } : {}),
    ...(marcas.consentimento ? { consentimento: marcas.consentimento } : {}),
  };
}

/** Atributo do carrinho que chegou no pedido. */
function atributoDoPedido(
  pedido: { note_attributes?: { name?: string | null; value?: string | null }[] | null },
  nome: string
): string | null {
  const achado = (pedido.note_attributes || []).find(
    (a) => (a?.name || "").trim() === nome
  );
  return (achado?.value || "").trim() || null;
}

/**
 * As marcas da compra.
 *
 * O snippet grava `_xc_teste` e `_xc_consent` no carrinho, que viaja ate o
 * pedido. Pedido de teste da Shopify (`test: true`) nem chega aqui: o filtro do
 * pedido ja o descarta.
 */
export function marcasDoPedido(
  pedido: { note_attributes?: { name?: string | null; value?: string | null }[] | null },
  clickIds: readonly unknown[] = []
): Marcas {
  return {
    teste: ehTeste(atributoDoPedido(pedido, "_xc_teste"), clickIds),
    consentimento: lerConsentimento(atributoDoPedido(pedido, "_xc_consent")),
  };
}

/**
 * Grava na fila um evento que NAO vai sair: o de teste.
 *
 * Status 'enviado' SEM sent_at, e response.enviado = false. Nao ha status novo
 * de proposito (ver a critica do plano: a constraint da 035, o expurgo, o
 * painel e os alertas todos conhecem so pendente/enviado/falhou):
 *   - 'pendente' seria apanhado pelo cron e sairia;
 *   - 'falhou' acenderia o alerta de compra que nao chegou.
 * `enviado` sem `sent_at` nao existe por outro caminho -- gravarSucesso sempre
 * carimba --, entao identifica a linha sem ambiguidade.
 */
export async function registrarSemEnviar(
  admin: ReturnType<typeof createAdminClient>,
  entrada: {
    storeId: string;
    destination: "meta" | "google";
    destinationId: string;
    eventName: string;
    eventId: string;
    orderId?: string | null;
    visitorId?: string | null;
    referrer?: string | null;
    checkoutToken?: string | null;
    payload: unknown;
  }
): Promise<{ duplicado: boolean }> {
  const { error } = await admin.from("tracking_events").insert({
    store_id: entrada.storeId,
    destination: entrada.destination,
    destination_id: entrada.destinationId,
    event_name: entrada.eventName,
    event_id: entrada.eventId,
    order_id: entrada.orderId ?? null,
    visitor_id: entrada.visitorId ?? null,
    referrer: entrada.referrer ?? null,
    checkout_token: entrada.checkoutToken ?? null,
    payload: entrada.payload as Record<string, unknown>,
    status: "enviado",
    sent_at: null,
    response: { teste: true, enviado: false },
  });
  // 23505: o mesmo evento ja estava na fila (reenvio do snippet, reentrega).
  if (error?.code === "23505") return { duplicado: true };
  if (error) throw new Error(`falha ao registrar evento de teste: ${error.message}`);
  return { duplicado: false };
}
