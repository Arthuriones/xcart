import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// ============================================================================
// "Buscar contas novas" do Meta: a conta criada depois de conectar o perfil do
// Facebook. O login so listava as contas daquela hora (caso real de 28/10/2026:
// o token do perfil ja enxergava 4 contas que o xcart nao tinha). A busca so
// acrescenta -- a conta que ja existe nao muda -- e o token da conexao so vai
// para conta dela que esta sem segredo.
// ============================================================================

const mundo = vi.hoisted(() => ({
  banco: null as unknown as { client: never },
  usuario: null as { id: string } | null,
  /** Contas que cada token enxerga; numero = o codigo do erro do Meta. */
  contasDoToken: {} as Record<string, { account_id: string; nome: string }[] | number>,
  chamadas: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.banco.client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mundo.usuario } }) } }),
}));
vi.mock("@/lib/ads/meta-graph", async (original) => {
  const real = await original<typeof import("../src/lib/ads/meta-graph")>();
  return {
    ...real,
    listarContasMeta: async (token: string) => {
      mundo.chamadas.push(token);
      const r = mundo.contasDoToken[token];
      if (typeof r === "number") throw new real.ErroGraph("Error validating access token", r, 463);
      return (r ?? []).map((c) => ({ ...c, moeda: "USD", fuso: "America/Sao_Paulo", status: "ativa" }));
    },
  };
});

let banco: FakeSupabase;

function montar(tabelas: Record<string, Record<string, unknown>[]>) {
  banco = fakeSupabase({
    ad_connections: [],
    ad_connection_secrets: [],
    ad_accounts: [],
    ad_account_secrets: [],
    ...tabelas,
  });
  mundo.banco = banco as unknown as { client: never };
}

async function buscar() {
  const { POST } = await import("../src/app/api/auth/meta/buscar-contas/route");
  const resp = await POST();
  return { status: resp.status, corpo: (await resp.json()) as { ok: boolean; novas?: number; erros?: string[]; erro?: string } };
}

const contaVelha = {
  id: "a1",
  user_id: "u1",
  plataforma: "meta",
  external_id: "111",
  nome: "CA 01",
  store_id: "s1",
  ativo: false,
  connection_id: "c1",
  fonte: "api",
};

