import { RE_DIA, RE_MOEDA, arredondar, paraNumero, somarDias } from "@/lib/financeiro/tipos";
import {
  classificarErroMeta,
  type AcaoMeta,
  type ContextoLinhas,
  type InsightMeta,
} from "@/lib/ads/meta-mapear";

// ============================================================================
// Meta Ads -> linhas de ad_insights_granular (aba Campanhas). PURO: sem I/O,
// sem "server-only". Quem fala com a Graph e meta-graph.ts; quem grava e
// meta-sync.ts.
//
// O sync grava SO o cru do dia, na moeda da conta: gasto, impressoes,
// cliques, IC, video (reproducao, 3 s, 75%) e frequencia, mais o retrato
// atual do objeto (nome, status efetivo, CBO/ABO, orcamento diario). Derivada
// (cpc, ctr, roas...) e atribuicao (vendas, faturamento, lucro...) ficam no
// padrao 0: quem soma o periodo e atribui pelos pedidos e a leitura.
//
// retencao_75 e CONTAGEM (video_p75_watched_actions do dia), nao taxa -- a
// coluna e numeric(8,2), mas a soma do periodo so fecha com contagem: a taxa
// e soma(retencao_75) / soma(vis_video). Teto de 999.999 por linha.
// ============================================================================

export type NivelGranular = "campanha" | "grupo" | "anuncio";

export const NIVEIS_GRANULARES: readonly NivelGranular[] = ["campanha", "grupo", "anuncio"];

/** As colunas que o sync escreve; as outras ficam no padrao da tabela. */
export interface LinhaGranularMeta {
  user_id: string;
  ad_account_id: string;
  plataforma: "meta";
  data: string;
  nivel: NivelGranular;
  objeto_id: string;
  objeto_nome: string;
  objeto_status: string;
  campanha_id: string | null;
  campanha_nome: string | null;
  grupo_id: string | null;
  grupo_nome: string | null;
  tipo: "CBO" | "ABO" | null;
  orcamento: number;
  gasto: number;
  impressoes: number;
  cliques: number;
  ic: number;
  vis_video: number;
  vis_3s: number;
  retencao_75: number;
  frequencia: number;
  moeda: string;
  sincronizado_em: string;
}

/** Campanha, conjunto ou anuncio como o Meta lista agora. */
export interface ObjetoMeta {
  id: string;
  nome: string | null;
  /** effective_status (ACTIVE, PAUSED, CAMPAIGN_PAUSED, ADSET_PAUSED...). */
  status: string;
  campanhaId: string | null;
  grupoId: string | null;
  /** Orcamento diario em unidades da moeda da conta; 0 sem orcamento diario. */
  diario: number;
  /** Tem orcamento proprio, diario OU vitalicio. */
  temOrcamento: boolean;
}

export interface EstruturaMeta {
  campanhas: Map<string, ObjetoMeta>;
  grupos: Map<string, ObjetoMeta>;
  anuncios: Map<string, ObjetoMeta>;
}

/**
 * Sem filtro, as arestas /campaigns, /adsets e /ads nao trazem o que esta
 * arquivado ou apagado. Objeto que gastou na janela e nao veio na lista
 * (completa) e um dos dois -- nao da para saber qual; nenhum roda.
 */
export const STATUS_FORA_DA_LISTA = "ARCHIVED";

/** Lista veio sem effective_status (nao devia): nao inventa um. */
const STATUS_SEM_INFORMACAO = "UNKNOWN";

/**
 * Moedas de "offset 1" na Marketing API (developers.facebook.com/docs/
 * marketing-api/currencies): o orcamento vem na unidade cheia. Nas outras o
 * orcamento vem em centavos ("5000" = 50,00).
 */
export const MOEDAS_SEM_CENTAVOS: ReadonlySet<string> = new Set([
  "CLP",
  "COP",
  "CRC",
  "HUF",
  "ISK",
  "IDR",
  "JPY",
  "KRW",
  "PYG",
  "TWD",
  "VND",
]);

