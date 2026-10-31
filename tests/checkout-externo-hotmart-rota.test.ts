import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A rota do webhook com a Hotmart: o X-HOTMART-HOTTOK chega ao autenticar, a
// falha nossa responde 503 NA HORA (a Hotmart reenvia o nao-2xx ate 5 vezes)
// e deixa o erro na tela com o reenvio do Historico, o 413 com a origem
// conferida tambem fica na tela, e o que nao vira pedido responde 200 (a
// Hotmart desativa o webhook cuja URL da erro).

const HOTTOK = "hmt9f1c4e2a7b3d4c8ea1f52d6b8e0c3a71xyz";
const TOKEN = "a".repeat(43);

const estado = {
  checkout: null as null | Record<string, unknown>,
  segredo: HOTTOK as string | null,
  falharInsert: false,
  falharToken: false,
  gravados: [] as Record<string, unknown>[],
  marcas: [] as Record<string, unknown>[],
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/checkouts-externos/notificar", () => ({ notificarPedidoExterno: async () => undefined }));
vi.mock("@/lib/checkouts-externos/repo-supabase", () => ({
  checkoutDoToken: async () => {
    if (estado.falharToken) throw new Error("banco fora");
    return estado.checkout;
  },
  segredoDaPlataforma: async () => estado.segredo,
  repositorioSupabase: () => ({
    travarEvento: async () => "ok",
    soltarEvento: async () => undefined,
    lerPedido: async () => null,
    inserirPedido: async (x: Record<string, unknown>) => {
      if (estado.falharInsert) throw new Error("banco fora");
      estado.gravados.push(x);
      return "ok";
    },
    atualizarPedido: async () => true,
    reivindicarConta: async () => "ok",
    marcarCheckout: async (_id: string, campos: Record<string, unknown>) => void estado.marcas.push(campos),
  }),
}));
vi.mock("@/lib/checkouts-externos/rastreio", () => ({
  rastreioSupabase: () => ({ destinos: async () => [], enfileirar: async () => [] }),
  entregarEnvios: async () => undefined,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn(),
}));

const HOTMART = {
  id: "ck",
  user_id: "u",
  plataforma: "hotmart",
  nome: "Hotmart",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

function corpoHotmart(extra: Record<string, unknown> = {}): string {
  const agora = Date.now();
  return JSON.stringify({
    id: "8f2d1c3e-0000-4000-8000-000000000001",
    creation_date: agora,
    event: "PURCHASE_APPROVED",
    version: "2.0.0",
    data: {
      product: { id: 4774438, name: "Curso" },
      buyer: { email: "ana@provedor.com.br", name: "Ana" },
      commissions: [
        { value: 9.7, currency_value: "BRL", source: "MARKETPLACE" },
        { value: 87.3, currency_value: "BRL", source: "PRODUCER" },
      ],
      purchase: {
        transaction: "HP17715690036014",
        order_date: agora,
        approved_date: agora,
        status: "APPROVED",
        price: { value: 97, currency_value: "BRL" },
        payment: { type: "PIX" },
        order_bump: { is_order_bump: false },
      },
    },
    ...extra,
  });
}

const comHottok = (hottok = HOTTOK): Record<string, string> => ({ "X-HOTMART-HOTTOK": hottok });

async function post(corpo: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/checkout/[token]/route");
  return POST(new Request(`https://user.xcart.app/api/webhooks/checkout/${TOKEN}`, { method: "POST", body: corpo, headers }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

describe("POST /api/webhooks/checkout/[token] com a Hotmart", () => {
  beforeEach(() => {
    estado.checkout = HOTMART;
    estado.segredo = HOTTOK;
    estado.falharInsert = false;
    estado.falharToken = false;
    estado.gravados = [];
    estado.marcas = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("com o hottok salvo: 200 e o pedido gravado com as colunas da venda", async () => {
    const r = await post(corpoHotmart(), comHottok());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(estado.gravados).toHaveLength(1);
    expect(estado.gravados[0]).toMatchObject({ venda: true, pedido: { situacao: "pago", valor: 97, receita: 87.3, taxa: 9.7 } });
  });

  it("hottok errado ou ausente: 401 na hora, o erro no checkout", async () => {
    const errado = await post(corpoHotmart(), comHottok("outro-hottok-qualquer"));
    expect(errado.status).toBe(401);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/O token da Hotmart não confere/);
    expect((await post(corpoHotmart())).status).toBe(401);
    expect(estado.gravados).toHaveLength(0);
  });

  it("falha nossa ao gravar: 503 NA HORA (sem segurar) e o erro na tela com o reenvio do Historico", async () => {
    vi.useFakeTimers();
    estado.falharInsert = true;
    let pronto = false;
    const resposta = post(corpoHotmart(), comHottok()).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(pronto).toBe(true);
    expect((await resposta).status).toBe(503);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/tenta de novo até 5 vezes; se o erro ficar, use o reenvio no Histórico do webhook dela/);
  });

  it("corpo grande demais: 413 com o erro na tela so com o hottok certo", async () => {
    const grande = corpoHotmart({ observacao: "x".repeat(260 * 1024) });
    const r = await post(grande, comHottok());
    expect(r.status).toBe(413);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/passou de 256 KB.*mandar o evento de novo pela Hotmart/);
    estado.marcas = [];
    expect((await post(grande, comHottok("outro-hottok-qualquer"))).status).toBe(401);
    expect(estado.marcas).toHaveLength(0);
  });

  it("abandono de carrinho e assinatura: 200 sem gravar", async () => {
    const abandono = await post(JSON.stringify({ event: "PURCHASE_OUT_OF_SHOPPING_CART", data: {} }), comHottok());
    expect(await abandono.json()).toEqual({ ok: true, ignorado: "PURCHASE_OUT_OF_SHOPPING_CART" });
    const assinatura = await post(JSON.stringify({ event: "SUBSCRIPTION_CANCELLATION", data: {} }), comHottok());
    expect(assinatura.status).toBe(200);
    expect(estado.gravados).toHaveLength(0);
  });
});
