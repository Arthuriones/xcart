/**
 * Quanto a loja de demonstracao ocupa no banco, medido no proprio banco so
 * com SELECT.
 *
 * O banco de producao esta no plano free do Supabase (500 MB). Cheio, ele
 * fica so leitura e para webhook, coletor e roteamento das lojas reais. Por
 * isso o semear de verdade so grava com a estimativa MEDIDA e dentro dos
 * limites (conferirEspaco), e o --dry-run mostra a conta.
 *
 * Como mede, por tabela:
 *   - tupla: pg_column_size de uma amostra das NOSSAS linhas, montadas no
 *     tipo da propria tabela (jsonb_populate_recordset) -- o tamanho da linha
 *     como ela seria gravada, sem gravar nada;
 *   - disco por linha: o que a tabela gasta alem da tupla, medido nas linhas
 *     reais dela -- o heap (pg_total_relation_size - pg_indexes_size: TOAST,
 *     folga de pagina e linha morta) por byte de tupla (pg_column_size das
 *     linhas reais), e o indice (pg_indexes_size) por linha. A tabela com
 *     menos de MIN_LINHAS_REAIS linhas nao da medida (as paginas minimas
 *     dominam): ai vale o padrao, 1,2 no heap e 64 B por indice.
 *
 * A consulta vai pela Management API do Supabase com read_only: o Postgres a
 * roda numa transacao somente leitura, e a resposta confirma
 * (transaction_read_only = on) -- sem a confirmacao, a medida nao vale.
 *
 * Usado so por scripts/demo-loja.ts.
 */

export const MB = 1024 * 1024;
/** A carga da loja de demonstracao nunca passa disto. */
export const LIMITE_DA_CARGA = 70 * MB;
/** O banco (pg_database_size) mais a carga nunca passa disto (o plano free para em 500 MB). */
export const LIMITE_DO_BANCO = 400 * MB;
/** Abaixo disto a tabela real nao da medida de disco por linha. */
export const MIN_LINHAS_REAIS = 1000;
const FATOR_HEAP_PADRAO = 1.2;
const INDICE_PADRAO = 64;
/** Ponteiro de linha da pagina (ItemIdData): fora do pg_column_size. */
const PONTEIRO = 4;
const TAMANHO_DA_AMOSTRA = 120;

export type TabelaMedida =
  | "fin_orders"
  | "fin_order_origem"
  | "tracking_events"
  | "ad_spend_daily"
  | "ad_insights_granular"
  | "product_costs"
  | "demonstracao_catalogo";

const TABELAS = new Set<TabelaMedida>([
  "fin_orders",
  "fin_order_origem",
  "tracking_events",
  "ad_spend_daily",
  "ad_insights_granular",
  "product_costs",
  "demonstracao_catalogo",
]);

/** Uma parte da carga: as linhas que iriam para uma tabela. */
export interface ParteDaCarga {
  rotulo: string;
  tabela: TabelaMedida;
  linhas: readonly object[];
}

/** O que o banco respondeu para uma parte. */
export interface Medida {
  /** pg_column_size medio da amostra das nossas linhas. */
  tupla: number;
  amostra: number;
  /** As linhas reais da tabela, e quanto elas ocupam. */
  linhasReais: number;
  bytesReais: number;
  /** pg_total_relation_size - pg_indexes_size. */
  heapReal: number;
  indicesReais: number;
  nIndices: number;
  /** pg_database_size, no mesmo instante. */
  banco: number;
}

export interface PorLinha {
  heap: number;
  indice: number;
  total: number;
  /** A tabela real era pequena demais: fatores padrao. */
  padrao: boolean;
}

