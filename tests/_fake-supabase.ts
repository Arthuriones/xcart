// Supabase falso em memoria para os testes do sensor do roteamento: tabelas
// como listas de linhas, filtros simples (eq/in/gte/lt/is/neq), insert com a
// PK de shopify_webhook_events, update/delete pelos filtros e contagem com
// { head: true }. Ordem nao e aplicada: o teste guarda as linhas ja na ordem
// que a consulta pediria.

type Linha = Record<string, unknown>;
type Erro = { code?: string; message: string };
type Op = "select" | "insert" | "update" | "delete";

export interface FakeSupabase {
  // O tipo do cliente real e do chamador; aqui basta o formato.
  client: never;
  tabelas: Record<string, Linha[]>;
  inserts: { tabela: string; linha: Linha }[];
  updates: { tabela: string; payload: Linha; linhas: number }[];
  deletes: { tabela: string; linhas: number }[];
}

const PK: Record<string, string> = { shopify_webhook_events: "webhook_id" };
const MAX_LINHAS = 1000;

export function fakeSupabase(
  tabelas: Record<string, Linha[]>,
  falhar?: (tabela: string, op: Op, payload: unknown) => Erro | null
): FakeSupabase {
  const saida: FakeSupabase = {
    client: undefined as never,
    tabelas,
    inserts: [],
    updates: [],
    deletes: [],
  };

  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: Op = "select";
    let payload: unknown = null;
    let head = false;
    let limite: number | null = null;
    let unico = false;

    const executar = () => {
      const erro = falhar?.(tabela, op, payload) ?? null;
      if (erro) return { data: null, error: erro, count: null };
      const linhas = (tabelas[tabela] ||= []);
      if (op === "insert") {
        const novas = (Array.isArray(payload) ? payload : [payload]) as Linha[];
        const pk = PK[tabela];
        for (const n of novas) {
          if (pk && linhas.some((l) => l[pk] === n[pk])) {
            return { data: null, error: { code: "23505", message: "duplicate key" }, count: null };
          }
        }
        for (const n of novas) {
          linhas.push({ ...n });
          saida.inserts.push({ tabela, linha: { ...n } });
        }
        return { data: null, error: null, count: null };
      }
      const alvo = linhas.filter((l) => filtros.every((f) => f(l)));
      if (op === "update") {
        for (const l of alvo) Object.assign(l, payload as Linha);
        saida.updates.push({ tabela, payload: payload as Linha, linhas: alvo.length });
        return { data: null, error: null, count: null };
      }
      if (op === "delete") {
        for (const l of alvo) linhas.splice(linhas.indexOf(l), 1);
        saida.deletes.push({ tabela, linhas: alvo.length });
        return { data: null, error: null, count: null };
      }
      if (head) return { data: null, error: null, count: alvo.length };
      // Como o PostgREST do Supabase: no maximo 1000 linhas por resposta,
      // com ou sem limit maior. A contagem (head) nao tem esse corte.
      const data = alvo.slice(0, Math.min(limite ?? MAX_LINHAS, MAX_LINHAS));
      if (unico) return { data: data[0] ?? null, error: null, count: null };
      return { data, error: null, count: alvo.length };
    };

    const q: Record<string, unknown> = {
      select: (_cols?: string, o?: { head?: boolean }) => {
        if (o?.head) head = true;
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
      is: (c: string, v: unknown) => {
        filtros.push((l) => (l[c] ?? null) === v);
        return q;
      },
      not: (c: string, operador: string, v: unknown) => {
        if (operador === "is") filtros.push((l) => (l[c] ?? null) !== v);
        else filtros.push((l) => l[c] !== v);
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
