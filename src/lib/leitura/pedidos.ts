import { criarConversor, rotuloLoja, type Conversor, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import {
  chaveSku,
  custoVigente,
  diaNoFuso,
  formatarDinheiro,
  paraNumero,
  pedidoConta,
  pedidoTemCusto,
  qtdParaCusto,
  receitaDoPedido,
  somarDias,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type LojaDoSeletor,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";
import { motivoParaIgnorarPedido } from "@/lib/tracking/filtro-pedido";

// ============================================================================
// Tela Pedidos: um pedido por linha, com o lucro dele, de onde veio e se a
// compra chegou na plataforma de anuncio. Puro (sem "server-only"): quem le o
// banco e pedidos-banco.ts, e o vitest trava as regras em
// tests/pedidos-tela.test.ts.
//
// O lucro e a MESMA conta do Dashboard (src/lib/financeiro/calculo.ts), pedido
// a pedido: receita - produto e frete do fornecedor - taxa de pagamento. Sem o
// anuncio: o gasto e por conta e por dia, nao por pedido.
//
// O que o banco NAO tem fica de fora, nao inventado:
//   - nome do produto (fin_orders.linhas guarda so o SKU);
//   - origem de loja sem pixel do Meta: a origem vem do Purchase que o webhook
//     grava (fbc e URL de chegada), e so o Meta sai do servidor;
//   - se a compra chegou no Google: ela sai pela tag no navegador.
// ============================================================================

// ---------------------------------------------------------------------------
// Origem
// ---------------------------------------------------------------------------

export type OrigemId = "meta" | "google" | "email" | "outra" | "direto";

export interface Origem {
  id: OrigemId;
  /** "Meta Ads", "Google Ads", "E-mail", "tiktok", "Direto". */
  rotulo: string;
  /** utm_campaign, decodificado. */
  campanha: string | null;
  /** Como se sabe: vai para o detalhe. */
  pista: string;
}

/** O que o Purchase do pedido guardou: o cookie de clique e a URL de chegada. */
export interface SinaisDeOrigem {
  fbc?: string | null;
  url?: string | null;
}

const FONTES_META = new Set(["facebook", "fb", "ig", "instagram", "meta", "facebook_ads", "fbads", "an", "messenger"]);
const FONTES_GOOGLE = new Set(["google", "adwords", "googleads", "google_ads", "youtube"]);
const FONTES_EMAIL = new Set(["email", "e-mail", "klaviyo", "newsletter", "mail", "omnisend", "mailchimp"]);

function decodificar(v: string | null): string | null {
  if (!v) return null;
  const limpo = v.replace(/\+/g, " ").trim();
  return limpo || null;
}

/** Os parametros da URL de chegada. URL cortada (255 da Shopify) ou torta nao lanca. */
function parametros(url: string | null | undefined): URLSearchParams {
  const texto = String(url || "");
  const i = texto.indexOf("?");
  if (i < 0) return new URLSearchParams();
  try {
    return new URLSearchParams(texto.slice(i + 1).split("#")[0]);
  } catch {
    return new URLSearchParams();
  }
}

/**
 * De onde o pedido veio, do mais especifico para o mais generico: click id na
 * URL de chegada (e desta sessao), utm_source, e o cookie de clique do Meta
 * (fbc, que pode ser de um clique de dias antes). Sem sinal nenhum: Direto.
 */
export function origemDoPedido(s: SinaisDeOrigem | null | undefined): Origem {
  if (!s) {
    return { id: "direto", rotulo: "Direto", campanha: null, pista: "Sem evento de rastreamento deste pedido" };
  }
  const p = parametros(s.url);
  const campanha = decodificar(p.get("utm_campaign"));
  if (p.get("gclid") || p.get("gbraid") || p.get("wbraid")) {
    return { id: "google", rotulo: "Google Ads", campanha, pista: "Clique do Google na URL de chegada" };
  }
  if (p.get("fbclid")) {
    return { id: "meta", rotulo: "Meta Ads", campanha, pista: "Clique do Meta na URL de chegada" };
  }
  const fonte = decodificar(p.get("utm_source"));
  const chave = (fonte || "").toLowerCase();
  const meio = (p.get("utm_medium") || "").toLowerCase();
  if (fonte) {
    if (FONTES_META.has(chave)) return { id: "meta", rotulo: "Meta Ads", campanha, pista: `utm_source=${fonte}` };
    if (FONTES_GOOGLE.has(chave)) return { id: "google", rotulo: "Google Ads", campanha, pista: `utm_source=${fonte}` };
    if (FONTES_EMAIL.has(chave) || meio === "email") {
      return { id: "email", rotulo: "E-mail", campanha, pista: `utm_source=${fonte}` };
    }
    return { id: "outra", rotulo: fonte, campanha, pista: `utm_source=${fonte}` };
  }
  if ((s.fbc || "").trim()) {
    return { id: "meta", rotulo: "Meta Ads", campanha, pista: "Cookie de clique do Meta (fbc)" };
  }
  return { id: "direto", rotulo: "Direto", campanha, pista: "Sem clique de anúncio na chegada" };
}

// ---------------------------------------------------------------------------
// Envio da compra
// ---------------------------------------------------------------------------

/**
 * - enviado / falhou / pendente: o que a fila diz do Purchase deste pedido;
 * - faltou: loja com Meta ligado e nenhum Purchase para o pedido;
 * - aguardando: o mesmo, mas o pedido tem menos de 15 minutos;
 * - sem_pixel: a loja nao tinha Meta ligado (ou o pixel nasceu depois);
 * - nao_se_aplica: pedido que nunca vira conversao (draft, valor zero...);
 * - tag: Google. A compra sai pela tag no navegador e o servidor nao sabe
 *   se chegou -- nunca verde nem vermelho.
 */
export type EstadoEnvio =
  | "enviado"
  | "falhou"
  | "pendente"
  | "faltou"
  | "aguardando"
  | "sem_pixel"
  | "nao_se_aplica"
  | "tag";

export type StatusFila = "enviado" | "falhou" | "pendente";

/** Pedido mais novo que isto ainda pode estar a caminho da fila. */
export const JANELA_AGUARDANDO_MS = 15 * 60 * 1000;

export function estadoMeta(e: {
  /** Status de cada Purchase do pedido na fila (um por pixel Meta). */
  eventos: readonly StatusFila[];
  /** O pedido vira conversao? (motivoParaIgnorarPedido) */
  aplica: boolean;
  /** created_at do primeiro pixel Meta ativo, com o rastreamento ligado. null = sem Meta. */
  metaDesde: string | null;
  processadoEm: string;
  agoraMs: number;
}): EstadoEnvio {
  if (e.eventos.length) {
    if (e.eventos.includes("falhou")) return "falhou";
    return e.eventos.every((s) => s === "enviado") ? "enviado" : "pendente";
  }
  if (!e.metaDesde) return "sem_pixel";
  if (!e.aplica) return "nao_se_aplica";
  const pedidoMs = Date.parse(e.processadoEm);
  const desdeMs = Date.parse(e.metaDesde);
  if (Number.isFinite(pedidoMs) && Number.isFinite(desdeMs) && pedidoMs < desdeMs) return "sem_pixel";
  if (Number.isFinite(pedidoMs) && e.agoraMs - pedidoMs < JANELA_AGUARDANDO_MS) return "aguardando";
  return "faltou";
}

/** Para o filtro "Nao chegou na plataforma". */
export function naoChegou(estado: EstadoEnvio): boolean {
  return estado === "falhou" || estado === "faltou";
}

// ---------------------------------------------------------------------------
// Status do pedido
// ---------------------------------------------------------------------------

export type TomPedido = "ok" | "warn" | "err" | "info" | "neutral";

export interface StatusPedido {
  id: "cancelado" | "reembolsado" | "reembolso_parcial" | "aguardando_pagamento" | "enviado" | "parcial" | "nao_enviado";
  rotulo: string;
  tom: TomPedido;
}

export function statusDoPedido(
  p: Pick<FinOrderRow, "cancelado_em" | "reembolsado" | "liquido_pago" | "recebido" | "tipo" | "linhas">
): StatusPedido {
  if (p.cancelado_em) return { id: "cancelado", rotulo: "Cancelado", tom: "err" };
  if (paraNumero(p.reembolsado) > 0) {
    return paraNumero(p.liquido_pago) <= 0
      ? { id: "reembolsado", rotulo: "Reembolsado", tom: "warn" }
      : { id: "reembolso_parcial", rotulo: "Reembolso parcial", tom: "warn" };
  }
  if (p.tipo === "venda" && paraNumero(p.recebido) <= 0) {
    return { id: "aguardando_pagamento", rotulo: "Aguardando pagamento", tom: "neutral" };
  }
  let total = 0;
  let enviadas = 0;
  for (const l of Array.isArray(p.linhas) ? p.linhas : []) {
    const q = paraNumero(l.qtd);
    total += q;
    enviadas += Math.max(0, q - paraNumero(l.qtd_nao_enviada));
  }
  if (total > 0 && enviadas >= total) return { id: "enviado", rotulo: "Enviado", tom: "ok" };
  if (enviadas > 0) return { id: "parcial", rotulo: "Envio parcial", tom: "info" };
  return { id: "nao_enviado", rotulo: "Não enviado", tom: "neutral" };
}

// ---------------------------------------------------------------------------
// Valores e lucro do pedido (a conta do Dashboard, pedido a pedido)
// ---------------------------------------------------------------------------

export interface ItemPedido {
  sku: string;
  qtd: number;
  /** Preco unitario, moeda do relatorio. */
  preco: number;
  /** Produto + frete do fornecedor das unidades que custam. null = sem custo. */
  custo: number | null;
  /** sku = custo cadastrado; estimado = custo padrao (%) da loja; sem = nenhum. */
  custoTipo: "sku" | "estimado" | "sem" | "nenhuma_unidade";
}

export interface ValoresPedido {
  produtos: number;
  frete: number;
  desconto: number;
  /** O que entrou antes do reembolso, sem imposto, alfandega e gorjeta. */
  faturamento: number;
  /** Receita do Dashboard: faturamento - reembolso. */
  receita: number;
  cmv: number;
  taxa: number;
  /** A loja tem taxa de pagamento cadastrada. */
  temTaxa: boolean;
  reembolso: number;
  /** receita - cmv - taxa. null quando algum item nao tem custo nem custo padrao. */
  lucro: number | null;
  /** O lucro como o Dashboard soma (item sem custo entra com custo 0). */
  lucroComoDashboard: number;
  semCusto: boolean;
}

export interface ContextoValores {
  moeda: string;
  converter: Conversor;
  cfg: FinStoreSettingsRow | undefined;
  /** Versoes de custo da loja do pedido, por chaveSku. */
  custosPorSku: Map<string, ProductCostRow[]>;
}

/**
 * Valores do pedido na moeda do relatorio, pela cotacao do dia do pedido.
 * null = moeda sem cotacao nenhuma (o Dashboard deixa o pedido de fora).
 * As regras sao as de calcularFinanceiro, chamadas na mesma ordem.
 */
export function valoresDoPedido(
  p: FinOrderRow,
  ctx: ContextoValores
): { valores: ValoresPedido | null; itens: ItemPedido[] } {
  const dia = String(p.dia_local).slice(0, 10);
  const moedaPedido = String(p.moeda || "").toUpperCase();
  const fator = ctx.converter(1, moedaPedido, ctx.moeda, dia);
  const k = fator ? fator.valor : null;
  const linhas = Array.isArray(p.linhas) ? p.linhas : [];

  const receita = receitaDoPedido(p);
  const conta = pedidoConta(p);
  const cfg = ctx.cfg;
  const taxa =
    conta && cfg ? (paraNumero(p.recebido) * paraNumero(cfg.taxa_pct)) / 100 + paraNumero(cfg.taxa_fixa) : 0;
  const pctPadrao =
    cfg && cfg.custo_padrao_pct !== null && cfg.custo_padrao_pct !== undefined
      ? paraNumero(cfg.custo_padrao_pct)
      : null;

  let cmv = 0;
  let semCusto = false;
  const itens: ItemPedido[] = linhas.map((l) => {
    const item: ItemPedido = {
      sku: chaveSku(l.sku),
      qtd: paraNumero(l.qtd),
      preco: paraNumero(l.preco) * (k ?? 0),
      custo: null,
      custoTipo: "nenhuma_unidade",
    };
    if (!pedidoTemCusto(p)) return item;
    const q = qtdParaCusto(l, Boolean(p.cancelado_em), p.tipo === "venda" && paraNumero(p.recebido) <= 0);
    if (q <= 0) {
      item.custo = 0;
      return item;
    }
    const base = paraNumero(l.preco) * q;
    const versao = custoVigente(ctx.custosPorSku.get(chaveSku(l.sku)) ?? [], dia);
    if (versao) {
      const bruto = (paraNumero(versao.custo_unitario) + paraNumero(versao.frete_unitario)) * q;
      const c = ctx.converter(bruto, versao.moeda, moedaPedido, dia);
      if (c) {
        cmv += c.valor;
        item.custo = c.valor * (k ?? 0);
        item.custoTipo = "sku";
        return item;
      }
    }
    if (pctPadrao !== null) {
      const estimado = (base * pctPadrao) / 100;
      cmv += estimado;
      item.custo = estimado * (k ?? 0);
      item.custoTipo = "estimado";
    } else {
      semCusto = true;
      item.custoTipo = "sem";
    }
    return item;
  });

  if (k === null) return { valores: null, itens };

  const reembolso = p.tipo === "venda" ? paraNumero(p.reembolsado) : 0;
  const lucro = receita - cmv - taxa;
  return {
    valores: {
      produtos: linhas.reduce((s, l) => s + paraNumero(l.preco) * paraNumero(l.qtd), 0) * k,
      frete: paraNumero(p.frete_cobrado) * k,
      desconto: paraNumero(p.descontos) * k,
      faturamento: (receita + reembolso) * k,
      receita: receita * k,
      cmv: cmv * k,
      taxa: taxa * k,
      temTaxa: Boolean(cfg),
      reembolso: reembolso * k,
      lucro: semCusto ? null : lucro * k,
      lucroComoDashboard: lucro * k,
      semCusto,
    },
    itens,
  };
}

// ---------------------------------------------------------------------------
// Pecas de tela
// ---------------------------------------------------------------------------

/** Pedido no admin da Shopify da loja. Id que nao e numero nao vira link. */
export function urlNaShopify(dominio: string, pedidoId: string): string | null {
  if (!/^\d+$/.test(pedidoId)) return null;
  const d = String(dominio || "").trim().toLowerCase();
  const loja = /^([a-z0-9][a-z0-9-]*)\.myshopify\.com$/.exec(d);
  if (loja) return `https://admin.shopify.com/store/${loja[1]}/orders/${pedidoId}`;
  if (!d || !/^[a-z0-9.-]+$/.test(d)) return null;
  return `https://${d}/admin/orders/${pedidoId}`;
}

const GATEWAYS: Record<string, string> = {
  shopify_payments: "Shopify Payments",
  paypal: "PayPal",
  "paypal express checkout": "PayPal",
  mercado_pago: "Mercado Pago",
  stripe: "Stripe",
  manual: "Manual",
};

export function nomeGateway(gateways: readonly string[] | null | undefined): string | null {
  const cru = (Array.isArray(gateways) ? gateways : []).map((g) => String(g || "").trim()).filter(Boolean);
  if (!cru.length) return null;
  return [...new Set(cru)]
    .map((g) => GATEWAYS[g.toLowerCase()] ?? g.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()))
    .join(" + ");
}

/** "14:22" no fuso; fuso invalido cai em UTC. */
function hora(instante: Date, fuso: string): string {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(instante);
  try {
    return fmt(fuso);
  } catch {
    return fmt("UTC");
  }
}

/** "Hoje, 14:22", "Ontem, 09:10" ou "02/10, 18:40", no fuso do relatorio. */
export function quandoCurto(iso: string | null | undefined, fuso: string, hoje: string): string {
  const ms = Date.parse(String(iso || ""));
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const dia = diaNoFuso(d, fuso);
  const h = hora(d, fuso);
  if (dia === hoje) return `Hoje, ${h}`;
  if (dia === somarDias(hoje, -1)) return `Ontem, ${h}`;
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}, ${h}`;
}

/** "04/10/2026 às 14:22". */
export function quandoLongo(iso: string, fuso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "—";
  const d = new Date(ms);
  const dia = diaNoFuso(d, fuso);
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)} às ${hora(d, fuso)}`;
}

