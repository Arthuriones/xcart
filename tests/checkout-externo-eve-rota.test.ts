import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A rota do webhook com o Eve: o X-Eve-Signature (HMAC do corpo CRU) chega ao
// autenticar, a falha nossa responde 503 NA HORA (o Eve reenvia qualquer
// nao-2xx pela fila: 30 s, 1, 2, 4 e 8 min) e deixa o erro na tela, a
// retentativa de 30 s com a trava presa responde 503 (nunca "duplicado"), e o
// checkout do Eve numa conta fora da lista nem e achado.

const SECRET = "9f1c4e2a7b3d4c8ea1f52d6b8e0c3a719f1c4e2a7b3d4c8ea1f52d6b8e0c3a71";
const TOKEN = "e".repeat(43);
const ARTHUR = "55c773d6-873a-456a-8695-296ff1433a53";
const PEDIDO = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const estado = {
  checkout: null as null | Record<string, unknown>,
  segredo: SECRET as string | null,
  falharInsert: false,
  falharSoltar: false,
  falharToken: false,
  /** A trava (pedido|evento) -> quando foi gravada (ms). */
  travas: new Map<string, number>(),
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
    travarEvento: async (x: { pedido_id: string; evento: string }) => {
      const k = `${x.pedido_id}|${x.evento}`;
      if (estado.travas.has(k)) return "duplicado";
      estado.travas.set(k, Date.now());
      return "ok";
    },
    soltarEvento: async (x: { pedido_id: string; evento: string }) => {
      if (estado.falharSoltar) throw new Error("banco fora");
      estado.travas.delete(`${x.pedido_id}|${x.evento}`);
    },
    travaRecebidaEm: async (x: { pedido_id: string; evento: string }) => {
      const em = estado.travas.get(`${x.pedido_id}|${x.evento}`);
      return em === undefined ? null : new Date(em).toISOString();
    },
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

const EVE = {
  id: "ck",
  user_id: ARTHUR,
  plataforma: "eve",
  nome: "Eve Panela",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

const z = (d: Date) => `${d.toISOString().slice(0, 19)}Z`;

function corpoEve(extra: Record<string, unknown> = {}): string {
  const agora = z(new Date());
  return JSON.stringify({
    versao: 1,
    evento: "pedido.pago",
    enviado_em: agora,
    teste: false,
    loja: { id: "lj_9f8e7d6c", nome: "Panela Mônaco" },
    pedido: {
      id: PEDIDO,
      numero: 123,
      origem: "external",
      status: "paid",
      metodo: "pix",
      moeda: "BRL",
      subtotal_centavos: 9700,
      desconto_centavos: 0,
      frete_centavos: 0,
      total_centavos: 9700,
      criado_em: agora,
      pago_em: agora,
      vence_em: null,
      cancelado_em: null,
      reembolsado_em: null,
      atualizado_em: agora,
      itens: [{ id: "8123456789", titulo: "Panela Mônaco 5 peças", variante: null, quantidade: 1, preco_centavos: 9700, total_centavos: 9700 }],
    },
    comprador: { nome: "Ana Souza", email: "ana@provedor.com.br", telefone: "+5534988887777", cidade: "Belo Horizonte", estado: "MG", cep: "30140071", pais: "BR" },
    rastreio: { utm_source: "FB", url: "https://panelamonaco.shop/oferta" },
    ...extra,
  });
}

/** Os headers do contrato, assinados como o PHP faz: hash_hmac('sha256', "$ts.$corpo", $secret). */
function assinado(corpo: string, secret = SECRET, ts = String(Math.floor(Date.now() / 1000))): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": "Eve-Checkout/1",
    "X-Eve-Event": (JSON.parse(corpo) as { evento: string }).evento,
    "X-Eve-Timestamp": ts,
    "X-Eve-Signature": `v1=${createHmac("sha256", secret).update(`${ts}.${corpo}`, "utf8").digest("hex")}`,
  };
}

async function post(corpo: string, headers: Record<string, string> = {}) {
  const { POST } = await import("@/app/api/webhooks/checkout/[token]/route");
  return POST(new Request(`https://user.xcart.app/api/webhooks/checkout/${TOKEN}`, { method: "POST", body: corpo, headers }), {
    params: Promise.resolve({ token: TOKEN }),
  });
}

