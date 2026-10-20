/**
 * Do plano (plano.ts) para as linhas do banco, no estado de um instante.
 *
 * O pedido vira o objeto que a Shopify devolveria (NoPedidoShopify) e passa
 * pelas funcoes do proprio sync -- mapearPedido e mapearOrigem --, entao a
 * loja de demonstracao grava exatamente o que o sync gravaria. O Purchase e o
 * funil sao montados no formato que o webhook e o coletor gravam na fila.
 *
 * Puro: nada de banco aqui.
 */
import { mapearOrigem, mapearPedido, type NoPedidoShopify } from "../../src/lib/financeiro/mapear-pedido";
import {
  chaveSku,
  custoVigente,
  paraNumero,
  qtdParaCusto,
  type AdSpendDailyRow,
  type FinOrderRow,
  type ProductCostRow,
} from "../../src/lib/financeiro/tipos";
import type { LinhaOrigem } from "../../src/lib/tracking/origem-pedido";
import type { JornadaShopify, VisitaShopify } from "../../src/lib/tracking/origem-pedido";
import { idDoEvento } from "../../src/lib/tracking/purchase";
import { idDoEventoDeNavegador, idDoEventoDoCheckout, type ChaveEvento } from "../../src/lib/tracking/eventos";
import {
  ARTHUR,
  CAMPANHAS,
  CATALOGO,
  CONTA_GOOGLE,
  CONTA_META,
  CUSTO_V2_DESDE,
  DESTINO_META,
  DOMINIO,
  FUSO,
  LOJA_ID,
  MOEDA,
  POR_SKU,
  POSICIONAMENTOS,
  Sorteio,
  arred,
  campanhasDoDia,
  conjuntosDoDia,
  diaDaSemana,
  fatorDoEvento,
  instanteLocal,
  segundoDoDia,
  semanaBfcm,
  somarDia,
  uuid,
  type Campanha,
  type DiaPlano,
  type ItemCatalogo,
  type PedidoPlano,
} from "./plano";

/** Unidades da moeda por 1 USD no dia (a cotacao de fx_rates). */
export type Cambio = (moeda: string, dia: string) => number;

const CTX = { storeId: LOJA_ID, userId: ARTHUR, fuso: FUSO };
const iso = (ms: number) => new Date(ms).toISOString();
const MIN = 60_000;

// ---------------------------------------------------------------------------
// Pedido -> Shopify -> fin_orders e fin_order_origem
// ---------------------------------------------------------------------------

function paginaDoProduto(item: ItemCatalogo): string {
  return `https://${DOMINIO}/products/${item.handle}`;
}

/** A visita que virou o pedido (ou a primeira), como a jornada da Shopify devolve. */
function visitaDoAnuncio(p: PedidoPlano): VisitaShopify | null {
  const o = p.origem;
  const pagina = paginaDoProduto(POR_SKU.get(p.linhas[0].sku)!);
  if (o.tipo === "meta") {
    const utm = { source: "FB", medium: o.conjunto.id, campaign: o.campanha.id, content: o.anuncio.id, term: o.posicionamento };
    const q = new URLSearchParams({
      utm_source: utm.source,
      utm_campaign: utm.campaign,
      utm_medium: utm.medium,
      utm_content: utm.content,
      utm_term: utm.term,
      fbclid: o.fbclid,
    });
    return { occurredAt: iso(o.cliqueMs), landingPage: `${pagina}?${q}`, utmParameters: utm };
  }
  if (o.tipo === "google") {
    const utm = {
      source: "google",
      campaign: o.campanha.id,
      medium: o.grupo?.id ?? null,
      content: o.criativo?.id ?? null,
      term: o.palavra,
    };
    const q = new URLSearchParams({
      utm_source: "google",
      utm_campaign: o.campanha.id,
      utm_medium: o.grupo?.id ?? "",
      utm_content: o.criativo?.id ?? "",
      utm_term: o.palavra ?? "",
      gad_source: "1",
      gad_campaignid: o.campanha.id,
      gclid: o.gclid,
    });
    return { occurredAt: iso(o.cliqueMs), landingPage: `${pagina}?${q}`, utmParameters: utm };
  }
  if (o.tipo === "email") {
    const utm = { source: "klaviyo", medium: "email", campaign: o.fluxo, content: null, term: null };
    const q = new URLSearchParams({ utm_source: "klaviyo", utm_medium: "email", utm_campaign: o.fluxo });
    return { occurredAt: iso(o.cliqueMs), landingPage: `${pagina}?${q}`, utmParameters: utm };
  }
  if (o.tipo === "pinterest") {
    const utm = { source: "pinterest", medium: "social", campaign: null, content: null, term: null };
    return {
      occurredAt: iso(o.cliqueMs),
      landingPage: `${pagina}?utm_source=pinterest&utm_medium=social`,
      utmParameters: utm,
    };
  }
  return null;
}

function jornada(p: PedidoPlano): JornadaShopify | null {
  const o = p.origem;
  if (o.tipo === "sem_jornada") return { ready: false };
  const direta = (ms: number): VisitaShopify => ({ occurredAt: iso(ms), landingPage: `https://${DOMINIO}/`, utmParameters: null });
  if (o.tipo === "direto") {
    const v = direta(o.visitaMs);
    return { ready: true, firstVisit: v, lastVisit: v };
  }
  const anuncio = visitaDoAnuncio(p)!;
  const sessao = o.tipo === "meta" || o.tipo === "google" ? o.sessao : true;
  // Voltou depois, direto: a primeira visita e a do anuncio, a ultima nao tem UTM.
  return sessao
    ? { ready: true, firstVisit: anuncio, lastVisit: anuncio }
    : { ready: true, firstVisit: anuncio, lastVisit: direta(p.criadoMs - 12 * MIN) };
}