/** Os bytes de disco de UMA linha nossa, pela medida da tabela. */
export function porLinhaNoDisco(m: Pick<Medida, "tupla" | "linhasReais" | "bytesReais" | "heapReal" | "indicesReais" | "nIndices">): PorLinha {
  const medivel = m.linhasReais >= MIN_LINHAS_REAIS && m.bytesReais > 0;
  // Nunca abaixo de 1,05 no heap: pagina nao enche ate o ultimo byte.
  const fator = medivel ? Math.max(1.05, m.heapReal / m.bytesReais) : FATOR_HEAP_PADRAO;
  const indice = medivel ? m.indicesReais / m.linhasReais : m.nIndices * INDICE_PADRAO;
  const heap = (m.tupla + PONTEIRO) * fator;
  return { heap, indice, total: heap + indice, padrao: !medivel };
}

export interface ParteEstimada {
  rotulo: string;
  tabela: TabelaMedida;
  linhas: number;
  tupla: number;
  porLinha: PorLinha;
  bytes: number;
  /** false = o banco nao respondeu: tupla pelo JSON e fatores padrao. */
  medido: boolean;
}

export interface Estimativa {
  partes: ParteEstimada[];
  total: number;
  /** pg_database_size; null sem medida. */
  banco: number | null;
  /** Todas as partes medidas no banco (e confirmado somente leitura). */
  medido: boolean;
  erros: string[];
}

/** Por que NAO gravar (null = cabe). Sem medida, nao grava. */
export function conferirEspaco(e: Pick<Estimativa, "total" | "banco" | "medido" | "erros">): string | null {
  if (!e.medido || e.banco === null) {
    return `sem medir o banco nao da para saber se a carga cabe (${e.erros.join("; ") || "sem resposta"}).`;
  }
  if (e.total > LIMITE_DA_CARGA) {
    return `a carga estimada (${mb(e.total)} MB) passa de ${mb(LIMITE_DA_CARGA)} MB.`;
  }
  if (e.banco + e.total > LIMITE_DO_BANCO) {
    return `o banco (${mb(e.banco)} MB) mais a carga (${mb(e.total)} MB) passa de ${mb(LIMITE_DO_BANCO)} MB -- o plano free para em 500 MB.`;
  }
  return null;
}

export function mb(bytes: number): string {
  return (bytes / MB).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** `n` linhas espalhadas pela lista (a primeira, a ultima e o meio). */
export function amostra<T>(lista: readonly T[], n = TAMANHO_DA_AMOSTRA): T[] {
  if (lista.length <= n) return [...lista];
  const passo = (lista.length - 1) / (n - 1);
  return Array.from({ length: n }, (_, i) => lista[Math.round(i * passo)]);
}

const ETIQUETA = "$xcart_amostra$";

/** O SELECT que mede uma parte. So SELECT: a tabela vem da lista fechada, a amostra vai como literal. */
export function sqlDaMedida(tabela: TabelaMedida, linhas: readonly object[]): string {
  if (!TABELAS.has(tabela)) throw new Error(`tabela fora da lista: ${tabela}`);
  const json = JSON.stringify(linhas);
  if (json.includes(ETIQUETA)) throw new Error("a amostra contem a etiqueta do literal");
  const rel = `public.${tabela}`;
  return `select
  m.tupla,
  m.amostra,
  r.n::bigint as linhas_reais,
  r.bytes::bigint as bytes_reais,
  (pg_total_relation_size('${rel}'::regclass) - pg_indexes_size('${rel}'::regclass))::bigint as heap_real,
  pg_indexes_size('${rel}'::regclass)::bigint as indices_reais,
  (select count(*) from pg_index where indrelid = '${rel}'::regclass)::int as n_indices,
  pg_database_size(current_database())::bigint as banco,
  current_setting('transaction_read_only') as somente_leitura
from
  (select avg(pg_column_size(a.*))::float8 as tupla, count(*)::int as amostra
     from jsonb_populate_recordset(null::${rel}, ${ETIQUETA}${json}${ETIQUETA}::jsonb) a) m,
  (select count(*) as n, coalesce(sum(pg_column_size(t.*)), 0) as bytes from ${rel} t) r`;
}

interface Credenciais {
  token: string;
  projeto: string;
}

function credenciais(env: NodeJS.ProcessEnv): Credenciais | null {
  const token = env.SUPABASE_ACCESS_TOKEN;
  const projeto = env.SUPABASE_PROJECT_REF;
  return token && projeto ? { token, projeto } : null;
}

/** Uma consulta SO de leitura (Management API com read_only). Lanca se nao for SELECT. */
export async function consultarSomenteLeitura(sql: string, c: Credenciais): Promise<Record<string, unknown>[]> {
  if (!/^\s*(select|with)\b/i.test(sql)) throw new Error("so SELECT");
  const r = await fetch(`https://api.supabase.com/v1/projects/${encodeURIComponent(c.projeto)}/database/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${c.token}` },
    body: JSON.stringify({ query: sql, read_only: true }),
    signal: AbortSignal.timeout(60_000),
  });
  const corpo = (await r.json().catch(() => null)) as unknown;
  if (!r.ok || !Array.isArray(corpo)) {
    const msg = corpo && typeof corpo === "object" && "message" in corpo ? String((corpo as { message: unknown }).message) : `HTTP ${r.status}`;
    throw new Error(msg.slice(0, 300));
  }
  return corpo as Record<string, unknown>[];
}

