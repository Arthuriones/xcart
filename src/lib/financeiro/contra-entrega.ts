import {
  arredondar,
  paraNumero,
  qtdParaCusto,
  receitaDoPedido,
  somarDias,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type Intervalo,
  type LinhaPedido,
} from "./tipos";

// ============================================================================
// Contra entrega (COD, cash on delivery). Puro: servidor, tela e vitest.
//
// No COD o pedido nasce PENDING com o total inteiro em aberto, e marcar como
// pago na Shopify e opcional (o Releasit diz isso). Nem todo pedido e pago:
// recusa, cliente ausente, devolucao. Entao cada pedido COD tem uma SITUACAO,
// e o Dashboard da loja em "Contra entrega" separa o que ja entrou (Recebido)
// do que ainda pode entrar (A receber), e projeta o Previsto pela taxa de
// entrega da loja.
//
// A classificacao e POR PEDIDO, pelo gateway (loja mista funciona: a AmpleStep
// tem Shopify Payments e COD). Pedido online continua com a regra de sempre.
// ============================================================================

/** Taxa de entrega padrao (%) ate a loja ter amostra propria. */
export const TAXA_ENTREGA_PADRAO = 70;
/** Pedidos COD finalizados (entregues + recusados) para usar a taxa da loja. */
export const AMOSTRA_MINIMA = 20;
/** A amostra: pedidos dos ultimos 60 dias (o teto do read_orders)... */
export const DIAS_AMOSTRA = 60;
/**
 * ...menos os ultimos 7: a entrega fecha antes da recusa (devolucao demora a
 * ser registrada), e os pedidos novos puxariam a taxa para cima.
 */
export const DIAS_AMOSTRA_RECENTES = 7;
/**
 * Contra entrega em aberto (aguardando envio ou em transito) com mais dias que
 * isto conta como NAO entregue na amostra. Recusa que o lojista nao cancela
 * nem marca fica em transito para sempre: fora do denominador, a taxa ia a
 * 100% justo na loja que mais recusa.
 */
export const DIAS_SEM_RETORNO = 21;
/** Janela da sugestao "a loja virou contra entrega". */
export const DIAS_SUGESTAO = 7;

export type SituacaoCod = "aguardando_envio" | "em_transito" | "entregue" | "pago" | "recusado" | "cancelado";

export const SITUACOES_COD: SituacaoCod[] = [
  "aguardando_envio",
  "em_transito",
  "entregue",
  "pago",
  "recusado",
  "cancelado",
];

export const ROTULO_SITUACAO_COD: Record<SituacaoCod, string> = {
  aguardando_envio: "Aguardando envio",
  em_transito: "Em trânsito",
  entregue: "Entregue · a receber",
  pago: "Pago",
  recusado: "Recusado/Devolvido",
  cancelado: "Cancelado",
};

/** Ainda pode virar dinheiro: entra em "A receber". */
export function situacaoViva(s: SituacaoCod): boolean {
  return s === "aguardando_envio" || s === "em_transito" || s === "entregue";
}

// ---------------------------------------------------------------------------
// Gateway e tags
// ---------------------------------------------------------------------------

