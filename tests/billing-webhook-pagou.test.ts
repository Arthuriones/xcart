import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// O webhook da Pagou:
//  - evento que chegou e FALHOU e processado de novo no reenvio (antes o
//    reenvio batia na PK e saia em 200, e o evento ficava perdido);
//  - aviso de outra assinatura (a tentativa abandonada, o cartao antigo de
//    quem paga por Pix) nao mexe no perfil;
//  - falha ao gravar o perfil responde 500, para a Pagou reenviar.

type Linha = Record<string, unknown>;

const estado = {
  eventos: new Map<string, Linha>(),
  perfil: null as Linha | null,
  updatesPerfil: [] as Linha[],
  falharPerfil: false,
  compra: null as Linha | null,
  rpcs: [] as unknown[],
};

function adminFalso() {
  return {
    rpc: async (nome: string, args: unknown) => {
      estado.rpcs.push({ nome, args });
      return { data: true, error: null };
    },
    from: (tabela: string) => {
      let patch: Linha | null = null;
      let id: unknown = null;
      const api = {
        insert: async (linha: Linha) => {
          if (tabela === "payment_events") {
            if (estado.eventos.has(String(linha.id))) return { error: { code: "23505" } };
            estado.eventos.set(String(linha.id), { ...linha, processed_at: null });
          }
          return { error: null };
        },
        select: () => api,
        update: (p: Linha) => {
          patch = p;
          return api;
        },
        eq: (_c: string, v: unknown) => {
          id = v;
          return api;
        },
        maybeSingle: async () => {
          if (tabela === "payment_events") return { data: estado.eventos.get(String(id)) ?? null, error: null };
          if (tabela === "credit_purchases") return { data: estado.compra, error: null };
          return { data: estado.perfil, error: null };
        },
        single: async () => ({ data: estado.perfil, error: null }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch && tabela === "payment_events") {
            Object.assign(estado.eventos.get(String(id)) ?? {}, patch);
          }
          if (patch && tabela === "profiles") {
            if (estado.falharPerfil) {
              return Promise.resolve({ data: null, error: { code: "XX000", message: "caiu" } }).then(ok);
            }
            estado.updatesPerfil.push(patch);
          }
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return api;
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => adminFalso() }));

const getSubscription = vi.fn();
const getTransaction = vi.fn();
vi.mock("@/lib/billing/pagou", async (original) => ({
  ...(await original<typeof import("@/lib/billing/pagou")>()),
  getSubscription: (...a: unknown[]) => getSubscription(...a),
  getTransaction: (...a: unknown[]) => getTransaction(...a),
}));

process.env.PAGOU_WEBHOOK_TOKEN = "segredo";
const { POST } = await import("@/app/api/billing/pagou/webhook/route");

const aviso = (corpo: Linha) =>
  POST(
    new NextRequest("http://localhost/api/billing/pagou/webhook?t=segredo", {
      method: "POST",
      body: JSON.stringify(corpo),
    })
  );

beforeEach(() => {
  estado.eventos = new Map();
  estado.perfil = { pagou_subscription_id: "sub_B", subscription_status: "active", plano: "lojas3", current_period_end: null };
  estado.updatesPerfil = [];
  estado.falharPerfil = false;
  estado.compra = null;
  estado.rpcs = [];
  getSubscription.mockReset();
  getTransaction.mockReset();
});

describe("webhook da Pagou", () => {
  it("o cancelamento da tentativa abandonada não tira o acesso de quem paga a outra", async () => {
    getSubscription.mockResolvedValue({
      id: "sub_A",
      customerId: "cus_1",
      status: "canceled",
      amount: 7990,
      metadata: { user_id: "u1" },
    });
    const r = await aviso({ id: "ev_1", event: "subscription", data: { id: "sub_A" } });
    expect(r.status).toBe(200);
    expect(estado.updatesPerfil).toEqual([]);
  });

  it("aviso da assinatura do perfil aplica o status sem trocar o tier gravado", async () => {
    getSubscription.mockResolvedValue({
      id: "sub_B",
      customerId: "cus_1",
      status: "past_due",
      amount: 7990,
      metadata: { user_id: "u1" },
    });
    await aviso({ id: "ev_2", event: "subscription", data: { id: "sub_B" } });
    expect(estado.updatesPerfil.at(-1)).toMatchObject({ subscription_status: "past_due", plan: "pro" });
    expect(estado.updatesPerfil.at(-1)).not.toHaveProperty("plano");
  });

  it("falha ao gravar o perfil responde 500, e o reenvio processa de novo", async () => {
    getSubscription.mockResolvedValue({
      id: "sub_B",
      customerId: "cus_1",
      status: "active",
      amount: 11990,
      metadata: { user_id: "u1" },
    });
    estado.falharPerfil = true;
    const primeira = await aviso({ id: "ev_3", event: "subscription", data: { id: "sub_B" } });
    expect(primeira.status).toBe(500);

    estado.falharPerfil = false;
    const reenvio = await aviso({ id: "ev_3", event: "subscription", data: { id: "sub_B" } });
    expect(reenvio.status).toBe(200);
    expect(await reenvio.json()).toEqual({ received: true });
    expect(estado.updatesPerfil.at(-1)).toMatchObject({ subscription_status: "active" });
    expect(estado.eventos.get("ev_3")?.processed_at).toBeTruthy();
  });

  it("evento já processado não roda de novo", async () => {
    getTransaction.mockResolvedValue({ id: "tx_1", status: "paid" });
    estado.compra = { id: "c1", status: "pending" };
    await aviso({ id: "ev_4", event: "transaction", data: { id: "tx_1" } });
    const repetido = await aviso({ id: "ev_4", event: "transaction", data: { id: "tx_1" } });
    expect(await repetido.json()).toEqual({ received: true, duplicate: true });
    expect(estado.rpcs).toHaveLength(1);
  });
});
