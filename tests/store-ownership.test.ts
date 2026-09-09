import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * O invariante que estes testes trancam:
 *
 *   Um usuario nunca opera sobre a loja de outro, mesmo fornecendo o id dela.
 *
 * Toda operacao tem que seguir  sessao -> loja QUE ELE POSSUI -> credencial.
 * O caminho proibido e  id do cliente -> credencial -> Shopify, porque ele
 * entrega client_secret e access token alheios a quem souber um UUID.
 *
 * Aqui o Supabase e falso de proposito: o que esta sob teste nao e o banco, e
 * se o CODIGO monta a consulta com o filtro de dono. Um `select` que "esquece"
 * o `.eq("user_id", ...)` passaria em qualquer teste de integracao feito com
 * uma conta so -- e e exatamente esse esquecimento que vaza loja.
 */

// --------------------------------------------------------------- dublê

/** Loja de cada dono, indexada por id. */
const BANCO: Record<string, { id: string; user_id: string; shop_domain: string }> = {
  "loja-do-alice": {
    id: "loja-do-alice",
    user_id: "alice",
    shop_domain: "alice.myshopify.com",
  },
  "loja-do-bob": {
    id: "loja-do-bob",
    user_id: "bob",
    shop_domain: "bob.myshopify.com",
  },
  "outra-do-alice": {
    id: "outra-do-alice",
    user_id: "alice",
    shop_domain: "alice2.myshopify.com",
  },
};

/** Quem esta na sessao no teste corrente. */
let sessao: string | null = "alice";

/** Registra as consultas montadas, para inspecionar os filtros aplicados. */
let consultas: { filtros: Record<string, unknown>; ins: string[][] }[] = [];

function queryFalsa() {
  const filtros: Record<string, unknown> = {};
  const ins: string[][] = [];
  consultas.push({ filtros, ins });

  const resolver = () => {
    // Aplica EXATAMENTE os filtros que o codigo pediu. Se ele esqueceu
    // user_id, o filtro nao existe aqui e a loja alheia volta -- que e o
    // vazamento que o teste precisa conseguir enxergar.
    let linhas = Object.values(BANCO);
    if (typeof filtros.id === "string") linhas = linhas.filter((l) => l.id === filtros.id);
    if (typeof filtros.user_id === "string") {
      linhas = linhas.filter((l) => l.user_id === filtros.user_id);
    }
    for (const lista of ins) linhas = linhas.filter((l) => lista.includes(l.id));
    return linhas;
  };

  let contando = false;

  const api = {
    select: (_campos?: string, opts?: { count?: string; head?: boolean }) => {
      // head:true nao resolve aqui: os .eq()/.in() ainda vao ser encadeados
      // depois deste select. Resolver agora contaria o banco inteiro.
      if (opts?.head) contando = true;
      return api;
    },
    eq: (coluna: string, valor: unknown) => {
      filtros[coluna] = valor;
      return api;
    },
    in: (_coluna: string, valores: string[]) => {
      ins.push(valores);
      return api;
    },
    maybeSingle: async () => ({ data: resolver()[0] ?? null, error: null }),
    single: async () => ({ data: resolver()[0] ?? null, error: null }),
    // Await no fim da cadeia: so agora os filtros estao todos aplicados.
    then: (r: (v: Record<string, unknown>) => unknown) =>
      r(
        contando
          ? { count: resolver().length, error: null }
          : { data: resolver(), error: null }
      ),
  };
  return api;
}

const clienteFalso = { from: () => queryFalsa() };

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    ...clienteFalso,
    auth: {
      getUser: async () => ({
        data: { user: sessao ? { id: sessao } : null },
        error: null,
      }),
    },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => clienteFalso }));

const {
  lojaDoUsuario,
  exigirLojaDoUsuario,
  lojasDoUsuario,
  usuarioPossuiLojas,
  lojaDoDonoViaAdmin,
  credenciaisDe,
  NaoAutorizado,
} = await import("@/lib/stores/authorize");

beforeEach(() => {
  sessao = "alice";
  consultas = [];
});

// --------------------------------------------------------------- testes

describe("lojaDoUsuario", () => {
  it("devolve a loja quando ela e do usuario da sessao", async () => {
    const loja = await lojaDoUsuario("loja-do-alice");
    expect(loja?.id).toBe("loja-do-alice");
  });

  it("NAO devolve a loja de outro usuario, mesmo com o id certo", async () => {
    // Este e o ataque: Alice conhece o UUID da loja do Bob e o manda no body.
    expect(await lojaDoUsuario("loja-do-bob")).toBeNull();
  });

  it("filtra por user_id na consulta, nao so no resultado", async () => {
    await lojaDoUsuario("loja-do-alice");
    // Se o filtro nao for para a consulta, um refactor que troque o cliente
    // por um admin (sem RLS) passa a devolver loja alheia sem nada quebrar.
    expect(consultas.at(-1)?.filtros).toMatchObject({
      id: "loja-do-alice",
      user_id: "alice",
    });
  });

  it("sem sessao nao devolve nada e nem consulta o banco", async () => {
    sessao = null;
    expect(await lojaDoUsuario("loja-do-alice")).toBeNull();
    expect(consultas).toHaveLength(0);
  });

  it("id vazio nao vira consulta sem filtro", async () => {
    // `.eq("id", "")` sem guarda casaria com qualquer coisa em alguns
    // backends; melhor nem chegar la.
    expect(await lojaDoUsuario("")).toBeNull();
    expect(consultas).toHaveLength(0);
  });
});