// ---------------------------------------------------------------------------
// Montagem da tela
// ---------------------------------------------------------------------------

export interface PassoJornada {
  titulo: string;
  detalhe: string;
  hora: string;
  tom: TomPedido;
  marca?: "meta" | "google";
}

export interface PedidoTela {
  chave: string;
  id: string;
  nome: string;
  storeId: string;
  loja: string;
  quando: string;
  quandoLongo: string;
  processadoEm: string;
  itensTexto: string;
  skus: string[];
  origem: Origem;
  meta: EstadoEnvio;
  google: EstadoEnvio;
  status: StatusPedido;
  gateway: string | null;
  valores: ValoresPedido | null;
  itens: ItemPedido[];
  jornada: PassoJornada[];
  urlShopify: string | null;
}

/** Um Purchase da fila (tracking_events, destino Meta), sem o payload. */
export interface EventoCompra {
  store_id: string;
  order_id: string;
  destination_id: string | null;
  status: StatusFila;
  attempts: number;
  last_error: string | null;
  created_at: string;
  sent_at: string | null;
  fbc: string | null;
  url: string | null;
}

export interface DestinoLoja {
  id: string;
  store_id: string;
  plataforma: "meta" | "google";
  nome: string | null;
  ativo: boolean;
  created_at: string;
}