/** A URL de chegada da sessao do pedido (o landing_site do webhook). */
function urlDeChegada(p: PedidoPlano): string {
  const j = jornada(p);
  return j?.lastVisit?.landingPage ?? `https://${DOMINIO}/`;
}

/** O pedido no instante `agora`, como a query FinPedidos da Shopify devolveria. */
export function paraShopify(p: PedidoPlano, agoraMs: number, cambio: Cambio): NoPedidoShopify {
  const cancelado = p.cancelado && p.cancelado.emMs <= agoraMs ? p.cancelado : null;
  const reembolso = !cancelado && p.reembolso && p.reembolso.emMs <= agoraMs ? p.reembolso : null;
  // Reembolso total antes do envio: o pedido nunca sai.
  const naoSai = Boolean(p.cancelado) || Boolean(p.reembolso?.total && p.reembolso.emMs < p.enviaEmMs);
  const enviado = !naoSai && p.enviaEmMs <= agoraMs;
  const entregue = enviado && p.entregaEmMs <= agoraMs;

  const recebido = cancelado?.como === "VOIDED" ? 0 : p.total;
  const reembolsado = cancelado ? (cancelado.como === "REFUNDED" ? p.total : 0) : (reembolso?.valor ?? 0);
  const liquido = arred(recebido - reembolsado);
  const atual = cancelado ? 0 : arred(p.total - reembolsado);
  const impostoAtual = p.total > 0 ? arred((p.imposto * atual) / p.total) : 0;
  const status =
    p.tipo === "reenvio"
      ? "PAID"
      : cancelado
        ? cancelado.como
        : reembolso
          ? reembolso.total
            ? "REFUNDED"
            : "PARTIALLY_REFUNDED"
          : "PAID";
  const semItens = Boolean(cancelado) || Boolean(reembolso?.total);

  const momentos = [p.criadoMs, cancelado?.emMs, reembolso?.emMs, enviado ? p.enviaEmMs : null, entregue ? p.entregaEmMs : null]
    .filter((v): v is number => typeof v === "number");
  const atualizado = Math.max(...momentos) + 4_000;
  const dinheiro = (v: number) => ({ shopMoney: { amount: v.toFixed(2) } });

  return {
    id: `gid://shopify/Order/${p.id}`,
    name: `#${p.numero}`,
    createdAt: iso(p.criadoMs),
    processedAt: iso(p.criadoMs),
    updatedAt: iso(Math.min(atualizado, agoraMs)),
    cancelledAt: cancelado ? iso(cancelado.emMs) : null,
    test: false,
    sourceName: p.tipo === "reenvio" ? "shopify_draft_order" : "web",
    displayFinancialStatus: status,
    displayFulfillmentStatus: enviado ? "FULFILLED" : "UNFULFILLED",
    currencyCode: MOEDA,
    presentmentCurrencyCode: p.moedaCliente,
    paymentGatewayNames: p.gateway ? [p.gateway] : [],
    totalPriceSet: dinheiro(p.total),
    currentTotalPriceSet: {
      shopMoney: { amount: atual.toFixed(2) },
      presentmentMoney: { amount: arred(atual * cambio(p.moedaCliente, p.dia)).toFixed(2) },
    },
    currentTotalTaxSet: dinheiro(impostoAtual),
    currentTotalDutiesSet: dinheiro(0),
    totalTipReceivedSet: dinheiro(0),
    totalDiscountsSet: dinheiro(p.desconto),
    totalShippingPriceSet: dinheiro(p.frete),
    totalReceivedSet: dinheiro(recebido),
    totalRefundedSet: dinheiro(reembolsado),
    netPaymentSet: dinheiro(liquido),
    lineItems: {
      nodes: p.linhas.map((l) => ({
        sku: l.sku,
        variant: { sku: l.sku },
        quantity: l.qtd,
        currentQuantity: semItens ? 0 : l.qtd,
        unfulfilledQuantity: enviado ? 0 : semItens ? 0 : l.qtd,
        originalUnitPriceSet: dinheiro(l.preco),
      })),
    },
    returnStatus: reembolso?.devolvido ? "RETURNED" : "NO_RETURN",
    tags: [],
    fulfillments: enviado
      ? [
          {
            status: "SUCCESS",
            displayStatus: entregue ? "DELIVERED" : "IN_TRANSIT",
            createdAt: iso(p.enviaEmMs),
            deliveredAt: entregue ? iso(p.entregaEmMs) : null,
          },
        ]
      : [],
    customAttributes: [],
    customerJourneySummary: jornada(p),
  };
}

/** fin_orders: o que o sync gravaria agora. */
export function linhaDoPedido(p: PedidoPlano, agoraMs: number, cambio: Cambio): FinOrderRow {
  return { ...mapearPedido(paraShopify(p, agoraMs, cambio), CTX), sincronizado_em: iso(agoraMs) };
}

/** fin_order_origem: o que o sync gravaria (null = sem origem, como reenvio e pedido sem jornada). */
export function linhaDaOrigem(p: PedidoPlano, agoraMs: number, cambio: Cambio): LinhaOrigem | null {
  const o = mapearOrigem(paraShopify(p, agoraMs, cambio), CTX);
  return o ? { ...o, atualizado_em: iso(agoraMs) } : null;
}

// ---------------------------------------------------------------------------
// Custos
// ---------------------------------------------------------------------------

const CUSTOS_DESDE = "2026-07-20";

