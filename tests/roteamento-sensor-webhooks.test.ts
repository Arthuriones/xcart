import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// A conferencia dos webhooks do sensor: orders/create em cada loja de checkout
// ligada, checkouts/create na vitrine de cada rota ligada. Idempotente (le
// antes, so inscreve o que falta), 1x por dia por loja, e o motivo fica
// gravado para a tela quando a loja nao deu read_orders.

vi.mock("server-only", () => ({}));

const ensureWebhook = vi.fn();
const shopifyGraphQL = vi.fn();
vi.mock("@/lib/shopify/client", () => ({
  ensureWebhook: (...a: unknown[]) => ensureWebhook(...a),
  shopifyGraphQL: (...a: unknown[]) => shopifyGraphQL(...a),
}));

process.env.NEXT_PUBLIC_APP_URL = "https://user.xcart.app";
const { conferirWebhooks } = await import("@/lib/checkout-routes/sensores");

const AGORA = Date.parse("2026-10-08T12:00:00Z");
const HORA = 3_600_000;
const ha = (h: number) => new Date(AGORA - h * HORA).toISOString();

type Linha = Record<string, unknown>;

/** Resposta da query do sensor: escopos e inscricoes. */
function loja(escopos: string[], inscricoes: { topic: string; url: string; createdAt?: string }[] = []) {
  return {
    currentAppInstallation: { accessScopes: escopos.map((handle) => ({ handle })) },
    webhookSubscriptions: {
      nodes: inscricoes.map((i) => ({
        topic: i.topic,
        createdAt: i.createdAt ?? "2026-09-30T22:04:21Z",
        endpoint: { callbackUrl: i.url },
      })),
    },
  };
}

let banco: FakeSupabase;
function cenario(over: { destinoSettings?: Linha; rotaSettings?: Linha; donoDaLoja?: string; desinstalada?: boolean } = {}) {
  banco = fakeSupabase({
    routed_checkout_configs: [
      {
        id: "rota-1",
        user_id: "u1",
        source_store_id: "vit",
        enabled: true,
        settings: { last_heal: { at: ha(1), ok: true }, theme_sync: { at: ha(1), estado: "ok" }, ...over.rotaSettings },
      },
      { id: "rota-off", user_id: "u1", source_store_id: "vit-off", enabled: false, settings: {} },
    ],
    routed_checkout_targets: [
      {
        id: "t1",
        route_id: "rota-1",
        target_store_id: "chk",
        enabled: true,
        settings: { checkout_country: "BR", ...over.destinoSettings },
      },
      { id: "t-pausado", route_id: "rota-1", target_store_id: "chk-2", enabled: false, settings: {} },
    ],
    stores: [
      { id: "vit", user_id: "u1", shop_domain: "vit.myshopify.com", client_id: "c", client_secret: "s", access_token: null, uninstalled_at: null },
      {
        id: "chk",
        user_id: over.donoDaLoja ?? "u1",
        shop_domain: "chk.myshopify.com",
        client_id: "c",
        client_secret: "s",
        access_token: null,
        uninstalled_at: over.desinstalada ? ha(10) : null,
      },
    ],
  });
}

const settingsDe = (tabela: string, id: string) =>
  (banco.tabelas[tabela].find((l) => l.id === id)?.settings ?? {}) as Linha;

beforeEach(() => {
  ensureWebhook.mockReset();
  shopifyGraphQL.mockReset();
  ensureWebhook.mockResolvedValue({ ok: true });
  cenario();
});

