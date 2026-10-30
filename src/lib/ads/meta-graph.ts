import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import { META_GRAPH_VERSAO } from "@/lib/financeiro/tipos";
import {
  contaDaListaMeta,
  lerThrottle,
  statusDaContaMeta,
  type ContaMeta,
  type InsightMeta,
  type ThrottleMeta,
} from "@/lib/ads/meta-mapear";

// ============================================================================
// Leitura da Marketing API (Insights) com token de system user (ads_read).
//
// A URL leva o access_token na query: ela NUNCA vai para log, mensagem de erro
// ou resposta. Por isso toda falha de rede vira uma mensagem fixa, e a
// mensagem que o Meta devolve passa por limparMensagem antes de subir.
// ============================================================================

const BASE = "https://graph.facebook.com/" + META_GRAPH_VERSAO;
const TIMEOUT_MS = 25_000;

export class ErroGraph extends Error {
  codigo: number | null;
  subcodigo: number | null;
  /** error_user_title + error_user_msg: o motivo que a Marketing API explica (orcamento minimo...). */
  detalhe: string | null;
  constructor(mensagem: string, codigo: number | null, subcodigo: number | null, detalhe: string | null = null) {
    super(mensagem);
    this.name = "ErroGraph";
    this.codigo = codigo;
    this.subcodigo = subcodigo;
    this.detalhe = detalhe;
  }
}

interface RespostaGraph {
  json: Record<string, unknown>;
  throttle: ThrottleMeta | null;
}

function numeroOuNulo(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return v === null || v === undefined || v === "" || !Number.isFinite(n) ? null : n;
}