/** product_costs: a planilha do fornecedor no lancamento e a renegociacao dos travesseiros. */
export function custosDosProdutos(): ProductCostRow[] {
  const linhas: ProductCostRow[] = [];
  for (const i of CATALOGO) {
    linhas.push({
      id: uuid(`custo:${i.sku}:${CUSTOS_DESDE}`),
      store_id: LOJA_ID,
      user_id: ARTHUR,
      sku: i.sku,
      custo_unitario: i.custo,
      frete_unitario: i.frete,
      moeda: MOEDA,
      valido_desde: CUSTOS_DESDE,
      origem: "csv",
      created_at: "2026-07-19T22:41:07.000Z",
    });
    if (i.v2) {
      linhas.push({
        id: uuid(`custo:${i.sku}:${CUSTO_V2_DESDE}`),
        store_id: LOJA_ID,
        user_id: ARTHUR,
        sku: i.sku,
        custo_unitario: i.v2.custo,
        frete_unitario: i.v2.frete,
        moeda: MOEDA,
        valido_desde: CUSTO_V2_DESDE,
        origem: "manual",
        created_at: "2026-09-14T13:22:51.000Z",
      });
    }
  }
  return linhas;
}

/** Produto + frete do fornecedor das unidades que custam (a regra do Lucro). */
export function cmvDoPedido(p: FinOrderRow, custos: ProductCostRow[]): number {
  let total = 0;
  const cancelado = Boolean(p.cancelado_em);
  const semPagamento = paraNumero(p.recebido) <= 0 && p.tipo === "venda";
  for (const l of p.linhas) {
    const q = qtdParaCusto(l, cancelado, semPagamento);
    if (q <= 0) continue;
    const v = custoVigente(custos.filter((c) => chaveSku(c.sku) === chaveSku(l.sku)), p.dia_local);
    if (v) total += (paraNumero(v.custo_unitario) + paraNumero(v.frete_unitario)) * q;
  }
  return total;
}

// ---------------------------------------------------------------------------
// Fila de rastreamento (tracking_events)
// ---------------------------------------------------------------------------

export interface LinhaEvento {
  id: string;
  store_id: string;
  destination: "meta";
  destination_id: string;
  event_name: string;
  event_id: string;
  order_id: string;
  payload: Record<string, unknown>;
  status: "enviado";
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
  sent_at: string;
  visitor_id: string | null;
  referrer: string | null;
  checkout_token: string | null;
}

/** O aviso que o envio grava quando o evento nao tem clique do Meta (fila.ts). */
const AVISO_SEM_FBC = "sem fbc: nao veio de clique em anuncio do Meta";

function fbcDe(p: Pick<PedidoPlano, "origem">): string | null {
  return p.origem.tipo === "meta" ? `fb.1.${Math.floor(p.origem.cliqueMs)}.${p.origem.fbclid}` : null;
}

function linhaEnviada(
  r: Sorteio,
  e: Omit<LinhaEvento, "store_id" | "destination" | "destination_id" | "status" | "attempts" | "next_attempt_at" | "sent_at" | "created_at" | "last_error"> & {
    criadoMs: number;
  }
): LinhaEvento {
  const { criadoMs, ...resto } = e;
  const fbc = (e.payload.user_data as { fbc?: string } | undefined)?.fbc;
  return {
    ...resto,
    store_id: LOJA_ID,
    destination: "meta",
    destination_id: DESTINO_META.id,
    status: "enviado",
    attempts: 1,
    next_attempt_at: iso(criadoMs),
    last_error: fbc ? null : AVISO_SEM_FBC,
    created_at: iso(criadoMs),
    sent_at: iso(criadoMs + Math.round(r.entre(250, 1900))),
  };
}

/**
 * O payload de um evento da loja de demonstracao: SO o que alguma tela le.
 *   - Pedidos (pedidos-banco.ts): payload.user_data.fbc e event_source_url do
 *     Purchase (a origem de reserva, quando a gravada nao tem plataforma), e a
 *     marca de teste (teste / test_event_code), que aqui nunca existe;
 *   - Rastreamento (tracking_painel_v2): user_data.fbc ("de anuncio") e a
 *     marca de teste;
 *   - Eventos ao vivo (tracking_feed_v2): user_data.fbc e utm_source /
 *     utm_campaign de event_source_url.
 * O resto do que o webhook e o coletor gravam (hashes, user agent, itens,
 * valor) nao aparece em tela nenhuma e custava ~1 KB por linha no plano free.
 * Nada le o payload desta loja para enviar: a fila so drena 'pendente', e
 * estas linhas nascem 'enviado'.
 */
function payloadMinimo(url: string | null, fbc: string | null): Record<string, unknown> {
  return { ...(url ? { event_source_url: url } : {}), ...(fbc ? { user_data: { fbc } } : {}) };
}

/**
 * A URL do evento de funil com so o que o feed le dela (utm_source e
 * utm_campaign). Sem nenhum dos dois, nada: o feed mostraria o mesmo vazio.
 */
export function urlDoFeed(url: string): string | null {
  const i = url.indexOf("?");
  if (i < 0) return null;
  const q = new URLSearchParams(url.slice(i + 1));
  const curta = new URLSearchParams();
  for (const k of ["utm_source", "utm_campaign"]) {
    const v = q.get(k);
    if (v) curta.set(k, v);
  }
  const texto = curta.toString();
  return texto ? `${url.slice(0, i)}?${texto}` : null;
}