/** Orcamento do Meta (string na menor unidade da moeda) -> unidades. */
export function orcamentoEmUnidades(bruto: unknown, moeda: string): number {
  const n = paraNumero(bruto);
  if (n <= 0) return 0;
  return arredondar(n / (MOEDAS_SEM_CENTAVOS.has(moeda) ? 1 : 100), 2);
}

function idDe(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  return s.length <= 64 ? s : "";
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function moedaValida(...candidatas: (string | null | undefined)[]): string {
  for (const c of candidatas) {
    const m = (c ?? "").trim().toUpperCase();
    if (RE_MOEDA.test(m)) return m;
  }
  return "";
}

/** Linha de /campaigns, /adsets ou /ads -> objeto. Sem id: null. */
export function objetoDaLista(row: unknown, moeda: string): ObjetoMeta | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = idDe(r.id);
  if (!id) return null;
  const diario = orcamentoEmUnidades(r.daily_budget, moeda);
  const vitalicio = orcamentoEmUnidades(r.lifetime_budget, moeda);
  const status = typeof r.effective_status === "string" ? r.effective_status.trim().toUpperCase() : "";
  return {
    id,
    nome: textoOuNulo(r.name),
    status: status ? status.slice(0, 40) : STATUS_SEM_INFORMACAO,
    campanhaId: idDe(r.campaign_id) || null,
    grupoId: idDe(r.adset_id) || null,
    diario,
    temOrcamento: diario > 0 || vitalicio > 0,
  };
}

export function estruturaDaLista(
  listas: { campanhas: unknown[]; conjuntos: unknown[]; anuncios: unknown[] },
  moeda: string
): EstruturaMeta {
  const mapa = (rows: unknown[]) => {
    const m = new Map<string, ObjetoMeta>();
    for (const row of Array.isArray(rows) ? rows : []) {
      const o = objetoDaLista(row, moeda);
      if (o) m.set(o.id, o);
    }
    return m;
  };
  return {
    campanhas: mapa(listas.campanhas),
    grupos: mapa(listas.conjuntos),
    anuncios: mapa(listas.anuncios),
  };
}

/**
 * CBO = o orcamento e da campanha (Advantage campaign budget); ABO = dos
 * conjuntos. Sem a campanha na lista, o conjunto decide: conjunto sem
 * orcamento proprio so roda com o da campanha.
 */
export function tipoDoOrcamento(campanha?: ObjetoMeta, grupo?: ObjetoMeta): "CBO" | "ABO" | null {
  if (campanha) return campanha.temOrcamento ? "CBO" : "ABO";
  if (grupo) return grupo.temOrcamento ? "ABO" : "CBO";
  return null;
}

/**
 * Ordem de preferencia, como em TIPOS_COMPRA: omni_ ja e a soma deduplicada
 * (pixel + CAPI) que o Gerenciador mostra; o do pixel e so um pedaco. Fica o
 * primeiro que vier -- somar contaria o mesmo checkout duas vezes.
 */
export const TIPOS_IC = [
  "omni_initiated_checkout",
  "offsite_conversion.fb_pixel_initiate_checkout",
  "initiate_checkout",
] as const;

function valorDaAcao(lista: AcaoMeta[] | null | undefined, tipos: readonly string[]): number {
  const l = Array.isArray(lista) ? lista : [];
  for (const tipo of tipos) {
    const acao = l.find((a) => a?.action_type === tipo);
    if (acao) return paraNumero(acao.value);
  }
  return 0;
}

/** video_play_actions e video_p75_watched_actions vem como [{ action_type: "video_view", value }]. */
function contagemDeVideo(lista: AcaoMeta[] | null | undefined): number {
  const l = Array.isArray(lista) ? lista : [];
  const vv = l.find((a) => a?.action_type === "video_view");
  if (vv) return paraNumero(vv.value);
  return l.reduce((s, a) => s + paraNumero(a?.value), 0);
}

/** numeric(8,2): passar disso recusaria o lote inteiro. */
const TETO_NUMERIC_8_2 = 999_999.99;
const TETO_CONTAGEM_8_2 = 999_999;

