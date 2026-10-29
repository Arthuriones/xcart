import {
  derivar,
  somarLinhas,
  type LinhaCampanha,
  type MetricasCampanha,
  type NivelGranularidade,
  type PlataformaCampanha,
  type SomasCampanha,
} from "./metricas";
import type { ContaSemDetalhe } from "./montar";

// ============================================================================
// Filtro da tela Campanhas (nivel, plataforma, conta, status, busca) e a linha
// de total. Puro e leve: a tela (navegador) e a rota do app do celular
// (/api/app/v1/campanhas) usam a MESMA regra, entao o numero e o mesmo.
// ============================================================================

export type PlataformaFiltro = "todas" | PlataformaCampanha;
export type StatusFiltro = "qualquer" | "ativa" | "pausada";

export interface FiltroCampanhas {
  nivel: NivelGranularidade;
  plataforma: PlataformaFiltro;
  /** "todas" ou o id da conta (ad_accounts.id). */
  conta: string;
  status: StatusFiltro;
  busca: string;
  /** So o app: a campanha aberta (a propria, os conjuntos ou os anuncios dela). */
  campanhaId?: string | null;
}

export const FILTRO_CAMPANHAS_PADRAO: FiltroCampanhas = {
  nivel: "campanha",
  plataforma: "todas",
  conta: "todas",
  status: "qualquer",
  busca: "",
  campanhaId: null,
};

const NIVEIS: readonly NivelGranularidade[] = ["conta", "campanha", "grupo", "anuncio"];
const PLATAFORMAS: readonly PlataformaFiltro[] = ["todas", "meta", "google", "tiktok"];
const STATUS: readonly StatusFiltro[] = ["qualquer", "ativa", "pausada"];
/** Busca colada do gerenciador cabe folgado; mais que isso e lixo. */
const BUSCA_MAXIMA = 200;
/** Id de campanha (Meta, Google, TikTok): digitos, as vezes letras. */
const RE_ID = /^[A-Za-z0-9_-]{1,64}$/;

const umDe = <T extends string>(lista: readonly T[], v: string | null, padrao: T): T =>
  lista.find((x) => x === v) ?? padrao;

/**
 * Parametros da URL do app -> filtro valido. Valor torto vira o padrao (como
 * cookie torto), nunca erro; conta fora de `contasValidas` vira "todas".
 */
export function filtroDeParametros(p: URLSearchParams, contasValidas: readonly string[]): FiltroCampanhas {
  const conta = p.get("conta");
  const campanhaId = (p.get("campanhaId") ?? "").trim();
  return {
    nivel: umDe(NIVEIS, p.get("nivel"), FILTRO_CAMPANHAS_PADRAO.nivel),
    plataforma: umDe(PLATAFORMAS, p.get("plataforma"), FILTRO_CAMPANHAS_PADRAO.plataforma),
    conta: conta && contasValidas.includes(conta) ? conta : "todas",
    status: umDe(STATUS, p.get("status"), FILTRO_CAMPANHAS_PADRAO.status),
    busca: (p.get("q") ?? "").trim().slice(0, BUSCA_MAXIMA),
    campanhaId: RE_ID.test(campanhaId) ? campanhaId : null,
  };
}

export function filtrarLinhas<T extends LinhaCampanha>(linhas: readonly T[], f: FiltroCampanhas): T[] {
  const q = f.busca.trim().toLowerCase();
  return linhas.filter((l) => {
    if (l.nivel !== f.nivel) return false;
    if (f.plataforma !== "todas" && l.plataforma !== f.plataforma) return false;
    if (f.conta !== "todas" && l.contaId !== f.conta) return false;
    // A campanha tem campanhaId = o proprio id; conjunto e anuncio, o da campanha deles.
    if (f.campanhaId && l.campanhaId !== f.campanhaId) return false;

    // Sem status (campanha so com gasto, sem detalhe) nao e ativa nem pausada.
    if (f.status === "ativa" && l.status !== "ACTIVE") return false;
    if (f.status === "pausada" && (l.status === null || l.status === "ACTIVE")) return false;

    // Busca textual: nome, conta ou o id (colado do gerenciador)
    if (q && !(l.nome.toLowerCase().includes(q) || l.contaNome.toLowerCase().includes(q) || l.objetoId.includes(q))) {
      return false;
    }
    return true;
  });
}

export type TotalCampanhas = SomasCampanha & MetricasCampanha;

/** Linha de total: das somas cruas das linhas visiveis, com a mesma conta das linhas. */
export function totalDasLinhas(linhas: readonly SomasCampanha[]): TotalCampanhas {
  const somas = somarLinhas(linhas);
  return { ...somas, ...derivar(somas) };
}

/**
 * O aviso "sem detalhe no periodo": so em conjunto e anuncio (a campanha
 * aparece com ou sem detalhe), e so da conta escolhida.
 */
export function semDetalheDoFiltro(semDetalhe: readonly ContaSemDetalhe[], f: Pick<FiltroCampanhas, "nivel" | "conta">): ContaSemDetalhe[] {
  if (f.nivel !== "grupo" && f.nivel !== "anuncio") return [];
  return semDetalhe.filter((c) => f.conta === "todas" || c.contaId === f.conta);
}
