import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// ============================================================================
// Excluir a conta (Apple 5.1.1(v), Google): confere o e-mail, recusa admin,
// cancela a assinatura que cobra ANTES e so entao apaga no Auth. Cancelamento
// que falha nao apaga. As duas portas: a do app (Bearer, mesmo sem acesso) e a
// do site (cookie, que sai da sessao na mesma resposta).
// ============================================================================

const U = "11111111-1111-4111-8111-111111111111";
const JWT = "eyJhbGciOiJFUzI1NiJ9.eyJzdWIiOiJ1MSJ9.assinatura-aqui";

const mundo = vi.hoisted(() => ({
  banco: null as unknown as FakeSupabase,
  passos: [] as string[],
  email: "Lojista@Exemplo.com" as string | null,
  /** Sem a 084: deleteUser falha se sobrou linha em background_jobs. */
  semCascataNosJobs: true,
  falharDeleteUser: false,
  token: null as string | null,
  usuario: null as { id: string } | null,
  acesso: false,
  pagouCancelar: null as null | (() => Promise<unknown>),
  pagouLer: null as null | (() => Promise<unknown>),
  abacateCancelar: null as null | (() => Promise<Response>),
  abacateLer: null as null | (() => Promise<unknown>),
  signOut: 0,
  /** Storage: bucket -> pasta -> itens (pasta vem sem id). */
  arquivos: {} as Record<string, Record<string, { name: string; id: string | null }[]>>,
  removidos: [] as string[],
  falharStorage: null as string | null,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mundo.token ? { authorization: `Bearer ${mundo.token}` } : {}),
  cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }),
}));
vi.mock("@/lib/supabase/server", () => ({
  tokenDoApp: async () => mundo.token,
  createClient: async () => ({
    auth: {
      signOut: async () => {
        mundo.signOut++;
        mundo.passos.push("signOut");
        return { error: null };
      },
    },
  }),
}));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => mundo.usuario }));
// Plano vencido: a porta comum do app recusaria; a exclusao nao pode depender disso.
vi.mock("@/lib/billing/access", () => ({
  userHasAccess: async () => {
    mundo.passos.push("userHasAccess");
    return mundo.acesso;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (mundo.banco.client as unknown as { from: (t: string) => unknown }).from,
    storage: {
      from: (bucket: string) => ({
        list: async (pasta: string) =>
          mundo.falharStorage === bucket
            ? { data: null, error: { message: "storage fora" } }
            : { data: mundo.arquivos[bucket]?.[pasta] ?? [], error: null },
        remove: async (caminhos: string[]) => {
          mundo.removidos.push(...caminhos.map((c) => `${bucket}:${c}`));
          return { data: [], error: null };
        },
      }),
    },
    auth: {
      admin: {
        getUserById: async (id: string) =>
          id === U ? { data: { user: { id, email: mundo.email } }, error: null } : { data: { user: null }, error: { message: "nao achou" } },
        deleteUser: async (id: string) => {
          mundo.passos.push("deleteUser");
          const sobrou = (mundo.banco.tabelas.background_jobs || []).some((j) => j.user_id === id);
          if (mundo.falharDeleteUser || (mundo.semCascataNosJobs && sobrou)) {
            return { data: { user: null }, error: { status: 500, message: "Database error deleting user" } };
          }
          return { data: { user: null }, error: null };
        },
      },
    },
  }),
}));
vi.mock("@/lib/billing/pagou", () => {
  class PagouError extends Error {
    status: number;
    code?: string;
    constructor(m: string, status: number, code?: string) {
      super(m);
      this.status = status;
      this.code = code;
    }
  }
  return {
    PagouError,
    cancelSubscription: async (id: string, motivo: string) => {
      mundo.passos.push(`pagou:cancelar:${id}:${motivo}`);
      return mundo.pagouCancelar!();
    },
    getSubscription: async () => mundo.pagouLer!(),
  };
});
vi.mock("@/lib/billing/assinar-abacatepay", () => ({
  cancelarAssinaturaAbacate: async (_u: string, p: { abacatepay_subscription_id: string }) => {
    mundo.passos.push(`abacate:cancelar:${p.abacatepay_subscription_id}`);
    return mundo.abacateCancelar!();
  },
}));
vi.mock("@/lib/billing/abacatepay", () => ({ buscarAssinatura: async () => mundo.abacateLer!() }));

