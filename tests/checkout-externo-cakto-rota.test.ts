import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A rota do webhook com a Cakto: o corpo CRU e os headers chegam ao
// autenticar (HMAC), e a falha nossa SEGURA a resposta ate passar dos 8 s da
// Cakto (ela so reenvia timeout e erro de rede, nunca 503). A Sphere segue
// com o 503 na hora.

const SECRET = "b3f1a9c2-7b4d-4a8e-9f01-2c6d5b8a4e37";
const TOKEN = "a".repeat(43);

const estado = {
  checkout: null as null | Record<string, unknown>,
  segredo: SECRET as string | null,
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
// A compra pelo servidor (073): aqui sem destino. O caminho dela tem o
// proprio teste (checkout-externo-rastreio.test.ts).
vi.mock("@/lib/checkouts-externos/rastreio", () => ({
  rastreioSupabase: () => ({ destinos: async () => [], enfileirar: async () => [] }),
  entregarEnvios: async () => undefined,
}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn(),
}));

const CAKTO = {
  id: "ck",
  user_id: "u",
  plataforma: "cakto",
  nome: "Cakto",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

function corpoCakto(): string {
  const agora = new Date().toISOString();
  return JSON.stringify({
    secret: SECRET,
    event: "purchase_approved",
    data: {
      id: "b3df956e-1998-4322-b091-ac0c54f7b4ba",
      refId: "4852F91",
      status: "paid",
      offer_type: "main",
      parent_order: "",
      baseAmount: 97,
      amount: 97,
      currency: "BRL",
      fees: 6.78,
      discount: "0.00",
      paymentMethod: "pix",
      commissions: [{ type: "producer", totalAmount: 90.22 }],
      product: { name: "Curso" },
      createdAt: agora,
      paidAt: agora,
      pix: { expirationDate: agora.replace("T", " ") },
    },
  });
}

function assinatura(raw: string, segredo = SECRET): Record<string, string> {
  const ts = String(Math.floor(Date.now() / 1000));
  return {
    "X-Cakto-Timestamp": ts,
    "X-Cakto-Signature": `v1=${createHmac("sha256", segredo).update(`${ts}.${raw}`).digest("hex")}`,
    "User-Agent": "CaktoBot/1.0",
  };
}

async function post(corpo: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/checkout/[token]/route");
  return POST(new Request(`https://user.xcart.app/api/webhooks/checkout/${TOKEN}`, { method: "POST", body: corpo, headers }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

describe("POST /api/webhooks/checkout/[token] com a Cakto", () => {
  beforeEach(() => {
    estado.checkout = CAKTO;
    estado.segredo = SECRET;
    estado.falharInsert = false;
    estado.falharToken = false;
    estado.gravados = [];
    estado.marcas = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("assinada com o secret salvo: 200 e o pedido gravado com as colunas da venda", async () => {
    const raw = corpoCakto();
    const r = await post(raw, assinatura(raw));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(estado.gravados).toHaveLength(1);
    expect(estado.gravados[0]).toMatchObject({ venda: true, pedido: { situacao: "pago", valor: 97, receita: 90.22, taxa: 6.78 } });
  });

  it("assinatura de outro secret: 401 na hora, o erro no checkout", async () => {
    const raw = corpoCakto();
    const r = await post(raw, assinatura(raw, "outro-secret-qualquer"));
    expect(r.status).toBe(401);
    expect(estado.gravados).toHaveLength(0);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/não confere/);
  });

  it("sem secret salvo: 401 pedindo para colar o secret", async () => {
    estado.segredo = null;
    const raw = corpoCakto();
    const r = await post(raw, assinatura(raw));
    expect(r.status).toBe(401);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/Cole aqui o secret/);
  });

  it("falha nossa ao gravar: segura a resposta ate passar dos 8 s da Cakto, e so entao 503", async () => {
    vi.useFakeTimers();
    estado.falharInsert = true;
    const raw = corpoCakto();
    let pronto = false;
    const resposta = post(raw, assinatura(raw)).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(8_000);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(1_500);
    const r = await resposta;
    expect(pronto).toBe(true);
    expect(r.status).toBe(503);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/Reenviar no painel/);
  });

  it("banco fora antes de achar o checkout, numa entrega da Cakto: tambem segura", async () => {
    vi.useFakeTimers();
    estado.falharToken = true;
    const raw = corpoCakto();
    let pronto = false;
    const resposta = post(raw, assinatura(raw)).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(8_500);
    expect(pronto).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect((await resposta).status).toBe(503);
  });

  it("corpo que nao e JSON: sem a assinatura, 401 e nada na tela; assinado, 400 com o erro na tela", async () => {
    const lixo = "isto nao e json";
    const sem = await post(lixo);
    expect(sem.status).toBe(401);
    expect(estado.marcas).toHaveLength(0);
    const outro = await post(lixo, assinatura(lixo, "outro-secret-qualquer"));
    expect(outro.status).toBe(401);
    expect(estado.marcas).toHaveLength(0);
    const assinado = await post(lixo, assinatura(lixo));
    expect(assinado.status).toBe(400);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/não é JSON/);
  });

  it("V2 grande: ate 256 KB passa; acima, 413 com o erro na tela (a Cakto nao reenvia)", async () => {
    const comLixo = (kb: number) => {
      const c = JSON.parse(corpoCakto()) as { data: Record<string, unknown> };
      c.data.observacao = "x".repeat(kb * 1024);
      return JSON.stringify(c);
    };
    const medio = comLixo(100);
    expect((await post(medio, assinatura(medio))).status).toBe(200);
    const grande = comLixo(260);
    const r = await post(grande, assinatura(grande));
    expect(r.status).toBe(413);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/passou de 256 KB/);
    // Sem a origem (sem o header e com outro secret no corpo), o 413 nao escreve na tela.
    estado.marcas = [];
    expect((await post(grande.replace(SECRET, "secret-de-outra-conta"))).status).toBe(401);
    expect(estado.marcas).toHaveLength(0);
  });

  it("a Sphere segue com o 503 na hora (ela reenvia o 503)", async () => {
    estado.checkout = { ...CAKTO, plataforma: "sphere", moeda_receita: "EUR" };
    estado.falharInsert = true;
    const agora = new Date().toISOString();
    const r = await post(
      JSON.stringify({
        evento: "pedido.criado",
        data_evento: agora,
        pedido: { id: 1, moeda: "EUR", valor: "10.00", criado_em: agora },
        comissao: { valor: "5.00", status: "pending" },
        afiliado: { codigo: "abc" },
      })
    );
    expect(r.status).toBe(503);
    // E a Sphere grava so as colunas da 069 (sem a marca da venda).
    estado.falharInsert = false;
    await post(
      JSON.stringify({
        evento: "pedido.criado",
        data_evento: agora,
        pedido: { id: 2, moeda: "EUR", valor: "10.00", criado_em: agora },
        comissao: { valor: "5.00", status: "pending" },
        afiliado: { codigo: "abc" },
      })
    );
    expect(estado.gravados.at(-1)).not.toHaveProperty("venda");
  });
});
