// ============================================================================
// Tela Campanhas: a linha e as metricas derivadas. Puro e leve (vai para o
// navegador: a linha de total da tabela usa o mesmo derivar). Quem monta as
// linhas a partir do banco e src/lib/campanhas/montar.ts.
//
// Regra das derivadas: SEMPRE das somas cruas do periodo, nunca media de
// razoes do dia. Sem base para a conta (divisao por zero, dia sem detalhe),
// a metrica e null e a tela mostra "—", nunca 0.
// ============================================================================

export type NivelGranularidade = "conta" | "campanha" | "grupo" | "anuncio";
export type PlataformaCampanha = "meta" | "google" | "tiktok";

/** As somas cruas do periodo, ja na moeda do relatorio. Somaveis entre linhas. */
export interface SomasCampanha {
  gastos: number;
  impressoes: number;
  cliques: number;
  /**
   * Algum dia do periodo veio do detalhe (ad_insights_granular). IC, video e
   * frequencia so existem nesses dias; sem nenhum, as colunas ficam "—".
   */
  detalhe: boolean;
  /** Gasto e impressoes so dos dias com detalhe: a base do CPI, do hook, do hold e da frequencia. */
  gastoDetalhe: number;
  impressoesDetalhe: number;
  /** Finalizacao de compra iniciada, reportada pela plataforma. */
  ic: number;
  visVideo: number;
  vis3s: number;
  /** CONTAGEM de visualizacoes ate 75% do video (nao taxa). */
  vis75: number;
  /** Soma de frequencia do dia x impressoes do dia, e as impressoes que entraram nela. */
  frequenciaPeso: number;
  impressoesFrequencia: number;
  /** Vendas pagas (a contagem do Lucro: pedido com receita, cobranca paga, comissao aprovada). */
  vendas: number;
  /** Pix/boleto aguardando, contra entrega em aberto e comissao pendente. */
  vendasPendentes: number;
  /** A receita do Lucro (o que entrou), moeda do relatorio. */
  faturamento: number;
  custoProduto: number;
  /** Lucro dos pedidos ANTES do anuncio: faturamento - custo - taxas - devolucoes. */
  lucroPedidos: number;
}

export interface MetricasCampanha {
  vendasTotais: number;
  /** lucroPedidos - gastos. */
  lucro: number;
  roas: number | null;
  /** Percentual: lucro / (gastos + custo de produto). */
  roi: number | null;
  /** Percentual: lucro / faturamento. */
  margem: number | null;
  cpa: number | null;
  /** Custo por venda total (pagas + pendentes). */
  cpt: number | null;
  /** Custo por venda pendente. */
  cpp: number | null;
  cpc: number | null;
  cpm: number | null;
  /** Percentual. */
  ctr: number | null;
  /** Custo por finalizacao iniciada (so os dias com detalhe). */
  cpi: number | null;
  /** Percentuais sobre as impressoes dos dias com detalhe. */
  hookRate: number | null;
  holdRate: number | null;
  /** Percentual: visualizacoes ate 75% / reproducoes. */
  retencao75: number | null;
  /** Media dos dias, ponderada pelas impressoes (o alcance unico nao vem). */
  frequencia: number | null;
}

export interface IdentidadeCampanha {
  /** nivel:conta:objeto -- o id do objeto so e unico dentro da conta. */
  id: string;
  objetoId: string;
  nome: string;
  /** effective_status do dia mais recente (ACTIVE, PAUSED...). null = sem detalhe. */
  status: string | null;
  plataforma: PlataformaCampanha;
  nivel: NivelGranularidade;
  contaId: string;
  contaNome: string;
  campanhaId: string | null;
  campanhaNome: string | null;
  grupoId: string | null;
  grupoNome: string | null;
  /** CBO/ABO (Meta) ou o tipo do Google. null = sem detalhe. */
  tipo: string | null;
  /** Orcamento diario, moeda do relatorio. null = sem orcamento nesse nivel ou sem detalhe. */
  orcamento: number | null;
  cpaDesejado: number | null;
}

export type LinhaCampanha = IdentidadeCampanha & SomasCampanha & MetricasCampanha;

export function somasVazias(): SomasCampanha {
  return {
    gastos: 0,
    impressoes: 0,
    cliques: 0,
    detalhe: false,
    gastoDetalhe: 0,
    impressoesDetalhe: 0,
    ic: 0,
    visVideo: 0,
    vis3s: 0,
    vis75: 0,
    frequenciaPeso: 0,
    impressoesFrequencia: 0,
    vendas: 0,
    vendasPendentes: 0,
    faturamento: 0,
    custoProduto: 0,
    lucroPedidos: 0,
  };
}

const CHAVES = Object.keys(somasVazias()) as (keyof SomasCampanha)[];

/** Soma `parte` em `alvo` (detalhe = qualquer um tem). Le so as chaves de SomasCampanha. */
export function somarEm(alvo: SomasCampanha, parte: Partial<SomasCampanha>): void {
  const numeros = alvo as unknown as Record<string, number>;
  for (const k of CHAVES) {
    const v = parte[k];
    if (v === undefined) continue;
    if (k === "detalhe") alvo.detalhe = alvo.detalhe || Boolean(v);
    else numeros[k] += Number(v) || 0;
  }
}

export function somarLinhas(linhas: readonly SomasCampanha[]): SomasCampanha {
  const total = somasVazias();
  for (const l of linhas) somarEm(total, l);
  return total;
}

const razao = (a: number, b: number, fator = 1): number | null => (b > 0 ? (a / b) * fator : null);

export function derivar(s: SomasCampanha): MetricasCampanha {
  const lucro = s.lucroPedidos - s.gastos;
  const vendasTotais = s.vendas + s.vendasPendentes;
  const comGasto = s.gastos > 0;
  // Video: sem nenhuma reproducao, hook/hold/retencao nao existem (imagem).
  const temVideo = s.detalhe && (s.visVideo > 0 || s.vis3s > 0 || s.vis75 > 0);
  return {
    vendasTotais,
    lucro,
    roas: razao(s.faturamento, s.gastos),
    roi: razao(lucro, s.gastos + s.custoProduto, 100),
    margem: razao(lucro, s.faturamento, 100),
    cpa: comGasto ? razao(s.gastos, s.vendas) : null,
    cpt: comGasto ? razao(s.gastos, vendasTotais) : null,
    cpp: comGasto ? razao(s.gastos, s.vendasPendentes) : null,
    cpc: razao(s.gastos, s.cliques),
    cpm: razao(s.gastos, s.impressoes, 1000),
    ctr: razao(s.cliques, s.impressoes, 100),
    cpi: s.detalhe ? razao(s.gastoDetalhe, s.ic) : null,
    hookRate: temVideo ? razao(s.vis3s, s.impressoesDetalhe, 100) : null,
    holdRate: temVideo ? razao(s.vis75, s.impressoesDetalhe, 100) : null,
    retencao75: temVideo ? razao(s.vis75, s.visVideo, 100) : null,
    frequencia: s.detalhe ? razao(s.frequenciaPeso, s.impressoesFrequencia) : null,
  };
}
