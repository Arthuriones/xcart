import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Achados baixos da auditoria:
//  - /api/health publico nao conta o que esta configurado;
//  - /api/checkout-routes/resolve nao devolve a mensagem crua da excecao;
//  - 401/403 da Pagou nao chegam ao navegador como 401 ("Sua sessao expirou").

const estado = { usuario: null as { id: string } | null, admin: false, adminQuebra: false };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.usuario } }) },
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (estado.adminQuebra) throw new Error("relation \"segredo_interno\" does not exist");
    return {
      from: (tabela: string) => ({
        select: () => ({
          limit: async () => ({ data: [], error: null }),
          eq: () => ({
            single: async () => ({ data: tabela === "profiles" ? { is_admin: estado.admin } : null }),
          }),
        }),
      }),
    };
  },
}));

const { GET: health } = await import("@/app/api/health/route");
const { POST: resolve } = await import("@/app/api/checkout-routes/resolve/route");
const { PagouError, PAGOU_RECUSOU, respostaDoErroPagou } = await import("@/lib/billing/pagou");

function pedidoHealth(auth?: string) {
  return new NextRequest("http://x/api/health", {
    headers: auth ? { authorization: auth } : {},
  });
}

beforeEach(() => {
  estado.usuario = null;
  estado.admin = false;
  estado.adminQuebra = false;
  vi.stubEnv("CRON_SECRET", "segredo-do-cron");
  vi.stubEnv("BULK_IMPORT_CRON_SECRET", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/health", () => {
  it("anonimo recebe so ok:true", async () => {
    const r = await health(pedidoHealth());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
  });

  it("segredo errado ou usuario comum tambem", async () => {
    expect(await (await health(pedidoHealth("Bearer outro"))).json()).toEqual({ ok: true });
    estado.usuario = { id: "u1" };
    expect(await (await health(pedidoHealth())).json()).toEqual({ ok: true });
  });

  it("sem CRON_SECRET configurado, Bearer vazio nao abre", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect(await (await health(pedidoHealth("Bearer "))).json()).toEqual({ ok: true });
  });

  it("cron com o segredo ve os detalhes", async () => {
    const r = await health(pedidoHealth("Bearer segredo-do-cron"));
    const corpo = await r.json();
    expect(corpo.checks).toMatchObject({ database: "ok", cron: "ok" });
  });

  it("admin logado ve os detalhes", async () => {
    estado.usuario = { id: "u1" };
    estado.admin = true;
    const corpo = await (await health(pedidoHealth())).json();
    expect(corpo.checks).toBeDefined();
  });
});

describe("/api/checkout-routes/resolve", () => {
  it("excecao vira mensagem generica, sem o texto interno", async () => {
    estado.adminQuebra = true;
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await resolve(
      new NextRequest("http://x/api/checkout-routes/resolve", {
        method: "POST",
        body: JSON.stringify({ token: "t", lines: [{ variantId: "1", sku: "A", quantity: 1 }] }),
      })
    );
    expect(r.status).toBe(500);
    const corpo = await r.json();
    expect(corpo).toEqual({ error: "Falha ao resolver checkout." });
    expect(JSON.stringify(corpo)).not.toContain("segredo_interno");
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });
});

describe("respostaDoErroPagou", () => {
  it("401 e 403 da Pagou viram 502, nunca 401", () => {
    for (const s of [401, 403]) {
      const r = respostaDoErroPagou(new PagouError("Unauthorized", s));
      expect(r).toEqual({ status: 502, error: PAGOU_RECUSOU });
    }
  });

  it("outros 4xx passam com a mensagem dela", () => {
    expect(respostaDoErroPagou(new PagouError("card: recusado", 422))).toEqual({
      status: 422,
      error: "card: recusado",
    });
  });

  it("5xx vira 502", () => {
    expect(respostaDoErroPagou(new PagouError("Pagou respondeu 500", 500)).status).toBe(502);
  });
});
