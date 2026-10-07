import {
  RE_MOEDA,
  arredondar,
  diaNoFuso,
  diasDoIntervalo,
  paraNumero,
  somarDias,
  type AdSpendDailyRow,
  type Intervalo,
  type NivelGasto,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Meta Ads (Insights) -> linhas de ad_spend_daily. PURO: sem I/O, sem
// "server-only". Quem fala com a Graph e meta-graph.ts; quem grava e
// meta-sync.ts.
// ============================================================================

export interface AcaoMeta {
  action_type: string;
  value: string;
}

/** Uma linha de GET act_{id}/insights com time_increment=1. */
export interface InsightMeta {
  account_currency?: string;
  date_start?: string;
  date_stop?: string;
  spend?: string | number;
  impressions?: string | number;
  clicks?: string | number;
  actions?: AcaoMeta[];
  action_values?: AcaoMeta[];
  campaign_id?: string | number;
  campaign_name?: string;
  adset_id?: string | number;
  adset_name?: string;
  ad_id?: string | number;
  ad_name?: string;
}

export interface ContextoLinhas {
  ad_account_id: string;
  user_id: string;
  moedaConta: string;
  sincronizado_em: string;
}

/**
 * Ordem de preferencia. omni_purchase ja e a soma deduplicada que o Gerenciador
 * mostra como "Compras" (pixel + CAPI + app + offline); o fb_pixel_purchase e
 * so o pedaco do pixel. Somar os dois contaria a mesma compra duas vezes.
 */
export const TIPOS_COMPRA = ["omni_purchase", "offsite_conversion.fb_pixel_purchase"] as const;

export function comprasDe(
  actions?: AcaoMeta[] | null,
  valores?: AcaoMeta[] | null
): { compras: number; valor: number } {
  const lista = Array.isArray(actions) ? actions : [];
  const listaValores = Array.isArray(valores) ? valores : [];
  for (const tipo of TIPOS_COMPRA) {
    const acao = lista.find((a) => a?.action_type === tipo);
    if (!acao) continue;
    // O valor vem do MESMO tipo: misturar a contagem de um com o valor de outro
    // daria um ticket medio que nao existe.
    const valor = listaValores.find((a) => a?.action_type === tipo);
    return {
      compras: arredondar(paraNumero(acao.value), 2),
      valor: arredondar(paraNumero(valor?.value), 2),
    };
  }
  return { compras: 0, valor: 0 };
}

function moedaValida(...candidatas: (string | null | undefined)[]): string {
  for (const c of candidatas) {
    const m = (c ?? "").trim().toUpperCase();
    if (RE_MOEDA.test(m)) return m;
  }
  return "";
}

export function linhasDeInsights(
  rows: InsightMeta[],
  nivel: NivelGasto,
  ctx: ContextoLinhas
): AdSpendDailyRow[] {
  const saida: AdSpendDailyRow[] = [];
  for (const r of rows ?? []) {
    const data = String(r?.date_start ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) continue;
    const campanhaId = nivel === "campanha" ? String(r.campaign_id ?? "").trim() : "";
    // Linha de campanha sem id nao tem chave: viraria conflito com o total.
    if (nivel === "campanha" && !campanhaId) continue;
    const { compras, valor } = comprasDe(r.actions, r.action_values);
    saida.push({
      ad_account_id: ctx.ad_account_id,
      user_id: ctx.user_id,
      data,
      nivel,
      campanha_id: campanhaId,
      campanha_nome: nivel === "campanha" ? (r.campaign_name ?? null) : null,
      moeda: moedaValida(r.account_currency, ctx.moedaConta),
      // A coluna tem check gasto >= 0; o Meta nunca manda negativo, mas uma
      // linha recusada derrubaria o lote inteiro.
      gasto: Math.max(0, arredondar(paraNumero(r.spend), 4)),
      impressoes: Math.max(0, Math.round(paraNumero(r.impressions))),
      cliques: Math.max(0, Math.round(paraNumero(r.clicks))),
      compras,
      valor_compras: valor,
      fonte: "api",
      sincronizado_em: ctx.sincronizado_em,
    });
  }
  return saida;
}

/**
 * Uma linha de nivel 'conta' para CADA dia do intervalo, zerada se faltar.
 *
 * O Insights nao devolve linha para dia sem entrega. Sem o zero, um dia cujo
 * gasto o Meta corrigiu para 0 (clique invalido, campanha pausada antes de
 * gastar) ficaria com o valor velho gravado -- e o lucro mentiria.
 * As linhas de campanha passam intactas.
 */
export function preencherDiasConta(
  linhas: AdSpendDailyRow[],
  intervalo: Intervalo,
  ctx: ContextoLinhas
): AdSpendDailyRow[] {
  const moeda = moedaValida(ctx.moedaConta);
  const porDia = new Map<string, AdSpendDailyRow>();
  const outras: AdSpendDailyRow[] = [];
  for (const l of linhas) {
    if (l.nivel === "conta") porDia.set(l.data, l);
    else outras.push(l);
  }
  const saida: AdSpendDailyRow[] = [];
  for (const dia of diasDoIntervalo(intervalo)) {
    const existente = porDia.get(dia);
    if (existente) {
      saida.push(existente);
      porDia.delete(dia);
      continue;
    }
    // Sem moeda conhecida nao da para gravar (coluna not null com check): o
    // dia fica sem linha, e o proximo sync com moeda preenche.
    if (!moeda) continue;
    saida.push({
      ad_account_id: ctx.ad_account_id,
      user_id: ctx.user_id,
      data: dia,
      nivel: "conta",
      campanha_id: "",
      campanha_nome: null,
      moeda,
      gasto: 0,
      impressoes: 0,
      cliques: 0,
      compras: 0,
      valor_compras: 0,
      fonte: "api",
      sincronizado_em: ctx.sincronizado_em,
    });
  }
  // Dias fora do intervalo (o Meta nao devia mandar) nao sao descartados.
  return [...saida, ...porDia.values(), ...outras];
}

/**
 * Mesma chave duas vezes no MESMO upsert faz o Postgres recusar o lote
 * ("cannot affect row a second time"). Fica a ultima.
 */
export function deduplicarLinhas(linhas: AdSpendDailyRow[]): AdSpendDailyRow[] {
  const porChave = new Map<string, AdSpendDailyRow>();
  for (const l of linhas) {
    porChave.set(`${l.data}|${l.nivel}|${l.campanha_id}`, l);
  }
  return [...porChave.values()];
}

/** Reprocessa a janela longa se o ultimo reprocesso tiver mais que isto. */
export const REPROCESSO_A_CADA_MS = 20 * 60 * 60 * 1000;

/**
 * Quais dias pedir ao Meta nesta rodada.
 *
 * O Meta recalcula o gasto o tempo todo (atribuicao atrasada, clique invalido)
 * e congela depois de 28 dias. A rodada de 15 min pega ontem e hoje; uma vez a
 * cada ~20 h relemos os 28 dias inteiros. "Hoje" e no fuso DA CONTA, porque e
 * nele que o Meta corta o dia.
 *
 * A PRIMEIRA rodada vai 62 dias para tras: o mesmo horizonte dos pedidos (60
 * dias do read_orders) mais folga de fuso. Com 28, "Mes passado" e o periodo
 * anterior teriam receita inteira e gasto pela metade -- lucro inflado.
 */
export function janelaDeSync(
  conta: { fuso: string | null; ultimo_reprocesso_em: string | null },
  agora: Date
): { desde: string; ate: string; reprocesso: boolean } {
  const hoje = diaNoFuso(agora, conta.fuso);
  const ultimo = conta.ultimo_reprocesso_em ? Date.parse(conta.ultimo_reprocesso_em) : NaN;
  const primeira = !Number.isFinite(ultimo);
  const reprocesso = primeira || agora.getTime() - ultimo > REPROCESSO_A_CADA_MS;
  return {
    desde: primeira ? somarDias(hoje, -61) : reprocesso ? somarDias(hoje, -27) : somarDias(hoje, -1),
    ate: hoje,
    reprocesso,
  };
}

export type TipoErroMeta = "token" | "permissao" | "limite" | "outro";

const CODIGOS_LIMITE = new Set([4, 17, 32, 613, 80000]);

/**
 * Codigos da Graph (https://developers.facebook.com/docs/graph-api/guides/error-handling).
 * 190 = token; 10 e a faixa 200-299 = permissao; 4/17/32/613 = limite de
 * chamadas; 80000-80014 = limite por caso de uso de negocio (80000 e o do
 * Insights).
 */
export function classificarErroMeta(codigo: number | null): TipoErroMeta {
  if (codigo === null || !Number.isFinite(codigo)) return "outro";
  if (codigo === 190) return "token";
  if (codigo === 10 || (codigo >= 200 && codigo <= 299)) return "permissao";
  if (CODIGOS_LIMITE.has(codigo) || (codigo >= 80000 && codigo <= 80014)) return "limite";
  return "outro";
}

/** Header x-fb-ads-insights-throttle. */
export interface ThrottleMeta {
  app_id_util_pct: number;
  acc_id_util_pct: number;
}

export function lerThrottle(header: string | null | undefined): ThrottleMeta | null {
  if (!header) return null;
  try {
    const j = JSON.parse(header) as Record<string, unknown>;
    if (!j || typeof j !== "object") return null;
    return {
      app_id_util_pct: paraNumero(j.app_id_util_pct),
      acc_id_util_pct: paraNumero(j.acc_id_util_pct),
    };
  } catch {
    return null;
  }
}

/** Acima disto pulamos o detalhe por campanha: o total da conta vem primeiro. */
export const THROTTLE_MAX_PCT = 75;

/**
 * O total (level=account) e o que o lucro le; campanha e detalhe. Com a cota
 * da conta ou do app quase no fim, gastar chamada em detalhe arrisca o total da
 * proxima rodada.
 */
export function deveBuscarCampanha(t: ThrottleMeta | null): boolean {
  if (!t) return true;
  return t.acc_id_util_pct <= THROTTLE_MAX_PCT && t.app_id_util_pct <= THROTTLE_MAX_PCT;
}

/**
 * Niveis cujas linhas velhas da janela podem ser apagadas. Sem a chamada de
 * campanha nesta rodada, as linhas de campanha NAO foram reescritas -- apaga-las
 * por sincronizado_em antigo abriria buraco de 28 dias no detalhe.
 */
export function niveisParaLimpar(campanhaBuscada: boolean): NivelGasto[] {
  return campanhaBuscada ? ["conta", "campanha"] : ["conta"];
}

// ---------------------------------------------------------------------------
// Contas
// ---------------------------------------------------------------------------

export interface ContaMeta {
  account_id: string;
  nome: string | null;
  moeda: string | null;
  fuso: string | null;
  status: string | null;
}

/** account_status do Meta (numero) -> rotulo para a tela. */
const STATUS_CONTA: Record<number, string> = {
  1: "ativa",
  2: "desativada",
  3: "pagamento pendente",
  7: "em análise de risco",
  8: "acerto pendente",
  9: "em período de carência",
  100: "fechamento pendente",
  101: "fechada",
};

export function statusDaContaMeta(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  if (Number.isFinite(n) && STATUS_CONTA[n]) return STATUS_CONTA[n];
  return String(v).slice(0, 40);
}

/**
 * Linha de me/adaccounts ou assigned_ad_accounts -> conta. account_id so com
 * digitos (o `id` vem como "act_123"; a coluna external_id recusa o prefixo).
 */
export function contaDaListaMeta(row: unknown): ContaMeta | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const bruto = String(r.account_id ?? r.id ?? "");
  const account_id = bruto.replace(/^act_/, "").replace(/\D/g, "");
  if (!/^\d{5,20}$/.test(account_id)) return null;
  const moeda = moedaValida(typeof r.currency === "string" ? r.currency : null);
  const nome = typeof r.name === "string" && r.name.trim() ? r.name.trim().slice(0, 200) : null;
  const fuso =
    typeof r.timezone_name === "string" && r.timezone_name.trim() ? r.timezone_name.trim() : null;
  return {
    account_id,
    nome,
    moeda: moeda || null,
    fuso,
    status: statusDaContaMeta(r.account_status),
  };
}
