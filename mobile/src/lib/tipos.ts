// ============================================================================
// O contrato das rotas do servidor (src/app/api/app/v1/* e /api/ads/* no
// repo do site). Toda resposta e { ok: true, ... } ou { ok: false, codigo,
// erro }. Os textos ja vem prontos do servidor (mesmos numeros e frases do
// site): o app so desenha.
// ============================================================================

export type RespostaErro = { ok: false; codigo?: string; erro: string };

export type TomStatus = "ok" | "warn" | "err" | "info" | "neutral" | "run";
export type DirecaoVariacao = "sobe" | "desce" | "estavel";
export type TomVariacao = "ok" | "err" | "neutral";

export interface Filtro {
  /** "todas" ou o id da loja/checkout. */
  loja: string;
  /** Id do periodo ("7d", "hoje"...) ou "AAAA-MM-DD_AAAA-MM-DD". */
  periodo: string;
  moeda: string;
  comparar: string;
}

// GET /api/app/v1/eu
export interface Eu {
  usuario: { id: string; email: string | null; nome: string | null; sobrenome: string | null };
  lojas: { id: string; nome: string; dominio: string | null }[];
  checkouts: { id: string; nome: string; plataforma: string | null; modelo: string }[];
  periodos: { id: string; rotulo: string; curto: string }[];
  personalizado: { rotulo: string; tetoDias: number; voltaMaximaDias: number };
  moedas: { id: string; rotulo: string }[];
  comparacoes: { id: string; rotulo: string }[];
  filtroPadrao: Filtro;
}

// GET /api/app/v1/dashboard
export interface VariacaoDoApp {
  /** "12,3%" ou "1,5 p.p.", sem sinal: a direcao diz. */
  texto: string;
  direcao: DirecaoVariacao;
  tom: TomVariacao;
}

export interface CartaoDoApp {
  id: string;
  rotulo: string;
  texto: string;
  valor: number | null;
  negativo: boolean;
  /** Ausente = sem comparacao; null = sem base no periodo anterior. */
  variacao?: VariacaoDoApp | null;
  linha?: string;
  detalhe?: string;
  selo?: { texto: string; tom: TomStatus };
  definicao: string;
  notas?: string[];
}

export interface LojaDoApp {
  id: string;
  nome: string;
  situacao: { texto: string; tom: TomStatus };
  pedidos: string;
  faturamento: string;
  gasto: string;
  roas: string;
  lucro: string;
  lucroNegativo: boolean;
  margem: string;
}

export interface PendenciaDoApp {
  id: string;
  tom: string;
  titulo: string;
  detalhe?: string;
  acao?: { rotulo: string; href: string } | { rotulo: string; sincronizar: true };
  dispensavel?: boolean;
}

export type Dashboard =
  | { vazio: true }
  | {
      vazio: false;
      filtro: Filtro & { nomeLoja: string };
      periodo: {
        rotulo: string;
        porExtenso: string;
        desde: string;
        ate: string;
        umDia: boolean;
        terminaHoje: boolean;
        anterior: { desde: string; ate: string; rotulo: string };
      };
      moeda: string;
      comparacao: string;
      contraEntrega: boolean;
      grafico: { receita: string; lucro: string; pedidos: string };
      principal: CartaoDoApp;
      cartoes: CartaoDoApp[];
      porLoja: LojaDoApp[];
      pendencias: PendenciaDoApp[];
      leitura: { rotulo: string; hora: string | null; em: string | null };
    };

// GET /api/app/v1/dashboard/serie
export interface PontoDia {
  dia: string;
  parcial: boolean;
  pedidos: number;
  receita: number;
  cmv: number;
  taxas: number;
  devolucoes?: number;
  gastoMeta: number;
  gastoGoogle: number;
  /** Lucro do dia pela mesma formula do grafico do site. */
  lucro: number;
}

export type Serie =
  | { vazio: true }
  | {
      vazio: false;
      moeda: string;
      intervalos: { atual: { desde: string; ate: string }; anterior: { desde: string; ate: string } };
      atual: PontoDia[];
      anterior: PontoDia[];
    };

// GET /api/app/v1/campanhas?nivel=&plataforma=&conta=&status=&q=&campanhaId=
export type NivelCampanha = "conta" | "campanha" | "grupo" | "anuncio";
export type PlataformaCampanha = "meta" | "google" | "tiktok";

export interface NumerosCampanha {
  gastos: number;
  faturamento: number;
  lucro: number;
  roas: number | null;
  roasTom: "ok" | "err" | null;
  margem: number | null;
  roi: number | null;
  custoProduto: number;
  vendas: number;
  vendasPendentes: number;
  vendasTotais: number;
  cpa: number | null;
  cpt: number | null;
  cpp: number | null;
  impressoes: number;
  cliques: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  ic: number | null;
  cpi: number | null;
  visVideo: number | null;
  vis3s: number | null;
  retencao75: number | null;
  hookRate: number | null;
  holdRate: number | null;
  frequencia: number | null;
}

export interface LinhaCampanha extends NumerosCampanha {
  id: string;
  objetoId: string;
  nome: string;
  /** effective_status do Meta (ACTIVE, PAUSED, CAMPAIGN_PAUSED...). null = sem detalhe. */
  status: string | null;
  plataforma: PlataformaCampanha;
  nivel: NivelCampanha;
  /** ad_accounts.id (uuid): vai como `conta` nas rotas de edicao. */
  contaId: string;
  contaNome: string;
  campanhaId: string | null;
  campanhaNome: string | null;
  grupoId: string | null;
  grupoNome: string | null;
  tipo: string | null;
  /** Orcamento diario na moeda do relatorio; null = nao tem nesse nivel. */
  orcamento: number | null;
  cpaDesejado: number | null;
}

export interface Campanhas {
  periodo: string;
  moeda: string;
  contas: { id: string; nome: string | null; plataforma: string; external_id: string; moeda?: string | null }[];
  filtro: { nivel: NivelCampanha; plataforma: string; conta: string; status: string; q: string; campanhaId: string | null };
  linhas: LinhaCampanha[];
  total: (NumerosCampanha & { quantidade: number }) | null;
  avisos: {
    semDetalhe: unknown[];
    diasNoPeriodo: number | null;
    moedasSemCotacao: string[];
    contraEntrega: boolean;
    sincronizadoEm: string | null;
  };
}

// GET /api/ads/meta/objeto e POST /api/ads/meta/alterar
export type NivelEdicao = "campanha" | "grupo" | "anuncio";
export type CampoEdicao = "status" | "orcamento_diario" | "orcamento_total" | "lance" | "roas_minimo";

export interface ObjetoAoVivo {
  id: string;
  nome: string;
  nivel: NivelEdicao;
  /** status configurado (ACTIVE, PAUSED, ARCHIVED, DELETED). */
  status: string;
  /** effective_status. */
  efetivo: string;
  diario: number | null;
  total: number | null;
  estrategia: string | null;
  lance: number | null;
  roasMinimo: number | null;
  conta: string | null;
  moeda: string;
}

export const ESTRATEGIAS_COM_LANCE = ["LOWEST_COST_WITH_BID_CAP", "COST_CAP"];
export const ESTRATEGIA_ROAS_MINIMO = "LOWEST_COST_WITH_MIN_ROAS";
