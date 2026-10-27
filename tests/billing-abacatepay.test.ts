import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// ============================================================================
// Cobranca pela AbacatePay (docs/migracao-abacatepay/estudo.md).
//
// O que trava aqui, rodando as rotas e o webhook DE VERDADE contra um banco em
// memoria e uma API da AbacatePay de mentira (fetch trocado):
//  - o fim do periodo, que a AbacatePay nao da, sai do pagamento + ciclo +
//    folga, e so anda para frente;
//  - cancelar la e na hora: aqui o Pro fica ate o fim ja pago, e a porta fecha
//    quando ele passa;
//  - o webhook so vale com o secret da URL E o HMAC do corpo, deduplica pelo
//    id e rele o estado na API (o corpo e so aviso);
//  - o Pix avulso aplica uma vez so (apply_paid_charge) e sai sem CPF na
//    recarga de creditos;
//  - o checkout de assinatura pendente da mesma hora e reaproveitado (a API
//    nao tem idempotencia) e o preco do produto tem que ser o de plans.ts.
// ============================================================================

vi.mock("server-only", () => ({}));

let banco: FakeSupabase;
const rpcs: { nome: string; args: Record<string, unknown> }[] = [];
const estado = {
  user: { id: "11111111-2222-4333-8444-555555555555", email: "lojista@exemplo.com" } as {
    id: string;
    email: string;
  } | null,
  rpcErro: null as { message: string } | null,
};

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => (banco.client as unknown as { from: (t: string) => unknown }).from(t),
    rpc: async (nome: string, args: Record<string, unknown>) => {
      rpcs.push({ nome, args });
      return { data: true, error: estado.rpcErro };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: estado.user } }) } }),
}));

// ---- a AbacatePay de mentira ------------------------------------------------
const api = {
  pixStatus: "PENDING",
  assinatura: null as Record<string, unknown> | null,
  produtos: {} as Record<string, Record<string, unknown>>,
  checkoutPendente: null as Record<string, unknown> | null,
  falhar: null as null | { status: number; corpo: unknown },
  chamadas: [] as { metodo: string; caminho: string; query: Record<string, string>; corpo: Record<string, unknown> | null }[],
};

function resposta(status: number, corpo: unknown) {
  return new Response(JSON.stringify(corpo), { status, headers: { "content-type": "application/json" } });
}

const fetchFalso = vi.fn(async (entrada: URL | string, init?: RequestInit) => {
  const url = new URL(String(entrada));
  const caminho = url.pathname.replace(/^\/v2/, "");
  const query = Object.fromEntries(url.searchParams);
  const corpo = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
  api.chamadas.push({ metodo: init?.method || "GET", caminho, query, corpo });
  if (api.falhar) return resposta(api.falhar.status, api.falhar.corpo);
  const ok = (data: unknown) => resposta(200, { data, success: true, error: null });
  switch (caminho) {
    case "/transparents/create":
      return ok({
        id: "pix_char_abc",
        amount: (corpo?.data as { amount: number }).amount,
        status: "PENDING",
        brCode: "00020126580014BR.GOV.BCB.PIX",
        brCodeBase64: "data:image/png;base64,AAAA",
        expiresAt: "2026-10-27T13:00:00.000Z",
      });
    case "/transparents/check":
      return ok({ status: api.pixStatus });
    case "/subscriptions/get":
      return api.assinatura ? ok(api.assinatura) : resposta(404, { data: null, success: false, error: "Not found" });
    case "/subscriptions/cancel":
      return ok({ ...api.assinatura, status: "CANCELLED" });
    case "/products/get": {
      const p = api.produtos[query.externalId];
      return p ? ok(p) : resposta(400, { data: null, success: false, error: "Product not found" });
    }
    case "/subscriptions/checkouts/get":
      return api.checkoutPendente
        ? ok(api.checkoutPendente)
        : resposta(404, { data: null, success: false, error: "Checkout not found" });
    case "/subscriptions/create":
      return ok({ id: "bill_novo", url: "https://app.abacatepay.com/pay/bill_novo", status: "PENDING" });
    case "/customers/create":
      return ok({ id: "cust_novo" });
    default:
      return resposta(404, { data: null, success: false, error: `rota ${caminho}` });
  }
});

