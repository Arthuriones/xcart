/**
 * O estado da loja de demonstracao num instante: o plano (plano.ts) virado
 * nas linhas do banco (linhas.ts), so o que cabe nas janelas que o banco
 * guarda, e o gasto de anuncio de cada dia fechado pela meta de lucro.
 *
 * Janelas (o banco de producao esta no plano free do Supabase, 500 MB):
 *   - pedidos, origem e gasto: de inicioDaJanela (dia 1 do mes retrasado,
 *     60 a 92 dias) ate agora -- o periodo atual e o anterior de todo
 *     periodo do app;
 *   - Purchase na fila: de primeiroDiaDeCompra (35 a 62 dias: os ultimos 35
 *     ou, se for antes, desde o dia 1 do mes anterior);
 *   - funil (ver produto, carrinho, checkout, pagamento): as ultimas
 *     HORAS_DE_FUNIL horas.
 *
 * Puro: nada de banco aqui. Quem le o cambio e grava e o gravacao.ts (o cron
 * e o scripts/demo-loja.ts).
 */
import { calcularFinanceiro } from "@/lib/financeiro/calculo";
import type {
  AdAccountRow,
  AdSpendDailyRow,
  FinOrderRow,
  FinStoreSettingsRow,
  FxRateRow,
} from "@/lib/financeiro/tipos";
import {
  ARTHUR,
  CONTA_GOOGLE,
  CONTA_META,
  DOMINIO,
  FUSO,
  HORAS_DE_FUNIL,
  LOJA_ID,
  MOEDA,
  NOME_LOJA,
  TAXA_FIXA,
  TAXA_PCT,
  corteDasCompras,
  diaLocal,
  fracaoDoDia,
  gerarPlano,
  inicioDaJanela,
  instanteLocal,
  segundosLocais,
  somarDia,
  type DiaPlano,
  type PedidoPlano,
} from "./plano";
import {
  compraDoPedido,
  funilDoDia,
  gastoDoDia,
  granularDeHoje,
  linhaDaOrigem,
  linhaDoPedido,
  linhasDeGasto,
  sincronizadoDoDia,
  custosDosProdutos,
  type Cambio,
  type GastoDoDia,
  type LinhaEvento,
  type LinhaGranular,
} from "./linhas";

/** ROAS real minimo e maximo de um dia: fora disso o gasto e ajustado e o lucro sai da meta. */
export const ROAS_MIN = 2.15;
export const ROAS_MAX = 3.3;
/** O estado final de cada pedido (reembolso e entrega ja aconteceram). */
const FIM_DOS_TEMPOS = Date.parse("2100-01-01T00:00:00Z");

export const configLoja: FinStoreSettingsRow = {
  store_id: LOJA_ID,
  user_id: ARTHUR,
  taxa_pct: TAXA_PCT,
  taxa_fixa: TAXA_FIXA,
  custo_padrao_pct: null,
  contra_entrega: false,
};

export const lojaFinanceira = { id: LOJA_ID, nome: NOME_LOJA, dominio: DOMINIO, fuso: FUSO, moeda: MOEDA };

export function contasDaLoja(): AdAccountRow[] {
  const base = {
    user_id: ARTHUR,
    store_id: LOJA_ID,
    checkout_id: null,
    moeda: MOEDA,
    fuso: FUSO,
    ativo: true,
    sincronizando_desde: null,
    ultimo_sync_em: null,
    ultimo_sync_ok_em: null,
    ultimo_reprocesso_em: null,
    ultimo_dado_gerado_em: null,
    ultimo_erro: null,
  };
  return [
    { ...base, id: CONTA_META.id, plataforma: "meta", external_id: CONTA_META.external_id, nome: CONTA_META.nome, status_externo: "ativa", fonte: "api" },
    { ...base, id: CONTA_GOOGLE.id, plataforma: "google", external_id: CONTA_GOOGLE.external_id, nome: CONTA_GOOGLE.nome, status_externo: null, fonte: "script" },
  ];
}

/** Onde cada janela comeca, no instante `agoraMs`. */
export interface Cortes {
  /** Primeiro dia (local) de pedidos, origem e gasto. */
  janela: string;
  /** Primeiro instante com Purchase na fila (meia-noite local). */
  compras: number;
  /** Primeiro instante com evento de funil na fila. */
  funil: number;
}

export function cortesDe(agoraMs: number): Cortes {
  const hoje = diaLocal(agoraMs);
  return {
    janela: inicioDaJanela(hoje),
    compras: corteDasCompras(hoje),
    funil: agoraMs - HORAS_DE_FUNIL * 3_600_000,
  };
}

export interface Semeadura {
  agoraMs: number;
  hoje: string;
  cortes: Cortes;
  /** Os dias da janela (o plano inteiro nasce do LANCAMENTO, so a janela vem aqui). */
  plano: DiaPlano[];
  pedidos: FinOrderRow[];
  origens: NonNullable<ReturnType<typeof linhaDaOrigem>>[];
  compras: LinhaEvento[];
  funil: LinhaEvento[];
  /**
   * Os eventos do funil de HOJE que aconteceram antes da meia-noite (a sessao
   * do primeiro pedido do dia comeca ate 50 min antes dele): so existem depois
   * que o dia entra no plano, atras do ultimo evento gravado. Ja estao em
   * `funil`; a primeira rodada do dia os manda (gravacao.ts).
   */
  madrugada: LinhaEvento[];
  gastos: GastoDoDia[];
  linhasGasto: AdSpendDailyRow[];
  /** O gasto do dia inteiro (a conta do lucro) e a meta, por dia. */
  porDia: Map<string, { gastoDia: number; meta: number; roasMeta: number; ajustado: boolean }>;
}