/** O Purchase do pedido, como o webhook orders/create grava (null = nao vira compra, ou ainda nao chegou). */
export function compraDoPedido(p: PedidoPlano, agoraMs: number): LinhaEvento | null {
  if (p.tipo !== "venda" || p.total <= 0) return null;
  const r = new Sorteio(`compra:${p.id}`);
  const criadoMs = p.criadoMs + Math.round(r.entre(1500, 9000));
  if (criadoMs > agoraMs) return null;
  // A URL de chegada inteira: com o fbclid/gclid, e dela que a tela Pedidos
  // tira a origem quando a gravada nao tem plataforma.
  const chegada = urlDeChegada(p);
  return linhaEnviada(r, {
    id: uuid(`compra:${p.id}`),
    event_name: "Purchase",
    event_id: idDoEvento(p.id),
    order_id: p.id,
    payload: payloadMinimo(chegada.includes("?") ? chegada : null, fbcDe(p)),
    visitor_id: null,
    referrer: null,
    checkout_token: null,
    criadoMs,
  });
}

interface Sessao {
  chave: string;
  inicioMs: number;
  visitante: string;
  fbp: string;
  fbc: string | null;
  /** URL da primeira pagina (com as UTMs do anuncio, quando houver). */
  chegada: string;
  /** De onde veio (o Referer da primeira pagina). */
  origemHost: string | null;
  skus: string[];
  token: string;
}

function eventoDeFunil(
  r: Sorteio,
  s: Sessao,
  chave: ChaveEvento,
  ms: number,
  i: number,
  url: string,
  referrer: string | null
): LinhaEvento {
  const doPixel = chave === "begin_checkout" || chave === "payment_info";
  const eventId = doPixel ? idDoEventoDoCheckout(chave, s.token) : idDoEventoDeNavegador(chave, s.visitante, Math.floor(ms));
  return linhaEnviada(r, {
    id: uuid(`funil:${s.chave}:${chave}:${i}`),
    event_name: chave,
    event_id: eventId,
    order_id: eventId,
    payload: payloadMinimo(urlDoFeed(url), s.fbc),
    visitor_id: s.visitante,
    referrer,
    checkout_token: doPixel ? s.token : null,
    criadoMs: Math.floor(ms),
  });
}

/** Os eventos de uma sessao: ver produto, carrinho, checkout e pagamento, ate onde ela foi. */
function eventosDaSessao(r: Sorteio, s: Sessao, ate: "vi" | "atc" | "ic" | "pi", fimMs: number): LinhaEvento[] {
  const saida: LinhaEvento[] = [];
  const produto = POR_SKU.get(s.skus[0])!;
  const pagina = paginaDoProduto(produto);
  // A maioria das visitas de anuncio ve um produto so (media ~1,3).
  const nVi = r.peso([[1, 72], [2, 25], [3, 3]] as const);
  // Distribui do inicio da sessao ate pouco antes do fim.
  const passos = nVi + (ate === "vi" ? 0 : ate === "atc" ? 1 : ate === "ic" ? 2 : 3);
  const duracao = Math.max(60_000, fimMs - s.inicioMs);
  let t = s.inicioMs;
  const proximo = () => {
    t += duracao / (passos + 1) * r.entre(0.6, 1.3);
    return Math.min(t, fimMs);
  };
  for (let i = 0; i < nVi; i += 1) {
    const sku = i === 0 ? s.skus[0] : r.peso(CATALOGO.map((c) => [c.sku, c.principal + c.extra] as const));
    const url = i === 0 ? s.chegada : paginaDoProduto(POR_SKU.get(sku)!);
    const ref = i === 0 ? s.origemHost : pagina;
    saida.push(eventoDeFunil(r, s, "view_item", i === 0 ? s.inicioMs : proximo(), i, url, ref));
  }
  if (ate === "vi") return saida;
  saida.push(eventoDeFunil(r, s, "add_to_cart", proximo(), 0, pagina, pagina));
  if (ate === "atc") return saida;
  const checkout = `https://${DOMINIO}/checkouts/cn/${s.token}/en-us`;
  saida.push(eventoDeFunil(r, s, "begin_checkout", proximo(), 0, checkout, `https://${DOMINIO}/cart`));
  if (ate === "ic") return saida;
  saida.push(eventoDeFunil(r, s, "payment_info", proximo(), 0, checkout, `https://${DOMINIO}/cart`));
  return saida;
}

function hostDeOrigem(p: Pick<PedidoPlano, "origem">): string | null {
  const o = p.origem;
  if (o.tipo === "meta") return o.posicionamento.startsWith("Instagram") ? "https://l.instagram.com/" : "https://m.facebook.com/";
  if (o.tipo === "google") return "https://www.google.com/";
  if (o.tipo === "email") return "https://mail.google.com/";
  if (o.tipo === "pinterest") return "https://www.pinterest.com/";
  return null;
}

/**
 * Sessoes sem compra por compra do dia, pelo ponto em que pararam. A
 * referencia e a de uma loja de anuncio que vende bem: ~3,5% das sessoes
 * compram, 10-14% poem no carrinho, e 75-85% dos cliques do Meta viram sessao.
 */
export const SESSOES_SEM_COMPRA = { vi: 24, atc: 2, ic: 0.6, pi: 0.4 } as const;

/**
 * O funil do dia (ver produto, carrinho, checkout, pagamento) na fila do
 * Meta: a sessao de cada pedido e as que nao compraram, na proporcao das
 * lojas reais. So o que ja aconteceu (<= agora).
 */