export interface ResumoPedidos {
  /** Pedidos que contam (venda com receita), como no Dashboard. */
  pedidos: number;
  /** Receita do Dashboard. */
  faturamento: number;
  /** receita - cmv - taxas do periodo, como o Dashboard soma. */
  lucro: number;
  /** Pedidos com item sem custo (o lucro deles fica "—" na linha). */
  semCusto: number;
  /** Fracao com Purchase enviado, entre os que deviam ir ao Meta. null = nenhum. */
  rastreadas: number | null;
  /** Pedidos em moeda sem cotacao: fora dos valores. */
  semCotacao: number;
}

export interface EntradaPedidos {
  entrada: EntradaFinanceiro;
  lojas: LojaDoSeletor[];
  fuso: string;
  eventos: EventoCompra[];
  destinos: DestinoLoja[];
  /** Lojas com o rastreamento ligado (tracking_configs.enabled). */
  lojasLigadas: string[];
  agoraMs: number;
}

function primeiroCriado(datas: string[]): string | null {
  let menor: string | null = null;
  let menorMs = Infinity;
  for (const d of datas) {
    const ms = Date.parse(d);
    if (Number.isFinite(ms) && ms < menorMs) {
      menorMs = ms;
      menor = d;
    }
  }
  return menor;
}

