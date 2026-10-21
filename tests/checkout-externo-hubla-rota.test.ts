import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A rota do webhook com a Hubla: o x-hubla-token chega ao autenticar, a falha
// nossa responde 503 NA HORA (a Hubla reenvia qualquer nao-2xx, 5 vezes em
// ~75 s) e deixa o erro na tela com o Reprocessar, e o 413 com a origem
// conferida tambem fica na tela (depois das 5 ela desiste).

const HUBLA_TOKEN = "hbl_9f1c4e2a7b3d4c8ea1f52d6b8e0c3a71";
const TOKEN = "a".repeat(43);

const estado = {
  checkout: null as null | Record<string, unknown>,
  segredo: HUBLA_TOKEN as string | null,
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

const HUBLA = {
  id: "ck",
  user_id: "u",
  plataforma: "hubla",
  nome: "Hubla",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

function corpoHubla(extra: Record<string, unknown> = {}): string {
  const agora = new Date().toISOString();
  return JSON.stringify({
    type: "invoice.payment_succeeded",
    version: "2.0.0",
    event: {
      product: { id: "inAVzweR0QYw5y03K5mq", name: "Mentoria" },
      invoice: {
        id: "7614b1bb-1d1a-43ba-890c-50d74216eb56",
        parentInvoiceId: null,
        paymentMethod: "pix",
        currency: "BRL",
        type: "sell",
        status: "paid",
        statusAt: [
          { status: "unpaid", when: agora },
          { status: "paid", when: agora },
        ],
        amount: { totalCents: 9700, installmentFeeCents: 0 },
        receivers: [
          { role: "platform", totalCents: 678, currency: "BRL" },
          { role: "seller", totalCents: 9022, currency: "BRL" },
        ],
        createdAt: agora,
        modifiedAt: agora,
      },
      ...extra,
    },
  });
}

const comToken = (token = HUBLA_TOKEN): Record<string, string> => ({
  "x-hubla-token": token,
  "x-hubla-sandbox": "FALSE",
  "x-hubla-delivery-mode": "standard",
});

async function post(corpo: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/checkout/[token]/route");
  return POST(new Request(`https://user.xcart.app/api/webhooks/checkout/${TOKEN}`, { method: "POST", body: corpo, headers }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

describe("POST /api/webhooks/checkout/[token] com a Hubla", () => {
  beforeEach(() => {
    estado.checkout = HUBLA;
    estado.segredo = HUBLA_TOKEN;
    estado.falharInsert = false;
    estado.falharToken = false;
    estado.gravados = [];
    estado.marcas = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("com o token salvo: 200 e o pedido gravado com as colunas da venda", async () => {
    const r = await post(corpoHubla(), comToken());
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(estado.gravados).toHaveLength(1);
    expect(estado.gravados[0]).toMatchObject({ venda: true, pedido: { situacao: "pago", valor: 97, receita: 90.22, taxa: 6.78 } });
  });

  it("token errado ou ausente: 401 na hora, o erro no checkout", async () => {
    const errado = await post(corpoHubla(), comToken("outro-token-qualquer"));
    expect(errado.status).toBe(401);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/O token da Hubla não confere/);
    expect((await post(corpoHubla())).status).toBe(401);
    expect(estado.gravados).toHaveLength(0);
  });

  it("falha nossa ao gravar: 503 NA HORA (sem segurar) e o erro na tela com o Reprocessar", async () => {
    vi.useFakeTimers();
    estado.falharInsert = true;
    let pronto = false;
    const resposta = post(corpoHubla(), comToken()).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(pronto).toBe(true);
    expect((await resposta).status).toBe(503);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/tenta de novo por cerca de 1 minuto; se o erro ficar, use Reprocessar no histórico de eventos dela/);
  });

  it("banco fora antes de achar o checkout: 503 na hora", async () => {
    vi.useFakeTimers();
    estado.falharToken = true;
    let pronto = false;
    const resposta = post(corpoHubla(), comToken()).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(pronto).toBe(true);
    expect((await resposta).status).toBe(503);
  });

  it("corpo grande demais: 413 com o erro na tela so com o token certo", async () => {
    const grande = corpoHubla({ observacao: "x".repeat(260 * 1024) });
    const r = await post(grande, comToken());
    expect(r.status).toBe(413);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/passou de 256 KB.*Reprocessar na Hubla/);
    estado.marcas = [];
    expect((await post(grande, comToken("outro-token-qualquer"))).status).toBe(401);
    expect(estado.marcas).toHaveLength(0);
  });

  it("lead, assinatura e o status_updated que repete o pagamento: 200 sem gravar", async () => {
    const lead = await post(JSON.stringify({ type: "lead.abandoned_checkout", event: {} }), comToken());
    expect(await lead.json()).toEqual({ ok: true, ignorado: "lead.abandoned_checkout" });
    const repetido = JSON.parse(corpoHubla()) as Record<string, unknown>;
    repetido.type = "invoice.status_updated";
    const r = await post(JSON.stringify(repetido), comToken());
    expect(await r.json()).toEqual({ ok: true, ignorado: "invoice.status_updated:paid" });
    expect(estado.gravados).toHaveLength(0);
  });
});
