import { TAXAS_BRL } from "@/lib/sales/cambio";
import {
  aReceberCod,
  chanceDeReceber,
  contaDoPedido,
  qtdComCusto,
  situacaoViva,
  taxaDeEntrega,
  type AmostraEntrega,
  type TaxaEntrega,
} from "@/lib/financeiro/contra-entrega";
import {
  chaveSku,
  custoVigente,
  diasDoIntervalo,
  paraNumero,
  pedidoConta,
  pedidoTemCusto,
  qtdParaCusto,
  receitaDoPedido,
  somarDias,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type FxRateRow,
  type Intervalo,
  type LinhaPedido,
  type LojaDoSeletor,
  type MoedaRelatorio,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";
import type { PedidoExternoRow } from "@/lib/checkouts-externos/tipos";

// ============================================================================
// Motor do Lucro. Puro: recebe as linhas do banco, devolve os totais.
//
// Fica separado da leitura (queries.ts) para ser testado com fixture pequena --
// e a conta que o lojista usa para decidir se escala ou desliga anuncio, entao
// cada regra aqui tem teste em tests/financeiro-calculo.test.ts.
//
// Valores chegam na moeda ORIGINAL (a da loja para pedido e custo, a da conta
// para gasto) e so viram a moeda do relatorio aqui, pela cotacao do dia de
// cada valor. Converter na gravacao congelaria a cotacao errada.
//
// Contra entrega (contra-entrega.ts): o pedido COD tem situacao propria. O
// realizado continua nos campos de sempre (receita = so o que foi pago); o
// que ainda pode entrar e o previsto ficam em Totais.cod. Pedido online passa
// pela mesma conta de antes -- tests/financeiro-contra-entrega.test.ts trava.
//
// Checkout externo (069, src/lib/checkouts-externos): uma "loja" de comissao
// em `lojas` (tipo "checkout"), com os pedidos em `externos`. A receita e a
// COMISSAO (aprovada + paga = Recebido; pendente = A receber, pela taxa de
// aprovacao), sem custo de produto nem taxa. Entra na visao contra entrega:
// os mesmos campos, a mesma conta de Previsto e Lucro previsto. Loja Shopify
// nao muda -- tests/financeiro-checkout-externo.test.ts trava.
// ============================================================================

/**
 * ROAS real abaixo de 1,2x o de equilibrio = "no limite". O 1,2 e palpite da
 * pesquisa (margem para devolucao e chargeback que ainda nao chegaram), nao
 * regra da plataforma: fica constante para ser ajustado num lugar so.
 */
export const LIMITE_AMARELO = 1.2;

/** Fim de semana e feriado nao tem cotacao: vale a ultima ate N dias antes. */
export const DIAS_MAX_COTACAO = 10;

export type Semaforo = "verde" | "amarelo" | "vermelho" | "cinza";

export interface Totais {
  pedidos: number;
  /** O que entrou. Na loja em contra entrega, e o "Recebido". */
  receita: number;
  /** Custo de produtos: produto + frete do fornecedor. */
  cmv: number;
  taxas: number;
  /** Custo de devolucao dos contra entrega recusados que foram enviados. 0 sem COD. */
  devolucoes: number;
  gastoMeta: number;
  gastoGoogle: number;
  gasto: number;
  lucro: number;
  roas: number | null;
  roasEquilibrio: number | null;
  margem: number | null;
  cpa: number | null;
  ticket: number | null;
  reenvios: number;
  /** Fracao (0..1) do valor vendido que tem custo cadastrado. */
  coberturaCusto: number | null;
  /** A visao contra entrega. Sem pedido COD, o previsto e o realizado. */
  cod: TotaisCod;
  /** Checkout externo (comissao). Tudo zero sem checkout no filtro. */
  externo: TotaisExterno;
}

/** Os pedidos de checkout externo no periodo (src/lib/checkouts-externos). */
export interface TotaisExterno {
  /** Todos os pedidos criados. */
  pedidos: number;
  pendentes: number;
  aprovados: number;
  pagos: number;
  /** Expirados e revertidos. */
  perdidos: number;
  /** A comissao dos expirados e revertidos. */
  perdido: number;
  /** Total dos pedidos na plataforma (pedido.valor): so dica, nao e receita. */
  valorPedidos: number;
}

/**
 * Contra entrega (src/lib/financeiro/contra-entrega.ts). O realizado e o de
 * Totais (receita = Recebido, lucro = Lucro realizado); aqui fica o que ainda
 * pode entrar e o previsto.
 */
export interface TotaisCod {
  /** Online pagos + contra entrega que nao foi cancelado antes do envio. */
  gerados: number;
  /** Contra entrega vivos: aguardando envio, em transito, entregue a receber. */
  abertos: number;
  /** Contra entrega recusados ou devolvidos. */
  recusados: number;
  /** Contra entrega cancelados antes do envio. */
  cancelados: number;
  /** Valor dos vivos que ainda nao entrou. */
  aReceber: number;
  /** Recebido + entregues a receber + aguardando e em transito x taxa de entrega. */
  previsto: number;
  /** A taxa de entrega que o Previsto usou nos nao entregues. null = nenhum. */
  taxaEntrega: number | null;
  /** cmv + o custo dos que ainda vao ser enviados. */
  custoPrevisto: number;
  /** devolucoes + custo de devolucao x (1 - chance de receber) dos vivos. */
  devolucoesPrevistas: number;
  /** taxas + a taxa de pagamento sobre o que se espera receber. */
  taxasPrevistas: number;
  lucroPrevisto: number;
  roasPrevisto: number | null;
  roasEquilibrioPrevisto: number | null;
  /** Gasto por pedido gerado (nao so os pagos). */
  cpa: number | null;
  /**
   * A coberturaCusto contando tambem o que ainda vai ser enviado (o custo do
   * Previsto). Loja so COD com nada enviado tem cobertura aqui, nao no realizado.
   */
  coberturaCusto: number | null;
}

export type LinhaLoja = Totais & {
  storeId: string;
  nome: string;
  dominio: string;
  moedaLoja: string | null;
  fuso: string | null;
  semaforo: Semaforo;
};

export type LinhaDia = Totais & { dia: string; parcial: boolean };

export interface Avisos {
  cambioAproximado: boolean;
  moedasSemCotacao: string[];
  lojasSemTaxa: string[];
  lojasSemCustoPadraoComFalta: string[];
  fusosDiferentes: { conta: string; fusoConta: string; loja: string; fusoLoja: string }[];
}

export interface ResultadoFinanceiro {
  moeda: MoedaRelatorio;
  intervalos: { atual: Intervalo; anterior: Intervalo };
  atual: Totais;
  anterior: Totais;
  porLoja: LinhaLoja[];
  porDia: LinhaDia[];
  avisos: Avisos;
  /** Lojas do filtro marcadas "Contra entrega": o Dashboard troca os cartoes. */
  lojasContraEntrega: string[];
  entrega: ResumoEntrega;
}

export interface ResumoEntrega {
  /** A taxa de cada loja do filtro (a da amostra, ou a padrao). */
  porLoja: Record<string, TaxaEntrega>;
  /** Uma loja: a dela. Varias: a media das lojas em contra entrega. */
  taxa: number | null;
  fonte: TaxaEntrega["fonte"] | "misto" | null;
  amostra: number;
}

export type LojaFinanceira = LojaDoSeletor & {
  fuso: string | null;
  moeda: string | null;
  /**
   * Checkout externo: a taxa de aprovacao padrao (%) ate ter amostra. A
   * `moeda` dele e a da comissao (a Sphere nao manda).
   */
  taxaPadraoPct?: number | null;
};

/** O que o calculo le de um pedido de checkout externo (pedidos_externos). */
export type PedidoExternoFin = Pick<
  PedidoExternoRow,
  "checkout_id" | "situacao" | "moeda" | "valor" | "receita" | "moeda_receita" | "dia_local"
>;

export interface EntradaFinanceiro {
  lojas: LojaFinanceira[];
  pedidos: FinOrderRow[];
  custos: ProductCostRow[];
  configs: FinStoreSettingsRow[];
  contas: AdAccountRow[];
  gastos: AdSpendDailyRow[];
  cambio: FxRateRow[];
  intervalos: { atual: Intervalo; anterior: Intervalo };
  moeda: MoedaRelatorio;
  /** "Hoje" no fuso do relatorio: o dia que ainda esta acontecendo. */
  hoje: string;
  /**
   * Contra entrega finalizados dos ultimos 60 dias, por loja (a taxa de
   * entrega). Ausente = taxa padrao de cada loja. Checkout externo: a
   * amostra de aprovacao, pelo id dele.
   */
  amostraEntrega?: Record<string, AmostraEntrega>;
  /** Pedidos de checkout externo do periodo (069). Ausente = nenhum. */
  externos?: PedidoExternoFin[];
}

// ---------------------------------------------------------------------------
// Cambio
// ---------------------------------------------------------------------------

export type Conversor = (
  valor: number,
  de: string,
  para: string,
  dia: string
) => { valor: number; aproximado: boolean } | null;

/**
 * Conversor pela cotacao do DIA do valor. Sem cotacao no banco (cron de cambio
 * ainda nao rodou, moeda fora da lista), cai na tabela fixa de
 * src/lib/sales/cambio.ts marcando `aproximado` -- a tela avisa. Sem nenhuma
 * das duas: null, e quem chama deixa o valor de fora em vez de somar errado.
 */
export function criarConversor(cambio: FxRateRow[]): Conversor {
  const porMoeda = new Map<string, { data: string; porUsd: number }[]>();
  for (const c of cambio) {
    const moeda = String(c.moeda || "").toUpperCase();
    const porUsd = paraNumero(c.por_usd);
    if (!moeda || porUsd <= 0) continue;
    const lista = porMoeda.get(moeda) ?? [];
    lista.push({ data: String(c.data).slice(0, 10), porUsd });
    porMoeda.set(moeda, lista);
  }
  // Mais recente primeiro: a busca para na primeira data <= dia.
  for (const lista of porMoeda.values()) lista.sort((a, b) => (a.data < b.data ? 1 : -1));

  const memo = new Map<string, number | null>();
  const porUsdNoDia = (moeda: string, dia: string): number | null => {
    if (moeda === "USD") return 1;
    const chave = `${moeda}|${dia}`;
    if (memo.has(chave)) return memo.get(chave) ?? null;
    const limite = somarDias(dia, -DIAS_MAX_COTACAO);
    let achado: number | null = null;
    for (const c of porMoeda.get(moeda) ?? []) {
      if (c.data > dia) continue;
      if (c.data >= limite) achado = c.porUsd;
      break;
    }
    memo.set(chave, achado);
    return achado;
  };

  return (valor, de, para, dia) => {
    const origem = String(de || "").toUpperCase();
    const destino = String(para || "").toUpperCase();
    if (origem === destino) return { valor, aproximado: false };
    const a = porUsdNoDia(origem, dia);
    const b = porUsdNoDia(destino, dia);
    if (a && b) return { valor: (valor / a) * b, aproximado: false };
    const brlDe = TAXAS_BRL[origem];
    const brlPara = TAXAS_BRL[destino];
    if (brlDe && brlPara) return { valor: (valor * brlDe) / brlPara, aproximado: true };
    return null;
  };
}

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

/** Soma bruta antes dos derivados. As bases de custo dao a cobertura. */
interface Acumulador {
  pedidos: number;
  receita: number;
  cmv: number;
  taxas: number;
  devolucoes: number;
  gastoMeta: number;
  gastoGoogle: number;
  reenvios: number;
  baseComCusto: number;
  baseEstimado: number;
  baseSemCusto: number;
  // Contra entrega
  gerados: number;
  codAbertos: number;
  codRecusados: number;
  codCancelados: number;
  aReceber: number;
  /** Soma de a receber x chance de receber (entregue = 1). */
  esperado: number;
  /** A receber dos que ainda nao foram entregues, e ele x taxa: a taxa efetiva. */
  aReceberPendente: number;
  esperadoPendente: number;
  custoAEnviar: number;
  devolucoesEsperadas: number;
  taxasEsperadas: number;
  /** As bases da cobertura das unidades que ainda vao ser enviadas. */
  baseAEnviarComCusto: number;
  baseAEnviarEstimado: number;
  baseAEnviarSemCusto: number;
  // Checkout externo
  extPedidos: number;
  extPendentes: number;
  extAprovados: number;
  extPagos: number;
  extPerdidos: number;
  extPerdido: number;
  extValorPedidos: number;
}

function acumuladorVazio(): Acumulador {
  return {
    pedidos: 0,
    receita: 0,
    cmv: 0,
    taxas: 0,
    devolucoes: 0,
    gastoMeta: 0,
    gastoGoogle: 0,
    reenvios: 0,
    baseComCusto: 0,
    baseEstimado: 0,
    baseSemCusto: 0,
    gerados: 0,
    codAbertos: 0,
    codRecusados: 0,
    codCancelados: 0,
    aReceber: 0,
    esperado: 0,
    aReceberPendente: 0,
    esperadoPendente: 0,
    custoAEnviar: 0,
    devolucoesEsperadas: 0,
    taxasEsperadas: 0,
    baseAEnviarComCusto: 0,
    baseAEnviarEstimado: 0,
    baseAEnviarSemCusto: 0,
    extPedidos: 0,
    extPendentes: 0,
    extAprovados: 0,
    extPagos: 0,
    extPerdidos: 0,
    extPerdido: 0,
    extValorPedidos: 0,
  };
}

function somarEm(alvo: Acumulador, parte: Partial<Acumulador>) {
  for (const [k, v] of Object.entries(parte) as [keyof Acumulador, number][]) {
    alvo[k] += v;
  }
}

function totaisDe(a: Acumulador): Totais {
  const gasto = a.gastoMeta + a.gastoGoogle;
  // devolucoes e 0 sem contra entrega: a conta online fica a de sempre.
  const lucro = a.receita - a.cmv - a.taxas - a.devolucoes - gasto;
  const cm2 = a.receita - a.cmv - a.taxas - a.devolucoes;
  const baseTotal = a.baseComCusto + a.baseEstimado + a.baseSemCusto;

  const previsto = a.receita + a.esperado;
  const custoPrevisto = a.cmv + a.custoAEnviar;
  const devolucoesPrevistas = a.devolucoes + a.devolucoesEsperadas;
  const taxasPrevistas = a.taxas + a.taxasEsperadas;
  const cm2Previsto = previsto - custoPrevisto - devolucoesPrevistas - taxasPrevistas;
  const basePrevista = baseTotal + a.baseAEnviarComCusto + a.baseAEnviarEstimado + a.baseAEnviarSemCusto;
  return {
    pedidos: a.pedidos,
    receita: a.receita,
    cmv: a.cmv,
    taxas: a.taxas,
    devolucoes: a.devolucoes,
    gastoMeta: a.gastoMeta,
    gastoGoogle: a.gastoGoogle,
    gasto,
    lucro,
    roas: gasto > 0 ? a.receita / gasto : null,
    roasEquilibrio: cm2 > 0 ? a.receita / cm2 : null,
    margem: a.receita > 0 ? lucro / a.receita : null,
    cpa: a.pedidos > 0 && gasto > 0 ? gasto / a.pedidos : null,
    ticket: a.pedidos > 0 ? a.receita / a.pedidos : null,
    reenvios: a.reenvios,
    coberturaCusto: baseTotal > 0 ? a.baseComCusto / baseTotal : null,
    cod: {
      gerados: a.gerados,
      abertos: a.codAbertos,
      recusados: a.codRecusados,
      cancelados: a.codCancelados,
      aReceber: a.aReceber,
      previsto,
      taxaEntrega: a.aReceberPendente > 0 ? a.esperadoPendente / a.aReceberPendente : null,
      custoPrevisto,
      devolucoesPrevistas,
      taxasPrevistas,
      lucroPrevisto: cm2Previsto - gasto,
      roasPrevisto: gasto > 0 ? previsto / gasto : null,
      roasEquilibrioPrevisto: cm2Previsto > 0 ? previsto / cm2Previsto : null,
      cpa: a.gerados > 0 && gasto > 0 ? gasto / a.gerados : null,
      coberturaCusto: basePrevista > 0 ? (a.baseComCusto + a.baseAEnviarComCusto) / basePrevista : null,
    },
    externo: {
      pedidos: a.extPedidos,
      pendentes: a.extPendentes,
      aprovados: a.extAprovados,
      pagos: a.extPagos,
      perdidos: a.extPerdidos,
      perdido: a.extPerdido,
      valorPedidos: a.extValorPedidos,
    },
  };
}

export function semaforoDe(t: Pick<Totais, "gasto" | "lucro" | "roas" | "roasEquilibrio">): Semaforo {
  if (t.gasto <= 0) return "cinza";
  if (t.lucro < 0) return "vermelho";
  if (t.roas !== null && t.roasEquilibrio !== null && t.roas < LIMITE_AMARELO * t.roasEquilibrio) {
    return "amarelo";
  }
  return "verde";
}

/** "Nome · dominio" sem .myshopify.com: o nome no banco e velho em algumas lojas. */
export function rotuloLoja(l: Pick<LojaDoSeletor, "nome" | "dominio">): string {
  const dominio = String(l.dominio || "").replace(/\.myshopify\.com$/i, "");
  if (!dominio || l.nome === l.dominio || l.nome === dominio) return l.nome || dominio;
  return `${l.nome} · ${dominio}`;
}

function dentro(dia: string, i: Intervalo): boolean {
  return dia >= i.desde && dia <= i.ate;
}

/** A taxa do filtro: a da loja, ou a media das lojas de referencia. */
function resumirEntrega(porLoja: Record<string, TaxaEntrega>, ids: string[]): ResumoEntrega {
  const taxas = ids.map((id) => porLoja[id]).filter((t): t is TaxaEntrega => Boolean(t));
  if (taxas.length === 0) return { porLoja, taxa: null, fonte: null, amostra: 0 };
  const fontes = new Set(taxas.map((t) => t.fonte));
  return {
    porLoja,
    taxa: taxas.reduce((s, t) => s + t.taxa, 0) / taxas.length,
    fonte: fontes.size === 1 ? taxas[0].fonte : "misto",
    amostra: taxas.reduce((s, t) => s + t.amostra, 0),
  };
}

// ---------------------------------------------------------------------------
// Calculo
// ---------------------------------------------------------------------------

export function calcularFinanceiro(e: EntradaFinanceiro): ResultadoFinanceiro {
  const converter = criarConversor(e.cambio);
  const { atual: iAtual, anterior: iAnterior } = e.intervalos;

  const lojaPorId = new Map(e.lojas.map((l) => [l.id, l]));
  const configPorLoja = new Map(e.configs.map((c) => [c.store_id, c]));

  const custosPorSku = new Map<string, ProductCostRow[]>();
  for (const c of e.custos) {
    const chave = `${c.store_id}\u0000${chaveSku(c.sku)}`;
    const lista = custosPorSku.get(chave) ?? [];
    lista.push({ ...c, valido_desde: String(c.valido_desde).slice(0, 10) });
    custosPorSku.set(chave, lista);
  }

  const totAtual = acumuladorVazio();
  const totAnterior = acumuladorVazio();
  const porLoja = new Map<string, Acumulador>();
  const porDia = new Map<string, Acumulador>();
  const diasAtual = diasDoIntervalo(iAtual);
  for (const d of diasAtual) porDia.set(d, acumuladorVazio());
  for (const l of e.lojas) porLoja.set(l.id, acumuladorVazio());

  let cambioAproximado = false;
  const moedasSemCotacao = new Set<string>();
  const lojasSemTaxa = new Set<string>();
  const lojasSemCustoPadraoComFalta = new Set<string>();

  // Taxa de entrega de cada loja: a da amostra, ou a padrao de Custos e taxas.
  // Checkout externo: a taxa de APROVACAO, com a padrao do proprio checkout.
  const taxaPorLoja: Record<string, TaxaEntrega> = {};
  for (const l of e.lojas) {
    const padrao = l.tipo === "checkout" ? l.taxaPadraoPct : configPorLoja.get(l.id)?.cod_taxa_entrega;
    taxaPorLoja[l.id] = taxaDeEntrega(e.amostraEntrega?.[l.id], padrao);
  }
  const taxaDaLoja = (id: string): TaxaEntrega => taxaPorLoja[id] ?? taxaDeEntrega(null, null);

  /** Soma `parte` no periodo certo, e (so no atual) na loja e no dia. */
  const lancar = (storeId: string, dia: string, parte: Partial<Acumulador>) => {
    if (dentro(dia, iAtual)) {
      somarEm(totAtual, parte);
      const loja = porLoja.get(storeId);
      if (loja) somarEm(loja, parte);
      const noDia = porDia.get(dia);
      if (noDia) somarEm(noDia, parte);
    } else if (dentro(dia, iAnterior)) {
      somarEm(totAnterior, parte);
    }
  };

  // --- Pedidos ------------------------------------------------------------
  for (const p of e.pedidos) {
    const loja = lojaPorId.get(p.store_id);
    if (!loja) continue;
    // Teste e PDV nao sao venda de anuncio: nem receita, nem custo.
    if (p.tipo === "teste" || p.tipo === "pdv") continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (!dentro(dia, iAtual) && !dentro(dia, iAnterior)) continue;

    const moedaPedido = String(p.moeda || "").toUpperCase();
    // Conversao e linear: o fator de 1 unidade serve para receita, custo,
    // taxa e as bases da cobertura, que estao todos na moeda da loja.
    const fator = converter(1, moedaPedido, e.moeda, dia);
    if (!fator) {
      // Sem cotacao nenhuma: o pedido fica de fora. Somar CLP como se fosse
      // real inflaria o faturamento em ordens de grandeza.
      moedasSemCotacao.add(moedaPedido);
      continue;
    }
    if (fator.aproximado) cambioAproximado = true;

    const receita = receitaDoPedido(p);
    const conta = pedidoConta(p);
    const cfg = configPorLoja.get(p.store_id);
    if (!cfg) lojasSemTaxa.add(rotuloLoja(loja));

    // Contra entrega: a situacao decide o que ja entrou e o que pode entrar,
    // e os valores fixos (moeda da loja) vao para a moeda do pedido. Pedido
    // online passa por aqui com situacao null e a conta de sempre. A mesma
    // regra serve o Pedidos e o por produto (contaDoPedido).
    const cc = contaDoPedido(p, cfg, loja.moeda, converter);
    if (cc.aproximado) cambioAproximado = true;
    const situacao = cc.situacao;
    const taxas = conta && cfg ? (paraNumero(p.recebido) * paraNumero(cfg.taxa_pct)) / 100 + cc.taxaFixa : 0;

    let cmv = 0;
    let custoAEnviar = 0;
    let baseComCusto = 0;
    let baseEstimado = 0;
    let baseSemCusto = 0;
    let baseAEnviarComCusto = 0;
    let baseAEnviarEstimado = 0;
    let baseAEnviarSemCusto = 0;
    if (pedidoTemCusto(p)) {
      const pctPadrao =
        cfg && cfg.custo_padrao_pct !== null && cfg.custo_padrao_pct !== undefined
          ? paraNumero(cfg.custo_padrao_pct)
          : null;
      /**
       * Custo de `q` unidades da linha, moeda do pedido. `aEnviar` = ainda nao
       * saiu (so o Previsto): a base vai para a cobertura do previsto, e o SKU
       * sem custo avisa do mesmo jeito -- senao a loja so COD com nada enviado
       * tinha um Lucro previsto sem custo nenhum, e calado.
       */
      const custoDe = (l: LinhaPedido, q: number, aEnviar: boolean): number => {
        const base = paraNumero(l.preco) * q;
        const versao = custoVigente(
          custosPorSku.get(`${p.store_id}\u0000${chaveSku(l.sku)}`) ?? [],
          dia
        );
        if (versao) {
          const bruto = (paraNumero(versao.custo_unitario) + paraNumero(versao.frete_unitario)) * q;
          const c = converter(bruto, versao.moeda, moedaPedido, dia);
          if (c) {
            if (c.aproximado) cambioAproximado = true;
            if (aEnviar) baseAEnviarComCusto += base;
            else baseComCusto += base;
            return c.valor;
          }
          // Custo numa moeda sem cotacao: vale como "sem custo", com aviso.
          moedasSemCotacao.add(String(versao.moeda).toUpperCase());
        }
        if (pctPadrao !== null) {
          if (aEnviar) baseAEnviarEstimado += base;
          else baseEstimado += base;
          return (base * pctPadrao) / 100;
        }
        if (aEnviar) baseAEnviarSemCusto += base;
        else baseSemCusto += base;
        lojasSemCustoPadraoComFalta.add(rotuloLoja(loja));
        return 0;
      };
      for (const l of Array.isArray(p.linhas) ? p.linhas : []) {
        // recebido, nao liquido_pago: pago e reembolsado depois tem liquido 0
        // e o custo dele e real. Recusado que voltou ao estoque custa o que saiu.
        const q = qtdComCusto(l, p, cc.voltouAoEstoque);
        if (q > 0) cmv += custoDe(l, q, false);
        // Aguardando envio: o custo vem quando sair. So no previsto.
        if (situacao === "aguardando_envio") {
          const aEnviar = qtdParaCusto(l, false, false);
          if (aEnviar > 0) custoAEnviar += custoDe(l, aEnviar, true);
        }
      }
    }

    const devolucao = cc.devolucao;
    let aReceber = 0;
    let esperado = 0;
    let pendente = 0;
    let devolucaoEsperada = 0;
    let taxasEsperadas = 0;
    let taxaUsada = 0;
    if (situacao !== null && situacaoViva(situacao)) {
      taxaUsada = taxaDaLoja(p.store_id).taxa;
      const chance = chanceDeReceber(situacao, taxaUsada);
      aReceber = aReceberCod(p, situacao);
      esperado = aReceber * chance;
      if (situacao !== "entregue") pendente = aReceber;
      devolucaoEsperada = cc.custoDevolucao * (1 - chance);
      taxasEsperadas = cfg ? ((aReceber * paraNumero(cfg.taxa_pct)) / 100 + cc.taxaFixa) * chance : 0;
    }

    const k = fator.valor;
    lancar(p.store_id, dia, {
      pedidos: conta ? 1 : 0,
      reenvios: p.tipo === "reenvio" ? 1 : 0,
      receita: receita * k,
      cmv: cmv * k,
      taxas: taxas * k,
      devolucoes: devolucao * k,
      baseComCusto: baseComCusto * k,
      baseEstimado: baseEstimado * k,
      baseSemCusto: baseSemCusto * k,
      gerados: situacao === null ? (conta ? 1 : 0) : situacao === "cancelado" ? 0 : 1,
      codAbertos: situacao !== null && situacaoViva(situacao) ? 1 : 0,
      codRecusados: situacao === "recusado" ? 1 : 0,
      codCancelados: situacao === "cancelado" ? 1 : 0,
      aReceber: aReceber * k,
      esperado: esperado * k,
      aReceberPendente: pendente * k,
      esperadoPendente: pendente * taxaUsada * k,
      custoAEnviar: custoAEnviar * k,
      devolucoesEsperadas: devolucaoEsperada * k,
      taxasEsperadas: taxasEsperadas * k,
      baseAEnviarComCusto: baseAEnviarComCusto * k,
      baseAEnviarEstimado: baseAEnviarEstimado * k,
      baseAEnviarSemCusto: baseAEnviarSemCusto * k,
    });
  }

  // --- Checkout externo (comissao) ----------------------------------------
  for (const x of e.externos ?? []) {
    const ck = lojaPorId.get(x.checkout_id);
    if (!ck || ck.tipo !== "checkout") continue;
    const dia = String(x.dia_local).slice(0, 10);
    if (!dentro(dia, iAtual) && !dentro(dia, iAnterior)) continue;

    // A comissao vem na moeda do checkout (a Sphere nao diz qual e).
    const moedaComissao = String(x.moeda_receita || ck.moeda || "EUR").toUpperCase();
    const fator = converter(1, moedaComissao, e.moeda, dia);
    if (!fator) {
      moedasSemCotacao.add(moedaComissao);
      continue;
    }
    if (fator.aproximado) cambioAproximado = true;
    const comissao = paraNumero(x.receita) * fator.valor;
    // O total do pedido e so dica: sem cotacao, fica de fora so ele.
    const fatorPedido = converter(1, String(x.moeda || "").toUpperCase(), e.moeda, dia);
    const valorPedido = fatorPedido ? paraNumero(x.valor) * fatorPedido.valor : 0;

    const comum: Partial<Acumulador> = { gerados: 1, extPedidos: 1, extValorPedidos: valorPedido };
    if (x.situacao === "aprovado" || x.situacao === "pago") {
      lancar(ck.id, dia, {
        ...comum,
        pedidos: 1,
        receita: comissao,
        extAprovados: x.situacao === "aprovado" ? 1 : 0,
        extPagos: x.situacao === "pago" ? 1 : 0,
      });
    } else if (x.situacao === "pendente") {
      const taxa = taxaDaLoja(ck.id).taxa;
      lancar(ck.id, dia, {
        ...comum,
        codAbertos: 1,
        extPendentes: 1,
        aReceber: comissao,
        esperado: comissao * taxa,
        aReceberPendente: comissao,
        esperadoPendente: comissao * taxa,
      });
    } else {
      // expirado ou revertido: a comissao nao vem.
      lancar(ck.id, dia, { ...comum, codRecusados: 1, extPerdidos: 1, extPerdido: comissao });
    }
  }

  // --- Gasto --------------------------------------------------------------
  // A conta liga a uma loja OU a um checkout externo (069).
  const destinoDaConta = (c: AdAccountRow): string | null => c.store_id ?? c.checkout_id ?? null;
  const contaPorId = new Map<string, AdAccountRow>();
  const fusosDiferentes: Avisos["fusosDiferentes"] = [];
  for (const c of e.contas) {
    const destino = destinoDaConta(c);
    if (!destino || !lojaPorId.has(destino)) continue;
    contaPorId.set(c.id, c);
    const loja = lojaPorId.get(destino)!;
    if (c.fuso && loja.fuso && c.fuso !== loja.fuso) {
      fusosDiferentes.push({
        conta: c.nome || c.external_id,
        fusoConta: c.fuso,
        loja: rotuloLoja(loja),
        fusoLoja: loja.fuso,
      });
    }
  }

  for (const g of e.gastos) {
    // Nivel conta e a verdade (no Meta inclui anuncio apagado); campanha e
    // detalhe e somaria em dobro.
    if (g.nivel !== "conta") continue;
    const conta = contaPorId.get(g.ad_account_id);
    const destino = conta ? destinoDaConta(conta) : null;
    if (!conta || !destino) continue;
    const dia = String(g.data).slice(0, 10);
    if (!dentro(dia, iAtual) && !dentro(dia, iAnterior)) continue;
    const c = converter(paraNumero(g.gasto), g.moeda, e.moeda, dia);
    if (!c) {
      moedasSemCotacao.add(String(g.moeda).toUpperCase());
      continue;
    }
    if (c.aproximado) cambioAproximado = true;
    lancar(
      destino,
      dia,
      conta.plataforma === "google" ? { gastoGoogle: c.valor } : { gastoMeta: c.valor }
    );
  }

  // --- Saida --------------------------------------------------------------
  const linhasLoja: LinhaLoja[] = e.lojas.map((l) => {
    const t = totaisDe(porLoja.get(l.id) ?? acumuladorVazio());
    return {
      ...t,
      storeId: l.id,
      nome: l.nome,
      dominio: l.dominio,
      moedaLoja: l.moeda,
      fuso: l.fuso,
      semaforo: semaforoDe(t),
    };
  });
  linhasLoja.sort((a, b) => b.lucro - a.lucro);

  const linhasDia: LinhaDia[] = [...diasAtual].reverse().map((dia) => ({
    ...totaisDe(porDia.get(dia) ?? acumuladorVazio()),
    dia,
    parcial: dia === e.hoje,
  }));

  // Checkout externo e sempre "a receber + previsto": entra aqui tambem.
  const lojasContraEntrega = e.lojas
    .filter((l) => l.tipo === "checkout" || configPorLoja.get(l.id)?.contra_entrega === true)
    .map((l) => l.id);

  return {
    moeda: e.moeda,
    intervalos: e.intervalos,
    atual: totaisDe(totAtual),
    anterior: totaisDe(totAnterior),
    porLoja: linhasLoja,
    porDia: linhasDia,
    lojasContraEntrega,
    entrega: resumirEntrega(
      taxaPorLoja,
      lojasContraEntrega.length > 0 ? lojasContraEntrega : e.lojas.map((l) => l.id)
    ),
    avisos: {
      cambioAproximado,
      moedasSemCotacao: [...moedasSemCotacao].filter(Boolean).sort(),
      lojasSemTaxa: [...lojasSemTaxa].sort(),
      lojasSemCustoPadraoComFalta: [...lojasSemCustoPadraoComFalta].sort(),
      fusosDiferentes,
    },
  };
}
