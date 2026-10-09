// ============================================================================
// Pedido da Shopify -> foto financeira (fin_orders).
//
// Puro de proposito (sem "server-only", sem I/O): e aqui que mora a regra de
// dinheiro do pedido, e o vitest precisa importar sem o servidor. Quem fala
// com a Shopify e shopify-pedidos.ts.
//
// NUNCA leia customer, email, endereco ou telefone. A foto existe para somar
// receita e custo; dado pessoal aqui so aumentaria o que vaza se o banco vazar.
// ============================================================================

import { gatewayEhCod, tagEhCod, tagEhRecusa } from "./contra-entrega";
import {
  chaveSku,
  diaNoFuso,
  paraNumero,
  type EntregaPedido,
  type FinOrderRow,
  type LinhaPedido,
  type TipoPedido,
} from "./tipos";

interface Dinheiro {
  amount?: string | number | null;
}

interface MoneyBag {
  shopMoney?: Dinheiro | null;
  presentmentMoney?: Dinheiro | null;
}

export interface NoLinhaPedidoShopify {
  sku?: string | null;
  /** SKU ATUAL da variante. A linha guarda o SKU do dia da venda: produto
   *  vendido sem SKU continua sem, mesmo depois de o lojista cadastrar. */
  variant?: { sku?: string | null } | null;
  quantity: number;
  currentQuantity?: number | null;
  unfulfilledQuantity?: number | null;
  originalUnitPriceSet?: MoneyBag | null;
}

/** Espelha os campos de `orders.nodes` da query FinPedidos (shopify-pedidos.ts). */
export interface NoPedidoShopify {
  id: string;
  name?: string | null;
  createdAt: string;
  processedAt?: string | null;
  updatedAt: string;
  cancelledAt?: string | null;
  test?: boolean | null;
  sourceName?: string | null;
  displayFinancialStatus?: string | null;
  /** Enum OrderDisplayFulfillmentStatus (nao nulo na Shopify). */
  displayFulfillmentStatus?: string | null;
  currencyCode: string;
  presentmentCurrencyCode?: string | null;
  paymentGatewayNames?: string[] | null;
  totalPriceSet?: MoneyBag | null;
  currentTotalPriceSet?: MoneyBag | null;
  currentTotalTaxSet?: MoneyBag | null;
  currentTotalDutiesSet?: MoneyBag | null;
  totalTipReceivedSet?: MoneyBag | null;
  totalDiscountsSet?: MoneyBag | null;
  totalShippingPriceSet?: MoneyBag | null;
  totalReceivedSet?: MoneyBag | null;
  totalRefundedSet?: MoneyBag | null;
  netPaymentSet?: MoneyBag | null;
  lineItems?: { nodes?: NoLinhaPedidoShopify[] | null } | null;
  /** Enum OrderReturnStatus. */
  returnStatus?: string | null;
  /** Lidas so para o sim/nao de COD e de recusa: NUNCA gravadas. */
  tags?: string[] | null;
  fulfillments?: NoEntregaShopify[] | null;
}

/** Um fulfillment do pedido (o envio), sem rastreio nem endereco. */
export interface NoEntregaShopify {
  /** FulfillmentStatus: SUCCESS, CANCELLED, ERROR, FAILURE, OPEN, PENDING. */
  status?: string | null;
  /** FulfillmentDisplayStatus: IN_TRANSIT, DELIVERED, FAILURE, NOT_DELIVERED... */
  displayStatus?: string | null;
  createdAt?: string | null;
  deliveredAt?: string | null;
}

/** Uma pagina da query FinPedidos, como shopifyGraphQL devolve (json.data). */
export interface PaginaPedidos {
  shop?: { ianaTimezone?: string | null; currencyCode?: string | null } | null;
  orders?: {
    pageInfo?: { hasNextPage?: boolean | null; endCursor?: string | null } | null;
    nodes?: NoPedidoShopify[] | null;
  } | null;
}