function perfil(extra: Record<string, unknown> = {}) {
  return {
    id: U,
    is_admin: false,
    payment_provider: null,
    pagou_subscription_id: null,
    abacatepay_subscription_id: null,
    stripe_subscription_id: null,
    subscription_status: null,
    current_period_end: null,
    cancel_at_period_end: null,
    ...extra,
  };
}

function montar(p = perfil(), falharJobs?: { code?: string; message: string }) {
  mundo.banco = fakeSupabase(
    {
      profiles: [p],
      background_jobs: [
        { id: "j1", user_id: U },
        { id: "j2", user_id: "outro" },
      ],
    },
    (tabela, op) => {
      if (op !== "select") mundo.passos.push(`${op}:${tabela}`);
      return tabela === "background_jobs" && op === "delete" && falharJobs ? falharJobs : null;
    }
  );
}

async function excluir(confirmacao: unknown) {
  const { excluirConta } = await import("../src/lib/conta/excluir");
  return excluirConta(U, confirmacao);
}

beforeEach(() => {
  mundo.passos = [];
  mundo.email = "Lojista@Exemplo.com";
  mundo.semCascataNosJobs = true;
  mundo.falharDeleteUser = false;
  mundo.token = null;
  mundo.usuario = null;
  mundo.acesso = false;
  mundo.signOut = 0;
  mundo.arquivos = {};
  mundo.removidos = [];
  mundo.falharStorage = null;
  mundo.pagouCancelar = async () => ({ id: "sub_1", status: "cancel_scheduled", currentPeriodEnd: "2026-11-20T00:00:00Z" });
  mundo.pagouLer = async () => ({ id: "sub_1", status: "active" });
  mundo.abacateCancelar = async () => Response.json({ status: "cancel_scheduled" });
  mundo.abacateLer = async () => ({ id: "subs_1", status: "ACTIVE" });
  montar();
});