export function funilDoDia(d: DiaPlano, agoraMs: number): LinhaEvento[] {
  const saida: LinhaEvento[] = [];
  const vendas = d.pedidos.filter((p) => p.tipo === "venda" && p.total > 0);

  for (const p of vendas) {
    const r = new Sorteio(`funil-pedido:${p.id}`);
    const o = p.origem;
    const inicioMs =
      (o.tipo === "meta" || o.tipo === "google") && o.sessao
        ? o.cliqueMs
        : o.tipo === "email" || o.tipo === "pinterest"
          ? o.cliqueMs
          : p.criadoMs - r.entre(6, 35) * MIN;
    const s: Sessao = {
      chave: `pedido:${p.id}`,
      inicioMs,
      visitante: p.visitante,
      fbp: p.fbp,
      fbc: fbcDe(p),
      chegada: o.tipo === "direto" || o.tipo === "sem_jornada" || ((o.tipo === "meta" || o.tipo === "google") && !o.sessao) ? `https://${DOMINIO}/` : urlDeChegada(p),
      origemHost: (o.tipo === "meta" || o.tipo === "google") && !o.sessao ? null : hostDeOrigem(p),
      skus: p.linhas.map((l) => l.sku),
      token: p.token,
    };
    for (const e of eventosDaSessao(r, s, "pi", p.criadoMs - r.entre(20, 70) * 1000)) {
      if (Date.parse(e.created_at) <= agoraMs) saida.push(e);
    }
  }

  // As sessoes que nao compraram: so produto, ate o carrinho, ate o checkout,
  // ate o pagamento. Por compra: ~27 sessoes sem compra -- conversao de ~3,5%
  // das sessoes, carrinho em ~14% delas, metade dos checkouts vira compra.
  const r = new Sorteio(`funil-dia:${d.dia}`);
  // Dia de pico (promocao, Black Friday) converte mais: menos sessoes sem
  // compra por compra. Sem isto, as sessoes do Meta passavam dos cliques do
  // Meta na semana da Black Friday (o CPM sobe e o clique fica mais caro).
  const n = vendas.length / Math.max(1, fatorDoEvento(d.dia)) / (semanaBfcm(d.dia) ? 1.35 : 1);
  const ruido = () => r.entre(0.9, 1.1);
  const grupos: ["vi" | "atc" | "ic" | "pi", number][] = [
    ["vi", Math.round(n * SESSOES_SEM_COMPRA.vi * ruido())],
    ["atc", Math.round(n * SESSOES_SEM_COMPRA.atc * ruido())],
    ["ic", Math.round(n * SESSOES_SEM_COMPRA.ic * ruido())],
    ["pi", Math.round(n * SESSOES_SEM_COMPRA.pi * ruido())],
  ];
  const metas = campanhasDoDia(d.dia, "meta");
  for (const [ate, quantas] of grupos) {
    for (let i = 0; i < quantas; i += 1) {
      const rs = new Sorteio(`sessao:${d.dia}:${ate}:${i}`);
      const inicioMs = instanteLocal(d.dia, segundoDoDia(rs));
      const produto = rs.peso(CATALOGO.filter((c) => c.principal > 0).map((c) => [c, c.principal] as const));
      const de = rs.peso([["meta", 64], ["google", 11], ["direto", 18], ["outra", 7]] as const);
      let chegada = paginaDoProduto(produto);
      let fbc: string | null = null;
      let origemHost: string | null = null;
      if (de === "meta" && metas.length) {
        const { c } = rs.peso(metas.map((x) => [x, x.peso] as const));
        const conj = rs.peso(conjuntosDoDia(c, d.dia).map((s) => [s, s.peso] as const));
        const ad = rs.peso(conj.anuncios.map((a) => [a, a.peso] as const));
        const lugar = rs.peso(POSICIONAMENTOS);
        const fbclid = `IwZXh0bgNhZW0BMABhZGlkAa${rs.texto(46, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")}`;
        chegada += `?${new URLSearchParams({ utm_source: "FB", utm_campaign: c.id, utm_medium: conj.id, utm_content: ad.id, utm_term: lugar, fbclid })}`;
        fbc = `fb.1.${inicioMs}.${fbclid}`;
        origemHost = lugar.startsWith("Instagram") ? "https://l.instagram.com/" : "https://m.facebook.com/";
      } else if (de === "google") {
        chegada += `?utm_source=google&gclid=Cj0KCQjw${rs.texto(60, "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-")}`;
        origemHost = "https://www.google.com/";
      } else if (de === "outra") {
        origemHost = rs.chance(0.5) ? "https://www.pinterest.com/" : "https://www.bing.com/";
      }
      const s: Sessao = {
        chave: `${d.dia}:${ate}:${i}`,
        inicioMs,
        visitante: `${rs.texto(8)}.${rs.texto(10)}`,
        fbp: `fb.1.${inicioMs - Math.floor(rs.entre(0, 20) * 864e5)}.${rs.inteiro(100000000, 2147483647)}`,
        fbc,
        chegada,
        origemHost,
        skus: [produto.sku],
        token: rs.texto(32, "0123456789abcdef"),
      };
      const fim = inicioMs + rs.entre(2, 18) * MIN;
      for (const e of eventosDaSessao(rs, s, ate, fim)) {
        if (Date.parse(e.created_at) <= agoraMs) saida.push(e);
      }
    }
  }
  return saida;
}

// ---------------------------------------------------------------------------
// Gasto de anuncio (ad_spend_daily)
// ---------------------------------------------------------------------------

export interface GastoCampanha {
  campanha: Campanha;
  gasto: number;
  impressoes: number;
  cliques: number;
  compras: number;
  valorCompras: number;
  /** Pedidos ligados a campanha pela origem gravada (fin_order_origem). */
  pedidos: PedidoPlano[];
}

export interface GastoDoDia {
  dia: string;
  meta: number;
  google: number;
  campanhas: GastoCampanha[];
}

