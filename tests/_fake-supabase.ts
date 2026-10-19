// Supabase falso em memoria para os testes do sensor do roteamento: tabelas
// como listas de linhas, filtros simples (eq/in/gte/lte/lt/gt/is/neq/like, e o
// `or` do PostgREST com grupos `and(...)`),
// insert com a PK de shopify_webhook_events e o indice unico da fila de
// rastreamento, update/delete pelos filtros e contagem com { head: true }.
// Ordem nao e aplicada: o teste guarda as linhas ja na ordem que a consulta
// pediria. upsert pela coluna do onConflict; .select() depois de uma escrita
// devolve as linhas escritas (o insert ganha um id se nao tem). Coluna JSON no
// select (`apelido:payload->a->>b`) vem junto da linha, pelo apelido.

type Linha = Record<string, unknown>;
type Erro = { code?: string; message: string };
type Op = "select" | "insert" | "update" | "delete" | "upsert";

export interface FakeSupabase {
  // O tipo do cliente real e do chamador; aqui basta o formato.
  client: never;
  tabelas: Record<string, Linha[]>;
  inserts: { tabela: string; linha: Linha }[];
  upserts: { tabela: string; linha: Linha }[];
  updates: { tabela: string; payload: Linha; linhas: number }[];
  deletes: { tabela: string; linhas: number }[];
}

/** Chaves unicas por tabela: a PK do webhook e o (store, destino, evento) da fila (043). */
const UNICOS: Record<string, string[]> = {
  shopify_webhook_events: ["webhook_id"],
  tracking_events: ["store_id", "destination_id", "event_id"],
};
/** Os defaults das colunas que o codigo nao manda no insert. */
const PADRAO: Record<string, () => Linha> = {
  tracking_events: () => {
    const agora = new Date().toISOString();
    return { status: "pendente", attempts: 0, sent_at: null, created_at: agora, next_attempt_at: agora };
  },
};
const MAX_LINHAS = 1000;