function textoDosItens(p: FinOrderRow): string {
  const linhas = Array.isArray(p.linhas) ? p.linhas : [];
  if (!linhas.length) return "—";
  return linhas.map((l) => `${paraNumero(l.qtd)}× ${chaveSku(l.sku) || "sem SKU"}`).join(", ");
}

export function montarPedidos(e: EntradaPedidos): { pedidos: PedidoTela[]; resumo: ResumoPedidos } {
  const { entrada, fuso } = e;
  const moeda = entrada.moeda;
  const converter = criarConversor(entrada.cambio);
  const intervalo = entrada.intervalos.atual;
  const lojaPorId = new Map(e.lojas.map((l) => [l.id, l]));
  const configPorLoja = new Map(entrada.configs.map((c) => [c.store_id, c]));
  const ligadas = new Set(e.lojasLigadas);
  const dinheiro = (v: number) => formatarDinheiro(v, moeda, 2);

  const custosPorLoja = new Map<string, Map<string, ProductCostRow[]>>();
  for (const c of entrada.custos) {
    const porSku = custosPorLoja.get(c.store_id) ?? new Map<string, ProductCostRow[]>();
    const chave = chaveSku(c.sku);
    const lista = porSku.get(chave) ?? [];
    lista.push({ ...c, valido_desde: String(c.valido_desde).slice(0, 10) });
    porSku.set(chave, lista);
    custosPorLoja.set(c.store_id, porSku);
  }

  const eventosPorPedido = new Map<string, EventoCompra[]>();
  for (const ev of e.eventos) {
    const chave = `${ev.store_id}:${ev.order_id}`;
    const lista = eventosPorPedido.get(chave) ?? [];
    lista.push(ev);
    eventosPorPedido.set(chave, lista);
  }

  const nomeDestino = new Map(e.destinos.map((d) => [d.id, d.nome]));
  const metaDesde = new Map<string, string | null>();
  const temGoogle = new Set<string>();
  for (const l of e.lojas) {
    const ativos = e.destinos.filter((d) => d.store_id === l.id && d.ativo);
    metaDesde.set(
      l.id,
      ligadas.has(l.id) ? primeiroCriado(ativos.filter((d) => d.plataforma === "meta").map((d) => d.created_at)) : null
    );
    if (ligadas.has(l.id) && ativos.some((d) => d.plataforma === "google")) temGoogle.add(l.id);
  }

  const resumo: ResumoPedidos = { pedidos: 0, faturamento: 0, lucro: 0, semCusto: 0, rastreadas: null, semCotacao: 0 };
  let deviamIr = 0;
  let foram = 0;
  const pedidos: PedidoTela[] = [];

  for (const p of entrada.pedidos) {
    const loja = lojaPorId.get(p.store_id);
    if (!loja) continue;
    // Como no Dashboard: teste e PDV nao sao venda de anuncio.
    if (p.tipo === "teste" || p.tipo === "pdv") continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < intervalo.desde || dia > intervalo.ate) continue;

    const { valores, itens } = valoresDoPedido(p, {
      moeda,
      converter,
      cfg: configPorLoja.get(p.store_id),
      custosPorSku: custosPorLoja.get(p.store_id) ?? new Map(),
    });
    if (valores) {
      if (pedidoConta(p)) resumo.pedidos += 1;
      resumo.faturamento += valores.receita;
      resumo.lucro += valores.lucroComoDashboard;
      if (valores.semCusto) resumo.semCusto += 1;
    } else {
      resumo.semCotacao += 1;
    }

    const chave = `${p.store_id}:${p.shopify_order_id}`;
    const eventos = eventosPorPedido.get(chave) ?? [];
    // A mesma regra do webhook: draft, PDV e valor zero nao viram conversao.
    // Pedido de teste ja saiu acima.
    const motivo = motivoParaIgnorarPedido({
      test: false,
      source_name: p.origem,
      total_price: p.total_bruto,
    });
    const meta = estadoMeta({
      eventos: eventos.map((ev) => ev.status),
      aplica: !motivo && p.tipo === "venda",
      metaDesde: metaDesde.get(p.store_id) ?? null,
      processadoEm: p.processado_em,
      agoraMs: e.agoraMs,
    });
    if (meta === "enviado" || meta === "falhou" || meta === "faltou" || meta === "pendente") {
      deviamIr += 1;
      if (meta === "enviado") foram += 1;
    }
    const google: EstadoEnvio = temGoogle.has(p.store_id) && !motivo ? "tag" : "sem_pixel";

    const comSinal = eventos.find((ev) => ev.url || ev.fbc) ?? eventos[0];
    const origem =
      p.tipo === "reenvio"
        ? { id: "outra" as const, rotulo: "Reenvio", campanha: null, pista: "Pedido de valor zero (reenvio ou troca)" }
        : origemDoPedido(comSinal ? { fbc: comSinal.fbc, url: comSinal.url } : null);
    const status = statusDoPedido(p);
    const gateway = nomeGateway(p.gateways);

    // --- Jornada: so o que o banco registrou deste pedido -------------------
    const jornada: PassoJornada[] = [];
    if (origem.id === "meta" || origem.id === "google") {
      jornada.push({
        titulo: `Clique no anúncio · ${origem.rotulo}`,
        detalhe: origem.campanha ? `utm_campaign=${origem.campanha} · ${origem.pista}` : origem.pista,
        hora: "",
        tom: "info",
        marca: origem.id,
      });
    } else if (origem.id === "email") {
      jornada.push({ titulo: "Link de e-mail", detalhe: origem.pista, hora: "", tom: "neutral" });
    } else if (origem.id === "outra" && p.tipo !== "reenvio") {
      jornada.push({ titulo: `Veio de ${origem.rotulo}`, detalhe: origem.pista, hora: "", tom: "neutral" });
    } else if (origem.id === "direto") {
      jornada.push({ titulo: "Sem clique de anúncio", detalhe: origem.pista, hora: "", tom: "neutral" });
    }
    jornada.push({
      titulo: paraNumero(p.recebido) > 0 ? "Compra paga" : "Pedido criado",
      detalhe: paraNumero(p.recebido) > 0 ? (gateway ?? "Pagamento") : "Sem pagamento recebido",
      hora: quandoCurto(p.processado_em, fuso, entrada.hoje),
      tom: paraNumero(p.recebido) > 0 ? "ok" : "neutral",
    });
    for (const ev of eventos) {
      const destino = ev.destination_id ? nomeDestino.get(ev.destination_id) : null;
      const sufixo = destino ? ` · ${destino}` : "";
      if (ev.status === "enviado") {
        jornada.push({
          titulo: "Compra enviada ao Meta",
          detalhe: `Aceita pelo Meta${sufixo}`,
          hora: quandoCurto(ev.sent_at || ev.created_at, fuso, entrada.hoje),
          tom: "ok",
          marca: "meta",
        });
      } else if (ev.status === "falhou") {
        const n = paraNumero(ev.attempts);
        const erro = (ev.last_error || "").trim().slice(0, 160);
        jornada.push({
          titulo: "Compra não chegou ao Meta",
          detalhe: `Recusada depois de ${n === 1 ? "1 tentativa" : `${n} tentativas`}${sufixo}${erro ? `: ${erro}` : ""}`,
          hora: quandoCurto(ev.created_at, fuso, entrada.hoje),
          tom: "err",
          marca: "meta",
        });
      } else {
        jornada.push({
          titulo: "Compra na fila do Meta",
          detalhe: `O xcart tenta de novo sozinho${sufixo}`,
          hora: quandoCurto(ev.created_at, fuso, entrada.hoje),
          tom: "neutral",
          marca: "meta",
        });
      }
    }
    if (meta === "faltou") {
      jornada.push({
        titulo: "Compra não foi enviada ao Meta",
        detalhe: "A loja tem pixel do Meta, mas não há envio registrado deste pedido.",
        hora: "",
        tom: "err",
        marca: "meta",
      });
    } else if (meta === "aguardando") {
      jornada.push({
        titulo: "Compra a caminho do Meta",
        detalhe: "Pedido recente: o envio sai em instantes.",
        hora: "",
        tom: "neutral",
        marca: "meta",
      });
    } else if (meta === "nao_se_aplica" && motivo) {
      jornada.push({ titulo: "Não vai para o Meta", detalhe: `Motivo: ${motivo}`, hora: "", tom: "neutral", marca: "meta" });
    }
    if (google === "tag") {
      jornada.push({
        titulo: "Compra do Google pela tag do checkout",
        detalhe: "Sai do navegador do comprador; o servidor não confirma a chegada.",
        hora: "",
        tom: "neutral",
        marca: "google",
      });
    }
    if (valores && valores.reembolso > 0) {
      jornada.push({ titulo: "Reembolso", detalhe: dinheiro(valores.reembolso), hora: "", tom: "warn" });
    }
    if (p.cancelado_em) {
      jornada.push({
        titulo: "Pedido cancelado",
        detalhe: "Cancelado na Shopify",
        hora: quandoCurto(p.cancelado_em, fuso, entrada.hoje),
        tom: "err",
      });
    }

    pedidos.push({
      chave,
      id: p.shopify_order_id,
      nome: p.nome || `#${p.shopify_order_id}`,
      storeId: p.store_id,
      loja: rotuloLoja(loja),
      quando: quandoCurto(p.processado_em, fuso, entrada.hoje),
      quandoLongo: quandoLongo(p.processado_em, fuso),
      processadoEm: p.processado_em,
      itensTexto: textoDosItens(p),
      skus: itens.map((i) => i.sku).filter(Boolean),
      origem,
      meta,
      google,
      status,
      gateway,
      valores,
      itens,
      jornada,
      urlShopify: urlNaShopify(loja.dominio, p.shopify_order_id),
    });
  }

  pedidos.sort((a, b) => Date.parse(b.processadoEm) - Date.parse(a.processadoEm) || (a.chave < b.chave ? -1 : 1));
  resumo.rastreadas = deviamIr > 0 ? foram / deviamIr : null;
  return { pedidos, resumo };
}