/**
 * O gasto do dia por conta e campanha. `total` e o gasto do dia inteiro (a
 * conta do lucro); `fracao` e quanto do dia ja passou (1 nos dias fechados).
 * Impressao e clique saem do CPM/CPC da campanha; compra e valor sao o que a
 * PLATAFORMA reporta -- um pouco abaixo dos pedidos ligados a ela, como no
 * Gerenciador de verdade.
 */
export function gastoDoDia(d: DiaPlano, total: number, fracao: number, agoraMs: number): GastoDoDia {
  const r = new Sorteio(`gasto:${d.dia}`);
  const gastoAteAgora = total * fracao;
  const meta = arred(gastoAteAgora * d.meta.fatiaMeta);
  const google = arred(gastoAteAgora - meta);
  // Sexta o leilao do Meta e mais caro; o dia ruim do Meta (EVENTOS) e a
  // semana da Black Friday, mais ainda.
  const leilao =
    (diaDaSemana(d.dia) === 5 ? 1.04 : 1) * (d.dia === "2026-08-12" ? 1.25 : 1) * (semanaBfcm(d.dia) ? 1.35 : 1);
  const ligados = d.pedidos.filter((p) => p.tipo === "venda" && p.criadoMs <= agoraMs);

  const campanhas: GastoCampanha[] = [];
  for (const plataforma of ["meta", "google"] as const) {
    const ativas = campanhasDoDia(d.dia, plataforma).map((x) => ({ ...x, peso: x.peso * Math.exp(0.08 * r.normal()) }));
    const soma = ativas.reduce((s, x) => s + x.peso, 0) || 1;
    // O total das campanhas fica um pouco abaixo do da conta (anuncio apagado, arredondamento).
    const daConta = (plataforma === "meta" ? meta : google) * r.entre(0.992, 0.999);
    for (const { c, peso } of ativas) {
      const gasto = arred((daConta * peso) / soma);
      const pedidos = ligados.filter(
        (p) => (p.origem.tipo === "meta" || p.origem.tipo === "google") && p.origem.campanha.id === c.id
      );
      const valorPedidos = pedidos.reduce((s, p) => s + p.total, 0);
      let impressoes: number;
      let cliques: number;
      let compras: number;
      let valorCompras: number;
      if (plataforma === "meta") {
        const cpm = c.custoMidia * Math.exp(0.07 * r.normal()) * leilao;
        impressoes = Math.round((gasto / cpm) * 1000);
        const ctr = (c.nome.startsWith("RT") ? 0.021 : 0.0125) * Math.exp(0.1 * r.normal());
        cliques = Math.round(impressoes * ctr);
        const f = r.entre(0.84, 0.96);
        compras = Math.round(pedidos.length * f);
        valorCompras = arred(valorPedidos * f * r.entre(0.97, 1.02));
      } else {
        const cpc = c.custoMidia * Math.exp(0.08 * r.normal());
        cliques = Math.round(gasto / cpc);
        const ctr = c.tipo === "SEARCH" ? r.entre(0.05, 0.08) : c.tipo === "PMAX" ? r.entre(0.012, 0.018) : r.entre(0.009, 0.013);
        impressoes = Math.round(cliques / ctr);
        const f = r.entre(0.95, 1.18);
        compras = arred(pedidos.length * f, 2);
        valorCompras = arred(valorPedidos * f, 2);
      }
      campanhas.push({ campanha: c, gasto, impressoes, cliques, compras, valorCompras, pedidos });
    }
  }
  return { dia: d.dia, meta, google, campanhas };
}

/** O gasto do dia em linhas de ad_spend_daily (nivel conta e campanha). */
export function linhasDeGasto(g: GastoDoDia, sincronizadoEm: string): AdSpendDailyRow[] {
  const linhas: AdSpendDailyRow[] = [];
  for (const [conta, plataforma, total] of [
    [CONTA_META.id, "meta", g.meta],
    [CONTA_GOOGLE.id, "google", g.google],
  ] as const) {
    const fonte = plataforma === "meta" ? "api" : "script";
    const daConta = g.campanhas.filter((x) => x.campanha.plataforma === plataforma);
    linhas.push({
      ad_account_id: conta,
      user_id: ARTHUR,
      data: g.dia,
      nivel: "conta",
      campanha_id: "",
      campanha_nome: null,
      moeda: MOEDA,
      gasto: total,
      impressoes: daConta.reduce((s, x) => s + x.impressoes, 0),
      cliques: daConta.reduce((s, x) => s + x.cliques, 0),
      compras: arred(daConta.reduce((s, x) => s + x.compras, 0), 2),
      valor_compras: arred(daConta.reduce((s, x) => s + x.valorCompras, 0)),
      fonte,
      sincronizado_em: sincronizadoEm,
    });
    for (const x of daConta) {
      linhas.push({
        ad_account_id: conta,
        user_id: ARTHUR,
        data: g.dia,
        nivel: "campanha",
        campanha_id: x.campanha.id,
        campanha_nome: x.campanha.nome,
        moeda: MOEDA,
        gasto: x.gasto,
        impressoes: x.impressoes,
        cliques: x.cliques,
        compras: x.compras,
        valor_compras: x.valorCompras,
        fonte,
        sincronizado_em: sincronizadoEm,
      });
    }
  }
  return linhas;
}

/** Quando o gasto de um dia fechado foi lido pela ultima vez: madrugada do dia seguinte. */
export function sincronizadoDoDia(dia: string, agoraMs: number): string {
  return iso(Math.min(agoraMs, instanteLocal(somarDia(dia, 1), 3 * 3600 + 14 * 60)));
}

