// A linha vem pronta do servidor (src/lib/campanhas/montar.ts); aqui ficam so
// os tipos da tela. O periodo e o da barra do topo: a tela nao tem seletor.
export type { LinhaCampanha, NivelGranularidade } from "@/lib/campanhas/metricas";
export type { ResumoAtribuicao, ContaSemDetalhe } from "@/lib/campanhas/montar";

export type PlataformaAds = "todas" | "meta" | "google" | "tiktok";
export type StatusFiltro = "qualquer" | "ativa" | "pausada";

export interface ColunaDefinicao {
  id: string;
  rotulo: string;
  descricao?: string;
  larguraMinima?: number;
  categoria: "financeiro" | "trafego" | "conversao" | "video" | "geral";
  padraoAtiva: boolean;
  formato: "moeda" | "numero" | "porcentagem" | "texto" | "badge";
}