describe("excluirConta", () => {
  it("confirmacao errada ou vazia: recusa e nao toca em nada", async () => {
    for (const c of ["outro@exemplo.com", "", "   ", null, 42]) {
      const r = await excluir(c);
      expect(r).toMatchObject({ ok: false, status: 400, codigo: "confirmacao_errada" });
    }
    expect(mundo.passos).toEqual([]);
  });

  it("maiuscula e espaco nao contam no e-mail", async () => {
    expect(await excluir("  lojista@exemplo.COM ")).toEqual({ ok: true });
    expect(mundo.passos).toContain("deleteUser");
  });

  it("conta admin e recusada, sem cancelar nem apagar", async () => {
    montar(perfil({ is_admin: true, payment_provider: "pagou", pagou_subscription_id: "sub_1", subscription_status: "active" }));
    const r = await excluir("lojista@exemplo.com");
    expect(r).toMatchObject({ ok: false, status: 403, codigo: "conta_admin" });
    expect(mundo.passos).toEqual([]);
  });

  it("sucesso na Pagou: cancela, apaga os jobs e so entao deleteUser", async () => {
    montar(perfil({ payment_provider: "pagou", pagou_subscription_id: "sub_1", subscription_status: "active" }));
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
    expect(mundo.passos).toEqual([
      "pagou:cancelar:sub_1:user_requested",
      "update:profiles",
      "delete:background_jobs",
      "deleteUser",
    ]);
    // Grava como a rota de cancelar: a nova tentativa nao chama a Pagou de novo.
    expect(mundo.banco.updates[0].payload).toMatchObject({ subscription_status: "cancel_scheduled", cancel_at_period_end: true });
  });

  it("depois do deleteUser, apaga os arquivos do usuario no Storage, descendo nas subpastas", async () => {
    mundo.arquivos = {
      "product-images": { [U]: [{ name: "a.png", id: "1" }, { name: "b.png", id: "2" }] },
      "store-assets": {
        [U]: [{ name: "loja-1", id: null }],
        [`${U}/loja-1`]: [{ name: "banner.jpg", id: "3" }],
      },
    };
    mundo.falharStorage = "store-logos";
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
    expect(mundo.removidos.sort()).toEqual([
      `product-images:${U}/a.png`,
      `product-images:${U}/b.png`,
      `store-assets:${U}/loja-1/banner.jpg`,
    ]);
  });

  it("deleteUser que falha nao apaga arquivo nenhum", async () => {
    mundo.arquivos = { "product-images": { [U]: [{ name: "a.png", id: "1" }] } };
    mundo.falharDeleteUser = true;
    expect(await excluir("lojista@exemplo.com")).toMatchObject({ ok: false, codigo: "falhou" });
    expect(mundo.removidos).toEqual([]);
  });

  it("falha no cancelamento da Pagou: nao apaga e diz por que", async () => {
    montar(perfil({ payment_provider: "pagou", pagou_subscription_id: "sub_1", subscription_status: "active" }));
    const { PagouError } = await import("@/lib/billing/pagou");
    mundo.pagouCancelar = async () => {
      throw new PagouError("timeout", 504);
    };
    const r = await excluir("lojista@exemplo.com");
    expect(r).toMatchObject({ ok: false, status: 502, codigo: "assinatura_nao_cancelada" });
    expect(r.ok ? "" : r.erro).toMatch(/não foi excluída/);
    expect(mundo.passos).not.toContain("deleteUser");
    expect(mundo.passos).not.toContain("delete:background_jobs");
    expect(mundo.banco.tabelas.background_jobs).toHaveLength(2);
  });

  it("Pagou recusa porque ja estava cancelada la (banco atrasado): segue e apaga", async () => {
    montar(perfil({ payment_provider: "pagou", pagou_subscription_id: "sub_1", subscription_status: "active" }));
    mundo.pagouCancelar = async () => {
      throw new Error("ja cancelada");
    };
    mundo.pagouLer = async () => ({ id: "sub_1", status: "canceled" });
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
  });

  it("AbacatePay: cancela pela mesma funcao da tela; recusa dela nao apaga", async () => {
    montar(perfil({ payment_provider: "abacatepay", abacatepay_subscription_id: "subs_1", subscription_status: "active" }));
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
    expect(mundo.passos.indexOf("abacate:cancelar:subs_1")).toBeLessThan(mundo.passos.indexOf("deleteUser"));

    mundo.passos = [];
    montar(perfil({ payment_provider: "abacatepay", abacatepay_subscription_id: "subs_1", subscription_status: "active" }));
    mundo.abacateCancelar = async () => Response.json({ error: "x" }, { status: 502 });
    const r = await excluir("lojista@exemplo.com");
    expect(r).toMatchObject({ ok: false, codigo: "assinatura_nao_cancelada" });
    expect(mundo.passos).not.toContain("deleteUser");
  });

  it("assinatura do Stripe viva: pede o suporte e nao apaga; ja cancelada, apaga", async () => {
    montar(perfil({ payment_provider: "stripe", stripe_subscription_id: "sub_s", subscription_status: "active" }));
    expect(await excluir("lojista@exemplo.com")).toMatchObject({ ok: false, status: 409, codigo: "assinatura_antiga" });
    expect(mundo.passos).toEqual([]);

    montar(perfil({ payment_provider: "stripe", stripe_subscription_id: "sub_s", subscription_status: "canceled" }));
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
  });

  it("cancelamento ja agendado ou Pix avulso: nao chama o processador", async () => {
    montar(perfil({ payment_provider: "pagou", pagou_subscription_id: "sub_1", subscription_status: "cancel_scheduled" }));
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
    montar(perfil({ payment_provider: "pagou", plan: "pro", current_period_end: "2026-11-20T00:00:00Z" }));
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
    expect(mundo.passos.some((p) => p.startsWith("pagou:") || p.startsWith("abacate:"))).toBe(false);
  });

  it("sem a 084: apaga os background_jobs do usuario antes do deleteUser (e so os dele)", async () => {
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
    expect(mundo.passos).toEqual(["delete:background_jobs", "deleteUser"]);
    expect(mundo.banco.tabelas.background_jobs).toEqual([{ id: "j2", user_id: "outro" }]);
  });

  it("erro ao apagar os jobs ou no deleteUser: 503 e diz que a assinatura ja foi cancelada", async () => {
    montar(perfil({ payment_provider: "pagou", pagou_subscription_id: "sub_1", subscription_status: "active" }), {
      code: "57014",
      message: "timeout",
    });
    const r = await excluir("lojista@exemplo.com");
    expect(r).toMatchObject({ ok: false, status: 503, codigo: "falhou" });
    expect(r.ok ? "" : r.erro).toMatch(/assinatura já foi cancelada/);
    expect(mundo.passos).not.toContain("deleteUser");

    montar();
    mundo.falharDeleteUser = true;
    const r2 = await excluir("lojista@exemplo.com");
    expect(r2).toMatchObject({ ok: false, status: 503, codigo: "falhou" });
    expect(r2.ok ? "" : r2.erro).not.toMatch(/assinatura/);
  });

  it("background_jobs ausente no banco (42P01) nao trava a exclusao", async () => {
    montar(perfil(), { code: "42P01", message: "relation does not exist" });
    mundo.semCascataNosJobs = false; // sem a tabela, nao ha FK para travar
    expect(await excluir("lojista@exemplo.com")).toEqual({ ok: true });
  });
});