describe("conferirWebhooks", () => {
  it("sem read_orders: nao tenta inscrever e grava o motivo para a tela", async () => {
    shopifyGraphQL.mockResolvedValue(loja(["read_products", "write_themes"]));
    const r = await conferirWebhooks(banco.client, { agora: AGORA });

    expect(ensureWebhook).not.toHaveBeenCalled();
    expect(r).toMatchObject({ lojas: 2, semPermissao: 2, inscritos: 0 });
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toEqual({
      em: new Date(AGORA).toISOString(),
      estado: "sem_permissao",
      motivo: "falta a permissão de pedidos (read_orders) no app da loja",
    });
    expect((settingsDe("routed_checkout_configs", "rota-1").webhook_vitrine as Linha).estado).toBe("sem_permissao");
  });

  it("com read_orders: inscreve orders/create no checkout e checkouts/create na vitrine, no host publico", async () => {
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    await conferirWebhooks(banco.client, { agora: AGORA });

    const chamadas = ensureWebhook.mock.calls.map((c) => [(c[0] as { shopDomain: string }).shopDomain, c[1], c[2]]);
    expect(chamadas).toEqual(
      expect.arrayContaining([
        ["chk.myshopify.com", "ORDERS_CREATE", "https://user.xcart.app/api/shopify/webhooks"],
        ["vit.myshopify.com", "CHECKOUTS_CREATE", "https://user.xcart.app/api/shopify/webhooks"],
      ])
    );
    expect(chamadas).toHaveLength(2);
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toMatchObject({
      estado: "inscrito",
      desde: new Date(AGORA).toISOString(),
    });
  });

  it("ja inscrito (ate em host antigo): nao inscreve de novo e usa o createdAt da Shopify", async () => {
    shopifyGraphQL.mockResolvedValue(
      loja(
        ["read_orders"],
        [
          { topic: "ORDERS_CREATE", url: "https://shopify-creator-chi.vercel.app/api/shopify/webhooks", createdAt: "2026-09-10T04:13:40Z" },
          { topic: "CHECKOUTS_CREATE", url: "https://user.xcart.app/api/shopify/webhooks" },
        ]
      )
    );
    await conferirWebhooks(banco.client, { agora: AGORA });
    expect(ensureWebhook).not.toHaveBeenCalled();
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toMatchObject({
      estado: "inscrito",
      desde: "2026-09-10T04:13:40Z",
    });
  });

  it("mantem o resto do settings (mercado, last_heal, theme_sync)", async () => {
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    await conferirWebhooks(banco.client, { agora: AGORA });
    expect(settingsDe("routed_checkout_targets", "t1").checkout_country).toBe("BR");
    const rota = settingsDe("routed_checkout_configs", "rota-1");
    expect(rota.last_heal).toBeTruthy();
    expect(rota.theme_sync).toBeTruthy();
  });

  it("no maximo 1x por dia: conferido ha 2 h nao chama a Shopify", async () => {
    const recente = { em: ha(2), estado: "sem_permissao", motivo: "x" };
    cenario({ destinoSettings: { webhook_pedidos: recente }, rotaSettings: { webhook_vitrine: recente } });
    const r = await conferirWebhooks(banco.client, { agora: AGORA });
    expect(shopifyGraphQL).not.toHaveBeenCalled();
    expect(r.lojas).toBe(0);
  });

  it("'Testar agora' reconfere so o que esta pendente", async () => {
    cenario({
      destinoSettings: { webhook_pedidos: { em: ha(2), estado: "sem_permissao" } },
      rotaSettings: { webhook_vitrine: { em: ha(2), estado: "inscrito", desde: ha(500) } },
    });
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    await conferirWebhooks(banco.client, { agora: AGORA, rotaId: "rota-1", reconferirPendentes: true });
    expect(ensureWebhook).toHaveBeenCalledTimes(1);
    expect(ensureWebhook.mock.calls[0][1]).toBe("ORDERS_CREATE");
  });

  it("rota desligada e loja de checkout pausada ficam de fora", async () => {
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    await conferirWebhooks(banco.client, { agora: AGORA });
    const lojas = shopifyGraphQL.mock.calls.map((c) => (c[0] as { shopDomain: string }).shopDomain).sort();
    expect(lojas).toEqual(["chk.myshopify.com", "vit.myshopify.com"]);
  });

  it("loja de outro dono nao e tocada", async () => {
    cenario({ donoDaLoja: "outro" });
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    await conferirWebhooks(banco.client, { agora: AGORA });
    const lojas = shopifyGraphQL.mock.calls.map((c) => (c[0] as { shopDomain: string }).shopDomain);
    expect(lojas).toEqual(["vit.myshopify.com"]);
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toBeUndefined();
  });

  it("app removido: grava loja_fora sem chamar a Shopify", async () => {
    cenario({ desinstalada: true });
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"], [{ topic: "CHECKOUTS_CREATE", url: "https://user.xcart.app/api/shopify/webhooks" }]));
    await conferirWebhooks(banco.client, { agora: AGORA });
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toMatchObject({
      estado: "loja_fora",
      motivo: "app removido da loja",
    });
    expect(shopifyGraphQL).toHaveBeenCalledTimes(1);
  });

  it("Shopify fora nao lanca: vira estado na tela", async () => {
    shopifyGraphQL.mockRejectedValue(new Error("Shopify API error: 402 Payment Required"));
    const r = await conferirWebhooks(banco.client, { agora: AGORA });
    expect(r.foraDoAr).toBe(2);
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toMatchObject({
      estado: "loja_fora",
      motivo: "loja pausada ou sem plano na Shopify",
    });
  });

  it("inscricao recusada por dado protegido fica como sem permissao", async () => {
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    ensureWebhook.mockResolvedValue({ ok: false, message: "This app is not approved to subscribe to webhook topics containing protected customer data." });
    await conferirWebhooks(banco.client, { agora: AGORA });
    expect(settingsDe("routed_checkout_targets", "t1").webhook_pedidos).toMatchObject({ estado: "sem_permissao" });
  });

  it("limite de lojas por passada: a mais tempo sem conferir primeiro", async () => {
    cenario({ rotaSettings: { webhook_vitrine: { em: ha(30), estado: "inscrito" } } });
    shopifyGraphQL.mockResolvedValue(loja(["read_orders"]));
    await conferirWebhooks(banco.client, { agora: AGORA, limiteLojas: 1 });
    expect(shopifyGraphQL).toHaveBeenCalledTimes(1);
    // A loja de checkout nunca foi conferida: vai antes da vitrine (30 h).
    expect((shopifyGraphQL.mock.calls[0][0] as { shopDomain: string }).shopDomain).toBe("chk.myshopify.com");
  });
});
