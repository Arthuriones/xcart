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
  /** Simula a migration 064 ainda nao aplicada: a escrita com `plano` da PGRST204. */
  semColunaPlano: false,
};

const SEM_COLUNA = {
  code: "PGRST204",
  message: "Could not find the 'plano' column of 'profiles' in the schema cache",
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
          if (estado.semColunaPlano && "plano" in linha) return { error: SEM_COLUNA };
          estado.inserts.push({ tabela, linha });
          return { error: null };
        },
        single: async () => ({ data: estado.perfil, error: null }),
        maybeSingle: async () => ({ data: estado.perfil, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch && estado.semColunaPlano && "plano" in patch) {
            return Promise.resolve({ data: null, error: SEM_COLUNA }).then(ok);
          }
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
const getSubscription = vi.fn();
const cancelSubscription = vi.fn();
vi.mock("@/lib/billing/pagou", async (original) => ({
  ...(await original<typeof import("@/lib/billing/pagou")>()),
  getOrCreateCustomer: async () => "cus_1",
  createSubscription: (...a: unknown[]) => createSubscription(...a),
  createPixTransaction: (...a: unknown[]) => createPixTransaction(...a),
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  cancelSubscription: (...a: unknown[]) => cancelSubscription(...a),
}));

const { POST: assinar } = await import("@/app/api/billing/subscribe/route");
const { POST: pix } = await import("@/app/api/billing/credits/route");

const req = (url: string, corpo: unknown) =>
  new NextRequest(`http://localhost${url}`, { method: "POST", body: JSON.stringify(corpo) });

beforeEach(() => {
  estado.perfil = { plan: "free", pagou_subscription_id: null, subscription_status: null, document_number: "52998224725" };
  estado.updates = [];
  estado.inserts = [];
  estado.semColunaPlano = false;
  getSubscription.mockReset();
  cancelSubscription.mockReset();
  cancelSubscription.mockImplementation(async (id: string) => ({ id, status: "canceled" }));
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
    expect(chamada.idempotencyKey).toMatch(new RegExp(`^sub_u1_${plano}_`));
    expect(estado.updates.at(-1)).toMatchObject({ plan: "pro", plano, pagou_subscription_id: "sub_1" });
  });

  it("Pix automático também cobra pelo plano", async () => {
    await assinar(req("/api/billing/subscribe", { method: "pix_automatic", plano: "lojas3" }));
    expect(createSubscription.mock.calls[0][0]).toMatchObject({ amountCents: 11990, cardToken: undefined });
  });

  it("a chave leva o cartão: duplo clique repete, outro cartão depois da recusa é pedido novo", async () => {
    await assinar(req("/api/billing/subscribe", { cardToken: "pgct_a", plano: "lojas3" }));
    await assinar(req("/api/billing/subscribe", { cardToken: "pgct_a", plano: "lojas3" }));
    await assinar(req("/api/billing/subscribe", { cardToken: "pgct_b", plano: "lojas3" }));
    const [a1, a2, b] = createSubscription.mock.calls.map((c) => c[0].idempotencyKey);
    expect(a1).toBe(a2);
    expect(b).not.toBe(a1);
    // O token (de uso unico) nao vai cru na chave.
    expect(a1).not.toContain("pgct_a");
  });

  it("tentativa anterior parada no 1º pagamento é cancelada antes de criar a nova", async () => {
    estado.perfil = { plan: "free", pagou_subscription_id: "sub_0", subscription_status: "incomplete" };
    getSubscription.mockResolvedValue({ id: "sub_0", status: "incomplete", metadata: { chave: "outra" } });
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "ilimitado" }));
    expect(r.status).toBe(200);
    expect(cancelSubscription).toHaveBeenCalledWith("sub_0", "user_requested");
    expect(createSubscription).toHaveBeenCalledTimes(1);
  });

  it("o mesmo pedido de novo (mesma chave) não cancela a própria tentativa", async () => {
    await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "lojas3" }));
    const chave = createSubscription.mock.calls[0][0].idempotencyKey;
    estado.perfil = { plan: "free", pagou_subscription_id: "sub_1", subscription_status: "incomplete" };
    getSubscription.mockResolvedValue({ id: "sub_1", status: "incomplete", metadata: { chave } });
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "lojas3" }));
    expect(r.status).toBe(200);
    expect(cancelSubscription).not.toHaveBeenCalled();
  });

  it("tentativa anterior que já passou: não cria a segunda", async () => {
    estado.perfil = { plan: "free", pagou_subscription_id: "sub_0", subscription_status: "incomplete" };
    getSubscription.mockResolvedValue({ id: "sub_0", status: "active", metadata: {} });
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "loja1" }));
    expect(r.status).toBe(409);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("não deu para conferir a tentativa anterior: recusa em vez de arriscar duas", async () => {
    estado.perfil = { plan: "free", pagou_subscription_id: "sub_0", subscription_status: "incomplete" };
    getSubscription.mockRejectedValue(new Error("fora do ar"));
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "loja1" }));
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/ainda está sendo processado/);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("sem a migration 064, grava o perfil sem o tier (PGRST204) em vez de deixar sem Pro", async () => {
    estado.semColunaPlano = true;
    const r = await assinar(req("/api/billing/subscribe", { cardToken: "pgct_x", plano: "lojas3" }));
    expect(r.status).toBe(200);
    expect(estado.updates.at(-1)).toMatchObject({ plan: "pro", pagou_subscription_id: "sub_1" });
    expect(estado.updates.at(-1)).not.toHaveProperty("plano");
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

  it("sem a migration 064, registra a compra sem o tier (PGRST204) em vez de dar 500", async () => {
    estado.semColunaPlano = true;
    const r = await pix(req("/api/billing/credits", { packId: "pro_month", plano: "lojas3" }));
    expect(r.status).toBe(200);
    const compra = estado.inserts.find((i) => i.tabela === "credit_purchases")?.linha;
    expect(compra).toMatchObject({ kind: "pro_month", amount_cents: 11990 });
    expect(compra).not.toHaveProperty("plano");
  });

  it("quem assina no cartão não paga 30 dias por Pix por cima", async () => {
    estado.perfil = {
      plan: "pro",
      pagou_subscription_id: "sub_0",
      subscription_status: "active",
      document_number: "52998224725",
    };
    const r = await pix(req("/api/billing/credits", { packId: "pro_month", plano: "ilimitado" }));
    expect(r.status).toBe(409);
    expect(createPixTransaction).not.toHaveBeenCalled();
    // Recarga de credito continua.
    const recarga = await pix(req("/api/billing/credits", { packId: "pack_50" }));
    expect(recarga.status).toBe(200);
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