describe("POST /api/webhooks/checkout/[token] com o Eve", () => {
  beforeEach(() => {
    estado.checkout = EVE;
    estado.segredo = SECRET;
    estado.falharInsert = false;
    estado.falharSoltar = false;
    estado.falharToken = false;
    estado.travas = new Map();
    estado.gravados = [];
    estado.marcas = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("assinado com o secret salvo: 200 e o pedido gravado com as colunas da venda", async () => {
    const c = corpoEve();
    const r = await post(c, assinado(c));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true });
    expect(estado.gravados).toHaveLength(1);
    expect(estado.gravados[0]).toMatchObject({
      venda: true,
      pedido: { situacao: "pago", valor: 97, receita: 97, taxa: null, referencia: "123", grupo: PEDIDO, produto: "Panela Mônaco 5 peças" },
    });
  });

  it("assinatura errada ou ausente: 401 na hora, o erro no checkout", async () => {
    const c = corpoEve();
    const errado = await post(c, assinado(c, "outro-secret-qualquer"));
    expect(errado.status).toBe(401);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/A assinatura da Eve não confere \(assinatura nao confere\)/);
    // Corpo mexido depois de assinar.
    expect((await post(c.replace("9700", "9800"), assinado(c))).status).toBe(401);
    expect((await post(c, { "Content-Type": "application/json" })).status).toBe(401);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/X-Eve-Signature ausente/);
    expect(estado.gravados).toHaveLength(0);
  });

  it("sem secret salvo: 401 pedindo o secret", async () => {
    estado.segredo = null;
    const c = corpoEve();
    expect((await post(c, assinado(c))).status).toBe(401);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/^Cole aqui o secret do webhook da Eve/);
  });

  it("falha nossa ao gravar: 503 NA HORA (sem segurar) e o erro na tela com a fila do Eve", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    estado.falharInsert = true;
    const c = corpoEve();
    let pronto = false;
    const resposta = post(c, assinado(c)).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(pronto).toBe(true);
    expect((await resposta).status).toBe(503);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(
      /Falha nossa ao gravar um evento\. A Eve tenta de novo sozinha pela fila .*; se o erro ficar, use Enviar teste no painel dela/
    );
    // A trava saiu: a retentativa grava.
    estado.falharInsert = false;
    vi.useRealTimers();
    const de_novo = corpoEve();
    expect((await post(de_novo, assinado(de_novo))).status).toBe(200);
  });

  it("a trava presa (gravar e soltar falharam): a retentativa em 30 s responde 503, nao 'duplicado'; depois de 60 s refaz", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const inicio = new Date("2026-10-24T05:10:00.000Z");
    vi.setSystemTime(inicio);
    estado.falharInsert = true;
    estado.falharSoltar = true;
    const c1 = corpoEve();
    expect((await post(c1, assinado(c1))).status).toBe(503);
    expect(estado.travas.size).toBe(1);

    // A 1a retentativa do Eve: 30 s depois, corpo remontado e assinado de novo.
    estado.falharInsert = false;
    estado.falharSoltar = false;
    vi.setSystemTime(new Date(inicio.getTime() + 30_000));
    const c2 = corpoEve();
    const r2 = await post(c2, assinado(c2));
    expect(r2.status).toBe(503);
    expect(await r2.json()).toEqual({ ok: false, erro: "tente de novo" });
    expect(estado.gravados).toHaveLength(0);

    // A 2a (mais 60 s): a trava ja passou da janela, refaz e grava.
    vi.setSystemTime(new Date(inicio.getTime() + 90_000));
    const c3 = corpoEve();
    expect((await post(c3, assinado(c3))).status).toBe(200);
    expect(estado.gravados).toHaveLength(1);
  });

  it("banco fora antes de achar o checkout: 503 na hora", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    estado.falharToken = true;
    const c = corpoEve();
    let pronto = false;
    const resposta = post(c, assinado(c)).then((r) => {
      pronto = true;
      return r;
    });
    await vi.advanceTimersByTimeAsync(10);
    expect(pronto).toBe(true);
    expect((await resposta).status).toBe(503);
  });

  it("checkout do Eve numa conta fora da lista: 404, nada gravado nem marcado", async () => {
    estado.checkout = { ...EVE, user_id: "0b7e3c2a-1d4f-4e5a-9b8c-7d6e5f4a3b2c" };
    const c = corpoEve();
    const r = await post(c, assinado(c));
    expect(r.status).toBe(404);
    expect(estado.gravados).toHaveLength(0);
    expect(estado.marcas).toHaveLength(0);
  });

  it("corpo grande demais: 413 com o erro na tela so com a assinatura certa", async () => {
    const grande = corpoEve({ observacao: "x".repeat(260 * 1024) });
    const r = await post(grande, assinado(grande));
    expect(r.status).toBe(413);
    expect(String(estado.marcas.at(-1)?.ultimo_erro)).toMatch(/passou de 256 KB.*mandar o evento de novo pela Eve/);
    estado.marcas = [];
    expect((await post(grande, assinado(grande, "outro-secret-qualquer"))).status).toBe(401);
    expect(estado.marcas).toHaveLength(0);
  });

  it("o teste do Eve e lead sem Pix: 200 sem gravar", async () => {
    const teste = corpoEve({ teste: true });
    expect(await (await post(teste, assinado(teste))).json()).toEqual({ ok: true, teste: true });
    const lead = JSON.parse(corpoEve()) as { evento: string; pedido: Record<string, unknown> };
    lead.evento = "pix.gerado";
    lead.pedido.status = "started";
    const raw = JSON.stringify(lead);
    expect(await (await post(raw, assinado(raw))).json()).toEqual({ ok: true, ignorado: "status started" });
    expect(estado.gravados).toHaveLength(0);
  });
});