// ---------------------------------------------------------------------------
// Campanhas (ad_insights_granular): o retrato de hoje
// ---------------------------------------------------------------------------

export interface LinhaGranular {
  user_id: string;
  ad_account_id: string;
  plataforma: "meta" | "google";
  data: string;
  nivel: "conta" | "campanha" | "grupo" | "anuncio";
  objeto_id: string;
  objeto_nome: string;
  objeto_status: string;
  campanha_id: string | null;
  campanha_nome: string | null;
  grupo_id: string | null;
  grupo_nome: string | null;
  tipo: string | null;
  orcamento: number;
  cpa_desejado: number | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  cpc: number;
  cpm: number;
  ctr: number;
  vendas: number;
  faturamento: number;
  custo_produto: number;
  lucro: number;
  roas: number;
  roi: number;
  margem: number;
  cpa: number;
  ic: number;
  cpi: number;
  vis_video: number;
  vis_3s: number;
  retencao_75: number;
  hook_rate: number;
  hold_rate: number;
  frequencia: number;
  moeda: string;
  sincronizado_em: string;
}

interface Numeros {
  gasto: number;
  impressoes: number;
  cliques: number;
  vendas: number;
  faturamento: number;
  custo: number;
}

/**
 * Campanha, conjunto e anuncio de HOJE (a tela Campanhas mostra o que esta
 * na tabela, sem filtro de data: um retrato so). Valores em BRL, a moeda que
 * a tela formata. Objeto parado fica PAUSED com zero; o nome continua servindo
 * a tela Pedidos (conjunto e anuncio de pedidos antigos).
 */