/**
 * Pedido em que NADA foi enviado. `unfulfilledQuantity` e documentado so como
 * "units not yet fulfilled"; o que a Shopify poe ali numa linha cancelada ou
 * reembolsada sem envio nao esta verificado (pode vir 0). Se vier 0, o custo
 * do pedido cancelado sairia cheio -- e em dropshipping cancelamento e comum.
 * Quando o pedido inteiro diz que nada saiu, a quantidade toda conta como nao
 * enviada. Pedido parcialmente enviado ainda depende de unfulfilledQuantity.
 */
const NADA_ENVIADO = new Set(["UNFULFILLED", "OPEN", "RESTOCKED", "ON_HOLD", "SCHEDULED"]);

function valor(set: MoneyBag | null | undefined): number {
  return paraNumero(set?.shopMoney?.amount);
}

/** gid://shopify/Order/123 -> "123". Id ja numerico passa direto. */
export function idNumerico(gid: string): string {
  const partes = String(gid ?? "").split("/");
  return (partes[partes.length - 1] ?? "").split("?")[0];
}

export function mapearLinhas(no: NoPedidoShopify): LinhaPedido[] {
  const nadaEnviado = NADA_ENVIADO.has(String(no.displayFulfillmentStatus ?? ""));
  return (no.lineItems?.nodes ?? []).map((n) => {
    const qtd = paraNumero(n.quantity);
    return {
      // O da venda vence; sem ele, o SKU que a variante tem hoje.
      sku: chaveSku(n.sku) || chaveSku(n.variant?.sku) || null,
      qtd,
      qtd_atual: n.currentQuantity == null ? qtd : paraNumero(n.currentQuantity),
      qtd_nao_enviada: nadaEnviado ? qtd : paraNumero(n.unfulfilledQuantity ?? 0),
      preco: valor(n.originalUnitPriceSet),
    };
  });
}

/** Envio que nao saiu: pedido de envio recusado, cancelado, etiqueta anulada. */
const ENVIO_DESFEITO = new Set(["CANCELLED", "ERROR", "FAILURE"]);
const EXIBICAO_DESFEITA = new Set(["CANCELED", "LABEL_VOIDED"]);
const EXIBICAO_FALHOU = new Set(["FAILURE", "NOT_DELIVERED"]);
const EXIBICAO_ENTREGUE = new Set(["DELIVERED", "PICKED_UP"]);

function instante(iso: string | null | undefined): number {
  const ms = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NaN;
}

/**
 * Os envios do pedido em tres campos: a situacao da entrega (falhou vence,
 * entregue so quando TODOS os envios foram entregues), o primeiro envio e a
 * ultima entrega. Sem envio valido: tudo null.
 */
export function resumirEntregas(fs: readonly NoEntregaShopify[] | null | undefined): {
  entrega: EntregaPedido | null;
  enviado_em: string | null;
  entregue_em: string | null;
} {
  const validos = (Array.isArray(fs) ? fs : []).filter(
    (f) =>
      f &&
      !ENVIO_DESFEITO.has(String(f.status ?? "").toUpperCase()) &&
      !EXIBICAO_DESFEITA.has(String(f.displayStatus ?? "").toUpperCase())
  );
  if (validos.length === 0) return { entrega: null, enviado_em: null, entregue_em: null };

  let primeiro = Number.POSITIVE_INFINITY;
  let ultimaEntrega = Number.NEGATIVE_INFINITY;
  let falhou = false;
  let entregues = 0;
  for (const f of validos) {
    const exibicao = String(f.displayStatus ?? "").toUpperCase();
    const criado = instante(f.createdAt);
    if (criado < primeiro) primeiro = criado;
    if (EXIBICAO_FALHOU.has(exibicao)) falhou = true;
    const entregueEm = instante(f.deliveredAt);
    if (Number.isFinite(entregueEm) || EXIBICAO_ENTREGUE.has(exibicao)) {
      entregues += 1;
      if (entregueEm > ultimaEntrega) ultimaEntrega = entregueEm;
    }
  }
  const tudoEntregue = !falhou && entregues === validos.length;
  return {
    entrega: falhou ? "falhou" : tudoEntregue ? "entregue" : "em_transito",
    enviado_em: Number.isFinite(primeiro) ? new Date(primeiro).toISOString() : null,
    entregue_em: tudoEntregue && Number.isFinite(ultimaEntrega) ? new Date(ultimaEntrega).toISOString() : null,
  };
}

