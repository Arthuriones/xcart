export type NivelGranularidade = "conta" | "campanha" | "grupo" | "anuncio";
export type PlataformaAds = "todas" | "meta" | "google" | "tiktok";
export type StatusFiltro = "qualquer" | "ativa" | "pausada";
export type PeriodoFiltro = "hoje" | "ontem" | "7d" | "14d" | "30d" | "mes_atual" | "mes_passado";

export interface ColunaDefinicao {
  id: string;
  rotulo: string;
  descricao?: string;
  larguraMinima?: number;
  categoria: "financeiro" | "trafego" | "conversao" | "video" | "geral";
  padraoAtiva: boolean;
  formato: "moeda" | "numero" | "porcentagem" | "texto" | "badge";
}

export interface LinhaCampanha {
  id: string;
  objetoId: string;
  nome: string;
  status: "ACTIVE" | "PAUSED" | "ARCHIVED" | string;
  plataforma: "meta" | "google" | "tiktok";
  nivel: NivelGranularidade;
  contaId: string;
  contaNome: string;
  campanhaId?: string;
  campanhaNome?: string;
  grupoId?: string;
  grupoNome?: string;
  tipo?: string;
  orcamento: number;
  cpaDesejado?: number;
  gastos: number;
  faturamento: number;
  custoProduto: number;
  lucro: number;
  roas: number;
  roi: number;
  margem: number;
  cpa: number;
  vendas: number;
  vendasPendentes?: number;
  vendasTotais?: number;
  cliques: number;
  impressoes: number;
  cpc: number;
  cpm: number;
  ctr: number;
  ic: number;
  cpi: number;
  visVideo?: number;
  vis3s?: number;
  retencao75?: number;
  hookRate?: number;
  holdRate?: number;
  frequencia?: number;
}

export interface TotaisResumo {
  contas: number;
  campanhas: number;
  grupos: number;
  anuncios: number;
  gastos: number;
  faturamento: number;
  lucro: number;
  vendas: number;
  cliques: number;
  impressoes: number;
  cpaMedio: number;
  roasMedio: number;
  margemMedia: number;
}