const USER = "11111111-2222-4333-8444-555555555555";
const SEGREDO = "segredo-do-webhook-de-teste";
const AGORA = Date.parse("2026-10-27T12:00:00Z");

function cenario(perfil: Record<string, unknown> = {}, compras: Record<string, unknown>[] = []) {
  banco = fakeSupabase({
    profiles: [
      {
        id: USER,
        plan: "free",
        plano: null,
        payment_provider: "pagou",
        pagou_subscription_id: null,
        abacatepay_subscription_id: null,
        abacatepay_customer_id: null,
        subscription_status: null,
        current_period_end: null,
        cancel_at_period_end: false,
        document_number: null,
        nome: "Ana",
        sobrenome: "Lima",
        telefone: "31999990000",
        is_admin: false,
        access_granted: false,
        ...perfil,
      },
    ],
    credit_purchases: compras,
    payment_events: [],
  });
}

const perfil = () => banco.tabelas.profiles[0];

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  vi.stubGlobal("fetch", fetchFalso);
  process.env.NEXT_PUBLIC_BILLING_PROVIDER = "abacatepay";
  process.env.ABACATEPAY_API_KEY = "abc_dev_teste";
  process.env.ABACATEPAY_WEBHOOK_SECRET = SEGREDO;
  process.env.NEXT_PUBLIC_APP_URL = "https://user.xcart.app";
  delete process.env.NEXT_PUBLIC_ABACATEPAY_PIX_AUTOMATICO;
  estado.user = { id: USER, email: "lojista@exemplo.com" };
  estado.rpcErro = null;
  rpcs.length = 0;
  api.pixStatus = "PENDING";
  api.assinatura = null;
  api.checkoutPendente = null;
  api.falhar = null;
  api.chamadas = [];
  api.produtos = {
    roteamento: { id: "prod_rot", externalId: "roteamento", price: 19700, cycle: "MONTHLY" },
    completo: { id: "prod_comp", externalId: "completo", price: 49700, cycle: "MONTHLY" },
    ilimitado_v2: { id: "prod_ilim", externalId: "ilimitado_v2", price: 99700, cycle: "MONTHLY" },
  };
  (await import("@/lib/billing/abacatepay")).limparCacheDeProdutos();
  cenario();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
