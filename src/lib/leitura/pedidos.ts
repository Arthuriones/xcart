import { criarConversor, rotuloLoja, type Conversor, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import {
  ROTULO_SITUACAO_COD,
  aReceberCod,
  ehPedidoCod,
  foiEnviado,
  gatewayEhCod,
  situacaoCod,
  unidadesEnviadas,
  type SituacaoCod,
} from "@/lib/financeiro/contra-entrega";
import {
  chaveSku,
  custoVigente,
  diaNoFuso,
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

export type OrigemId = "meta" | "google" | "email" | "outra" | "direto" | "sem_dado" | "reenvio";

export interface Origem {
  id: OrigemId;
  /** "Meta Ads", "Google Ads", "E-mail", "tiktok", "Direto", "Sem dado". */
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
 * (fbc, que pode ser de um clique de dias antes). Evento sem sinal: Direto.
 * Sem evento nenhum (loja sem pixel do Meta, pedido de antes do pixel): Sem
 * dado -- nao ha como saber, e "Direto" afirmaria que nao houve anuncio.
 */
export function origemDoPedido(s: SinaisDeOrigem | null | undefined): Origem {
  if (!s) {
    return { id: "sem_dado", rotulo: "Sem dado", campanha: null, pista: "Sem evento de rastreamento deste pedido" };
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
 * - teste: compra de teste do dono, que nao sai para a plataforma;
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
  | "teste"
  | "tag";

export type StatusFila = "enviado" | "falhou" | "pendente";

/** Pedido mais novo que isto ainda pode estar a caminho da fila. */
export const JANELA_AGUARDANDO_MS = 15 * 60 * 1000;

/** O pedido e anterior ao instante (ISO)? Data torta nao conta como anterior. */
function antesDe(processadoEm: string, desde: string): boolean {
  const a = Date.parse(processadoEm);
  const b = Date.parse(desde);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

/**
 * A compra de teste do dono (src/lib/tracking/teste.ts) fica na fila como
 * 'enviado' SEM sent_at e nunca sai para o Meta. A regra de teste da migration
 * 055 (tracking_evento_teste) marca tambem payload.teste, test_event_code e
 * fbc com TEST.
 */
export function compraDeTeste(ev: Pick<EventoCompra, "status" | "sent_at" | "fbc" | "teste">): boolean {
  return (ev.status === "enviado" && !ev.sent_at) || ev.teste === true || /TEST/.test(ev.fbc ?? "");
}

export function estadoMeta(e: {
  /** Status de cada Purchase do pedido na fila (um por pixel Meta), sem os de teste. */
  eventos: readonly StatusFila[];
  /** O pedido so tem Purchase de teste. */
  teste?: boolean;
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
  if (e.teste) return "teste";
  if (!e.metaDesde) return "sem_pixel";
  if (!e.aplica) return "nao_se_aplica";
  if (antesDe(e.processadoEm, e.metaDesde)) return "sem_pixel";
  const pedidoMs = Date.parse(e.processadoEm);
  if (Number.isFinite(pedidoMs) && e.agoraMs - pedidoMs < JANELA_AGUARDANDO_MS) return "aguardando";
  return "faltou";
}

/**
 * Google: so a tag do checkout, que o servidor nao confirma. Sem destino
 * Google ativo na hora do pedido: sem pixel. Pedido que nao vira conversao e
 * compra de teste ficam cinza, nunca "pela tag".
 */
export function estadoGoogle(e: {
  /** created_at do primeiro destino Google ativo, com o rastreamento ligado. null = sem Google. */
  googleDesde: string | null;
  processadoEm: string;
  aplica: boolean;
  teste: boolean;
}): EstadoEnvio {
  if (!e.googleDesde || antesDe(e.processadoEm, e.googleDesde)) return "sem_pixel";
  if (!e.aplica) return "nao_se_aplica";
  if (e.teste) return "teste";
  return "tag";
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
  id:
    | "cancelado"
    | "reembolsado"
    | "reembolso_parcial"
    | "aguardando_pagamento"
    | "enviado"
    | "parcial"
    | "nao_enviado"
    | `cod_${SituacaoCod}`;
  rotulo: string;
  tom: TomPedido;
}

const TOM_COD: Record<SituacaoCod, TomPedido> = {
  aguardando_envio: "neutral",
  em_transito: "info",
  entregue: "info",
  pago: "ok",
  recusado: "err",
  cancelado: "neutral",
};

export function statusCod(s: SituacaoCod): StatusPedido {
  return { id: `cod_${s}`, rotulo: ROTULO_SITUACAO_COD[s], tom: TOM_COD[s] };
}

type CamposCod = Partial<
  Pick<
    FinOrderRow,
    "gateways" | "status_financeiro" | "cod" | "status_envio" | "entrega" | "enviado_em" | "devolucao" | "marca_recusa"
  >
>;

/** Situacao do contra entrega, ou null para pedido online (e reenvio). */
export function situacaoDoPedido(
  p: Pick<FinOrderRow, "cancelado_em" | "reembolsado" | "recebido" | "tipo" | "linhas"> & CamposCod
): SituacaoCod | null {
  const gateways = p.gateways ?? [];
  if (p.tipo !== "venda" || !ehPedidoCod({ gateways, cod: p.cod })) return null;
  return situacaoCod({ ...p, gateways, status_financeiro: p.status_financeiro ?? null });
}

export function statusDoPedido(
  p: Pick<FinOrderRow, "cancelado_em" | "reembolsado" | "liquido_pago" | "recebido" | "tipo" | "linhas"> & CamposCod
): StatusPedido {
  // Contra entrega tem a situacao propria: "aguardando pagamento" nao diz se
  // o pedido ainda vai sair, esta na rua ou ja foi entregue.
  const cod = situacaoDoPedido(p);
  if (cod) return statusCod(cod);
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
  /**
   * "Valor pago": o que entrou ANTES do reembolso, sem imposto, alfandega e
   * gorjeta. Nao e o Faturamento do Dashboard, que e a receita abaixo.
   */
  valorPago: number;
  /** Receita do Dashboard ("Faturamento"): valorPago - reembolso. */
  receita: number;
  cmv: number;
  taxa: number;
  /** A loja tem taxa de pagamento cadastrada. */
  temTaxa: boolean;
  reembolso: number;
  /** Contra entrega vivo: o que falta entrar. 0 nos outros. */
  aReceber: number;
  /** Custo de devolucao do contra entrega recusado que foi enviado. */
  devolucao: number;
  /** receita - cmv - taxa - devolucao. null quando algum item nao tem custo nem custo padrao. */
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
  /** Moeda da loja: os valores fixos do contra entrega vem nela. */
  moedaLoja?: string | null;
}

/**
 * Valores do pedido na moeda do relatorio, pela cotacao do dia do pedido.
 * null = moeda sem cotacao nenhuma (o Dashboard deixa o pedido de fora).
 * `aproximado`: alguma conversao usou a tabela fixa (sem fx_rates do dia).
 * As regras sao as de calcularFinanceiro, chamadas na mesma ordem.
 */
export function valoresDoPedido(
  p: FinOrderRow,
  ctx: ContextoValores
): { valores: ValoresPedido | null; itens: ItemPedido[]; aproximado: boolean } {
  const dia = String(p.dia_local).slice(0, 10);
  const moedaPedido = String(p.moeda || "").toUpperCase();
  const fator = ctx.converter(1, moedaPedido, ctx.moeda, dia);
  const k = fator ? fator.valor : null;
  let aproximado = Boolean(fator?.aproximado);
  const linhas = Array.isArray(p.linhas) ? p.linhas : [];

  const receita = receitaDoPedido(p);
  const conta = pedidoConta(p);
  const cfg = ctx.cfg;
  const situacao = situacaoDoPedido(p);
  // Como no calculo: valor fixo do contra entrega convertido da moeda da loja.
  const fixo = (v: number): number => {
    if (situacao === null || v === 0) return v;
    const c = ctx.converter(v, String(ctx.moedaLoja || moedaPedido), moedaPedido, dia);
    if (!c) return v;
    if (c.aproximado) aproximado = true;
    return c.valor;
  };
  const taxa =
    conta && cfg ? (paraNumero(p.recebido) * paraNumero(cfg.taxa_pct)) / 100 + fixo(paraNumero(cfg.taxa_fixa)) : 0;
  const voltouAoEstoque = situacao === "recusado" && unidadesEnviadas(linhas) === 0 && foiEnviado(p);
  const devolucao = situacao === "recusado" && foiEnviado(p) ? fixo(paraNumero(cfg?.cod_custo_devolucao)) : 0;
  const aReceber = situacao === null ? 0 : aReceberCod(p, situacao);
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
    const q = voltouAoEstoque
      ? paraNumero(l.qtd)
      : qtdParaCusto(l, Boolean(p.cancelado_em), p.tipo === "venda" && paraNumero(p.recebido) <= 0);
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
        if (c.aproximado) aproximado = true;
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

  if (k === null) return { valores: null, itens, aproximado: false };

  const reembolso = p.tipo === "venda" ? paraNumero(p.reembolsado) : 0;
  const lucro = receita - cmv - taxa - devolucao;
  return {
    valores: {
      produtos: linhas.reduce((s, l) => s + paraNumero(l.preco) * paraNumero(l.qtd), 0) * k,
      frete: paraNumero(p.frete_cobrado) * k,
      desconto: paraNumero(p.descontos) * k,
      valorPago: (receita + reembolso) * k,
      receita: receita * k,
      cmv: cmv * k,
      taxa: taxa * k,
      temTaxa: Boolean(cfg),
      reembolso: reembolso * k,
      aReceber: aReceber * k,
      devolucao: devolucao * k,
      lucro: semCusto ? null : lucro * k,
      lucroComoDashboard: lucro * k,
      semCusto,
    },
    itens,
    aproximado,
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
  const nomes = cru.map((g) =>
    gatewayEhCod(g)
      ? "Contra entrega"
      : (GATEWAYS[g.toLowerCase()] ?? g.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()))
  );
  return [...new Set(nomes)].join(" + ");
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

/** "Hoje, 14:22", "Ontem, 09:10" ou "02/10, 18:40", no fuso dado (o da loja do pedido). */
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


/**
 * Um Purchase do pedido, curto: o texto da jornada e montado na tela
 * (jornadaDoPedido, em pedidos/filtros.ts), para nao ir pronto e repetido em
 * cada pedido do periodo.
 */
export interface EnvioTela {
  status: StatusFila | "teste";
  hora: string;
  destino?: string;
  /** So no recusado. */
  tentativas?: number;
  /** So no recusado, cortado. */
  erro?: string;
  /** Teste que saiu de fato (test_event_code): foi para a aba de teste. */
  saiu?: boolean;
}

export interface PedidoTela {
  chave: string;
  id: string;
  nome: string;
  loja: string;
  /** Data e hora no fuso da loja do pedido. */
  quando: string;
  quandoLongo: string;
  itensTexto: string;
  origem: Origem;
  meta: EstadoEnvio;
  google: EstadoEnvio;
  status: StatusPedido;
  /** Contra entrega: a situacao. null = pedido online. */
  cod: SituacaoCod | null;
  /** Contra entrega: primeiro envio e entrega, no fuso da loja. */
  enviado: string | null;
  entregue: string | null;
  gateway: string | null;
  /** Recebeu pagamento. */
  pago: boolean;
  /** Por que nao vira conversao (draft, PDV, valor zero). */
  motivo: string | null;
  /** Hora do cancelamento, no fuso da loja. */
  cancelado: string | null;
  envios: EnvioTela[];
  valores: ValoresPedido | null;
  itens: ItemPedido[];
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
  /** payload.teste ou test_event_code (regra da migration 055). */
  teste?: boolean;
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
  /** receita - cmv - taxas - devolucoes do periodo, como o Dashboard soma. */
  lucro: number;
  /** Contra entrega vivo: o que falta entrar, e quantos. */
  aReceber: number;
  codAbertos: number;
  /** Pedidos com item sem custo (o lucro deles fica "—" na linha). */
  semCusto: number;
  /** Fracao com Purchase enviado, entre os que deviam ir ao Meta. null = nenhum. */
  rastreadas: number | null;
  /** Pedidos em moeda sem cotacao: fora dos valores. */
  semCotacao: number;
  /** Alguma conversao usou a tabela fixa (sem cotacao do dia). */
  cambioAproximado: boolean;
}

export interface EntradaPedidos {
  entrada: EntradaFinanceiro;
  lojas: LojaDoSeletor[];
  /** Fuso do relatorio: so para loja sem fuso conhecido. */
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
  const moedaPorLoja = new Map(entrada.lojas.map((l) => [l.id, l.moeda]));
  const ligadas = new Set(e.lojasLigadas);

  // Hora no fuso da LOJA do pedido: o periodo e o Dashboard contam o dia pelo
  // dia_local, que e o da loja. No fuso do relatorio, o pedido das 23h de
  // Chicago apareceria com a data do dia seguinte.
  const fusoPorLoja = new Map(entrada.lojas.map((l) => [l.id, l.fuso || fuso]));
  const hojePorFuso = new Map<string, string>();
  const relogio = (lojaId: string) => {
    const f = fusoPorLoja.get(lojaId) || fuso;
    let hoje = hojePorFuso.get(f);
    if (!hoje) {
      hoje = diaNoFuso(new Date(e.agoraMs), f);
      hojePorFuso.set(f, hoje);
    }
    const dia = hoje;
    return {
      curto: (iso: string | null | undefined) => quandoCurto(iso, f, dia),
      longo: (iso: string) => quandoLongo(iso, f),
    };
  };

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
  const desdeDe = (lojaId: string, plataforma: DestinoLoja["plataforma"]) =>
    ligadas.has(lojaId)
      ? primeiroCriado(
          e.destinos
            .filter((d) => d.store_id === lojaId && d.ativo && d.plataforma === plataforma)
            .map((d) => d.created_at)
        )
      : null;
  const metaDesde = new Map(e.lojas.map((l) => [l.id, desdeDe(l.id, "meta")]));
  const googleDesde = new Map(e.lojas.map((l) => [l.id, desdeDe(l.id, "google")]));

  const resumo: ResumoPedidos = {
    pedidos: 0,
    faturamento: 0,
    lucro: 0,
    aReceber: 0,
    codAbertos: 0,
    semCusto: 0,
    rastreadas: null,
    semCotacao: 0,
    cambioAproximado: false,
  };
  let deviamIr = 0;
  let foram = 0;
  const linhas: { ms: number; p: PedidoTela }[] = [];

  for (const p of entrada.pedidos) {
    const loja = lojaPorId.get(p.store_id);
    if (!loja) continue;
    // Como no Dashboard: teste e PDV nao sao venda de anuncio.
    if (p.tipo === "teste" || p.tipo === "pdv") continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < intervalo.desde || dia > intervalo.ate) continue;
    const quando = relogio(p.store_id);

    const { valores, itens, aproximado } = valoresDoPedido(p, {
      moeda,
      converter,
      cfg: configPorLoja.get(p.store_id),
      custosPorSku: custosPorLoja.get(p.store_id) ?? new Map(),
      moedaLoja: moedaPorLoja.get(p.store_id) ?? null,
    });
    const cod = situacaoDoPedido(p);
    if (valores) {
      if (pedidoConta(p)) resumo.pedidos += 1;
      resumo.faturamento += valores.receita;
      resumo.lucro += valores.lucroComoDashboard;
      resumo.aReceber += valores.aReceber;
      if (cod === "aguardando_envio" || cod === "em_transito" || cod === "entregue") resumo.codAbertos += 1;
      if (valores.semCusto) resumo.semCusto += 1;
      if (aproximado) resumo.cambioAproximado = true;
    } else {
      resumo.semCotacao += 1;
    }

    const chave = `${p.store_id}:${p.shopify_order_id}`;
    const todos = eventosPorPedido.get(chave) ?? [];
    // Compra de teste nao conta como enviada nem como devida (regra da 055).
    const reais = todos.filter((ev) => !compraDeTeste(ev));
    const teste = todos.length > 0 && reais.length === 0;
    // A mesma regra do webhook: draft, PDV e valor zero nao viram conversao.
    // Pedido de teste ja saiu acima.
    const motivo = motivoParaIgnorarPedido({
      test: false,
      source_name: p.origem,
      total_price: p.total_bruto,
    });
    const aplica = !motivo && p.tipo === "venda";
    const meta = estadoMeta({
      eventos: reais.map((ev) => ev.status),
      teste,
      aplica,
      metaDesde: metaDesde.get(p.store_id) ?? null,
      processadoEm: p.processado_em,
      agoraMs: e.agoraMs,
    });
    if (meta === "enviado" || meta === "falhou" || meta === "faltou" || meta === "pendente") {
      deviamIr += 1;
      if (meta === "enviado") foram += 1;
    }
    const google = estadoGoogle({
      googleDesde: googleDesde.get(p.store_id) ?? null,
      processadoEm: p.processado_em,
      aplica,
      teste,
    });

    const comSinal = todos.find((ev) => ev.url || ev.fbc) ?? todos[0];
    const origem: Origem =
      p.tipo === "reenvio"
        ? { id: "reenvio", rotulo: "Reenvio", campanha: null, pista: "Pedido de valor zero (reenvio ou troca)" }
        : origemDoPedido(comSinal ? { fbc: comSinal.fbc, url: comSinal.url } : null);

    const envios = todos.map((ev) => {
      const envio: EnvioTela = {
        status: compraDeTeste(ev) ? "teste" : ev.status,
        hora: quando.curto(ev.sent_at || ev.created_at),
      };
      const destino = ev.destination_id ? nomeDestino.get(ev.destination_id) : null;
      if (destino) envio.destino = destino;
      if (envio.status === "falhou") {
        envio.tentativas = paraNumero(ev.attempts);
        const erro = (ev.last_error || "").trim().slice(0, 160);
        if (erro) envio.erro = erro;
      }
      if (envio.status === "teste" && ev.sent_at) envio.saiu = true;
      return envio;
    });

    linhas.push({
      ms: Date.parse(p.processado_em) || 0,
      p: {
        chave,
        id: p.shopify_order_id,
        nome: p.nome || `#${p.shopify_order_id}`,
        loja: rotuloLoja(loja),
        quando: quando.curto(p.processado_em),
        quandoLongo: quando.longo(p.processado_em),
        itensTexto: textoDosItens(p),
        origem,
        meta,
        google,
        status: statusDoPedido(p),
        cod,
        enviado: cod && p.enviado_em ? quando.curto(p.enviado_em) : null,
        entregue: cod && p.entregue_em ? quando.curto(p.entregue_em) : null,
        gateway: nomeGateway(p.gateways),
        pago: paraNumero(p.recebido) > 0,
        motivo,
        cancelado: p.cancelado_em ? quando.curto(p.cancelado_em) : null,
        envios,
        valores,
        itens,
        urlShopify: urlNaShopify(loja.dominio, p.shopify_order_id),
      },
    });
  }

  linhas.sort((a, b) => b.ms - a.ms || (a.p.chave < b.p.chave ? -1 : 1));
  resumo.rastreadas = deviamIr > 0 ? foram / deviamIr : null;
  return { pedidos: linhas.map((l) => l.p), resumo };
}
