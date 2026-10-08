import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import { CHECKOUT_DE_EXEMPLO, DADOS_DO_COMPRADOR } from "./_checkout-de-exemplo";

// checkouts/create na VITRINE: o comprador escapou da rota. O handler grava
// um evento "checkout_na_vitrine" so com os itens, uma vez por checkout, e
// nunca na loja que tambem recebe carrinho de outra rota.

vi.mock("server-only", () => ({}));
// sensores.ts importa o cliente da Shopify (para a conferencia dos webhooks),
// que este caminho nao usa.
vi.mock("@/lib/shopify/client", () => ({ ensureWebhook: vi.fn(), shopifyGraphQL: vi.fn() }));

let banco: FakeSupabase;
let falharEvento = false;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.client }));

const { POST } = await import("@/app/api/shopify/webhooks/route");

const SEGREDO = "shpss_vitrine";
const VITRINE = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "22222222-2222-4222-8222-222222222222";
const ROTA = "33333333-3333-4333-8333-333333333333";

function cenario(over: { rotaLigada?: boolean; vitrineTambemCheckout?: boolean } = {}) {
  falharEvento = false;
  banco = fakeSupabase(
    {
      stores: [
        { id: VITRINE, user_id: "u1", name: "NORAH", shop_domain: "r0pxre-p6.myshopify.com", client_secret: SEGREDO, uninstalled_at: null },
      ],
      routed_checkout_configs: [
        {
          id: ROTA,
          user_id: "u1",
          source_store_id: VITRINE,
          target_store_id: CHECKOUT,
          enabled: over.rotaLigada !== false,
          created_at: "2026-09-01T00:00:00Z",
        },
      ],
      routed_checkout_targets: over.vitrineTambemCheckout
        ? [{ id: "t9", target_store_id: VITRINE, enabled: true, route: { enabled: true, user_id: "u1" } }]
        : [{ id: "t1", target_store_id: CHECKOUT, enabled: true, route: { enabled: true, user_id: "u1" } }],
      routed_checkout_fallbacks: [],
      shopify_webhook_events: [],
    },
    (tabela, op) =>
      falharEvento && tabela === "routed_checkout_fallbacks" && op === "insert"
        ? { code: "XX000", message: "banco fora" }
        : null
  );
}

function entrega(corpo: unknown, webhookId: string) {
  const cru = JSON.stringify(corpo);
  return POST(
    new NextRequest("https://user.xcart.app/api/shopify/webhooks", {
      method: "POST",
      body: cru,
      headers: {
        "x-shopify-hmac-sha256": createHmac("sha256", SEGREDO).update(cru, "utf8").digest("base64"),
        "x-shopify-topic": "checkouts/create",
        "x-shopify-shop-domain": "r0pxre-p6.myshopify.com",
        "x-shopify-webhook-id": webhookId,
        "x-shopify-triggered-at": new Date().toISOString(),
      },
    })
  );
}

const escapes = () => banco.tabelas.routed_checkout_fallbacks.filter((l) => l.reason === "checkout_na_vitrine");

beforeEach(() => cenario());

describe("webhook checkouts/create na vitrine", () => {
  it("grava o escape na rota com os itens e nada do comprador", async () => {
    const r = await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, topic: "checkouts/create", escape: true });

    expect(escapes()).toHaveLength(1);
    const [linha] = escapes();
    expect(linha).toMatchObject({
      route_config_id: ROTA,
      target_id: null,
      page_url: null,
      detail: "3 itens: IPOD2008PINK x1 · v49148385 x2",
    });
    const tudoQueFoiGravado = JSON.stringify(banco.inserts);
    for (const pessoal of DADOS_DO_COMPRADOR) expect(tudoQueFoiGravado).not.toContain(pessoal);
    expect(tudoQueFoiGravado).not.toContain("123123123");
  });

  it("o mesmo checkout em outra entrega (outro webhook id) conta uma vez", async () => {
    await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    const r = await entrega(CHECKOUT_DE_EXEMPLO, "wh-2");
    expect(await r.json()).toMatchObject({ ignorado: "checkout ja contado" });
    expect(escapes()).toHaveLength(1);
  });

  it("reentrega do mesmo evento para no marcador de sempre", async () => {
    await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    const r = await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    expect(await r.json()).toMatchObject({ duplicado: true });
    expect(escapes()).toHaveLength(1);
  });

  it("rota desligada nao conta", async () => {
    cenario({ rotaLigada: false });
    const r = await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    expect(await r.json()).toMatchObject({ ignorado: "loja nao e vitrine de rota ligada" });
    expect(escapes()).toHaveLength(0);
  });

  it("loja que tambem e checkout de outra rota nao conta (seria venda, nao escape)", async () => {
    cenario({ vitrineTambemCheckout: true });
    const r = await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    expect(await r.json()).toMatchObject({ ignorado: "loja tambem e checkout de rota" });
    expect(escapes()).toHaveLength(0);
  });

  it("checkout sem item nao vira escape", async () => {
    const r = await entrega({ token: "t-vazio", line_items: [] }, "wh-1");
    expect(await r.json()).toMatchObject({ ignorado: "checkout sem itens" });
  });

  it("banco fora: 503, e as travas saem para a reentrega contar", async () => {
    falharEvento = true;
    const r = await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    expect(r.status).toBe(503);
    expect(banco.tabelas.shopify_webhook_events).toHaveLength(0);

    falharEvento = false;
    const de_novo = await entrega(CHECKOUT_DE_EXEMPLO, "wh-1");
    expect(await de_novo.json()).toMatchObject({ escape: true });
    expect(escapes()).toHaveLength(1);
  });

  it("assinatura de outro segredo e recusada", async () => {
    const cru = JSON.stringify(CHECKOUT_DE_EXEMPLO);
    const r = await POST(
      new NextRequest("https://user.xcart.app/api/shopify/webhooks", {
        method: "POST",
        body: cru,
        headers: {
          "x-shopify-hmac-sha256": createHmac("sha256", "outro").update(cru, "utf8").digest("base64"),
          "x-shopify-topic": "checkouts/create",
          "x-shopify-shop-domain": "r0pxre-p6.myshopify.com",
          "x-shopify-webhook-id": "wh-x",
        },
      })
    );
    expect(r.status).toBe(401);
    expect(escapes()).toHaveLength(0);
  });
});