function caber82(v: number): number {
  return Math.min(TETO_NUMERIC_8_2, Math.max(0, v));
}

export interface MetricasDoDia {
  gasto: number;
  impressoes: number;
  cliques: number;
  ic: number;
  vis_video: number;
  vis_3s: number;
  retencao_75: number;
  frequencia: number;
}

const SEM_ENTREGA: MetricasDoDia = {
  gasto: 0,
  impressoes: 0,
  cliques: 0,
  ic: 0,
  vis_video: 0,
  vis_3s: 0,
  retencao_75: 0,
  frequencia: 0,
};

/** O cru de uma linha do Insights (time_increment=1). Campo ausente = 0. */
export function metricasDoDia(r: InsightMeta): MetricasDoDia {
  const inteiro = (v: number) => Math.max(0, Math.round(v));
  return {
    gasto: Math.max(0, arredondar(paraNumero(r.spend), 4)),
    impressoes: inteiro(paraNumero(r.impressions)),
    cliques: inteiro(paraNumero(r.clicks)),
    ic: inteiro(valorDaAcao(r.actions, TIPOS_IC)),
    // Reproducao (qualquer tempo) e a lista video_play_actions; a de 3 s e o
    // action_type video_view de `actions`.
    vis_video: inteiro(contagemDeVideo(r.video_play_actions)),
    vis_3s: inteiro(valorDaAcao(r.actions, ["video_view"])),
    retencao_75: Math.min(TETO_CONTAGEM_8_2, inteiro(contagemDeVideo(r.video_p75_watched_actions))),
    frequencia: caber82(arredondar(paraNumero(r.frequency), 2)),
  };
}

export interface EntradaGranular {
  ctx: ContextoLinhas;
  /** Hoje no fuso da conta (o fim da janela). */
  hoje: string;
  insights: Record<NivelGranular, InsightMeta[]>;
  /** O Insights do nivel veio inteiro (sem pagina sobrando). */
  completos: Record<NivelGranular, boolean>;
  estrutura: EstruturaMeta;
}

function mapaDoNivel(e: EstruturaMeta, nivel: NivelGranular): Map<string, ObjetoMeta> {
  return nivel === "campanha" ? e.campanhas : nivel === "grupo" ? e.grupos : e.anuncios;
}

function idDoInsight(r: InsightMeta, nivel: NivelGranular): string {
  return idDe(nivel === "campanha" ? r.campaign_id : nivel === "grupo" ? r.adset_id : r.ad_id);
}

function nomeDoInsight(r: InsightMeta | null, nivel: NivelGranular): string | null {
  if (!r) return null;
  return textoOuNulo(nivel === "campanha" ? r.campaign_name : nivel === "grupo" ? r.adset_name : r.ad_name);
}

function chave(data: string, nivel: NivelGranular, id: string): string {
  return `${data}|${nivel}|${id}`;
}

/**
 * Insights dos tres niveis + a lista atual -> linhas da tabela, uma por
 * (dia, nivel, objeto). Nome, status e orcamento sao os de AGORA (os da
 * lista; o do Insights so quando o objeto nao veio nela).
 *
 * Objeto ATIVO que nao entregou hoje ganha a linha de hoje zerada: sem ela a
 * aba nao mostraria a campanha recem-ligada (nem o orcamento dela) ate o
 * primeiro gasto. Amanha, se continuar sem entrega, a limpeza da janela a
 * apaga. So em nivel com o Insights completo -- senao a linha zerada podia
 * cobrir a de verdade que ficou na pagina que nao veio.
 */
