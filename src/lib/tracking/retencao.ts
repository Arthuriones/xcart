// ============================================================================
// Quanto o rastreamento guarda, e o que sobra do payload depois do envio.
//
// Puro (sem "server-only", sem I/O): a tela de Eventos, a tela Pedidos e o
// alerta de rastreamento parado leem daqui. Quem APAGA e o purge_tracking()
// (migration 079), de hora em hora pelo drain; os prazos de la sao estes, e
// tests/tracking-historico.test.ts trava as duas pontas.
//
//   tracking_events     a FILA de envio: curta.
//   tracking_historico  uma linha por evento, sem payload e sem dado pessoal,
//                       gravada pelo proprio expurgo a partir da fila.
//   tracking_historico_diario  o funil de volume (EVENTOS_DO_DIARIO) depois
//                       de sair da fila: uma linha por loja, dia, evento,
//                       fonte e anuncio, com as contagens.
// ============================================================================

export const RETENCAO = {
  /**
   * Funil (tudo que nao e Purchase) entregue sai da fila -- menos o id POR
   * CHECKOUT (`<evento>_ck_<token>`, idDoEventoDoCheckout), que fica
   * `compraDias`: o indice unico sobre ele e a regra de um IC por checkout.
   */
  funilDias: 14,
  /** Purchase entregue (e o id por checkout) sai da fila: o "sem_registro" da tela Pedidos. */
  compraDias: 90,
  /** O payload da Purchase entregue vira o resumo (CAMPOS_DO_RESUMO). */
  resumoDaCompraDias: 8,
  /** O que nunca saiu (falhou, pendente) sai da fila. */
  naoSaiuDias: 30,
  /** O historico enxuto (por evento e por dia). */
  historicoMeses: 12,
} as const;

/**
 * O funil de VOLUME: 98% dos eventos. No historico ele so fica por evento ate
 * sair da fila; depois o tracking_compactar_funil (079) o junta no dia, em
 * tracking_historico_diario. Uma linha por view_item por 12 meses dava ~50 MB
 * numa loja como a Softnook. Checkout, pagamento e compra seguem por evento.
 */
export const EVENTOS_DO_DIARIO = ["page_view", "view_item", "add_to_cart"] as const;

/**
 * O que fica do payload no resumo (tracking_payload_resumo, 079): toda chave
 * que algum leitor le de uma linha ja enviada -- Pedidos (fbc, URL, marca de
 * teste), Eventos ao vivo (click ids e URL das tres plataformas) e a regra de
 * teste das RPCs (055/059). Leitor novo de linha velha que precise de outra
 * chave entra aqui E na funcao SQL, ou o teste para.
 */
export const CAMPOS_DO_RESUMO = [
  "teste",
  "test_event_code",
  "event_source_url",
  "pageUrl",
  "gclid",
  "gbraid",
  "wbraid",
  "user_data.fbc",
  "user.ttclid",
  "page.url",
] as const;