export function granularDeHoje(
  g: GastoDoDia,
  dia: string,
  pedidoPorId: Map<string, FinOrderRow>,
  custos: ProductCostRow[],
  brlPorUsd: number,
  sincronizadoEm: string
): LinhaGranular[] {
  const r = new Sorteio(`granular:${dia}`);
  const linhas: LinhaGranular[] = [];
  const brl = (v: number) => arred(v * brlPorUsd);

  const numerosDosPedidos = (pedidos: PedidoPlano[]) => {
    let faturamento = 0;
    let custo = 0;
    for (const p of pedidos) {
      const f = pedidoPorId.get(p.id);
      if (!f) continue;
      faturamento += Math.max(0, paraNumero(f.liquido_pago) - paraNumero(f.imposto_atual));
      custo += cmvDoPedido(f, custos);
    }
    return { vendas: pedidos.length, faturamento, custo };
  };

  const linha = (
    base: Pick<LinhaGranular, "ad_account_id" | "plataforma" | "nivel" | "objeto_id" | "objeto_nome" | "objeto_status" | "campanha_id" | "campanha_nome" | "grupo_id" | "grupo_nome" | "tipo"> & {
      orcamento?: number;
      cpaDesejado?: number | null;
      video?: boolean;
      retargeting?: boolean;
    },
    n: Numeros
  ): LinhaGranular => {
    const lucro = n.faturamento - n.custo - n.gasto;
    const ic = n.vendas > 0 ? Math.round(n.vendas * r.entre(1.7, 2.3)) : n.gasto > 0 ? r.inteiro(0, 2) : 0;
    // Hook = visualizacao de 3 s / impressao; a reproducao (qualquer tempo) e maior que a de 3 s.
    const hook = base.video ? r.entre(0.22, 0.36) : 0;
    const vis3s = Math.round(n.impressoes * hook);
    const visVideo = base.video ? Math.round(vis3s / r.entre(0.68, 0.84)) : 0;
    return {
      user_id: ARTHUR,
      ad_account_id: base.ad_account_id,
      plataforma: base.plataforma,
      data: dia,
      nivel: base.nivel,
      objeto_id: base.objeto_id,
      objeto_nome: base.objeto_nome,
      objeto_status: base.objeto_status,
      campanha_id: base.campanha_id,
      campanha_nome: base.campanha_nome,
      grupo_id: base.grupo_id,
      grupo_nome: base.grupo_nome,
      tipo: base.tipo,
      orcamento: brl(base.orcamento ?? 0),
      cpa_desejado: base.cpaDesejado ? brl(base.cpaDesejado) : null,
      gasto: brl(n.gasto),
      impressoes: n.impressoes,
      cliques: n.cliques,
      cpc: n.cliques > 0 ? brl(n.gasto / n.cliques) : 0,
      cpm: n.impressoes > 0 ? brl((n.gasto / n.impressoes) * 1000) : 0,
      ctr: n.impressoes > 0 ? arred((n.cliques / n.impressoes) * 100) : 0,
      vendas: n.vendas,
      faturamento: brl(n.faturamento),
      custo_produto: brl(n.custo),
      lucro: brl(lucro),
      roas: n.gasto > 0 ? arred(n.faturamento / n.gasto) : 0,
      roi: n.gasto + n.custo > 0 ? arred((lucro / (n.gasto + n.custo)) * 100) : 0,
      margem: n.faturamento > 0 ? arred((lucro / n.faturamento) * 100) : 0,
      cpa: n.vendas > 0 ? brl(n.gasto / n.vendas) : 0,
      ic,
      cpi: ic > 0 ? brl(n.gasto / ic) : 0,
      vis_video: visVideo,
      vis_3s: vis3s,
      retencao_75: base.video ? arred(r.entre(3, 9)) : 0,
      hook_rate: base.video ? arred(hook * 100) : 0,
      hold_rate: base.video ? arred(r.entre(8, 18)) : 0,
      frequencia: n.impressoes > 0 ? arred(base.retargeting ? r.entre(2.1, 2.8) : r.entre(1.08, 1.6)) : 1,
      moeda: "BRL",
      sincronizado_em: sincronizadoEm,
    };
  };

  const somar = (lista: Numeros[]): Numeros =>
    lista.reduce(
      (a, b) => ({
        gasto: a.gasto + b.gasto,
        impressoes: a.impressoes + b.impressoes,
        cliques: a.cliques + b.cliques,
        vendas: a.vendas + b.vendas,
        faturamento: a.faturamento + b.faturamento,
        custo: a.custo + b.custo,
      }),
      { gasto: 0, impressoes: 0, cliques: 0, vendas: 0, faturamento: 0, custo: 0 }
    );
  const zero: Numeros = { gasto: 0, impressoes: 0, cliques: 0, vendas: 0, faturamento: 0, custo: 0 };

  for (const conta of [CONTA_META, CONTA_GOOGLE]) {
    const plataforma = conta === CONTA_META ? "meta" : "google";
    const daConta: Numeros[] = [];
    // So o que ja foi criado: campanha que ainda vai entrar no ar nao existe na conta.
    for (const c of CAMPANHAS.filter((x) => x.plataforma === plataforma && x.inicio <= dia)) {
      const hoje = g.campanhas.find((x) => x.campanha.id === c.id);
      const noAr = Boolean(hoje);
      const cbo = c.tipo !== "ABO";
      const totalCampanha: Numeros = hoje
        ? {
            gasto: hoje.gasto,
            impressoes: hoje.impressoes,
            cliques: hoje.cliques,
            ...numerosDosPedidos(hoje.pedidos),
          }
        : zero;
      daConta.push(totalCampanha);
      const baseCampanha = {
        ad_account_id: conta.id,
        plataforma,
        campanha_id: c.id,
        campanha_nome: c.nome,
        tipo: c.tipo === "ASC" ? "CBO" : c.tipo === "ABO" ? "ABO" : plataforma === "google" ? c.tipo : "CBO",
      } as const;
      linhas.push(
        linha(
          {
            ...baseCampanha,
            nivel: "campanha",
            objeto_id: c.id,
            objeto_nome: c.nome,
            objeto_status: noAr ? "ACTIVE" : "PAUSED",
            grupo_id: null,
            grupo_nome: null,
            orcamento: cbo ? c.orcamento : 0,
            cpaDesejado: plataforma === "meta" && c.tipo !== "ABO" ? 52 : null,
            retargeting: c.nome.startsWith("RT"),
          },
          totalCampanha
        )
      );

      // Conjuntos (grupos) e anuncios: o gasto da campanha repartido pelo peso.
      const conjuntosNoAr = noAr ? conjuntosDoDia(c, dia) : [];
      const somaConj = conjuntosNoAr.reduce((s, x) => s + x.peso, 0) || 1;
      for (const s of c.conjuntos) {
        const ativo = conjuntosNoAr.includes(s);
        const parte = ativo ? (s.peso / somaConj) * r.entre(0.9, 1.1) : 0;
        const pedidosConj = hoje
          ? hoje.pedidos.filter((p) =>
              p.origem.tipo === "meta" ? p.origem.conjunto.id === s.id : p.origem.tipo === "google" && p.origem.grupo?.id === s.id
            )
          : [];
        const nConj: Numeros = ativo
          ? {
              gasto: totalCampanha.gasto * parte,
              impressoes: Math.round(totalCampanha.impressoes * parte),
              cliques: Math.round(totalCampanha.cliques * parte),
              ...numerosDosPedidos(pedidosConj),
            }
          : zero;
        const baseConj = { ...baseCampanha, grupo_id: s.id, grupo_nome: s.nome };
        linhas.push(
          linha(
            {
              ...baseConj,
              nivel: "grupo",
              objeto_id: s.id,
              objeto_nome: s.nome,
              objeto_status: ativo ? "ACTIVE" : "PAUSED",
              orcamento: cbo ? 0 : s.orcamento,
              retargeting: c.nome.startsWith("RT"),
            },
            nConj
          )
        );
        const somaAds = s.anuncios.reduce((x, a) => x + a.peso, 0) || 1;
        for (const a of s.anuncios) {
          const parteAd = (a.peso / somaAds) * r.entre(0.85, 1.15);
          const pedidosAd = pedidosConj.filter((p) =>
            p.origem.tipo === "meta" ? p.origem.anuncio.id === a.id : p.origem.tipo === "google" && p.origem.criativo?.id === a.id
          );
          const nAd: Numeros = ativo
            ? {
                gasto: nConj.gasto * parteAd,
                impressoes: Math.round(nConj.impressoes * parteAd),
                cliques: Math.round(nConj.cliques * parteAd),
                ...numerosDosPedidos(pedidosAd),
              }
            : zero;
          linhas.push(
            linha(
              {
                ...baseConj,
                nivel: "anuncio",
                objeto_id: a.id,
                objeto_nome: a.nome,
                objeto_status: ativo ? "ACTIVE" : "PAUSED",
                video: a.nome.startsWith("VID"),
                retargeting: c.nome.startsWith("RT"),
              },
              nAd
            )
          );
        }
      }
    }
    linhas.push(
      linha(
        {
          ad_account_id: conta.id,
          plataforma,
          nivel: "conta",
          objeto_id: conta.external_id,
          objeto_nome: conta.nome,
          objeto_status: "ACTIVE",
          campanha_id: null,
          campanha_nome: null,
          grupo_id: null,
          grupo_nome: null,
          tipo: null,
        },
        somar(daConta)
      )
    );
  }
  return linhas;
}