/** Minusculo, sem acento, "_" e "-" viram espaco: "Cash_on-Delivery" casa. */
function normalizar(texto: string): string {
  return String(texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Nomes de gateway de contra entrega, ja normalizados. So "Cash on Delivery
 * (COD)" (Releasit) foi visto numa loja real; os outros sao os nomes usuais
 * por idioma (nao verificados).
 */
const RE_COD =
  /\bcash on delivery\b|\bcod\b|\bcontra ?entrega\b|\bcontra ?reembolso\b|\bpagamento na entrega\b|\bpago (a|en|na) (la )?entrega\b|\bpaiement a la livraison\b|\bcontre remboursement\b|\bnachnahme\b|\bdobi?e?rka\b|\bcontrassegno\b|\bpobrani(e|em)\b|\butanvet\b|\bramburs\b/;

export function gatewayEhCod(nome: string | null | undefined): boolean {
  return RE_COD.test(normalizar(nome ?? ""));
}

/** Tag de app de COD (o Releasit poe "releasit_cod_form"). */
export function tagEhCod(tag: string | null | undefined): boolean {
  return RE_COD.test(normalizar(tag ?? ""));
}

/**
 * Tag de recusa/devolucao posta pela transportadora ou pelo app (EasySell usa
 * "returned", "rts-1"). As tags NAO sao gravadas (podem ter dado do
 * comprador): so este sim/nao.
 */
const RE_RECUSA =
  /\b(rto|rts)\b|\breturned\b|\breturn to (sender|origin)\b|\brefused\b|\bundelivered\b|\brecusad[oa]\b|\bdevolvid[oa]\b|\brejeitad[oa]\b|\bnao entregue\b|\bno entregado\b|\brechazad[oa]\b|\bdevuelt[oa]\b/;

export function tagEhRecusa(tag: string | null | undefined): boolean {
  return RE_RECUSA.test(normalizar(tag ?? ""));
}

/** O pedido e contra entrega? Pelo gateway, ou pela marca gravada no sync (tag). */
export function ehPedidoCod(p: Pick<FinOrderRow, "gateways"> & Partial<Pick<FinOrderRow, "cod">>): boolean {
  if (p.cod === true) return true;
  return (Array.isArray(p.gateways) ? p.gateways : []).some(gatewayEhCod);
}

// ---------------------------------------------------------------------------
// Situacao do pedido COD
// ---------------------------------------------------------------------------

export type PedidoCod = Pick<
  FinOrderRow,
  "tipo" | "gateways" | "cancelado_em" | "status_financeiro" | "recebido" | "reembolsado" | "linhas"
> &
  Partial<Pick<FinOrderRow, "cod" | "status_envio" | "entrega" | "enviado_em" | "devolucao" | "marca_recusa">>;

/** displayFulfillmentStatus de pedido com alguma coisa enviada. */
const STATUS_ENVIADO = new Set(["FULFILLED", "PARTIALLY_FULFILLED"]);
/** returnStatus de devolucao que andou (pedido apenas, RETURN_REQUESTED, ainda nao). */
const DEVOLUCAO_ANDANDO = new Set(["IN_PROGRESS", "INSPECTION_COMPLETE", "RETURNED"]);

export function unidadesEnviadas(linhas: readonly LinhaPedido[] | null | undefined): number {
  let n = 0;
  for (const l of Array.isArray(linhas) ? linhas : []) {
    n += Math.max(0, paraNumero(l.qtd) - paraNumero(l.qtd_nao_enviada));
  }
  return n;
}

/**
 * Saiu alguma coisa para o cliente? Unidade enviada, entrega registrada ou o
 * status do pedido. As colunas de envio (068) podem faltar em linha antiga:
 * ai vale so a quantidade das linhas, como antes.
 */
export function foiEnviado(p: PedidoCod): boolean {
  if (unidadesEnviadas(p.linhas) > 0) return true;
  if (p.entrega || p.enviado_em) return true;
  return STATUS_ENVIADO.has(String(p.status_envio ?? "").toUpperCase());
}

/**
 * A primeira regra que bater:
 *   1. cancelado (ou pagamento anulado) sem nada enviado -> cancelado (sem custo);
 *   2. cancelado com algo enviado -> recusado;
 *   3. devolucao em andamento ou feita, entrega que falhou, tag de recusa -> recusado;
 *   4. recebeu: reembolso total -> recusado (devolvido); senao pago;
 *   5. entregue sem pagamento marcado -> entregue (a receber);
 *   6. enviado -> em transito;
 *   7. o resto -> aguardando envio.
 */
export function situacaoCod(p: PedidoCod): SituacaoCod {
  const anulado = Boolean(p.cancelado_em) || String(p.status_financeiro ?? "").toUpperCase() === "VOIDED";
  const enviado = foiEnviado(p);
  if (anulado) return enviado ? "recusado" : "cancelado";
  if (DEVOLUCAO_ANDANDO.has(String(p.devolucao ?? "").toUpperCase())) return "recusado";
  if (p.entrega === "falhou" || p.marca_recusa === true) return "recusado";
  const recebido = paraNumero(p.recebido);
  if (recebido > 0) return paraNumero(p.reembolsado) >= recebido ? "recusado" : "pago";
  if (p.entrega === "entregue") return "entregue";
  return enviado ? "em_transito" : "aguardando_envio";
}

// ---------------------------------------------------------------------------
// Valores (moeda do pedido)
// ---------------------------------------------------------------------------

type ValoresDoPedido = Pick<
  FinOrderRow,
  "tipo" | "total_atual" | "liquido_pago" | "imposto_atual" | "taxas_alfandega" | "gorjeta"
>;

/**
 * O que o pedido vale se for pago inteiro: a conta de receitaDoPedido sobre o
 * total atual em vez do valor pago (sem imposto, alfandega e gorjeta).
 */
export function valorCod(p: ValoresDoPedido): number {
  if (p.tipo !== "venda") return 0;
  const v =
    paraNumero(p.total_atual) -
    paraNumero(p.imposto_atual) -
    paraNumero(p.taxas_alfandega) -
    paraNumero(p.gorjeta);
  return v > 0 ? arredondar(v) : 0;
}

/** O que falta entrar de um pedido vivo: valor menos o que ja foi recebido. */
export function aReceberCod(p: ValoresDoPedido, situacao: SituacaoCod): number {
  if (!situacaoViva(situacao)) return 0;
  return Math.max(0, arredondar(valorCod(p) - receitaDoPedido(p)));
}

/**
 * Chance de um pedido vivo virar dinheiro. Entregue ja passou pela entrega
 * (falta so a baixa do pagamento): conta inteiro. Aguardando envio e em
 * transito valem pela taxa de entrega.
 */
export function chanceDeReceber(situacao: SituacaoCod, taxa: number): number {
  if (situacao === "entregue") return 1;
  if (situacao === "aguardando_envio" || situacao === "em_transito") return taxa;
  return 0;
}

// ---------------------------------------------------------------------------
// Taxa de entrega
// ---------------------------------------------------------------------------

export interface AmostraEntrega {
  /** Pagos ou entregues. */
  entregues: number;
  /** Recusados e devolvidos. Cancelado antes do envio nao entra. */
  recusados: number;
  /** Em aberto ha mais de DIAS_SEM_RETORNO dias: conta como nao entregue. */
  semRetorno?: number;
}

export interface TaxaEntrega {
  /** 0..1 */
  taxa: number;
  fonte: "historico" | "padrao";
  /** Pedidos finalizados na amostra. */
  amostra: number;
}

/** Padrao da loja em % (vazio = 70), limitado a 0..100. */
export function taxaPadrao(pct: number | string | null | undefined): number {
  const n = pct === null || pct === undefined || pct === "" ? TAXA_ENTREGA_PADRAO : paraNumero(pct);
  return Math.min(100, Math.max(0, n)) / 100;
}

/** A taxa da loja com amostra suficiente; senao a padrao. */
export function taxaDeEntrega(
  amostra: AmostraEntrega | null | undefined,
  padraoPct: number | string | null | undefined
): TaxaEntrega {
  const entregues = Math.max(0, paraNumero(amostra?.entregues));
  const recusados = Math.max(0, paraNumero(amostra?.recusados));
  const semRetorno = Math.max(0, paraNumero(amostra?.semRetorno));
  const n = entregues + recusados + semRetorno;
  if (n >= AMOSTRA_MINIMA) return { taxa: entregues / n, fonte: "historico", amostra: n };
  return { taxa: taxaPadrao(padraoPct), fonte: "padrao", amostra: n };
}

/** Dias da amostra: 60 dias atras ate 7 dias atras, no fuso da loja. */
export function intervaloDaAmostra(hoje: string): Intervalo {
  return { desde: somarDias(hoje, -DIAS_AMOSTRA), ate: somarDias(hoje, -DIAS_AMOSTRA_RECENTES) };
}

/**
 * Conta os pedidos COD finalizados, por loja: pagos ou entregues contra
 * recusados, mais os em aberto ha mais de DIAS_SEM_RETORNO dias (recusa que
 * ninguem marcou), que contam como nao entregues. Entregue sem pagamento
 * continua entregue.
 */
export function contarAmostra(
  pedidos: (PedidoCod & Pick<FinOrderRow, "store_id" | "dia_local">)[],
  intervalo: Intervalo,
  hoje: string
): Record<string, AmostraEntrega> {
  const limite = somarDias(hoje, -DIAS_SEM_RETORNO);
  const saida: Record<string, AmostraEntrega> = {};
  for (const p of pedidos) {
    if (p.tipo !== "venda" || !ehPedidoCod(p)) continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < intervalo.desde || dia > intervalo.ate) continue;
    const s = situacaoCod(p);
    const a = (saida[p.store_id] ??= { entregues: 0, recusados: 0, semRetorno: 0 });
    if (s === "pago" || s === "entregue") a.entregues += 1;
    else if (s === "recusado") a.recusados += 1;
    else if ((s === "em_transito" || s === "aguardando_envio") && dia < limite) a.semRetorno = (a.semRetorno ?? 0) + 1;
  }
  return saida;
}

// ---------------------------------------------------------------------------
// A conta do pedido: uma regra so para o Dashboard, o Pedidos e o por produto
// ---------------------------------------------------------------------------

/** O conversor do calculo (criarConversor): valor de uma moeda para outra no dia. */
export type ConverterValor = (
  valor: number,
  de: string,
  para: string,
  dia: string
) => { valor: number; aproximado: boolean } | null;

export interface ContaDoPedido {
  /** Situacao do contra entrega; null = pedido online (e reenvio). */
  situacao: SituacaoCod | null;
  /** Taxa fixa da loja, na moeda do pedido. */
  taxaFixa: number;
  /** Custo por devolucao, na moeda do pedido. 0 no online. */
  custoDevolucao: number;
  /** A devolucao lancada: o custo, so no recusado que foi enviado. */
  devolucao: number;
  /** Recusado que voltou ao estoque: as linhas dizem "nada enviado", mas saiu. */
  voltouAoEstoque: boolean;
  /** Alguma conversao usou a tabela fixa (sem cotacao do dia). */
  aproximado: boolean;
}

/**
 * O que muda na conta de um pedido por ele ser contra entrega. O Releasit cria
 * o pedido na moeda do cliente (CZK numa loja em USD): a taxa fixa e o custo
 * de devolucao, que estao na moeda da loja, passam para a do pedido. Pedido
 * online fica como sempre, sem converter.
 */
export function contaDoPedido(
  p: PedidoCod & Pick<FinOrderRow, "moeda" | "dia_local">,
  cfg: Partial<Pick<FinStoreSettingsRow, "taxa_fixa" | "cod_custo_devolucao">> | null | undefined,
  moedaLoja: string | null | undefined,
  converter: ConverterValor
): ContaDoPedido {
  const situacao = p.tipo === "venda" && ehPedidoCod(p) ? situacaoCod(p) : null;
  const moedaPedido = String(p.moeda || "").toUpperCase();
  const dia = String(p.dia_local).slice(0, 10);
  let aproximado = false;
  const fixo = (v: number): number => {
    if (situacao === null || v === 0) return v;
    const c = converter(v, String(moedaLoja || moedaPedido).toUpperCase(), moedaPedido, dia);
    if (!c) return v;
    if (c.aproximado) aproximado = true;
    return c.valor;
  };
  const taxaFixa = fixo(paraNumero(cfg?.taxa_fixa));
  const custoDevolucao = situacao === null ? 0 : fixo(paraNumero(cfg?.cod_custo_devolucao));
  const enviado = situacao === "recusado" && foiEnviado(p);
  return {
    situacao,
    taxaFixa,
    custoDevolucao,
    devolucao: enviado ? custoDevolucao : 0,
    voltouAoEstoque: enviado && unidadesEnviadas(p.linhas) === 0,
    aproximado,
  };
}

/**
 * Unidades da linha que custam produto e frete: a regra de sempre
 * (qtdParaCusto), e no recusado que voltou ao estoque todas as que sairam.
 * Recusado sem envio nenhum (tag na confirmacao) nao custa.
 */
export function qtdComCusto(
  l: LinhaPedido,
  p: Pick<FinOrderRow, "tipo" | "cancelado_em" | "recebido">,
  voltouAoEstoque: boolean
): number {
  if (voltouAoEstoque) return paraNumero(l.qtd);
  return qtdParaCusto(l, Boolean(p.cancelado_em), p.tipo === "venda" && paraNumero(p.recebido) <= 0);
}

// ---------------------------------------------------------------------------
// Sugestao de modo
// ---------------------------------------------------------------------------

export interface SugestaoCod {
  /** Pedidos contra entrega nos ultimos 7 dias. */
  cod: number;
  /** Vendas nos ultimos 7 dias. */
  total: number;
  /** A maioria dos pedidos recentes e COD (e ha pelo menos 2). */
  sugere: boolean;
}

export function sugerirContraEntrega(
  pedidos: (Pick<FinOrderRow, "tipo" | "gateways" | "dia_local"> & Partial<Pick<FinOrderRow, "cod">>)[],
  hoje: string
): SugestaoCod {
  const desde = somarDias(hoje, -(DIAS_SUGESTAO - 1));
  let cod = 0;
  let total = 0;
  for (const p of pedidos) {
    if (p.tipo !== "venda") continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (dia < desde || dia > hoje) continue;
    total += 1;
    if (ehPedidoCod(p)) cod += 1;
  }
  return { cod, total, sugere: cod >= 2 && cod * 2 > total };
}