/** LIKE do Postgres: % e qualquer sequencia, _ e um caractere. */
function casaLike(texto: unknown, padrao: string): boolean {
  const re = padrao
    .split("")
    .map((c) => (c === "%" ? ".*" : c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`).test(String(texto ?? ""));
}

/** Divide `a,b(c,d),e` nas virgulas do nivel de fora. */
function noNivelDeFora(s: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const c of s) {
    if (c === "(") nivel++;
    if (c === ")") nivel--;
    if (c === "," && nivel === 0) {
      partes.push(atual.trim());
      atual = "";
      continue;
    }
    atual += c;
  }
  if (atual.trim()) partes.push(atual.trim());
  return partes;
}

/**
 * Um termo do `.or()` do PostgREST: `coluna.op.valor` (com `not.` antes do op)
 * ou um grupo `and(...)`/`or(...)`. Op fora da lista lanca: o teste tem que
 * saber que o fake nao entende o filtro.
 */
function termoDoOr(termo: string): (l: Linha) => boolean {
  const grupo = termo.match(/^(and|or)\((.*)\)$/);
  if (grupo) {
    const termos = noNivelDeFora(grupo[2]).map(termoDoOr);
    return grupo[1] === "and" ? (l) => termos.every((t) => t(l)) : (l) => termos.some((t) => t(l));
  }
  const m = termo.match(/^(\w+)\.(not\.)?(eq|neq|is|like|gte|lte|gt|lt)\.(.*)$/);
  if (!m) throw new Error(`filtro or que o fake nao entende: ${termo}`);
  const [, col, nao, op, bruto] = m;
  const casa = (l: Linha): boolean => {
    const atual = l[col] ?? null;
    if (op === "is") return atual === (bruto === "null" ? null : bruto === "true" ? true : bruto === "false" ? false : bruto);
    if (atual === null) return false;
    const texto = String(atual);
    if (op === "eq") return texto === bruto;
    if (op === "neq") return texto !== bruto;
    if (op === "like") return casaLike(texto, bruto.replace(/\*/g, "%"));
    if (op === "gte") return texto >= bruto;
    if (op === "lte") return texto <= bruto;
    if (op === "gt") return texto > bruto;
    return texto < bruto;
  };
  return nao ? (l) => !casa(l) : casa;
}

/** `apelido:coluna->a->>b` do select -> le o caminho dentro da coluna JSON. */
function colunasJson(cols: string | undefined): { apelido: string; coluna: string; caminho: string[] }[] {
  return (cols || "")
    .split(",")
    .map((c) => c.trim().match(/^(\w+):(\w+)((?:->>?\w+)+)$/))
    .filter((m): m is RegExpMatchArray => Boolean(m))
    .map((m) => ({ apelido: m[1], coluna: m[2], caminho: m[3].split(/->>?/).filter(Boolean) }));
}

export function fakeSupabase(
  tabelas: Record<string, Linha[]>,
  falhar?: (tabela: string, op: Op, payload: unknown) => Erro | null
): FakeSupabase {
  const saida: FakeSupabase = {
    client: undefined as never,
    tabelas,
    inserts: [],
    upserts: [],
    updates: [],
    deletes: [],
  };

  // id das linhas inseridas com .select(), unico no banco inteiro.
  let novoId = 0;

  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: Op = "select";
    let payload: unknown = null;
    let head = false;
    let limite: number | null = null;
    let unico = false;
    let devolver = false;
    let conflito = "id";
    let json: ReturnType<typeof colunasJson> = [];

    /** A linha com as colunas JSON pedidas no select, pelo apelido. */
    const comJson = (l: Linha): Linha => {
      if (!json.length) return l;
      const extra: Linha = {};
      for (const { apelido, coluna, caminho } of json) {
        let v: unknown = l[coluna];
        for (const passo of caminho) v = v && typeof v === "object" ? (v as Linha)[passo] : undefined;
        extra[apelido] = v === undefined || v === null ? null : typeof v === "object" ? v : String(v);
      }
      return { ...l, ...extra };
    };

    // So quando a escrita pede .select(): sem ele o Supabase devolve data null.
    const resposta = (linhas: Linha[]) => {
      if (!devolver) return { data: null, error: null, count: null };
      return { data: unico ? (linhas[0] ?? null) : linhas, error: null, count: null };
    };

    const executar = () => {
      const erro = falhar?.(tabela, op, payload) ?? null;
      if (erro) return { data: null, error: erro, count: null };
      const linhas = (tabelas[tabela] ||= []);
      if (op === "insert") {
        const novas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
        const unico = UNICOS[tabela];
        for (const n of novas) {
          if (unico && linhas.some((l) => unico.every((c) => l[c] != null && l[c] === n[c]))) {
            return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
          }
        }
        const gravadas: Linha[] = [];
        for (const n of novas) {
          const comPadrao = { ...(PADRAO[tabela]?.() ?? {}), ...n };
          const linha =
            devolver && n.id === undefined ? { id: `${tabela}-${++novoId}`, ...comPadrao } : comPadrao;
          linhas.push(linha);
          gravadas.push({ ...linha });
          saida.inserts.push({ tabela, linha: { ...n } });
        }
        return resposta(gravadas);
      }
      if (op === "upsert") {
        const novas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
        const cols = conflito.split(",").map((c) => c.trim());
        const gravadas: Linha[] = [];
        for (const n of novas) {
          const atual = linhas.find((l) => cols.every((c) => l[c] === n[c]));
          if (atual) Object.assign(atual, n);
          else linhas.push({ ...n });
          gravadas.push({ ...(atual ?? n) });
          saida.upserts.push({ tabela, linha: { ...n } });
        }
        return resposta(gravadas);
      }
      const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const l of alvo) Object.assign(l, payload as Linha);
        saida.updates.push({ tabela, payload: payload as Linha, linhas: alvo.length });
        return resposta(alvo.map((l) => ({ ...l })));
      }
      if (op === "delete") {
        for (const l of alvo) linhas.splice(linhas.indexOf(l), 1);
        saida.deletes.push({ tabela, linhas: alvo.length });
        return resposta(alvo);
      }
      if (head) return { data: null, error: null, count: alvo.length };
      // Como o PostgREST do Supabase: no maximo 1000 linhas por resposta,
      // com ou sem limit maior. A contagem (head) nao tem esse corte.
      const data = alvo.slice(0, Math.min(limite ?? MAX_LINHAS, MAX_LINHAS)).map(comJson);
      if (unico) return { data: data[0] ?? null, error: null, count: null };
      return { data, error: null, count: alvo.length };
    };

    const q: Record<string, unknown> = {
      select: (cols?: string, o?: { head?: boolean }) => {
        if (o?.head) head = true;
        if (op !== "select") devolver = true;
        json = colunasJson(cols);
        return q;
      },
      upsert: (l: unknown, o?: { onConflict?: string }) => {
        op = "upsert";
        payload = l;
        if (o?.onConflict) conflito = o.onConflict;
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
      delete: () => {
        op = "delete";
        return q;
      },
      eq: (c: string, v: unknown) => {
        filtros.push((l) => l[c] === v);
        return q;
      },
      neq: (c: string, v: unknown) => {
        filtros.push((l) => l[c] !== v);
        return q;
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push((l) => vs.includes(l[c]));
        return q;
      },
      gte: (c: string, v: unknown) => {
        filtros.push((l) => String(l[c] ?? "") >= String(v));
        return q;
      },
      lt: (c: string, v: unknown) => {
        filtros.push((l) => String(l[c] ?? "") < String(v));
        return q;
      },
      gt: (c: string, v: unknown) => {
        filtros.push((l) =>
          typeof v === "number" ? Number(l[c] ?? Number.NaN) > v : String(l[c] ?? "") > String(v)
        );
        return q;
      },
      lte: (c: string, v: unknown) => {
        filtros.push((l) => String(l[c] ?? "") <= String(v));
        return q;
      },
      is: (c: string, v: unknown) => {
        filtros.push((l) => (l[c] ?? null) === v);
        return q;
      },
      like: (c: string, v: string) => {
        filtros.push((l) => casaLike(l[c], v));
        return q;
      },
      not: (c: string, operador: string, v: unknown) => {
        if (operador === "is") filtros.push((l) => (l[c] ?? null) !== v);
        else if (operador === "like") filtros.push((l) => !casaLike(l[c], String(v)));
        else filtros.push((l) => l[c] !== v);
        return q;
      },
      or: (expr: string) => {
        const termos = noNivelDeFora(expr).map(termoDoOr);
        filtros.push((l) => termos.some((t) => t(l)));
        return q;
      },
      order: () => q,
      limit: (n: number) => {
        limite = n;
        return q;
      },
      maybeSingle: () => {
        unico = true;
        return q;
      },
      single: () => {
        unico = true;
        return q;
      },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) =>
        Promise.resolve(executar()).then(ok, erro),
    };
    return q;
  }

  saida.client = { from } as never;
  return saida;
}