function pedido(corpo: unknown) {
  return new Request("http://localhost/api/x", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(corpo),
  });
}

describe("DELETE /api/app/v1/conta", () => {
  async function chamar(corpo: unknown) {
    const { DELETE } = await import("../src/app/api/app/v1/conta/route");
    const r = await DELETE(pedido(corpo));
    return { status: r.status, corpo: await r.json(), cache: r.headers.get("cache-control") };
  }

  it("sem acesso (plano vencido) ainda exclui: a porta comum do app nao entra", async () => {
    mundo.token = JWT;
    mundo.usuario = { id: U };
    mundo.acesso = false;
    expect(await chamar({ confirmacao: "lojista@exemplo.com" })).toEqual({
      status: 200,
      corpo: { ok: true, excluida: true },
      cache: "no-store",
    });
    expect(mundo.passos).toContain("deleteUser");
    expect(mundo.passos).not.toContain("userHasAccess");
  });

  it("sem login: 401, sem o Bearer do app (so cookie) ou com token recusado", async () => {
    mundo.usuario = { id: U };
    expect(await chamar({ confirmacao: "lojista@exemplo.com" })).toMatchObject({
      status: 401,
      corpo: { ok: false, codigo: "sem_login" },
    });
    mundo.token = JWT;
    mundo.usuario = null;
    expect(await chamar({ confirmacao: "lojista@exemplo.com" })).toMatchObject({ status: 401, corpo: { codigo: "sem_login" } });
    expect(mundo.passos).not.toContain("deleteUser");
  });

  it("confirmacao errada volta no formato do app", async () => {
    mundo.token = JWT;
    mundo.usuario = { id: U };
    expect(await chamar({ confirmacao: "x@y.com" })).toMatchObject({
      status: 400,
      corpo: { ok: false, codigo: "confirmacao_errada" },
    });
  });
});

describe("DELETE /api/conta (site)", () => {
  async function chamar(corpo: unknown) {
    const { DELETE } = await import("../src/app/api/conta/route");
    const r = await DELETE(pedido(corpo));
    return { status: r.status, corpo: await r.json() };
  }

  it("sem sessao: 401", async () => {
    expect(await chamar({ confirmacao: "lojista@exemplo.com" })).toMatchObject({ status: 401, corpo: { codigo: "sem_login" } });
    expect(mundo.passos).toEqual([]);
  });

  it("exclui e sai da sessao na mesma resposta, depois do deleteUser", async () => {
    mundo.usuario = { id: U };
    expect(await chamar({ confirmacao: "lojista@exemplo.com" })).toEqual({ status: 200, corpo: { ok: true } });
    expect(mundo.passos.slice(-2)).toEqual(["deleteUser", "signOut"]);
  });

  it("recusa nao sai da sessao", async () => {
    mundo.usuario = { id: U };
    expect(await chamar({ confirmacao: "errado@exemplo.com" })).toMatchObject({
      status: 400,
      corpo: { ok: false, codigo: "confirmacao_errada" },
    });
    expect(mundo.signOut).toBe(0);
  });
});
