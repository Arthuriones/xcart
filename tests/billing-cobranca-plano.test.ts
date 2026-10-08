import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// O checkout cobra pelo plano ESCOLHIDO, com o valor de plans.ts -- nunca um
// valor vindo do corpo -- e grava o tier junto com a assinatura. Vale para o
// cartao (/api/billing/subscribe), o Pix automatico e o Pix de 30 dias
// (/api/billing/credits, packId "pro_month").

type Linha = Record<string, unknown>;

const estado = {
  perfil: {} as Linha,
  updates: [] as Linha[],
  inserts: [] as { tabela: string; linha: Linha }[],
};

function adminFalso() {
  return {
    from: (tabela: string) => {
      let patch: Linha | null = null;
      const api = {
        select: () => api,
        eq: () => api,
        update: (p: Linha) => {
          patch = p;
          return api;
        },
        insert: async (linha: Linha) => {
          estado.inserts.push({ tabela, linha });
          return { error: null };
        },
        single: async () => ({ data: estado.perfil, error: null }),
        maybeSingle: async () => ({ data: estado.perfil, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch) estado.updates.push(patch);
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return api;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1", email: "a@b.com" } } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminFalso() }));

const createSubscription = vi.fn();
const createPixTransaction = vi.fn();
vi.mock("@/lib/billing/pagou", async (original) => ({
  ...(await original<typeof import("@/lib/billing/pagou")>()),
  getOrCreateCustomer: async () => "cus_1",
  createSubscription: (...a: unknown[]) => createSubscription(...a),
  createPixTransaction: (...a: unknown[]) => createPixTransaction(...a),
}));

const { POST: assinar } = await import("@/app/api/billing/subscribe/route");
const { POST: pix } = await import("@/app/api/billing/credits/route");

const req = (url: string, corpo: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(corpo) });

beforeEach(() => {
  estado.perfil = { plan: "free", pagou_subscription_id: null, subscription_status: null, document_number: "52998224725" };
  estado.updates = [];
  estado.inserts = [];
  createSubscription.mockReset();
  createSubscription.mockImplementation(async (p: { amountCents: number }) => ({
    id: "sub_1",
    status: "active",
    amount: p.amountCents,
    currentPeriodEnd: "2026-11-08T00:00:00Z",
  }));
  createPixTransaction.mockReset();
  createPixTransaction.mockImplementation(async (p: { amountCents: number }) => ({
    id: "tx_1",
    status: "waiting_payment",
    amount: p.amountCents,
    pix: { qr_code: "000201" },
  }));
});

describe("/api/billing/subscribe", () => {
  it("sem plano, ou com plano fora do catálogo, recusa sem cobrar", async () => {
    for (const corpo of [{ cardToken: "pgct_x" }, { cardToken: "pgct_x", plano: "ouro" }]) {
      const r = await assinar(req("/api/billing/subscribe", corpo));
      expect(r.status).toBe(400);
      expect((await r.json()).error).toBe("Escolha um plano.");
    }
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it.each([
    ["loja1", 7990],
    ["lojas3", 11990],
    ["ilimitado", 16990],
  ])("cartão no %s cobra %i e grava o tier", async (plano, valor) => {
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano, amountCents: 1 }));
    expect(r.status).toBe(200);
    const chamada = createSubscription.mock.calls[0][0];
    expect(chamada.amountCents).toBe(valor);
    expect(chamada.plano).toBe(plano);
    // Trocar de plano no mesmo dia nao pode reaproveitar a assinatura antiga.
    expect(chamada.idempotencyKey).toMatch(new RegExp(`_${plano}$`));
    expect(estado.updates.at(-1)).toMatchObject({ plan: "pro", plano, pagou_subscription_id: "sub_1" });
  });

  it("Pix automático também cobra pelo plano", async () => {
    await assinar(req("/api/billing/subscribe", { method: "pix_automatic", plano: "lojas3" }));
    expect(createSubscription.mock.calls[0][0]).toMatchObject({ amountCents: 11990, cardToken: undefined });
  });

  it("quem já assina não cria a segunda assinatura", async () => {
    estado.perfil = { plan: "pro", pagou_subscription_id: "sub_0", subscription_status: "active" };
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "ilimitado" }));
    expect(r.status).toBe(409);
    expect(createSubscription).not.toHaveBeenCalled();
  });
});

describe("/api/billing/credits (Pix de 30 dias)", () => {
  it("cobra o valor do plano e guarda o tier na compra", async () => {
    const r = await pix(req("/api/billing/credits", { packId: "pro_month", plano: "lojas3" }));
    expect(r.status).toBe(200);
    expect(createPixTransaction.mock.calls[0][0].amountCents).toBe(11990);
    const compra = estado.inserts.find((i) => i.tabela === "credit_purchases")?.linha;
    expect(compra).toMatchObject({ kind: "pro_month", plano: "lojas3", amount_cents: 11990 });
  });

  it("sem plano, recusa sem gerar Pix", async () => {
    const r = await pix(req("/api/billing/credits", { packId: "pro_month" }));
    expect(r.status).toBe(400);
    expect(createPixTransaction).not.toHaveBeenCalled();
  });

  it("recarga de créditos não leva tier", async () => {
    await pix(req("/api/billing/credits", { packId: "pack_50" }));
    const compra = estado.inserts.find((i) => i.tabela === "credit_purchases")?.linha;
    expect(compra).toMatchObject({ kind: "credits", amount_cents: 2500 });
    expect(compra).not.toHaveProperty("plano");
  });
});
