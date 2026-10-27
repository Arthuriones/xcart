import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// PATCH /api/billing/credits: a consulta do modal do Pix. Erro do banco nao e
// "cobranca nao encontrada" (503, o modal trata como falha), e o RPC que falha
// depois de a Pagou confirmar nao vira "pago e ativo": responde paid com
// aplicado:false, e o proximo PATCH repete (o RPC e idempotente).

type Resultado = { data: unknown; error: unknown };

const estado = {
  user: { id: "u1", email: "a@b.com" } as { id: string; email: string } | null,
  compra: { data: null, error: null } as Resultado,
  rpc: { data: true, error: null } as Resultado,
  rpcChamadas: 0,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: estado.user } }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        maybeSingle: async () => estado.compra,
      };
      return api;
    },
    rpc: async () => {
      estado.rpcChamadas++;
      return estado.rpc;
    },
  }),
}));

const getTransaction = vi.fn();
vi.mock("@/lib/billing/pagou", async (original) => ({
  ...(await original<typeof import("@/lib/billing/pagou")>()),
  getTransaction: (...a: unknown[]) => getTransaction(...a),
}));

const { PATCH } = await import("@/app/api/billing/credits/route");

const consultar = (corpo: unknown = { transactionId: "tx_1" }) =>
  PATCH(
    new NextRequest("http://localhost/api/billing/credits", { method: "PATCH", body: JSON.stringify(corpo) })
  );

const pendente = { id: "cp_1", user_id: "u1", status: "pending", kind: "pro_month" };

beforeEach(() => {
  estado.user = { id: "u1", email: "a@b.com" };
  estado.compra = { data: pendente, error: null };
  estado.rpc = { data: true, error: null };
  estado.rpcChamadas = 0;
  getTransaction.mockReset();
  getTransaction.mockImplementation(async (id: string) => ({ id, status: "waiting_payment" }));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("PATCH /api/billing/credits", () => {
  it("sem sessão: 401, sem consultar a Pagou", async () => {
    estado.user = null;
    const r = await consultar();
    expect(r.status).toBe(401);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("erro do banco ao ler a cobrança: 503, não 404", async () => {
    estado.compra = { data: null, error: { code: "57014", message: "timeout" } };
    const r = await consultar();
    expect(r.status).toBe(503);
    expect((await r.json()).status).toBeUndefined();
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("cobrança de outro usuário, ou inexistente: 404", async () => {
    estado.compra = { data: { ...pendente, user_id: "u2" }, error: null };
    expect((await consultar()).status).toBe(404);
    estado.compra = { data: null, error: null };
    expect((await consultar()).status).toBe(404);
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("já aplicada: paid sem ir à Pagou", async () => {
    estado.compra = { data: { ...pendente, status: "paid" }, error: null };
    const r = await consultar();
    expect(await r.json()).toEqual({ status: "paid", credited: true, kind: "pro_month" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("ainda esperando: devolve o status da Pagou", async () => {
    const r = await consultar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "waiting_payment", credited: false });
    expect(estado.rpcChamadas).toBe(0);
  });

  it("pago e aplicado: paid, credited", async () => {
    getTransaction.mockResolvedValue({ id: "tx_1", status: "paid" });
    const corpo = await (await consultar()).json();
    expect(corpo).toEqual({ status: "paid", credited: true, kind: "pro_month" });
    expect(corpo.aplicado).toBeUndefined();
  });

  it("pago mas o RPC falhou: paid com aplicado:false (não 'ativo'), e o próximo repete", async () => {
    getTransaction.mockResolvedValue({ id: "tx_1", status: "paid" });
    estado.rpc = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    const r = await consultar();
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ status: "paid", credited: false, aplicado: false, kind: "pro_month" });

    estado.rpc = { data: true, error: null };
    expect(await (await consultar()).json()).toEqual({ status: "paid", credited: true, kind: "pro_month" });
    expect(estado.rpcChamadas).toBe(2);
  });

  it("Pagou fora do ar: 502 sem status", async () => {
    getTransaction.mockRejectedValue(new Error("fetch failed"));
    const r = await consultar();
    expect(r.status).toBe(502);
    expect((await r.json()).status).toBeUndefined();
  });
});