const numero = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

async function medir(parte: ParteDaCarga, c: Credenciais): Promise<Medida> {
  const linhas = await consultarSomenteLeitura(sqlDaMedida(parte.tabela, amostra(parte.linhas)), c);
  const l = linhas[0] ?? {};
  if (l.somente_leitura !== "on") throw new Error("a consulta nao rodou somente leitura");
  return {
    tupla: numero(l.tupla),
    amostra: numero(l.amostra),
    linhasReais: numero(l.linhas_reais),
    bytesReais: numero(l.bytes_reais),
    heapReal: numero(l.heap_real),
    indicesReais: numero(l.indices_reais),
    nIndices: numero(l.n_indices),
    banco: numero(l.banco),
  };
}

/** Tupla pelo JSON (sem banco): o texto do JSON mais o cabecalho da linha. */
function tuplaPeloJson(linhas: readonly object[]): number {
  const a = amostra(linhas);
  if (!a.length) return 0;
  return a.reduce((t, x) => t + Buffer.byteLength(JSON.stringify(x)), 0) / a.length + 24;
}

/** A estimativa da carga inteira. Sem credencial ou com erro, cai no JSON e marca medido = false. */
export async function estimarCarga(partes: readonly ParteDaCarga[], env: NodeJS.ProcessEnv = process.env): Promise<Estimativa> {
  const c = credenciais(env);
  const erros: string[] = [];
  if (!c) erros.push("sem SUPABASE_ACCESS_TOKEN/SUPABASE_PROJECT_REF no .env.local");
  let banco: number | null = null;
  const saida: ParteEstimada[] = [];
  for (const p of partes) {
    let medida: Medida | null = null;
    if (c && p.linhas.length) {
      try {
        medida = await medir(p, c);
        banco = medida.banco;
      } catch (e) {
        // A primeira linha basta (o Postgres repete a consulta inteira depois).
        const msg = (e instanceof Error ? e.message : String(e)).split(/\r?\n/)[0].slice(0, 160);
        erros.push(`${p.rotulo}: ${msg}`);
      }
    }
    const base = medida ?? { tupla: tuplaPeloJson(p.linhas), linhasReais: 0, bytesReais: 0, heapReal: 0, indicesReais: 0, nIndices: 3 };
    const porLinha = porLinhaNoDisco(base);
    saida.push({
      rotulo: p.rotulo,
      tabela: p.tabela,
      linhas: p.linhas.length,
      tupla: base.tupla,
      porLinha,
      bytes: porLinha.total * p.linhas.length,
      medido: Boolean(medida) || p.linhas.length === 0,
    });
  }
  return {
    partes: saida,
    total: saida.reduce((t, p) => t + p.bytes, 0),
    banco,
    medido: Boolean(c) && banco !== null && saida.every((p) => p.medido),
    erros,
  };
}