describe("exigirLojaDoUsuario", () => {
  it("sem sessao lanca 401", async () => {
    sessao = null;
    await expect(exigirLojaDoUsuario("loja-do-alice")).rejects.toMatchObject({
      status: 401,
    });
  });

  it("loja de outro lanca 404, nao 403", async () => {
    // 403 confirmaria que o id existe, o que transforma o endpoint num
    // verificador de ids de loja alheia.
    const erro = await exigirLojaDoUsuario("loja-do-bob").catch((e) => e);
    expect(erro).toBeInstanceOf(NaoAutorizado);
    expect(erro.status).toBe(404);
  });

  it("loja propria passa", async () => {
    await expect(exigirLojaDoUsuario("loja-do-alice")).resolves.toMatchObject({
      user_id: "alice",
    });
  });
});

describe("lojasDoUsuario (varias de uma vez)", () => {
  it("duas lojas proprias passam", async () => {
    const lojas = await lojasDoUsuario(["loja-do-alice", "outra-do-alice"]);
    expect(lojas?.map((l) => l.id).toSorted()).toEqual([
      "loja-do-alice",
      "outra-do-alice",
    ]);
  });

  it("uma propria + uma alheia reprova TUDO, nao devolve a metade", async () => {
    // Meio-caminho aqui e pior que erro: uma rota com a vitrine certa e o
    // destino de outra pessoa e exatamente o cenario proibido.
    expect(await lojasDoUsuario(["loja-do-alice", "loja-do-bob"])).toBeNull();
  });

  it("id repetido nao reprova o dono", async () => {
    // A contagem ingenua (`count === ids.length`) reprovava aqui: 2 ids, 1
    // linha. Deduplicar antes e o que faz o caso do dono passar.
    const lojas = await lojasDoUsuario(["loja-do-alice", "loja-do-alice"]);
    expect(lojas?.map((l) => l.id)).toEqual(["loja-do-alice"]);
  });

  it("lista vazia nao autoriza nada", async () => {
    expect(await lojasDoUsuario([])).toBeNull();
    expect(await lojasDoUsuario(["", ""])).toBeNull();
  });
});

describe("usuarioPossuiLojas", () => {
  it("true so quando todas sao dele", async () => {
    expect(await usuarioPossuiLojas(["loja-do-alice", "outra-do-alice"], "alice")).toBe(
      true
    );
  });

  it("false quando qualquer uma e de outro", async () => {
    expect(await usuarioPossuiLojas(["loja-do-alice", "loja-do-bob"], "alice")).toBe(
      false
    );
  });

  it("id duplicado do proprio dono continua true", async () => {
    expect(await usuarioPossuiLojas(["loja-do-alice", "loja-do-alice"], "alice")).toBe(
      true
    );
  });

  it("lista vazia e false, nao true por vacuidade", async () => {
    // `count === 0 && ids.length === 0` daria true e autorizaria uma operacao
    // que nao nomeou nenhuma loja.
    expect(await usuarioPossuiLojas([], "alice")).toBe(false);
  });
});

describe("lojaDoDonoViaAdmin (cron e fila, sem sessao)", () => {
  it("acha a loja quando o userId do job bate", async () => {
    const loja = await lojaDoDonoViaAdmin("loja-do-alice", "alice");
    expect(loja?.id).toBe("loja-do-alice");
  });

  it("nao acha quando o userId do job nao bate", async () => {
    // O cliente admin burla RLS: aqui o filtro explicito e a UNICA defesa.
    expect(await lojaDoDonoViaAdmin("loja-do-bob", "alice")).toBeNull();
  });

  it("sempre manda user_id na consulta", async () => {
    await lojaDoDonoViaAdmin("loja-do-alice", "alice");
    expect(consultas.at(-1)?.filtros).toMatchObject({ user_id: "alice" });
  });

  it("userId vazio nao consulta", async () => {
    expect(await lojaDoDonoViaAdmin("loja-do-alice", "")).toBeNull();
    expect(consultas).toHaveLength(0);
  });
});

describe("credenciaisDe", () => {
  it("so monta credencial a partir de loja ja autorizada", async () => {
    const loja = await exigirLojaDoUsuario("loja-do-alice");
    // O tipo e o portao: credenciaisDe recebe LojaAutorizada, e o unico jeito
    // de obter uma e passando pelas funcoes que filtram por dono.
    expect(credenciaisDe(loja).shopDomain).toBe("alice.myshopify.com");
  });
});