describe("buscar contas novas do Meta", () => {
  beforeEach(() => {
    mundo.usuario = { id: "u1" };
    mundo.contasDoToken = {};
    mundo.chamadas.length = 0;
  });

  it("conta criada depois do login entra com o token do perfil; a que ja existia nao muda", async () => {
    montar({
      ad_connections: [{ id: "c1", user_id: "u1", plataforma: "meta", nome: "Elza" }],
      ad_connection_secrets: [{ connection_id: "c1", access_token: "tok-c1" }],
      ad_accounts: [{ ...contaVelha }],
      ad_account_secrets: [{ ad_account_id: "a1", meta_access_token: "tok-colado", updated_at: "2026-10-24T03:35:51Z" }],
    });
    mundo.contasDoToken["tok-c1"] = [
      { account_id: "111", nome: "CA 01 renomeada" },
      { account_id: "1633569111841699", nome: "CA 02" },
    ];

    const r = await buscar();
    expect(r).toMatchObject({ status: 200, corpo: { ok: true, novas: 1, erros: [] } });

    const contas = banco.tabelas.ad_accounts;
    expect(contas).toHaveLength(2);
    // A velha: loja, ativo, nome e token como estavam.
    expect(contas[0]).toEqual(contaVelha);
    const nova = contas.find((c) => c.external_id === "1633569111841699")!;
    expect(nova).toMatchObject({
      user_id: "u1",
      plataforma: "meta",
      nome: "CA 02",
      fonte: "api",
      connection_id: "c1",
      moeda: "USD",
      fuso: "America/Sao_Paulo",
    });
    expect(nova.store_id).toBeUndefined();
    expect(banco.tabelas.ad_account_secrets).toEqual([
      { ad_account_id: "a1", meta_access_token: "tok-colado", updated_at: "2026-10-24T03:35:51Z" },
      expect.objectContaining({ ad_account_id: nova.id, meta_access_token: "tok-c1" }),
    ]);
    // O token nunca volta na resposta.
    expect(JSON.stringify(r.corpo)).not.toContain("tok-");
  });

  it("segundo clique sem conta nova: nada muda e diz zero", async () => {
    montar({
      ad_connections: [{ id: "c1", user_id: "u1", plataforma: "meta", nome: "Elza" }],
      ad_connection_secrets: [{ connection_id: "c1", access_token: "tok-c1" }],
    });
    mundo.contasDoToken["tok-c1"] = [{ account_id: "222", nome: "CA 03" }];
    expect((await buscar()).corpo).toMatchObject({ ok: true, novas: 1 });
    const antes = JSON.stringify(banco.tabelas);
    expect((await buscar()).corpo).toMatchObject({ ok: true, novas: 0, erros: [] });
    expect(JSON.stringify(banco.tabelas)).toBe(antes);
  });

  it("conta da conexao que ficou sem token (busca que caiu no meio) ganha o token; a de outra origem nao", async () => {
    montar({
      ad_connections: [{ id: "c1", user_id: "u1", plataforma: "meta", nome: "Elza" }],
      ad_connection_secrets: [{ connection_id: "c1", access_token: "tok-c1" }],
      ad_accounts: [
        { ...contaVelha, id: "a1", external_id: "111", connection_id: "c1" },
        { ...contaVelha, id: "a2", external_id: "333", connection_id: null },
      ],
    });
    mundo.contasDoToken["tok-c1"] = [
      { account_id: "111", nome: "CA 01" },
      { account_id: "333", nome: "Manual" },
    ];
    expect((await buscar()).corpo).toMatchObject({ ok: true, novas: 0 });
    expect(banco.tabelas.ad_account_secrets).toEqual([
      expect.objectContaining({ ad_account_id: "a1", meta_access_token: "tok-c1" }),
    ]);
  });

  it("login vencido (190): avisa o perfil e nao grava nada", async () => {
    montar({
      ad_connections: [{ id: "c1", user_id: "u1", plataforma: "meta", nome: "Elza" }],
      ad_connection_secrets: [{ connection_id: "c1", access_token: "tok-c1" }],
    });
    mundo.contasDoToken["tok-c1"] = 190;
    const r = await buscar();
    expect(r.corpo).toMatchObject({ ok: true, novas: 0 });
    expect(r.corpo.erros).toEqual([expect.stringContaining("Elza: o login do Facebook venceu")]);
    expect(banco.tabelas.ad_accounts).toEqual([]);
  });

  it("dois perfis: um falha e o outro entra; conta vista pelos dois entra uma vez, pelo primeiro", async () => {
    montar({
      ad_connections: [
        { id: "c1", user_id: "u1", plataforma: "meta", nome: "Elza" },
        { id: "c2", user_id: "u1", plataforma: "meta", nome: "Arthur" },
        { id: "c3", user_id: "u1", plataforma: "meta", nome: "Sem login" },
      ],
      ad_connection_secrets: [
        { connection_id: "c1", access_token: "tok-c1" },
        { connection_id: "c2", access_token: "tok-c2" },
      ],
    });
    mundo.contasDoToken["tok-c1"] = [{ account_id: "444", nome: "BM" }];
    mundo.contasDoToken["tok-c2"] = [
      { account_id: "444", nome: "BM" },
      { account_id: "555", nome: "Pessoal" },
    ];
    const r = await buscar();
    expect(r.corpo).toMatchObject({ ok: true, novas: 2 });
    expect(r.corpo.erros).toEqual([expect.stringContaining("Sem login: o login do Facebook não ficou salvo")]);
    expect(banco.tabelas.ad_accounts.map((c) => [c.external_id, c.connection_id])).toEqual([
      ["444", "c1"],
      ["555", "c2"],
    ]);
  });

  it("so os perfis do usuario da sessao; sem sessao, 401", async () => {
    montar({
      ad_connections: [{ id: "c9", user_id: "outro", plataforma: "meta", nome: "Alheio" }],
      ad_connection_secrets: [{ connection_id: "c9", access_token: "tok-c9" }],
    });
    mundo.contasDoToken["tok-c9"] = [{ account_id: "999", nome: "Alheia" }];
    expect((await buscar()).corpo).toMatchObject({ ok: true, novas: 0, erros: [] });
    expect(mundo.chamadas).toEqual([]);

    mundo.usuario = null;
    expect((await buscar()).status).toBe(401);
  });
});