export function linhasGranulares(e: EntradaGranular): LinhaGranularMeta[] {
  const porChave = new Map<string, LinhaGranularMeta>();
  const est = e.estrutura;

  const montar = (
    nivel: NivelGranular,
    id: string,
    data: string,
    moeda: string,
    r: InsightMeta | null
  ): LinhaGranularMeta => {
    const proprio = mapaDoNivel(est, nivel).get(id);
    const campanhaId = nivel === "campanha" ? id : idDe(r?.campaign_id) || proprio?.campanhaId || null;
    const grupoId =
      nivel === "grupo" ? id : nivel === "anuncio" ? idDe(r?.adset_id) || proprio?.grupoId || null : null;
    const campanha = campanhaId ? est.campanhas.get(campanhaId) : undefined;
    const grupo = grupoId ? est.grupos.get(grupoId) : undefined;
    return {
      user_id: e.ctx.user_id,
      ad_account_id: e.ctx.ad_account_id,
      plataforma: "meta",
      data,
      nivel,
      objeto_id: id,
      objeto_nome: proprio?.nome ?? nomeDoInsight(r, nivel) ?? id,
      objeto_status: proprio?.status ?? STATUS_FORA_DA_LISTA,
      campanha_id: campanhaId,
      campanha_nome: campanha?.nome ?? textoOuNulo(r?.campaign_name),
      grupo_id: grupoId,
      grupo_nome: grupoId ? (grupo?.nome ?? textoOuNulo(r?.adset_name)) : null,
      tipo: tipoDoOrcamento(campanha, grupo),
      // O orcamento e de quem o tem: campanha em CBO, conjunto em ABO.
      // Anuncio nunca tem; vitalicio fica 0 (nao e diario).
      orcamento: nivel === "anuncio" ? 0 : (proprio?.diario ?? 0),
      ...(r ? metricasDoDia(r) : SEM_ENTREGA),
      moeda,
      sincronizado_em: e.ctx.sincronizado_em,
    };
  };

  for (const nivel of NIVEIS_GRANULARES) {
    for (const r of e.insights[nivel] ?? []) {
      const data = String(r?.date_start ?? "");
      if (!RE_DIA.test(data)) continue;
      const id = idDoInsight(r, nivel);
      if (!id) continue;
      // Coluna not null com check: sem moeda a linha derrubaria o lote.
      const moeda = moedaValida(r.account_currency, e.ctx.moedaConta);
      if (!moeda) continue;
      porChave.set(chave(data, nivel, id), montar(nivel, id, data, moeda, r));
    }
  }

  const moedaConta = moedaValida(e.ctx.moedaConta);
  if (moedaConta && RE_DIA.test(e.hoje)) {
    for (const nivel of NIVEIS_GRANULARES) {
      if (!e.completos[nivel]) continue;
      for (const o of mapaDoNivel(est, nivel).values()) {
        if (o.status !== "ACTIVE") continue;
        const k = chave(e.hoje, nivel, o.id);
        if (!porChave.has(k)) porChave.set(k, montar(nivel, o.id, e.hoje, moedaConta, null));
      }
    }
  }

  return [...porChave.values()];
}

/**
 * Niveis cujas linhas velhas da janela podem ser apagadas: so os que vieram
 * inteiros. Pagina que nao veio nao e "o Meta zerou".
 */
export function niveisGranularesParaLimpar(completos: Record<NivelGranular, boolean>): NivelGranular[] {
  return NIVEIS_GRANULARES.filter((n) => completos[n]);
}

/**
 * Banco no plano free: a aba le ate 92 dias; guardamos 100 (folga de fuso e
 * do "Mes passado"). Linha com data ANTES do corte sai.
 */
export const DIAS_GUARDADOS_GRANULAR = 100;

export function corteDaRetencaoGranular(hoje: string): string {
  return somarDias(hoje, -DIAS_GUARDADOS_GRANULAR);
}

/**
 * Erro do detalhe -> texto do log e do retorno do sync (nunca ultimo_erro: o
 * gasto ja foi gravado, e o alerta de gasto parado le aquele campo).
 */
export function textoDoErroGranular(codigo: number | null, mensagem: string): string {
  const tipo = classificarErroMeta(codigo);
  const motivo =
    tipo === "limite"
      ? "limite de taxa do Meta; tento de novo na próxima rodada."
      : tipo === "permissao"
        ? "sem permissão para ler campanhas, conjuntos e anúncios (ads_read)."
        : mensagem || "falha desconhecida";
  return `Detalhe da aba Campanhas não atualizou (o gasto sim): ${motivo}`.slice(0, 300);
}
