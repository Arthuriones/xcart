import { calcularFinanceiro, type EntradaFinanceiro, type LinhaDia } from "@/lib/financeiro/calculo";

// ============================================================================
// Serie diaria do Lucro (funcao #1): o periodo atual e o anterior, dia a dia,
// e o lucro de cada loja por dia (sparkline da aba Loja).
//
// Puro, sem "server-only": recebe a mesma entrada de calcularFinanceiro e
// chama a funcao SEM altera-la -- so troca o intervalo. O calculo devolve a
// serie diaria apenas do periodo atual; para ter a do anterior, basta pedir
// o calculo com o anterior no lugar do atual. A conta continua uma so.
//
// Quem le o banco e src/lib/leitura/base-lucro.ts.
// ============================================================================

/** Um dia, so com as somas cruas: o resto (lucro, ROAS...) se deriva delas. */
export interface PontoDia {
  dia: string;
  /** Dia em curso: ainda vai mudar. */
  parcial: boolean;
  pedidos: number;
  receita: number;
  cmv: number;
  taxas: number;
  gastoMeta: number;
  gastoGoogle: number;
}

export interface SerieDiaria {
  /** Periodo atual, do dia mais antigo para o mais novo. */
  atual: PontoDia[];
  /**
   * Periodo anterior, alinhado por posicao com o atual (o 1o dia de um com o
   * 1o do outro). Pode ter menos dias ("Este mes" contra o mes passado).
   */
  anterior: PontoDia[];
  /** Lucro estimado por dia de cada loja, no periodo atual, em ordem crescente. */
  porLoja: { storeId: string; lucro: number[] }[];
}

export function pontoDeLinha(l: LinhaDia): PontoDia {
  return {
    dia: l.dia,
    parcial: l.parcial,
    pedidos: l.pedidos,
    receita: l.receita,
    cmv: l.cmv,
    taxas: l.taxas,
    gastoMeta: l.gastoMeta,
    gastoGoogle: l.gastoGoogle,
  };
}

/** porDia do calculo vem do mais novo para o mais antigo. */
function crescente(linhas: LinhaDia[]): LinhaDia[] {
  return [...linhas].sort((a, b) => (a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0));
}

/**
 * Monta as series. `porLoja: false` pula a serie por loja (so serve com 2 ou
 * mais lojas e custa um calculo por loja).
 */
export function montarSerieDiaria(
  e: EntradaFinanceiro,
  opcoes: { porLoja?: boolean } = {}
): SerieDiaria {
  const atual = crescente(calcularFinanceiro(e).porDia).map(pontoDeLinha);

  // O anterior no lugar do atual. O "anterior" do calculo fica igual ao
  // atual de proposito: o calculo confere o atual primeiro, entao nada entra
  // duas vezes. Nenhum dia do periodo anterior e "hoje".
  const ant = e.intervalos.anterior;
  const anterior = crescente(
    calcularFinanceiro({ ...e, intervalos: { atual: ant, anterior: ant }, hoje: "" }).porDia
  ).map(pontoDeLinha);

  const porLoja =
    opcoes.porLoja === false || e.lojas.length < 2
      ? []
      : e.lojas.map((loja) => ({
          storeId: loja.id,
          lucro: crescente(calcularFinanceiro({ ...e, lojas: [loja] }).porDia).map((d) => d.lucro),
        }));

  return { atual, anterior, porLoja };
}
