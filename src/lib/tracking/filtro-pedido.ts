// ============================================================================
// Quais pedidos NAO viram conversao.
//
// O webhook orders/create dispara para todo pedido, e nem todo pedido e uma
// venda que o anuncio gerou:
//
//   - pedido de TESTE (gateway Bogus, `test: true`) ao montar a loja;
//   - pedido de VALOR ZERO, que em dropshipping e reposicao gratis;
//   - PDV (`source_name: "pos"`), que nem passou pela loja online;
//   - DRAFT ORDER (`source_name: "shopify_draft_order"`), que na operacao do
//     Arthur e reenvio ou troca.
//
// O draft de reenvio e o mais traicoeiro: ele carrega o e-mail e o telefone do
// cliente REAL, entao o Meta casa a pessoa e conta uma segunda compra com valor.
// O ROAS infla e o algoritmo aprende com sinal falso -- e isso pesa justamente
// em campanha nova, que tem pouca venda de verdade para diluir.
//
// LISTA DE BLOQUEIO, NAO DE PERMISSAO
//
// Exigir `source_name === "web"` parece mais seguro e nao e: app de checkout,
// app de upsell e os canais Shop/mobile mandam outro source_name (as vezes um
// numero) e sao vendas reais. Bloquear so o que se sabe que nao e venda.
//
// Arquivo puro e compartilhado: o webhook decide o que mandar e a tela decide
// quantos pedidos esperar. Se os dois usassem regras diferentes, a tela
// acusaria "pedido sem compra" para cada pedido de teste.
// ============================================================================

/** O recorte do pedido que esta regra le. */
export interface PedidoParaFiltro {
  test?: boolean | null;
  source_name?: string | null;
  total_price?: string | number | null;
}

/** Canais que nunca sao venda gerada por anuncio na loja online. */
const CANAIS_IGNORADOS: Record<string, string> = {
  pos: "pedido de PDV",
  shopify_draft_order: "draft order (reenvio ou troca)",
};

/**
 * Por que este pedido nao vira conversao, ou null se vira.
 *
 * Devolve o MOTIVO, nao um booleano: o webhook responde com ele, e e o que
 * permite ler no log por que uma venda nao apareceu no Meta.
 */
export function motivoParaIgnorarPedido(pedido: PedidoParaFiltro): string | null {
  if (pedido.test === true) return "pedido de teste";

  const canal = String(pedido.source_name ?? "").trim().toLowerCase();
  if (canal && CANAIS_IGNORADOS[canal]) return CANAIS_IGNORADOS[canal];

  // Valor ausente nao e valor zero: pedido sem total_price no payload continua
  // sendo venda, so com o valor que o resto do codigo resolver.
  if (pedido.total_price !== null && pedido.total_price !== undefined) {
    const valor = Number(pedido.total_price);
    if (Number.isFinite(valor) && valor <= 0) return "pedido de valor zero";
  }

  return null;
}
