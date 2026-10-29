import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Loja de demonstracao (074) no filtro do topo (filtroResolvido): com "Todas",
// os numeros sao os da operacao de verdade -- a loja marcada fica fora de
// `lojaIds`. Ela continua no seletor (`lojas`), conta quando escolhida, e
// quando e a unica loja (Todas nao fica vazio). Sem a 074 (42703) nenhuma loja
// e de demonstracao. A marca nunca vai para LojaDoSeletor (que vai ao navegador).
// ============================================================================

const DEMO = "11111111-1111-4111-8111-111111111111";
const REAL_A = "22222222-2222-4222-8222-222222222222";
const REAL_B = "33333333-3333-4333-8333-333333333333";

const mundo = vi.hoisted(() => ({
  cookies: {} as Record<string, string>,
  lojas: [] as Record<string, unknown>[],
  semColuna: false,
  pedidas: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("react", async (original) => ({ ...(await original<typeof import("react")>()), cache: <T,>(fn: T) => fn }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (nome: string) => (nome in mundo.cookies ? { value: mundo.cookies[nome] } : undefined),
  }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/supabase/server", () => ({
  tokenDoApp: async () => null,
  createClient: async () => ({
    from: (tabela: string) => {
      let colunas = "";
      const q = {
        select: (c: string) => {
          colunas = c;
          return q;
        },
        eq: () => q,
        order: () => q,
        then: (ok: (r: unknown) => unknown, erro?: (e: unknown) => unknown) => {
          let r: unknown;
          if (tabela === "checkouts_externos") r = { data: [], error: null };
          else if (tabela === "stores") {
            mundo.pedidas.push(colunas);
            if (mundo.semColuna && colunas.includes("demonstracao")) {
              r = { data: null, error: { code: "42703", message: 'column stores.demonstracao does not exist' } };
            } else {
              const quer = colunas.split(",").map((x) => x.trim());
              r = {
                data: mundo.lojas.map((l) => Object.fromEntries(quer.map((k) => [k, l[k]]))),
                error: null,
              };
            }
          } else r = { data: [], error: null };
          return Promise.resolve(r).then(ok, erro);
        },
      };
      return q;
    },
  }),
}));

const loja = (id: string, nome: string, demonstracao: boolean) => ({
  id,
  name: nome,
  shop_domain: `${nome.toLowerCase()}.myshopify.com`,
  demonstracao,
});

beforeEach(() => {
  mundo.cookies = {};
  mundo.semColuna = false;
  mundo.pedidas = [];
  mundo.lojas = [loja(REAL_A, "Ample", false), loja(DEMO, "Quill", true), loja(REAL_B, "Soft", false)];
});

describe("filtroResolvido com a loja de demonstracao", () => {
  it("Todas: a loja marcada fica fora de lojaIds, mas continua no seletor", async () => {
    const { filtroResolvido } = await import("@/lib/filtro-global");
    const r = await filtroResolvido();
    expect(r.filtro.lojaId).toBe("todas");
    expect(r.lojaIds).toEqual([REAL_A, REAL_B]);
    expect(r.lojas.map((l) => l.id)).toEqual([REAL_A, DEMO, REAL_B]);
  });

  it("a marca nao vai para LojaDoSeletor (que vai ao navegador)", async () => {
    const { listarLojasDoUsuario } = await import("@/lib/filtro-global");
    const lojas = await listarLojasDoUsuario();
    for (const l of lojas) expect(Object.keys(l).sort()).toEqual(["dominio", "id", "nome"]);
  });

  it("escolhida no seletor, ela conta (e so ela)", async () => {
    mundo.cookies = { xc_loja: DEMO };
    const { filtroResolvido } = await import("@/lib/filtro-global");
    const r = await filtroResolvido();
    expect(r.filtro.lojaId).toBe(DEMO);
    expect(r.lojaIds).toEqual([DEMO]);
  });

  it("loja real escolhida continua igual", async () => {
    mundo.cookies = { xc_loja: REAL_B };
    const { filtroResolvido } = await import("@/lib/filtro-global");
    expect((await filtroResolvido()).lojaIds).toEqual([REAL_B]);
  });

  it("so a loja de demonstracao: Todas nao fica vazio", async () => {
    mundo.lojas = [loja(DEMO, "Quill", true)];
    const { filtroResolvido } = await import("@/lib/filtro-global");
    expect((await filtroResolvido()).lojaIds).toEqual([DEMO]);
  });

  it("sem a 074 (42703): le de novo sem a coluna e Todas leva todas", async () => {
    mundo.semColuna = true;
    const { filtroResolvido } = await import("@/lib/filtro-global");
    const r = await filtroResolvido();
    expect(r.lojaIds).toEqual([REAL_A, DEMO, REAL_B]);
    expect(mundo.pedidas).toEqual(["id, name, shop_domain, demonstracao", "id, name, shop_domain"]);
  });
});
