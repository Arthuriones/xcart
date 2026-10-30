import type {
  AcaoRegra,
  CampoEdicao,
  JanelaRegra,
  MetricaRegra,
  NivelEdicao,
  OperadorRegra,
} from "@/lib/ads/gerenciar-regras";

// ============================================================================
// Contrato das rotas de regras automaticas e do historico (plano-de-acao/03).
// Tipos so -- a tela e as rotas importam daqui.
//
// GET    /api/ads/regras                 -> RespostaRegras
// POST   /api/ads/regras                 RegraEntrada -> { ok, regra: RegraTela }
// PATCH  /api/ads/regras/[id]            Partial<RegraEntrada> -> { ok, regra: RegraTela }
// DELETE /api/ads/regras/[id]            -> { ok }
// POST   /api/ads/regras/[id]/simular    -> { ok, resultado: SimulacaoTela }  (nada muda no Meta)
// Erro em todas: { ok: false, erro: string } com status 4xx/5xx.
// ============================================================================

export type TipoEscopo = "loja" | "checkout" | "conta";

export interface EscopoRegra {
  tipo: TipoEscopo;
  id: string;
}

export interface RegraEntrada {
  nome: string;
  ativa?: boolean;
  escopo: EscopoRegra;
  nivel: NivelEdicao;
  filtroNome: string | null;
  metrica: MetricaRegra;
  operador: OperadorRegra;
  valor: number;
  gastoMinimo: number;
  janela: JanelaRegra;
  acao: AcaoRegra;
  acaoPercentual: number | null;
  orcamentoLimite: number | null;
  intervaloMinutos: number;
}

/** Uma acao de uma passada (no ultimo_resultado e na simulacao). */
export interface AcaoPassada {
  contaNome: string;
  objetoId: string;
  nome: string;
  valorMetrica: number | null;
  acao: AcaoRegra;
  orcamentoAtual: number | null;
  orcamentoNovo: number | null;
  /** Ausente na simulacao. */
  ok?: boolean;
  erro?: string | null;
}

export interface ResultadoPassada {
  /** ISO da passada. */
  quando: string;
  julgados: number;
  acoes: AcaoPassada[];
  ignorados: { objetoId: string; nome: string; motivo: string }[];
  cortados: number;
  /** Contas puladas (sem token, dado velho...) e erro geral. */
  avisos: string[];
}

export type SimulacaoTela = Omit<ResultadoPassada, "acoes"> & { acoes: AcaoPassada[] };

export interface RegraTela extends Omit<RegraEntrada, "ativa"> {
  id: string;
  ativa: boolean;
  /** Nome da loja, do checkout ou da conta do escopo. */
  escopoNome: string;
  /** Moeda das contas do escopo (os valores da regra sao nela); null = mais de uma ou nenhuma. */
  moeda: string | null;
  descricao: string;
  ultimaExecucaoEm: string | null;
  proximaExecucaoEm: string;
  ultimoResultado: ResultadoPassada | null;
}

export interface OpcaoEscopo {
  tipo: TipoEscopo;
  id: string;
  nome: string;
  /** Contas do Meta ligadas (0 = a regra nao teria onde agir). */
  contasMeta: number;
  moeda: string | null;
}

export interface AlteracaoTela {
  id: number;
  criadoEm: string;
  contaNome: string;
  nivel: NivelEdicao;
  objetoId: string;
  objetoNome: string | null;
  campo: CampoEdicao;
  antes: string | null;
  depois: string | null;
  origem: "manual" | "regra";
  regraNome: string | null;
  ok: boolean;
  erro: string | null;
}

export interface RespostaRegras {
  ok: true;
  regras: RegraTela[];
  escopos: OpcaoEscopo[];
  historico: AlteracaoTela[];
  /** false = a migration 087 ainda nao foi aplicada (a tela avisa e nao deixa criar). */
  disponivel: boolean;
}
