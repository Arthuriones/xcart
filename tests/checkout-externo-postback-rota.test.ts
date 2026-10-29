import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A rota do webhook com o postback da Sphere (086): GET na mesma URL, com
// clickid/t na query. Sem eles, o texto de sempre (sem banco). So checkout
// da Sphere; falha nossa = 503. Pela hora quem decide e o cron (o teste do
// banco esta em checkout-externo-postback.test.ts).

const TOKEN = "a".repeat(43);

const estado = {
  checkout: null as null | Record<string, unknown>,
  falharToken: false,
  falharPostback: false,
  recebidos: [] as Record<string, unknown>[],
};

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/checkouts-externos/notificar", () => ({ notificarPedidoExterno: async () => undefined }));
vi.mock("@/lib/checkouts-externos/repo-supabase", () => ({
  checkoutDoToken: async () => {
    if (estado.falharToken) throw new Error("banco fora");
    return estado.checkout;
  },
  segredoDaPlataforma: async () => null,
  repositorioSupabase: () => ({
    travarEvento: async () => "ok",
    soltarEvento: async () => undefined,
    lerPedido: async () => null,
    inserirPedido: async () => "ok",
    atualizarPedido: async () => true,
    reivindicarConta: async () => "ok",
    marcarCheckout: async () => undefined,
  }),
}));
vi.mock("@/lib/checkouts-externos/rastreio", () => ({
  rastreioSupabase: () => ({ destinos: async () => [], enfileirar: async () => [] }),
  entregarEnvios: async () => undefined,
}));
vi.mock("@/lib/checkouts-externos/postback-supabase", () => ({
  receberPostback: async (_admin: unknown, _ck: unknown, p: Record<string, unknown>) => {
    if (estado.falharPostback) throw new Error("banco fora");
    estado.recebidos.push(p);
    return "casado";
  },
  decidirPostbacks: async () => ({}),
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn(),
}));

const SPHERE = {
  id: "ck",
  user_id: "u",
  plataforma: "sphere",
  nome: "Sphere",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "EUR",
  notificar_aprovada: false,
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

async function get(query = "") {
  const { GET } = await import("@/app/api/webhooks/checkout/[token]/route");
  return GET(new Request(`https://user.xcart.app/api/webhooks/checkout/${TOKEN}${query}`), {
    params: Promise.resolve({ token: TOKEN }),
  });
}


describe("GET /api/webhooks/checkout/[token]", () => {
  beforeEach(() => {
    estado.checkout = SPHERE;
    estado.falharToken = false;
    estado.falharPostback = false;
    estado.recebidos = [];
  });
  afterEach(() => vi.clearAllMocks());

  it("sem clickid nem t: o texto de sempre, sem banco", async () => {
    estado.falharToken = true;
    const r = await get();
    expect(r.status).toBe(200);
    expect(await r.text()).toMatch(/use POST/);
  });

  it("postback da Sphere: grava e responde a situacao", async () => {
    const r = await get("?clickid=120255889731580350&t=6824013332735&sum=33.00&currency=EUR&status=approved&type=Purchase");
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, postback: "casado" });
    expect(estado.recebidos).toEqual([
      expect.objectContaining({ anuncioId: "120255889731580350", pedidoRef: "6824013332735", soma: 33, moeda: "EUR" }),
    ]);
  });

  it("InitiateCheckout: 200 ignorado, nada gravado", async () => {
    const r = await get("?clickid=120255889731580350&type=InitiateCheckout&sum=0");
    expect(await r.json()).toEqual({ ok: true, ignorado: "tipo" });
    expect(estado.recebidos).toHaveLength(0);
  });

  it("token desconhecido ou checkout que nao e da Sphere: 404", async () => {
    estado.checkout = null;
    expect((await get("?clickid=1234567")).status).toBe(404);
    estado.checkout = { ...SPHERE, plataforma: "cakto" };
    expect((await get("?clickid=1234567")).status).toBe(404);
    expect(estado.recebidos).toHaveLength(0);
  });

  it("falha nossa: 503", async () => {
    estado.falharToken = true;
    expect((await get("?clickid=1234567")).status).toBe(503);
    estado.falharToken = false;
    estado.falharPostback = true;
    const erro = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await get("?clickid=1234567")).status).toBe(503);
    erro.mockRestore();
  });
});