describe("regras puras", () => {
  it("fim do periodo: pagamento + ciclo + a folga das retentativas, sem pular mes", async () => {
    const { fimDoPeriodo } = await import("../src/lib/billing/abacatepay-regras");
    // 3 tentativas de 2 em 2 dias = 6 dias de folga.
    expect(fimDoPeriodo("2026-10-27T12:00:00.000Z", "MONTHLY")).toBe("2026-12-03T12:00:00.000Z");
    expect(fimDoPeriodo("2026-01-31T10:00:00.000Z", "MONTHLY", 0)).toBe("2026-02-28T10:00:00.000Z");
    expect(fimDoPeriodo("2026-10-27T12:00:00.000Z", "WEEKLY", 0)).toBe("2026-11-03T12:00:00.000Z");
    expect(fimDoPeriodo("2026-10-27T12:00:00.000Z", "ANNUALLY", 0)).toBe("2027-10-27T12:00:00.000Z");
    expect(fimDoPeriodo("nao e data", "MONTHLY")).toBeNull();
  });

  it("status do Pix no vocabulario da janela do QR", async () => {
    const { statusDoPix } = await import("../src/lib/billing/abacatepay-regras");
    expect(["PAID", "EXPIRED", "CANCELLED", "REFUNDED", "PENDING", "?", "APPROVED"].map(statusDoPix)).toEqual([
      "paid",
      "expired",
      "canceled",
      "refunded",
      "pending",
      "pending",
      "paid",
    ]);
  });

  it("externalId: conta, plano e hora; volta inteiro, inclusive o plano com _", async () => {
    const { externalIdDaAssinatura, contaDoExternalId } = await import("../src/lib/billing/abacatepay-regras");
    const id = externalIdDaAssinatura(USER, "ilimitado_v2", AGORA);
    expect(contaDoExternalId(id)).toEqual({ userId: USER, plano: "ilimitado_v2" });
    // Mesma hora = mesmo id (reaproveita o checkout); hora seguinte, outro.
    expect(externalIdDaAssinatura(USER, "completo", AGORA + 10 * 60e3)).toBe(
      externalIdDaAssinatura(USER, "completo", AGORA)
    );
    expect(externalIdDaAssinatura(USER, "completo", AGORA + 61 * 60e3)).not.toBe(
      externalIdDaAssinatura(USER, "completo", AGORA)
    );
    expect(contaDoExternalId("pedido-123")).toBeNull();
    expect(contaDoExternalId(null)).toBeNull();
  });

  it("evento de assinatura: ativa, renova so para frente, atrasa, cancela ate o fim", async () => {
    const { decidirEventoDeAssinatura } = await import("../src/lib/billing/abacatepay-regras");
    const vazio = { abacatepay_subscription_id: null, subscription_status: null, current_period_end: null, plano: null };
    const sub = { id: "subs_1", status: "ACTIVE", amount: 49700, method: "CARD" };

    const ativa = decidirEventoDeAssinatura(vazio, "subscription.completed", sub, { pagoEm: "2026-10-27T12:00:00Z", clienteId: "cust_1" }, AGORA);
    expect(ativa.patch).toMatchObject({
      payment_provider: "abacatepay",
      abacatepay_subscription_id: "subs_1",
      abacatepay_customer_id: "cust_1",
      subscription_status: "active",
      subscription_method: "card",
      plan: "pro",
      plano: "completo",
      current_period_end: "2026-12-03T12:00:00.000Z",
    });
    expect(ativa.reporCreditosAte).toBe("2026-12-03T12:00:00.000Z");

    // Na API ainda nao ativa (ou ja cancelada): nada.
    expect(decidirEventoDeAssinatura(vazio, "subscription.completed", { ...sub, status: "CANCELLED" }, {}, AGORA).aplicar).toBe(false);

    const comAssinatura = {
      abacatepay_subscription_id: "subs_1",
      subscription_status: "active",
      current_period_end: "2026-12-03T12:00:00.000Z",
      plano: "roteamento",
    };
    // Renovacao: o fim anda, e o tier que o suporte gravou fica.
    const renovou = decidirEventoDeAssinatura(comAssinatura, "subscription.renewed", sub, { pagoEm: "2026-11-27T12:00:00Z" }, AGORA);
    expect(renovou.patch?.current_period_end).toBe("2027-01-02T12:00:00.000Z");
    expect(renovou.patch).not.toHaveProperty("plano");
    // Aviso velho (pagamento de antes) nao puxa o fim para tras nem repoe creditos.
    const velho = decidirEventoDeAssinatura(comAssinatura, "subscription.renewed", sub, { pagoEm: "2026-09-27T12:00:00Z" }, AGORA);
    expect(velho.patch?.current_period_end).toBe("2026-12-03T12:00:00.000Z");
    expect(velho.reporCreditosAte).toBeNull();
    // Outra assinatura viva na conta: nao mexe.
    expect(decidirEventoDeAssinatura(comAssinatura, "subscription.completed", { ...sub, id: "subs_2" }, {}, AGORA).aplicar).toBe(false);

    expect(decidirEventoDeAssinatura(comAssinatura, "subscription.payment_failed", sub, {}, AGORA).patch).toEqual({
      subscription_status: "past_due",
    });
    expect(decidirEventoDeAssinatura(comAssinatura, "subscription.cancelled", sub, {}, AGORA).patch).toEqual({
      subscription_status: "cancel_scheduled",
      cancel_at_period_end: true,
    });
    // Cancelada depois do fim: cai na hora.
    expect(
      decidirEventoDeAssinatura({ ...comAssinatura, current_period_end: "2026-10-01T00:00:00Z" }, "subscription.cancelled", sub, {}, AGORA).patch
    ).toMatchObject({ subscription_status: "canceled", plan: "free" });
    // Cancelamento de OUTRA assinatura nunca derruba a do perfil.
    expect(decidirEventoDeAssinatura(comAssinatura, "subscription.cancelled", { ...sub, id: "subs_velha" }, {}, AGORA).aplicar).toBe(false);
    // Pix Automatico.
    expect(decidirEventoDeAssinatura(vazio, "subscription.completed", { ...sub, method: "PIX" }, {}, AGORA).patch?.subscription_method).toBe("pix");
  });

  it("a porta: Pix avulso e cancelada vencem no fim; a assinatura viva nao vence por data", async () => {
    const { profileHasAccess } = await import("../src/lib/billing/access");
    const base = { plan: "pro", payment_provider: "abacatepay", is_admin: false, access_granted: false };
    const passou = "2026-10-20T00:00:00Z";
    const falta = "2026-11-20T00:00:00Z";
    expect(profileHasAccess({ ...base, current_period_end: falta })).toBe(true);
    expect(profileHasAccess({ ...base, current_period_end: passou })).toBe(false);
    expect(profileHasAccess({ ...base, abacatepay_subscription_id: "subs_1", subscription_status: "cancel_scheduled", current_period_end: falta })).toBe(true);
    expect(profileHasAccess({ ...base, abacatepay_subscription_id: "subs_1", subscription_status: "cancel_scheduled", current_period_end: passou })).toBe(false);
    expect(profileHasAccess({ ...base, abacatepay_subscription_id: "subs_1", subscription_status: "active", current_period_end: passou })).toBe(true);
    // A Pagou segue com a regra dela.
    expect(profileHasAccess({ ...base, payment_provider: "pagou", pagou_subscription_id: "sub_x", current_period_end: passou })).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("cliente da API", () => {
  it("success:false vira erro com a mensagem; 401/403 nossos viram 502 para a tela", async () => {
    const { conferirPix, respostaDoErroAbacate, AbacatePayError } = await import("../src/lib/billing/abacatepay");
    api.falhar = { status: 200, corpo: { data: null, success: false, error: "Esta cobrança já foi reembolsada." } };
    await expect(conferirPix("pix_char_1")).rejects.toMatchObject({ status: 400, message: "Esta cobrança já foi reembolsada." });
    api.falhar = { status: 403, corpo: { data: null, success: false, error: "Insufficient permissions" } };
    const erro = await conferirPix("pix_char_1").catch((e) => e);
    expect(erro).toBeInstanceOf(AbacatePayError);
    expect(respostaDoErroAbacate(erro)).toEqual({ status: 502, error: expect.stringContaining("recusou") });
    // A chave vai no header.
    const init = fetchFalso.mock.calls.at(-1)?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer abc_dev_teste");
  });

  it("webhook: o secret da URL e o HMAC do corpo", async () => {
    const { corpoDoWebhookIntegro, segredoDoWebhookValido, CHAVE_PUBLICA_WEBHOOK } = await import("../src/lib/billing/abacatepay");
    const corpo = '{"id":"log_1","event":"transparent.completed"}';
    const assinatura = createHmac("sha256", CHAVE_PUBLICA_WEBHOOK).update(corpo).digest("base64");
    expect(corpoDoWebhookIntegro(corpo, assinatura)).toBe(true);
    expect(corpoDoWebhookIntegro(corpo + " ", assinatura)).toBe(false);
    expect(corpoDoWebhookIntegro(corpo, null)).toBe(false);
    expect(segredoDoWebhookValido(SEGREDO)).toBe(true);
    expect(segredoDoWebhookValido("outro")).toBe(false);
    expect(segredoDoWebhookValido(null)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
async function webhook(corpo: Record<string, unknown>, opts: { segredo?: string | null; assinar?: boolean } = {}) {
  const { POST } = await import("@/app/api/billing/abacatepay/webhook/route");
  const { CHAVE_PUBLICA_WEBHOOK } = await import("../src/lib/billing/abacatepay");
  const cru = JSON.stringify(corpo);
  const segredo = opts.segredo === undefined ? SEGREDO : opts.segredo;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.assinar !== false) {
    headers["x-webhook-signature"] = createHmac("sha256", CHAVE_PUBLICA_WEBHOOK).update(cru).digest("base64");
  }
  const url = `https://user.xcart.app/api/billing/abacatepay/webhook${segredo ? `?webhookSecret=${segredo}` : ""}`;
  return POST(new NextRequest(url, { method: "POST", body: cru, headers }));
}

const COMPRA_PENDENTE = {
  id: "cp_1",
  user_id: USER,
  abacatepay_charge_id: "pix_char_abc",
  provider: "abacatepay",
  kind: "credits",
  status: "pending",
};

const pixPago = (id = "log_pix_1") => ({
  id,
  event: "transparent.completed",
  apiVersion: 2,
  devMode: true,
  data: { transparent: { id: "pix_char_abc", status: "PAID", amount: 2500 } },
});

const assinaturaAtiva = (evento = "subscription.completed", id = "log_sub_1") => ({
  id,
  event: evento,
  apiVersion: 2,
  devMode: true,
  data: {
    subscription: { id: "subs_1", amount: 49700, status: "ACTIVE", method: "CARD", frequency: "MONTHLY" },
    customer: { id: "cust_1" },
    payment: { id: "char_1", createdAt: "2026-10-27T12:00:00.000Z" },
    checkout: { id: "bill_1", externalId: `xc_${USER}_completo_490000` },
  },
});

describe("webhook da AbacatePay", () => {
  it("sem o secret certo ou sem o HMAC: 401, sem tocar em nada", async () => {
    cenario({}, [COMPRA_PENDENTE]);
    expect((await webhook(pixPago(), { segredo: null })).status).toBe(401);
    expect((await webhook(pixPago(), { segredo: "chute" })).status).toBe(401);
    expect((await webhook(pixPago(), { assinar: false })).status).toBe(401);
    expect(banco.tabelas.payment_events).toEqual([]);
    expect(rpcs).toEqual([]);
  });

  it("Pix pago: confere na API e aplica uma vez; o reenvio do mesmo evento nao aplica de novo", async () => {
    cenario({}, [COMPRA_PENDENTE]);
    api.pixStatus = "PAID";
    expect((await webhook(pixPago())).status).toBe(200);
    expect(rpcs).toEqual([{ nome: "apply_paid_charge", args: { p_charge_id: "pix_char_abc" } }]);
    expect(api.chamadas.map((c) => c.caminho)).toEqual(["/transparents/check"]);
    const r = await webhook(pixPago());
    expect(await r.json()).toMatchObject({ duplicate: true });
    expect(rpcs).toHaveLength(1);
  });

  it("aviso de Pix pago que a API desmente nao aplica; Pix que nao e nosso e ignorado", async () => {
    cenario({}, [COMPRA_PENDENTE]);
    api.pixStatus = "PENDING";
    expect((await webhook(pixPago())).status).toBe(200);
    expect(rpcs).toEqual([]);
    cenario({}, []);
    expect((await webhook(pixPago("log_pix_2"))).status).toBe(200);
    expect(api.chamadas.filter((c) => c.caminho === "/transparents/check")).toHaveLength(1);
  });

  it("assinatura ativa: o Pro liga pelo externalId, com o fim do periodo e os creditos", async () => {
    api.assinatura = { id: "subs_1", status: "ACTIVE", amount: 49700, method: "CARD", customerId: "cust_1" };
    expect((await webhook(assinaturaAtiva())).status).toBe(200);
    expect(perfil()).toMatchObject({
      payment_provider: "abacatepay",
      abacatepay_subscription_id: "subs_1",
      abacatepay_customer_id: "cust_1",
      subscription_status: "active",
      subscription_method: "card",
      plan: "pro",
      plano: "completo",
      current_period_end: "2026-12-03T12:00:00.000Z",
    });
    expect(rpcs).toEqual([
      { nome: "reset_ai_credits", args: expect.objectContaining({ p_user_id: USER, p_period_end: "2026-12-03T12:00:00.000Z" }) },
    ]);
  });

  it("a conta tambem sai do payment.externalId (o exemplo da doc traz o do checkout nulo)", async () => {
    api.assinatura = { id: "subs_1", status: "ACTIVE", amount: 19700, method: "CARD" };
    const corpo = assinaturaAtiva("subscription.completed", "log_sub_pay");
    (corpo.data as Record<string, unknown>).checkout = { id: "bill_1", externalId: null };
    (corpo.data as Record<string, unknown>).payment = {
      id: "char_1",
      externalId: `xc_${USER}_roteamento_490000`,
      createdAt: "2026-10-27T12:00:00.000Z",
    };
    (corpo.data as Record<string, unknown>).customer = { id: "cust_desconhecido" };
    expect((await webhook(corpo)).status).toBe(200);
    expect(perfil()).toMatchObject({ plan: "pro", plano: "roteamento", abacatepay_subscription_id: "subs_1" });
  });

  it("cancelada: o Pro fica ate o fim ja pago", async () => {
    cenario({
      plan: "pro",
      plano: "completo",
      payment_provider: "abacatepay",
      abacatepay_subscription_id: "subs_1",
      subscription_status: "active",
      current_period_end: "2026-12-03T12:00:00.000Z",
    });
    api.assinatura = { id: "subs_1", status: "CANCELLED", amount: 49700, method: "CARD" };
    const corpo = assinaturaAtiva("subscription.cancelled", "log_cancel");
    expect((await webhook(corpo)).status).toBe(200);
    expect(perfil()).toMatchObject({
      plan: "pro",
      subscription_status: "cancel_scheduled",
      cancel_at_period_end: true,
      current_period_end: "2026-12-03T12:00:00.000Z",
    });
  });

  it("falha ao reler na API: 500, e o reenvio do mesmo evento processa", async () => {
    api.falhar = { status: 503, corpo: { data: null, success: false, error: "fora" } };
    expect((await webhook(assinaturaAtiva())).status).toBe(500);
    expect(banco.tabelas.payment_events[0]).toMatchObject({ error: "fora" });
    expect(banco.tabelas.payment_events[0].processed_at ?? null).toBeNull();
    api.falhar = null;
    api.assinatura = { id: "subs_1", status: "ACTIVE", amount: 49700, method: "CARD" };
    expect((await webhook(assinaturaAtiva())).status).toBe(200);
    expect(perfil().plan).toBe("pro");
  });
});

// ---------------------------------------------------------------------------
async function postCredits(corpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/billing/credits/route");
  return POST(new NextRequest("https://user.xcart.app/api/billing/credits", { method: "POST", body: JSON.stringify(corpo) }));
}

describe("Pix avulso pela AbacatePay", () => {
  it("recarga de creditos sai sem CPF, e a compra nasce pendente com o id do Pix", async () => {
    const r = await postCredits({ packId: "pack_50" });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      transactionId: "pix_char_abc",
      status: "pending",
      pix: { qrCode: "00020126580014BR.GOV.BCB.PIX", expiresAt: "2026-10-27T13:00:00.000Z" },
    });
    const criado = api.chamadas.find((c) => c.caminho === "/transparents/create")!;
    expect(criado.corpo).toMatchObject({ method: "PIX", data: { amount: 2500, expiresIn: 3600 } });
    // A API recusa o travessao do nome do pacote ("xcart — 50 créditos"): 400 em producao.
    const descricao = String((criado.corpo!.data as Record<string, unknown>).description);
    expect(descricao).not.toMatch(/[^ -ÿ]/);
    expect(descricao).toContain("créditos");
    expect((criado.corpo!.data as Record<string, unknown>).customer).toBeUndefined();
    // metadata so com texto (a AbacatePay recusa numero).
    for (const v of Object.values((criado.corpo!.data as { metadata: Record<string, unknown> }).metadata)) {
      expect(typeof v).toBe("string");
    }
    expect(banco.tabelas.credit_purchases[0]).toMatchObject({
      abacatepay_charge_id: "pix_char_abc",
      provider: "abacatepay",
      status: "pending",
      kind: "credits",
      amount_cents: 2500,
    });
  });

  it("30 dias de plano pedem o CPF; com ele, o Pix sai no nome de quem assina", async () => {
    const sem = await postCredits({ packId: "pro_month", plano: "roteamento" });
    expect(sem.status).toBe(400);
    expect(await sem.json()).toMatchObject({ needsDocument: true });
    expect(api.chamadas).toEqual([]);

    const com = await postCredits({ packId: "pro_month", plano: "roteamento", document: "529.982.247-25" });
    expect(com.status).toBe(200);
    const criado = api.chamadas.find((c) => c.caminho === "/transparents/create")!;
    expect((criado.corpo!.data as Record<string, unknown>).customer).toMatchObject({
      email: "lojista@exemplo.com",
      taxId: "52998224725",
    });
    expect(banco.tabelas.credit_purchases[0]).toMatchObject({ kind: "pro_month", plano: "roteamento", amount_cents: 19700 });
  });

  it("cliente so vai inteiro: com CPF e sem celular no cadastro, o Pix sai sem cliente (o 422 de producao)", async () => {
    cenario({ document_number: "52998224725", telefone: null });
    expect((await postCredits({ packId: "pack_50" })).status).toBe(200);
    const criado = api.chamadas.find((c) => c.caminho === "/transparents/create")!;
    expect((criado.corpo!.data as Record<string, unknown>).customer).toBeUndefined();

    cenario({ document_number: "52998224725", telefone: "(31) 99999-0000" });
    api.chamadas = [];
    await postCredits({ packId: "pack_50" });
    const comCelular = api.chamadas.find((c) => c.caminho === "/transparents/create")!;
    expect((comCelular.corpo!.data as Record<string, unknown>).customer).toEqual({
      name: "Ana Lima",
      email: "lojista@exemplo.com",
      taxId: "52998224725",
      cellphone: "31999990000",
    });
  });

  it("a janela do QR confere pela AbacatePay e aplica com apply_paid_charge", async () => {
    cenario({}, [COMPRA_PENDENTE]);
    const { PATCH } = await import("@/app/api/billing/credits/route");
    const consultar = () =>
      PATCH(new NextRequest("https://user.xcart.app/api/billing/credits", { method: "PATCH", body: JSON.stringify({ transactionId: "pix_char_abc" }) }));
    expect(await (await consultar()).json()).toEqual({ status: "pending", credited: false });
    api.pixStatus = "PAID";
    expect(await (await consultar()).json()).toMatchObject({ status: "paid", credited: true });
    expect(rpcs).toEqual([{ nome: "apply_paid_charge", args: { p_charge_id: "pix_char_abc" } }]);
  });
});

// ---------------------------------------------------------------------------
async function assinar(corpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/billing/subscribe/route");
  return POST(new NextRequest("https://user.xcart.app/api/billing/subscribe", { method: "POST", body: JSON.stringify(corpo) }));
}

describe("assinar pela pagina da AbacatePay", () => {
  it("devolve a url do checkout de assinatura do produto do plano, e volta para a Assinatura", async () => {
    const r = await assinar({ plano: "completo" });
    expect(await r.json()).toEqual({ url: "https://app.abacatepay.com/pay/bill_novo" });
    const criado = api.chamadas.find((c) => c.caminho === "/subscriptions/create")!;
    expect(criado.corpo).toMatchObject({
      items: [{ id: "prod_comp", quantity: 1 }],
      customerId: "cust_novo",
      completionUrl: "https://user.xcart.app/billing?assinatura=ok",
      returnUrl: "https://user.xcart.app/billing",
      methods: ["CARD"],
      retryPolicy: { maxRetry: 3, retryEvery: 2 },
      metadata: { user_id: USER, plano: "completo" },
    });
    const { contaDoExternalId } = await import("../src/lib/billing/abacatepay-regras");
    expect(contaDoExternalId(criado.corpo!.externalId)).toEqual({ userId: USER, plano: "completo" });
    expect(perfil().abacatepay_customer_id).toBe("cust_novo");
  });

  it("do paywall volta para o paywall; com Pix Automatico liberado, o checkout aceita PIX", async () => {
    process.env.NEXT_PUBLIC_ABACATEPAY_PIX_AUTOMATICO = "1";
    await assinar({ plano: "roteamento", volta: "paywall" });
    const criado = api.chamadas.find((c) => c.caminho === "/subscriptions/create")!;
    expect(criado.corpo).toMatchObject({
      completionUrl: "https://user.xcart.app/no-access?assinatura=ok",
      methods: ["CARD", "PIX"],
    });
  });

  it("o checkout pendente da mesma hora e reaproveitado: nada de segunda pagina", async () => {
    api.checkoutPendente = { id: "bill_antigo", url: "https://app.abacatepay.com/pay/bill_antigo", status: "PENDING" };
    expect(await (await assinar({ plano: "completo" })).json()).toMatchObject({
      url: "https://app.abacatepay.com/pay/bill_antigo",
      reaproveitado: true,
    });
    expect(api.chamadas.some((c) => c.caminho === "/subscriptions/create")).toBe(false);
  });

  it("produto com outro preco que o de plans.ts: recusa, nao vende pelo valor errado", async () => {
    api.produtos.completo = { id: "prod_comp", externalId: "completo", price: 9700, cycle: "MONTHLY" };
    const r = await assinar({ plano: "completo" });
    expect(r.status).toBe(503);
    expect(api.chamadas.some((c) => c.caminho === "/subscriptions/create")).toBe(false);
  });

  it("quem ja assina nao assina de novo", async () => {
    cenario({ payment_provider: "abacatepay", abacatepay_subscription_id: "subs_1", subscription_status: "active" });
    expect((await assinar({ plano: "completo" })).status).toBe(409);
    expect(api.chamadas).toEqual([]);
  });
});

describe("cancelar pela tela", () => {
  it("cancela na AbacatePay e o Pro fica ate o fim ja pago", async () => {
    cenario({
      plan: "pro",
      plano: "completo",
      payment_provider: "abacatepay",
      abacatepay_subscription_id: "subs_1",
      subscription_status: "active",
      current_period_end: "2026-12-03T12:00:00.000Z",
    });
    api.assinatura = { id: "subs_1", status: "ACTIVE", amount: 49700, method: "CARD" };
    const { DELETE } = await import("@/app/api/billing/subscription/route");
    const r = await DELETE();
    expect(await r.json()).toMatchObject({ status: "cancel_scheduled", accessUntil: "2026-12-03T12:00:00.000Z" });
    expect(api.chamadas.map((c) => c.caminho)).toEqual(["/subscriptions/cancel"]);
    expect(perfil()).toMatchObject({ plan: "pro", subscription_status: "cancel_scheduled", cancel_at_period_end: true });
  });
});
