import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Login e filtro do APP DO CELULAR: `Authorization: Bearer <JWT do Supabase>`
// abre a sessao (sem cookie nenhum), e loja/periodo/moeda/comparar vem dos
// cabecalhos x-xc-*. O Bearer do cron e o do MCP nunca viram sessao, e o site
// (sem Bearer) continua no cookie.
// ============================================================================

const mundo = vi.hoisted(() => ({
  cabecalhos: new Headers(),
  cookies: {} as Record<string, string>,
  opcoes: [] as { global?: { headers?: Record<string, string> }; cookies: { getAll: () => unknown[] } }[],
  usuario: null as { id: string } | null,
  acesso: true,
  idasAoLogin: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => mundo.cabecalhos,
  cookies: async () => ({
    get: (n: string) => (n in mundo.cookies ? { value: mundo.cookies[n] } : undefined),
    getAll: () => Object.entries(mundo.cookies).map(([name, value]) => ({ name, value })),
    set: () => {},
  }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opcoes: (typeof mundo.opcoes)[number]) => {
    mundo.opcoes.push(opcoes);
    return {
      auth: {
        getUser: async () => {
          mundo.idasAoLogin++;
          return { data: { user: mundo.usuario }, error: null };
        },
      },
    };
  },
}));
vi.mock("@/lib/billing/access", () => ({ userHasAccess: async () => mundo.acesso }));

const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.assinatura-aqui";

function com(cabecalhos: Record<string, string>, cookies: Record<string, string> = {}) {
  mundo.cabecalhos = new Headers(cabecalhos);
  mundo.cookies = cookies;
  mundo.opcoes.length = 0;
}

describe("tokenDoApp e createClient", () => {
  it("so JWT no Bearer e o app; cron, MCP e lixo nao", async () => {
    const { tokenDoApp } = await import("../src/lib/supabase/server");
    com({ authorization: `Bearer ${JWT}` });
    expect(await tokenDoApp()).toBe(JWT);
    com({ authorization: "Bearer segredo-do-cron-com-43-caracteres-xxxxxxxx" });
    expect(await tokenDoApp()).toBeNull();
    com({ authorization: "Bearer xcart_mcp_abc.def.ghi" });
    expect(await tokenDoApp()).toBeNull();
    com({ authorization: `Basic ${JWT}` });
    expect(await tokenDoApp()).toBeNull();
    com({});
    expect(await tokenDoApp()).toBeNull();
  });

  it("com o Bearer do app, o cliente leva o cabecalho e nao le cookie nenhum", async () => {
    const { createClient } = await import("../src/lib/supabase/server");
    com({ authorization: `Bearer ${JWT}` }, { "sb-xyz-auth-token": "cookie-de-outro-usuario" });
    await createClient();
    expect(mundo.opcoes[0].global?.headers).toEqual({ Authorization: `Bearer ${JWT}` });
    expect(mundo.opcoes[0].cookies.getAll()).toEqual([]);
  });

  it("sem o Bearer (o site), o cliente segue no cookie e sem cabecalho proprio", async () => {
    const { createClient } = await import("../src/lib/supabase/server");
    com({}, { "sb-xyz-auth-token": "cookie" });
    await createClient();
    expect(mundo.opcoes[0].global?.headers).toBeUndefined();
    expect(mundo.opcoes[0].cookies.getAll()).toEqual([{ name: "sb-xyz-auth-token", value: "cookie" }]);
  });
});

describe("filtro do app pelos cabecalhos x-xc-*", () => {
  it("o app le loja, periodo, moeda e comparar do cabecalho; o cookie dele nao conta", async () => {
    const { lerFiltroGlobal, lerComparacao } = await import("../src/lib/filtro-global");
    com(
      {
        authorization: `Bearer ${JWT}`,
        "x-xc-loja": "11111111-1111-4111-8111-111111111111",
        "x-xc-periodo": "30d",
        "x-xc-moeda": "USD",
        "x-xc-comparar": "nenhum",
      },
      { xc_loja: "44444444-4444-4444-8444-444444444444", xc_periodo: "7d", xc_moeda: "BRL" }
    );
    const f = await lerFiltroGlobal();
    expect(f).toMatchObject({ lojaId: "11111111-1111-4111-8111-111111111111", periodo: "30d", moeda: "USD" });
    const { comparacaoDeCookie } = await import("../src/components/layout/contexto");
    expect(await lerComparacao()).toEqual(comparacaoDeCookie("nenhum"));
  });

  it("o site continua no cookie, mesmo com x-xc-* no cabecalho", async () => {
    const { lerFiltroGlobal } = await import("../src/lib/filtro-global");
    com({ "x-xc-loja": "33333333-3333-4333-8333-333333333333", "x-xc-moeda": "USD" }, { xc_loja: "22222222-2222-4222-8222-222222222222", xc_moeda: "EUR" });
    expect(await lerFiltroGlobal()).toMatchObject({ lojaId: "22222222-2222-4222-8222-222222222222", moeda: "EUR" });
  });
});

describe("sessaoDoApp (porta de /api/app/v1)", () => {
  beforeEach(() => {
    mundo.usuario = { id: "u1" };
    mundo.acesso = true;
  });

  async function porta() {
    vi.resetModules();
    const { sessaoDoApp } = await import("../src/lib/app-api/sessao");
    const r = await sessaoDoApp();
    return r.resposta ? { status: r.resposta.status, corpo: await r.resposta.json() } : { user: r.user };
  }

  it("Bearer do app com acesso: o usuario", async () => {
    com({ authorization: `Bearer ${JWT}` });
    expect(await porta()).toEqual({ user: { id: "u1" } });
  });

  it("so cookie (o site no mesmo navegador) nao abre a rota do app", async () => {
    com({}, { "sb-xyz-auth-token": "cookie" });
    expect(await porta()).toMatchObject({ status: 401, corpo: { ok: false, codigo: "sem_login" } });
  });

  it("token recusado pelo Supabase: 401", async () => {
    com({ authorization: `Bearer ${JWT}` });
    mundo.usuario = null;
    expect(await porta()).toMatchObject({ status: 401, corpo: { codigo: "sem_login" } });
  });

  it("sem acesso (plano vencido): 403 sem_acesso, sem falar de preco", async () => {
    com({ authorization: `Bearer ${JWT}` });
    mundo.acesso = false;
    const r = await porta();
    expect(r).toMatchObject({ status: 403, corpo: { codigo: "sem_acesso" } });
    expect(JSON.stringify(r)).not.toMatch(/R\$|assin|plano|pre[cç]o/i);
  });
});

describe("getCurrentUser no app: uma ida ao login por requisicao", () => {
  it("o cache() do React nao vale em rota; o login do app e validado uma vez so", async () => {
    vi.resetModules();
    const { getCurrentUser } = await import("../src/lib/supabase/current-user");
    mundo.usuario = { id: "u1" };
    com({ authorization: `Bearer ${JWT}` });
    mundo.idasAoLogin = 0;
    const [a, b, c] = await Promise.all([getCurrentUser(), getCurrentUser(), getCurrentUser()]);
    expect([a, b, c]).toEqual([{ id: "u1" }, { id: "u1" }, { id: "u1" }]);
    expect(mundo.idasAoLogin).toBe(1);
    // Outra requisicao (outro objeto de cabecalhos): valida de novo.
    com({ authorization: `Bearer ${JWT}` });
    await getCurrentUser();
    expect(mundo.idasAoLogin).toBe(2);
  });
});