/** Intervalo de calcularFinanceiro sobre a janela (o anterior e um dia vazio antes dela). */
export function intervalosDaJanela(janela: string, hoje: string) {
  return { atual: { desde: janela, ate: hoje }, anterior: { desde: somarDia(janela, -1), ate: somarDia(janela, -1) } };
}

/**
 * O que vira linha. Sem selecao, a janela inteira (o `semear`). O cron pede so
 * o que pode ter mudado -- os dias de hoje (e de ontem na virada) e os pedidos
 * que mudaram desde a ultima rodada --, e cada dia sai IGUAL ao da janela
 * inteira: a conta do gasto e o funil de um dia so dependem dos pedidos dele.
 */
export interface Selecao {
  /** Dias inteiros: pedidos, origem, Purchase, funil e gasto. */
  dias?: (dia: string) => boolean;
  /** Pedidos de outros dias que tambem viram linha (fin_orders, origem e Purchase). */
  pedido?: (p: PedidoPlano) => boolean;
}

export function montar(agoraMs: number, cambio: Cambio, fx: FxRateRow[], selecao?: Selecao): Semeadura {
  const hoje = diaLocal(agoraMs);
  const cortes = cortesDe(agoraMs);
  const plano = gerarPlano(hoje).filter((d) => d.dia >= cortes.janela);
  const custos = custosDosProdutos();
  const diaInteiro = (d: DiaPlano) => !selecao?.dias || selecao.dias(d.dia);
  const inteiros = plano.filter(diaInteiro);

  // 1) O gasto de cada dia sai do estado FINAL dos pedidos (o reembolso que
  //    ainda vai acontecer ja conta): o gasto de um dia passado nunca muda.
  const finais = inteiros.flatMap((d) => d.pedidos.map((p) => linhaDoPedido(p, FIM_DOS_TEMPOS, cambio)));
  const contaFinal = calcularFinanceiro({
    lojas: [lojaFinanceira],
    pedidos: finais,
    custos,
    configs: [configLoja],
    contas: [],
    gastos: [],
    cambio: fx,
    intervalos: intervalosDaJanela(cortes.janela, hoje),
    moeda: "USD",
    hoje,
  });
  const porDia: Semeadura["porDia"] = new Map();
  for (const d of inteiros) {
    const t = contaFinal.porDia.find((x) => x.dia === d.dia)!;
    const sobra = t.receita - t.cmv - t.taxas - d.meta.lucro;
    const gastoDia = Math.min(t.receita / ROAS_MIN, Math.max(t.receita / ROAS_MAX, sobra));
    porDia.set(d.dia, { gastoDia, meta: d.meta.lucro, roasMeta: d.meta.roas, ajustado: Math.abs(gastoDia - sobra) > 0.01 });
  }

  // 2) O estado de agora: so o que ja aconteceu, e so o que a janela guarda.
  const pedidos: FinOrderRow[] = [];
  const origens: Semeadura["origens"] = [];
  const compras: LinhaEvento[] = [];
  const funil: LinhaEvento[] = [];
  const madrugada: LinhaEvento[] = [];
  const meiaNoite = instanteLocal(hoje, 0);
  const gastos: GastoDoDia[] = [];
  const diaDoFunil = diaLocal(cortes.funil);
  const fracaoHoje = fracaoDoDia(segundosLocais(agoraMs));
  for (const d of plano) {
    const inteiro = diaInteiro(d);
    for (const p of d.pedidos) {
      if (p.criadoMs > agoraMs) continue;
      if (!inteiro && !selecao?.pedido?.(p)) continue;
      pedidos.push(linhaDoPedido(p, agoraMs, cambio));
      const o = linhaDaOrigem(p, agoraMs, cambio);
      if (o) origens.push(o);
      const c = compraDoPedido(p, agoraMs);
      if (c && Date.parse(c.created_at) >= cortes.compras) compras.push(c);
    }
    if (!inteiro) continue;
    if (d.dia >= diaDoFunil) {
      for (const e of funilDoDia(d, agoraMs)) {
        if (Date.parse(e.created_at) < cortes.funil) continue;
        funil.push(e);
        if (d.dia === hoje && Date.parse(e.created_at) < meiaNoite) madrugada.push(e);
      }
    }
    gastos.push(gastoDoDia(d, porDia.get(d.dia)!.gastoDia, d.dia === hoje ? fracaoHoje : 1, agoraMs));
  }
  const linhasGasto = gastos.flatMap((g) =>
    linhasDeGasto(g, g.dia === hoje ? new Date(agoraMs - 3 * 60_000).toISOString() : sincronizadoDoDia(g.dia, agoraMs))
  );
  return { agoraMs, hoje, cortes, plano, pedidos, origens, compras, funil, madrugada, gastos, linhasGasto, porDia };
}

/**
 * Campanhas, conjuntos e anuncios de hoje (a tela Campanhas mostra um retrato
 * so, sem filtro de data). Pede o dia de hoje inteiro na Semeadura.
 */
export function granularDe(s: Semeadura, brlPorUsd: number): LinhaGranular[] {
  const hoje = s.gastos.find((g) => g.dia === s.hoje);
  if (!hoje) return [];
  return granularDeHoje(
    hoje,
    s.hoje,
    new Map(s.pedidos.filter((p) => p.dia_local === s.hoje).map((p) => [p.shopify_order_id, p])),
    custosDosProdutos(),
    brlPorUsd,
    new Date(s.agoraMs).toISOString()
  );
}