function tipoDoPedido(no: NoPedidoShopify, totalBruto: number): TipoPedido {
  if (no.test) return "teste";
  if ((no.sourceName ?? "").toLowerCase() === "pos") return "pdv";
  // Valor zero: reenvio/troca criado como draft. Custa produto, nao tem receita.
  if (totalBruto <= 0) return "reenvio";
  return "venda";
}

export function mapearPedido(
  no: NoPedidoShopify,
  ctx: { storeId: string; userId: string; fuso: string | null }
): FinOrderRow {
  const processadoEm = no.processedAt || no.createdAt;
  const totalBruto = valor(no.totalPriceSet);
  const totalCliente = no.currentTotalPriceSet?.presentmentMoney?.amount;
  const gateways = Array.isArray(no.paymentGatewayNames) ? no.paymentGatewayNames : [];
  const tags = Array.isArray(no.tags) ? no.tags : [];
  const envios = resumirEntregas(no.fulfillments);

  return {
    store_id: ctx.storeId,
    user_id: ctx.userId,
    shopify_order_id: idNumerico(no.id),
    nome: no.name ?? null,
    processado_em: processadoEm,
    // O "dia" do lucro e o dia no fuso da LOJA, como o admin da Shopify mostra.
    dia_local: diaNoFuso(new Date(processadoEm), ctx.fuso),
    criado_em: no.createdAt,
    atualizado_em: no.updatedAt,
    cancelado_em: no.cancelledAt ?? null,
    tipo: tipoDoPedido(no, totalBruto),
    status_financeiro: no.displayFinancialStatus ?? null,
    origem: no.sourceName ?? null,
    moeda: no.currencyCode,
    moeda_cliente: no.presentmentCurrencyCode ?? null,
    total_bruto: totalBruto,
    total_atual: valor(no.currentTotalPriceSet),
    imposto_atual: valor(no.currentTotalTaxSet),
    taxas_alfandega: valor(no.currentTotalDutiesSet),
    gorjeta: valor(no.totalTipReceivedSet),
    descontos: valor(no.totalDiscountsSet),
    frete_cobrado: valor(no.totalShippingPriceSet),
    recebido: valor(no.totalReceivedSet),
    reembolsado: valor(no.totalRefundedSet),
    liquido_pago: valor(no.netPaymentSet),
    total_cliente: totalCliente == null ? null : paraNumero(totalCliente),
    gateways,
    linhas: mapearLinhas(no),
    // 068. shopify-pedidos.ts tira estes campos se a coluna ainda nao existe.
    cod: gateways.some(gatewayEhCod) || tags.some(tagEhCod),
    status_envio: no.displayFulfillmentStatus ?? null,
    entrega: envios.entrega,
    enviado_em: envios.enviado_em,
    entregue_em: envios.entregue_em,
    devolucao: no.returnStatus && no.returnStatus !== "NO_RETURN" ? no.returnStatus : null,
    marca_recusa: tags.some(tagEhRecusa),
  };
}

/** Os campos da 068 no FinOrderRow: sem a migration, o upsert vai sem eles. */
export const CAMPOS_ENVIO = [
  "cod",
  "status_envio",
  "entrega",
  "enviado_em",
  "entregue_em",
  "devolucao",
  "marca_recusa",
] as const;

export function semCamposDeEnvio(linha: FinOrderRow): FinOrderRow {
  const copia: Record<string, unknown> = { ...linha };
  for (const c of CAMPOS_ENVIO) delete copia[c];
  return copia as unknown as FinOrderRow;
}

/**
 * Coluna que o banco nao conhece: a migration ainda nao foi aplicada.
 * Escrita pelo PostgREST da PGRST204; leitura, 42703 do Postgres.
 */