/** Tira qualquer coisa que pareca token da mensagem antes de ela subir. */
function limparMensagem(msg: string, token: string | null): string {
  let m = msg.replace(/access_token=[^&\s"']+/gi, "access_token=***");
  if (token && token.length >= 8) m = m.split(token).join("***");
  return m.slice(0, 500);
}

async function pedir(url: string, token: string | null, corpo?: URLSearchParams): Promise<RespostaGraph> {
  let resposta: Response;
  try {
    resposta = await safeFetch(url, {
      method: corpo ? "POST" : "GET",
      headers: corpo
        ? { accept: "application/json", "content-type": "application/x-www-form-urlencoded" }
        : { accept: "application/json" },
      ...(corpo ? { body: corpo.toString() } : {}),
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    // A mensagem original do fetch pode carregar a URL (com o token).
    throw new Error("falha de rede ao falar com o Meta");
  }

  const throttle = lerThrottle(resposta.headers.get("x-fb-ads-insights-throttle"));

  let json: Record<string, unknown>;
  try {
    json = (await resposta.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`resposta invalida do Meta (HTTP ${resposta.status})`);
  }

  const erro = json?.error as Record<string, unknown> | undefined;
  if (erro && typeof erro === "object") {
    const titulo = typeof erro.error_user_title === "string" ? erro.error_user_title.trim() : "";
    const explicacao = typeof erro.error_user_msg === "string" ? erro.error_user_msg.trim() : "";
    const detalhe = [titulo, explicacao].filter(Boolean).join(": ");
    throw new ErroGraph(
      limparMensagem(String(erro.message ?? "erro do Meta"), token),
      numeroOuNulo(erro.code),
      numeroOuNulo(erro.error_subcode),
      detalhe ? limparMensagem(detalhe, token) : null
    );
  }
  if (!resposta.ok) {
    throw new ErroGraph(`HTTP ${resposta.status} do Meta`, null, null);
  }
  return { json: json ?? {}, throttle };
}

async function graphGet(
  caminho: string,
  params: Record<string, string>,
  token: string
): Promise<RespostaGraph> {
  const url = new URL(`${BASE}/${caminho.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  url.searchParams.set("access_token", token);
  return pedir(url.toString(), token);
}

/**
 * paging.next ja traz o token. So seguimos se apontar para a MESMA base: uma
 * resposta adulterada nao pode nos fazer mandar o token para outro host.
 */
async function graphGetProxima(url: string, token: string): Promise<RespostaGraph> {
  if (typeof url !== "string" || !url.startsWith(BASE + "/")) {
    throw new Error("paginacao do Meta fora da base esperada");
  }
  return pedir(url, token);
}

/**
 * Pagina uma aresta: segue paging.next quando aponta para a base; senao, o
 * cursor `after` com os mesmos parametros.
 *
 * `completo` = false quando sobrou pagina (teto de paginas ou paging.next sem
 * como seguir): quem apaga "o que nao voltou" precisa saber que nao viu tudo.
 */
async function paginar(
  caminho: string,
  params: Record<string, string>,
  token: string,
  maxPaginas: number
): Promise<{ rows: unknown[]; throttle: ThrottleMeta | null; completo: boolean }> {
  const rows: unknown[] = [];
  let throttle: ThrottleMeta | null = null;
  let completo = true;
  let r = await graphGet(caminho, params, token);
  for (let pagina = 1; ; pagina += 1) {
    if (r.throttle) throttle = r.throttle;
    const dados = r.json.data;
    if (Array.isArray(dados)) rows.push(...dados);
    const paging = (r.json.paging ?? {}) as {
      next?: string;
      cursors?: { after?: string };
    };
    if (pagina >= maxPaginas) {
      completo = typeof paging.next !== "string";
      break;
    }
    if (typeof paging.next === "string" && paging.next.startsWith(BASE + "/")) {
      r = await graphGetProxima(paging.next, token);
    } else if (typeof paging.next === "string" && paging.cursors?.after) {
      r = await graphGet(caminho, { ...params, after: paging.cursors.after }, token);
    } else {
      completo = typeof paging.next !== "string";
      break;
    }
  }
  return { rows, throttle, completo };
}

const CAMPOS_CONTA_LISTA = "id,account_id,name,currency,timezone_name,account_status";

function contasUnicas(rows: unknown[]): ContaMeta[] {
  const vistas = new Map<string, ContaMeta>();
  for (const row of rows) {
    const c = contaDaListaMeta(row);
    if (c && !vistas.has(c.account_id)) vistas.set(c.account_id, c);
  }
  return [...vistas.values()];
}

/**
 * Contas que o token enxerga.
 *
 * me/adaccounts com token de system user NAO esta verificado na doc atual; o
 * caminho documentado para system user e {id}/assigned_ad_accounts. Tenta o
 * primeiro e cai no segundo se der erro 100 ou vier vazio.
 */
export async function listarContasMeta(token: string): Promise<ContaMeta[]> {
  let contas: ContaMeta[] = [];
  try {
    const r = await paginar(
      "me/adaccounts",
      { fields: CAMPOS_CONTA_LISTA, limit: "100" },
      token,
      5
    );
    contas = contasUnicas(r.rows);
  } catch (e) {
    if (!(e instanceof ErroGraph && e.codigo === 100)) throw e;
  }
  if (contas.length > 0) return contas;

  const eu = await graphGet("me", { fields: "id" }, token);
  const id = String(eu.json.id ?? "").replace(/\D/g, "");
  if (!id) return [];
  try {
    const r = await paginar(
      `${id}/assigned_ad_accounts`,
      { fields: CAMPOS_CONTA_LISTA, limit: "100" },
      token,
      5
    );
    return contasUnicas(r.rows);
  } catch (e) {
    // 100 aqui = o token nao e de system user (a aresta nao existe para ele).
    if (e instanceof ErroGraph && e.codigo === 100) return [];
    throw e;
  }
}

export async function buscarConta(
  contaId: string,
  token: string
): Promise<Omit<ContaMeta, "account_id">> {
  const r = await graphGet(
    `act_${contaId.replace(/\D/g, "")}`,
    { fields: "name,currency,timezone_name,account_status" },
    token
  );
  const c = contaDaListaMeta({ ...r.json, account_id: contaId });
  return {
    nome: c?.nome ?? null,
    moeda: c?.moeda ?? null,
    fuso: c?.fuso ?? null,
    status: c?.status ?? statusDaContaMeta(r.json.account_status),
  };
}

/**
 * Insights diario. SEM action_attribution_windows de proposito: assim a API usa
 * a atribuicao configurada em cada conjunto e o numero bate com o Gerenciador.
 */
export type NivelInsightMeta = "account" | "campaign" | "adset" | "ad";

/**
 * Campos crus da aba Campanhas (ad_insights_granular). O IC e a visualizacao
 * de 3 s (`video_view`) ja vem em `actions`; reproducao e 75% do video vem em
 * listas proprias.
 */
export const CAMPOS_GRANULARES = "frequency,video_play_actions,video_p75_watched_actions";

export async function buscarInsightsDetalhado(
  contaId: string,
  token: string,
  desde: string,
  ate: string,
  nivel: NivelInsightMeta,
  opcoes: { granular?: boolean } = {}
): Promise<{ rows: InsightMeta[]; throttle: ThrottleMeta | null; completo: boolean }> {
  let fields = "account_currency,date_start,spend,impressions,clicks,actions,action_values";
  if (nivel === "campaign") {
    fields += ",campaign_id,campaign_name";
  } else if (nivel === "adset") {
    fields += ",campaign_id,campaign_name,adset_id,adset_name";
  } else if (nivel === "ad") {
    fields += ",campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name";
  }
  if (opcoes.granular) fields += "," + CAMPOS_GRANULARES;

  const r = await paginar(
    `act_${contaId.replace(/\D/g, "")}/insights`,
    {
      level: nivel,
      time_increment: "1",
      time_range: JSON.stringify({ since: desde, until: ate }),
      fields,
      limit: "500",
    },
    token,
    20
  );
  return { rows: r.rows as InsightMeta[], throttle: r.throttle, completo: r.completo };
}

/**
 * Campanhas, conjuntos e anuncios da conta como estao AGORA: status efetivo,
 * orcamento e a quem pertencem. Tres chamadas (uma por aresta), em paralelo,
 * com os campos minimos. Sem filtro o Meta devolve tudo que nao esta
 * arquivado nem apagado -- o que esta ativo ou pausado.
 */
export async function buscarEstruturaMeta(
  contaId: string,
  token: string
): Promise<{
  campanhas: unknown[];
  conjuntos: unknown[];
  anuncios: unknown[];
  completa: { campanhas: boolean; conjuntos: boolean; anuncios: boolean };
}> {
  const conta = `act_${contaId.replace(/\D/g, "")}`;
  const [campanhas, conjuntos, anuncios] = await Promise.all([
    paginar(
      `${conta}/campaigns`,
      { fields: "id,name,effective_status,daily_budget,lifetime_budget", limit: "500" },
      token,
      20
    ),
    paginar(
      `${conta}/adsets`,
      { fields: "id,name,effective_status,daily_budget,lifetime_budget,campaign_id", limit: "500" },
      token,
      20
    ),
    paginar(
      `${conta}/ads`,
      { fields: "id,name,effective_status,adset_id,campaign_id", limit: "500" },
      token,
      20
    ),
  ]);
  return {
    campanhas: campanhas.rows,
    conjuntos: conjuntos.rows,
    anuncios: anuncios.rows,
    completa: {
      campanhas: campanhas.completo,
      conjuntos: conjuntos.completo,
      anuncios: anuncios.completo,
    },
  };
}

export async function buscarInsights(
  contaId: string,
  token: string,
  desde: string,
  ate: string,
  nivel: NivelInsightMeta
): Promise<InsightMeta[]> {
  return (await buscarInsightsDetalhado(contaId, token, desde, ate, nivel)).rows;
}

/**
 * Estado AO VIVO de uma campanha, conjunto ou anuncio (gerenciar anuncios):
 * a edicao confere o valor de agora, nunca o do sync de 15 min.
 */
export async function lerObjetoMeta(
  objetoId: string,
  campos: string,
  token: string
): Promise<Record<string, unknown>> {
  const r = await graphGet(objetoId.replace(/\D/g, ""), { fields: campos }, token);
  return r.json;
}

/**
 * Escrita (ads_management): POST /{id} com os campos. O token vai no CORPO,
 * nao na URL. O Meta responde { success: true }; qualquer outra coisa e erro.
 */
export async function alterarObjetoMeta(
  objetoId: string,
  campos: Record<string, string>,
  token: string
): Promise<void> {
  const corpo = new URLSearchParams(campos);
  corpo.set("access_token", token);
  const r = await pedir(`${BASE}/${objetoId.replace(/\D/g, "")}`, token, corpo);
  if (r.json.success !== true) throw new ErroGraph("o Meta não confirmou a alteração", null, null);
}
