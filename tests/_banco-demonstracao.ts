// Banco falso em memoria para os testes da loja de demonstracao (o cron e o
// semear): tabelas como listas de linhas, com o que src/lib/demonstracao/
// gravacao.ts pede -- filtros (eq/neq/in/gte/gt/lte/lt/is/or), order com
// varias colunas, range/limit, o corte de 1000 linhas do PostgREST, contagem
// (head), upsert pela chave do onConflict (com ignoreDuplicates), update e
// delete pelos filtros (com count) e .select() depois da escrita. Conta as
// consultas (from) e guarda cada escrita com as linhas que ela tocou.

type Linha = Record<string, unknown>;
type Op = "select" | "insert" | "update" | "delete" | "upsert";

export interface Escrita {
  tabela: string;
  op: Exclude<Op, "select">;
  /** As linhas tocadas: o estado depois (upsert/update/insert) ou antes (delete). */
  linhas: Linha[];
}

export interface BancoFalso {
  client: never;
  tabelas: Record<string, Linha[]>;
  consultas: number;
  escritas: Escrita[];
}

const MAX_LINHAS = 1000;

function comparar(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  const x = String(a ?? "");
  const y = String(b ?? "");
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Um termo do `.or()` do PostgREST: `coluna.op.valor`. */
function termoDoOr(termo: string): (l: Linha) => boolean {
  const m = termo.trim().match(/^(\w+)\.(eq|neq|is|gte|lte|gt|lt)\.(.*)$/);
  if (!m) throw new Error(`filtro or que o fake nao entende: ${termo}`);
  const [, col, op, bruto] = m;
  return (l) => {
    const v = l[col] ?? null;
    if (op === "is") return v === (bruto === "null" ? null : bruto === "true" ? true : bruto === "false" ? false : bruto);
    if (v === null) return false;
    const c = comparar(v, bruto);
    if (op === "eq") return c === 0;
    if (op === "neq") return c !== 0;
    if (op === "gte") return c >= 0;
    if (op === "lte") return c <= 0;
    if (op === "gt") return c > 0;
    return c < 0;
  };
}

export function bancoFalso(tabelas: Record<string, Linha[]> = {}): BancoFalso {
  const saida: BancoFalso = { client: undefined as never, tabelas, consultas: 0, escritas: [] };

  function from(tabela: string) {
    saida.consultas += 1;
    const filtros: ((l: Linha) => boolean)[] = [];
    const ordens: { col: string; asc: boolean }[] = [];
    let op: Op = "select";
    let payload: unknown = null;
    let head = false;
    let contar = false;
    let devolver = false;
    let unico = false;
    let limite: number | null = null;
    let faixa: [number, number] | null = null;
    let conflito = "id";
    let ignorar = false;

    const executar = () => {
      const linhas = (tabelas[tabela] ||= []);
      if (op === "upsert" || op === "insert") {
        const novas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
        const cols = conflito.split(",").map((c) => c.trim());
        const chave = (l: Linha) => cols.map((c) => String(l[c] ?? "")).join("\u0000");
        const indice = new Map(linhas.map((l) => [chave(l), l]));
        const tocadas: Linha[] = [];
        for (const n of novas) {
          const atual = indice.get(chave(n));
          if (atual) {
            if (op === "insert") return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
            if (ignorar) continue;
            Object.assign(atual, structuredClone(n));
            tocadas.push(atual);
          } else {
            const linha = structuredClone(n);
            linhas.push(linha);
            indice.set(chave(linha), linha);
            tocadas.push(linha);
          }
        }
        saida.escritas.push({ tabela, op, linhas: tocadas.map((l) => ({ ...l })) });
        return { data: devolver ? tocadas.map((l) => ({ ...l })) : null, error: null, count: null };
      }
      const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const l of alvo) Object.assign(l, structuredClone(payload as Linha));
        saida.escritas.push({ tabela, op, linhas: alvo.map((l) => ({ ...l })) });
        return { data: devolver ? alvo.map((l) => ({ ...l })) : null, error: null, count: null };
      }
      if (op === "delete") {
        const fora = new Set(alvo);
        tabelas[tabela] = linhas.filter((l) => !fora.has(l));
        saida.escritas.push({ tabela, op, linhas: alvo.map((l) => ({ ...l })) });
        return { data: null, error: null, count: contar ? alvo.length : null };
      }
      if (head) return { data: null, error: null, count: alvo.length };
      const ordenadas = ordens.length
        ? [...alvo].sort((a, b) => {
            for (const o of ordens) {
              const c = comparar(a[o.col], b[o.col]);
              if (c !== 0) return o.asc ? c : -c;
            }
            return 0;
          })
        : alvo;
      let pagina = faixa ? ordenadas.slice(faixa[0], faixa[1] + 1) : ordenadas;
      pagina = pagina.slice(0, Math.min(limite ?? MAX_LINHAS, MAX_LINHAS));
      const data = pagina.map((l) => ({ ...l }));
      if (unico) return { data: data[0] ?? null, error: null, count: null };
      return { data, error: null, count: null };
    };

    const q: Record<string, unknown> = {
      select: (_cols?: string, o?: { head?: boolean; count?: string }) => {
        if (o?.head) head = true;
        if (op !== "select") devolver = true;
        return q;
      },
      upsert: (l: unknown, o?: { onConflict?: string; ignoreDuplicates?: boolean }) => {
        op = "upsert";
        payload = l;
        if (o?.onConflict) conflito = o.onConflict;
        ignorar = Boolean(o?.ignoreDuplicates);
        return q;
      },
      insert: (l: unknown) => {
        op = "insert";
        payload = l;
        return q;
      },
      update: (l: unknown) => {
        op = "update";
        payload = l;
        return q;
      },
      delete: (o?: { count?: string }) => {
        op = "delete";
        contar = Boolean(o?.count);
        return q;
      },
      eq: (c: string, v: unknown) => (filtros.push((l) => comparar(l[c], v) === 0 && l[c] !== undefined && l[c] !== null), q),
      neq: (c: string, v: unknown) => (filtros.push((l) => comparar(l[c], v) !== 0), q),
      in: (c: string, vs: unknown[]) => (filtros.push((l) => vs.some((v) => comparar(l[c], v) === 0)), q),
      gte: (c: string, v: unknown) => (filtros.push((l) => comparar(l[c], v) >= 0), q),
      gt: (c: string, v: unknown) => (filtros.push((l) => comparar(l[c], v) > 0), q),
      lte: (c: string, v: unknown) => (filtros.push((l) => comparar(l[c], v) <= 0), q),
      lt: (c: string, v: unknown) => (filtros.push((l) => comparar(l[c], v) < 0), q),
      is: (c: string, v: unknown) => (filtros.push((l) => (l[c] ?? null) === v), q),
      not: (c: string, operador: string, v: unknown) => {
        if (operador !== "is") throw new Error(`not.${operador} que o fake nao entende`);
        filtros.push((l) => (l[c] ?? null) !== v);
        return q;
      },
      or: (expr: string) => {
        const termos = expr.split(",").map(termoDoOr);
        filtros.push((l) => termos.some((t) => t(l)));
        return q;
      },
      order: (col: string, o?: { ascending?: boolean }) => (ordens.push({ col, asc: o?.ascending !== false }), q),
      limit: (n: number) => ((limite = n), q),
      range: (de: number, ate: number) => ((faixa = [de, ate]), q),
      maybeSingle: () => ((unico = true), q),
      single: () => ((unico = true), q),
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve().then(executar).then(ok, erro),
    };
    return q;
  }

  saida.client = { from } as never;
  return saida;
}

/** Copia funda das tabelas (para comparar antes e depois). */
export function retrato(b: BancoFalso, tabelas: string[]): Record<string, Linha[]> {
  return Object.fromEntries(tabelas.map((t) => [t, structuredClone(b.tabelas[t] ?? [])]));
}