export function ehColunaAusente(e: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!e) return false;
  if (e.code === "PGRST204" || e.code === "42703") return true;
  return /column .* does not exist|Could not find the '.*' column/i.test(String(e.message ?? ""));
}

function mensagemDe(erro: unknown): string {
  if (erro instanceof Error) return erro.message;
  return typeof erro === "string" ? erro : "";
}

/** A loja nao deu read_orders (ou o app nao foi aprovado): nao adianta repetir logo. */
export function ehNegado(erro: unknown): boolean {
  return /ACCESS_DENIED|access denied|read_orders|not approved/i.test(mensagemDe(erro));
}

/** A query passou do teto de custo da Shopify (1000 pontos) antes de rodar. */
export function ehCustoExcedido(erro: unknown): boolean {
  return /MAX_COST_EXCEEDED/.test(mensagemDe(erro));
}

// ---------------------------------------------------------------------------
// Paginacao com recuo de custo
// ---------------------------------------------------------------------------

/**
 * Pedidos por pagina. O custo exato da query nao foi verificado: pela tabela
 * linear da doc, cada pedido vale ~99 pontos (dez MoneyBag + 25 linhas), mais
 * ~5 dos envios (068), entao 8 por pagina fica perto de 850, abaixo do teto
 * de 1000. Se a Shopify recusar
 * com MAX_COST_EXCEEDED, a mesma pagina e pedida de novo com metade.
 */
export const PEDIDOS_POR_PAGINA = 8;
export const PEDIDOS_POR_PAGINA_MIN = 2;

export async function paginarPedidos(opts: {
  buscar: (cursor: string | null, n: number) => Promise<PaginaPedidos>;
  aoReceber: (pagina: PaginaPedidos) => Promise<void>;
  maxPaginas: number;
  nInicial?: number;
  /** Orcamento de tempo: true = pare antes da proxima pagina. */
  deveParar?: () => boolean;
  /** endCursor de uma rodada anterior com a MESMA busca: continua dali. */
  cursorInicial?: string | null;
}): Promise<{ paginas: number; terminou: boolean; n: number }> {
  let cursor: string | null = opts.cursorInicial ?? null;
  let n = opts.nInicial ?? PEDIDOS_POR_PAGINA;
  let paginas = 0;

  while (paginas < opts.maxPaginas) {
    if (paginas > 0 && opts.deveParar?.()) break;

    let pagina: PaginaPedidos;
    try {
      pagina = await opts.buscar(cursor, n);
    } catch (e) {
      if (ehCustoExcedido(e) && n > PEDIDOS_POR_PAGINA_MIN) {
        // Mesmo cursor, pagina menor. O n reduzido vale para o resto da rodada.
        n = Math.max(PEDIDOS_POR_PAGINA_MIN, Math.floor(n / 2));
        continue;
      }
      throw e;
    }

    paginas += 1;
    await opts.aoReceber(pagina);

    const info = pagina.orders?.pageInfo;
    if (!info?.hasNextPage) return { paginas, terminou: true, n };
    // hasNextPage sem cursor nao deveria acontecer; parar evita laco infinito
    // e NAO marca a carga como completa.
    if (!info.endCursor) return { paginas, terminou: false, n };
    cursor = info.endCursor;
  }

  return { paginas, terminou: false, n };
}

/** Maior updatedAt (ISO) entre o cursor atual e os pedidos da pagina. */
export function maiorAtualizado(atual: string | null, nos: NoPedidoShopify[]): string | null {
  const atualMs = atual ? Date.parse(atual) : Number.NaN;
  let maior = Number.isFinite(atualMs) ? atual : null;
  let maiorMs = Number.isFinite(atualMs) ? atualMs : Number.NEGATIVE_INFINITY;
  for (const no of nos) {
    const ms = Date.parse(no.updatedAt);
    if (Number.isFinite(ms) && ms > maiorMs) {
      maiorMs = ms;
      maior = new Date(ms).toISOString();
    }
  }
  return maior;
}
