import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import { idDoEventoDoCheckout } from "../src/lib/tracking/eventos";
import { hashDoIp } from "../src/lib/tracking/ip-balde";
import {
  caminhoEhEndpoint,
  horaDoCheckoutDeGarantia,
  idDoCheckoutDeGarantia,
  montarCheckoutDeGarantia,
  montarCheckoutDeGarantiaTiktok,
  montarPurchase,
  montarPurchaseTiktok,
  type PedidoShopify,
} from "../src/lib/tracking/purchase";

// ============================================================================
// IC de garantia: todo pedido que vira Purchase leva um InitiateCheckout.
//
// O caso real e o #1016 da Softnook: pago com Shop Pay em shop.app, onde o Web
// Pixel nao roda, e o clique do tema descartado como "checkout coberto pelo
// Web Pixel". Chegou ao Meta 1 compra e 0 Finalizacoes de compra. O que este
// arquivo trava, rodando o webhook, o coletor e o cron DE VERDADE contra um
// banco em memoria:
//
//   1. pedido sem IC sai com um IC antes da compra (fila e event_time), com o
//      user_data, o valor e os itens da compra;
//   2. o IC do Web Pixel do mesmo checkout (mesmo id) nunca dobra, chegue antes
//      ou depois do webhook;
//   3. o expresso pendente conta como "ja teve", e o cron manda so ele;
//   4. sem checkout_token (COD) o id e por pedido; o TikTok recebe o dele;
//   5. chegada que e endpoint (/cart/add.js) vira a pagina do comprador, ou a
//      raiz;
//   6. reentrega do webhook nao manda nada de novo.
// ============================================================================

vi.mock("server-only", () => ({}));
// O webhook agenda trabalho para depois da resposta (origem do pedido, celular).
// Fora de uma requisicao do Next, `after` lanca; aqui ele so nao roda.
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => {},
}));

let banco: FakeSupabase;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.client }));

const mundo = vi.hoisted(() => ({
  destinos: [] as Record<string, unknown>[],
  /** O que chegou a cada plataforma, na ordem em que foi chamada. */
  saiu: [] as { plataforma: "meta" | "tiktok"; evento: Record<string, unknown> }[],
}));

vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => mundo.destinos,
  destinoPorId: async (_a: unknown, id: string) => mundo.destinos.find((d) => d.id === id) ?? null,
  destinoAceita: () => true,
  porQueRecusa: () => "",
}));
vi.mock("@/lib/tracking/meta-capi", () => ({
  enviarParaMeta: async (_pixel: string, _token: string, eventos: Record<string, unknown>[]) => {
    for (const evento of eventos) mundo.saiu.push({ plataforma: "meta", evento });
    return { ok: true, status: 200, podeTentarDeNovo: false, corpo: {} };
  },
}));
vi.mock("@/lib/tracking/tiktok-api", () => ({
  enviarParaTiktok: async (_pixel: string, _token: string, eventos: Record<string, unknown>[]) => {
    for (const evento of eventos) mundo.saiu.push({ plataforma: "tiktok", evento });
    return { ok: true, corpo: { code: 0 }, podeTentarDeNovo: false };
  },
}));

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "kphigm-76.myshopify.com";
const SEGREDO = "shpss_softnook";
const PUBLICA = "https://softnook.test";
const VID = "mvd8jkt7.7fkulba7";
const CID = "b1c2d3e4-0000-4000-8000-00000000c1d0";
const TOKEN = "c1d2e3f4a5b6c7d8e9f0a1b2c3d4e5f6";
const FBC = "fb.1.1760756000000.IwAR-anuncio";
const IP = "203.0.113.9";
const MIN = 60e3;
// O webhook do #1016 chegou 45 s depois do pedido.
const AGORA = Date.parse("2026-10-18T03:01:22Z");

const META = {
  id: "dest-meta-0001",
  storeId: STORE,
  plataforma: "meta",
  nome: null,
  conta: "123456",
  labels: {},
  testEventCode: null,
  idTemplate: null,
  ativo: true,
  token: "EAAB",
};
const TIKTOK = { ...META, id: "dest-ttk-0001", plataforma: "tiktok", conta: "CABC123", token: "tt" };

const PEDIDO: PedidoShopify = {
  id: 18948568449101,
  order_number: 1016,
  email: "comprador@exemplo.com",
  currency: "USD",
  total_price: "96.18",
  created_at: "2026-10-18T03:00:37Z",
  processed_at: "2026-10-18T03:00:31Z",
  browser_ip: IP,
  // O AJAX do carrinho, nao uma pagina: e o que a Shopify gravou no #1016.
  landing_site: "/cart/add.js",
  checkout_token: TOKEN,
  order_status_url: `${PUBLICA}/72681816141/orders/abc123/authenticate?key=k`,
  source_name: "web",
  customer: { id: 7001, email: "comprador@exemplo.com", first_name: "Ana", last_name: "Lima" },
  billing_address: { first_name: "Ana", last_name: "Lima", city: "Toronto", zip: "M5V 2T6", country_code: "CA" },
  client_details: { browser_ip: IP, user_agent: "Mozilla/5.0 (iPhone)" },
  note_attributes: [
    { name: "_xc_vid", value: VID },
    { name: "_fbc", value: FBC },
    { name: "_fbp", value: "fb.1.1760755000000.222" },
    { name: "_xc_consent", value: "concedido" },
  ],
  line_items: [{ product_id: 9001, variant_id: 9011, sku: "MANTA-G", quantity: 1, price: "96.18" }],
};

type Linha = Record<string, unknown>;

/** Uma linha do funil que o coletor teria gravado para o visitante. */
function linhaDoFunil(over: Linha): Linha {
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    store_id: STORE,
    destination: "meta",
    destination_id: META.id,
    order_id: null,
    checkout_token: null,
    status: "enviado",
    attempts: 1,
    next_attempt_at: new Date(AGORA - 5 * MIN).toISOString(),
    sent_at: new Date(AGORA - 5 * MIN).toISOString(),
    created_at: new Date(AGORA - 5 * MIN).toISOString(),
    ...over,
  };
}

/** O add_to_cart do #1016, na pagina do produto. */
const ADD_TO_CART = () =>
  linhaDoFunil({
    event_name: "add_to_cart",
    event_id: `add_to_cart_${VID}_1`,
    visitor_id: VID,
    created_at: "2026-10-18T03:00:16Z",
    payload: { event_name: "AddToCart", event_source_url: `${PUBLICA}/products/blanket?variant=9011&fbclid=x` },
  });

function cenario(over: { eventos?: Linha[]; identidades?: Linha[]; falhar?: Parameters<typeof fakeSupabase>[1] } = {}) {
  banco = fakeSupabase(
    {
      stores: [
        { id: STORE, user_id: "u1", name: "Softnook", shop_domain: SHOP, client_secret: SEGREDO, uninstalled_at: null },
      ],
      tracking_configs: [
        {
          store_id: STORE,
          enabled: true,
          // Pixel visto ha 10 min: cobrindo o checkout, como na Softnook.
          web_pixel_visto_em: new Date(AGORA - 10 * MIN).toISOString(),
          web_pixel_com_id_em: new Date(AGORA - 10 * MIN).toISOString(),
          teto_atingido_em: null,
        },
      ],
      tracking_identities: over.identidades ?? [
        {
          store_id: STORE,
          visitor_id: VID,
          shopify_client_id: CID,
          fbc: FBC,
          fbp: "fb.1.1760755000000.222",
          updated_at: new Date(AGORA - 2 * MIN).toISOString(),
        },
      ],
      tracking_checkouts: [],
      tracking_events: over.eventos ?? [ADD_TO_CART()],
      shopify_webhook_events: [],
      routed_checkout_orders: [],
    },
    over.falhar
  );
}

async function webhook(pedido: PedidoShopify = PEDIDO, webhookId = "wh-1") {
  const { POST } = await import("@/app/api/shopify/webhooks/route");
  const cru = JSON.stringify(pedido);
  const r = await POST(
    new NextRequest("https://user.xcart.app/api/shopify/webhooks", {
      method: "POST",
      body: cru,
      headers: {
        "x-shopify-hmac-sha256": createHmac("sha256", SEGREDO).update(cru, "utf8").digest("base64"),
        "x-shopify-topic": "orders/create",
        "x-shopify-shop-domain": SHOP,
        "x-shopify-webhook-id": webhookId,
        "x-shopify-triggered-at": new Date(Date.parse(pedido.created_at || "") || Date.now()).toISOString(),
      },
    })
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

async function coletor(corpo: Record<string, unknown>) {
  const { POST } = await import("@/app/api/tracking/collect/route");
  const r = await POST(
    new NextRequest("https://user.xcart.app/api/tracking/collect", {
      method: "POST",
      body: JSON.stringify({ shop: SHOP, storeId: STORE, ...corpo }),
      headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": "Mozilla/5.0 (iPhone)", "x-forwarded-for": IP },
    })
  );
  return (await r.json()) as Record<string, unknown>;
}

async function drenar(emMs: number) {
  vi.setSystemTime(emMs);
  const { drenarFila } = await import("../src/lib/tracking/fila");
  return drenarFila();
}

const GARANTIA = idDoEventoDoCheckout("begin_checkout", TOKEN);
const fila = () => banco.tabelas.tracking_events;
const linha = (eventId: string, destino = META.id) =>
  fila().find((l) => l.event_id === eventId && l.destination_id === destino);
const nomes = (plataforma = "meta") =>
  mundo.saiu.filter((s) => s.plataforma === plataforma).map((s) => String(s.evento.event_name ?? s.evento.event));
const ics = (plataforma = "meta") => nomes(plataforma).filter((n) => n === "InitiateCheckout");

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(AGORA);
  mundo.destinos = [META];
  mundo.saiu.length = 0;
  cenario();
});
afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
describe("IC de garantia: regras puras", () => {
  it("o id e o do Web Pixel quando ha checkout_token; sem ele, um por pedido", () => {
    expect(idDoCheckoutDeGarantia(PEDIDO)).toBe(`begin_checkout_ck_${TOKEN}`);
    // O coletor corta e apara o token do mesmo jeito.
    expect(idDoCheckoutDeGarantia({ id: 1, checkout_token: `  ${TOKEN} ` })).toBe(GARANTIA);
    expect(idDoCheckoutDeGarantia({ id: 5544, checkout_token: null })).toBe("begin_checkout_pedido_5544");
  });

  it("event_time: um segundo antes do pagamento, sempre antes da compra, nunca no futuro", () => {
    const compra = Math.floor(Date.parse("2026-10-18T03:00:37Z") / 1000);
    expect(horaDoCheckoutDeGarantia(PEDIDO, compra, AGORA)).toBe(
      Math.floor(Date.parse("2026-10-18T03:00:31Z") / 1000) - 1
    );
    // Sem processed_at: um antes da compra.
    expect(horaDoCheckoutDeGarantia({ created_at: PEDIDO.created_at }, compra, AGORA)).toBe(compra - 1);
    // processed_at de dias antes (pedido importado) nao arrasta o IC.
    expect(
      horaDoCheckoutDeGarantia({ created_at: PEDIDO.created_at, processed_at: "2026-10-10T00:00:00Z" }, compra, AGORA)
    ).toBe(compra - 1);
    // Compra "no futuro" (relogio da Shopify adiantado): o IC fica no agora.
    expect(horaDoCheckoutDeGarantia({}, Math.floor(AGORA / 1000) + 600, AGORA)).toBe(Math.floor(AGORA / 1000));
  });

  it("sai da compra: mesmo user_data, valor, moeda, itens e URL; sem order_id e sem segmento", () => {
    const { evento: compra } = montarPurchase(
      { ...PEDIDO, customer: { ...PEDIDO.customer, orders_count: 1 } },
      { dominioLoja: SHOP }
    );
    const ic = montarCheckoutDeGarantia(compra, PEDIDO, AGORA);
    expect(ic.event_name).toBe("InitiateCheckout");
    expect(ic.event_id).toBe(GARANTIA);
    expect(ic.event_time).toBeLessThan(compra.event_time);
    expect(ic.user_data).toEqual(compra.user_data);
    expect(ic.event_source_url).toBe(compra.event_source_url);
    expect(ic.custom_data).toEqual({
      currency: "USD",
      value: 96.18,
      content_type: "product",
      content_ids: ["9011"],
      contents: [{ id: "9011", quantity: 1, item_price: 96.18 }],
      num_items: 1,
    });
    // A compra nao foi tocada.
    expect(compra.event_name).toBe("Purchase");
    expect(compra.custom_data).toMatchObject({ order_id: String(PEDIDO.id), customer_segmentation: "new_customer_to_business" });
  });

  it("TikTok: InitiateCheckout com o mesmo id e page.url da compra, valor so se a compra levou", () => {
    const compra = montarPurchaseTiktok(PEDIDO, { dominioLoja: SHOP });
    const ic = montarCheckoutDeGarantiaTiktok(compra, PEDIDO, AGORA);
    expect(ic).toMatchObject({ event: "InitiateCheckout", event_id: GARANTIA, page: compra.page, user: compra.user });
    expect(ic.properties).toMatchObject({ currency: "USD", value: 96.18, num_items: 1 });
    expect(ic.properties).not.toHaveProperty("order_id");
    expect(compra.properties?.order_id).toBe(String(PEDIDO.id));

    const emCoroa = montarPurchaseTiktok({ ...PEDIDO, currency: "XAF" }, { dominioLoja: SHOP });
    expect(montarCheckoutDeGarantiaTiktok(emCoroa, PEDIDO, AGORA).properties).not.toHaveProperty("value");
  });

  it("endpoint x pagina", () => {
    for (const e of [
      "/cart/add.js",
      "/cart/add",
      "/cart/add?id=1&quantity=1",
      "/en-ca/cart/add",
      "/cart.js",
      "/cart/update.js",
      "/cart/change",
      "/cart/c/Z2NwLXVzLWVhc3Q",
      "/products/manta.js",
      "/recommendations/products.json",
      "/checkouts/cn/hWN4abc/en-ca",
      "/72681816141/checkouts/abc123",
      "/checkout",
      "/wpm@a1b2/custom/web-pixel-1@1/sandbox/modern/checkouts/cn/x",
    ]) {
      expect(caminhoEhEndpoint(e), e).toBe(true);
    }
    for (const p of ["/", "/products/blanket", "/products/blanket?fbclid=x", "/cart", "/cart/9011:1,9012:2", "/collections/all", "/pages/checkout-faq"]) {
      expect(caminhoEhEndpoint(p), p).toBe(false);
    }
  });

  it("event_source_url: endpoint vira a pagina do comprador (sem query), senao a raiz; pagina continua igual", () => {
    const url = (pedido: PedidoShopify, paginas?: string[]) =>
      montarPurchase(pedido, { dominioLoja: SHOP, paginas }).evento.event_source_url;

    expect(url(PEDIDO, [`${PUBLICA}/products/blanket?variant=9011&fbclid=x`])).toBe(`${PUBLICA}/products/blanket`);
    // A mais recente que serve: endpoint e outra origem ficam para tras.
    expect(
      url(PEDIDO, [`${PUBLICA}/checkouts/cn/${TOKEN}`, "https://outra.test/products/x", `${PUBLICA}/collections/mantas`])
    ).toBe(`${PUBLICA}/collections/mantas`);
    expect(url(PEDIDO)).toBe(`${PUBLICA}/`);
    expect(url({ ...PEDIDO, landing_site: `/checkouts/cn/${TOKEN}?email=a@b.c` })).toBe(`${PUBLICA}/`);

    // O que ja funcionava nao muda: pagina de chegada, com a query dela.
    expect(url({ ...PEDIDO, landing_site: "/products/blanket?fbclid=ABC" }, [`${PUBLICA}/outra`])).toBe(
      `${PUBLICA}/products/blanket?fbclid=ABC`
    );
    expect(url({ ...PEDIDO, landing_site: "/cart/9011:1" })).toBe(`${PUBLICA}/cart/9011:1`);

    // O TikTok usa a mesma URL.
    expect(montarPurchaseTiktok(PEDIDO, { dominioLoja: SHOP }).page.url).toBe(`${PUBLICA}/`);
  });
});

// ---------------------------------------------------------------------------
describe("IC de garantia no webhook orders/create", () => {
  it("#1016: sem IC nenhum, o IC entra e sai ANTES da compra, com os dados da compra", async () => {
    const r = await webhook();
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({
      eventId: `purchase_${PEDIDO.id}`,
      destinos: { "meta:dest-met": "enviado" },
      checkoutDeGarantia: { "meta:dest-met": "enviado" },
    });

    const ic = linha(GARANTIA)!;
    const compra = linha(`purchase_${PEDIDO.id}`)!;
    expect(ic).toMatchObject({
      event_name: "begin_checkout",
      order_id: String(PEDIDO.id),
      visitor_id: VID,
      checkout_token: null,
      status: "enviado",
    });
    expect(ic.sent_at).toBeTruthy();
    // Na fila antes da compra, e saiu antes dela.
    expect(fila().indexOf(ic)).toBeLessThan(fila().indexOf(compra));
    expect(nomes()).toEqual(["InitiateCheckout", "Purchase"]);

    const [enviadoIc, enviadaCompra] = mundo.saiu.map((s) => s.evento) as Record<string, Record<string, unknown>>[];
    expect(enviadoIc.event_time).toBe(Math.floor(Date.parse(PEDIDO.processed_at!) / 1000) - 1);
    expect(enviadoIc.event_time).toBeLessThan(enviadaCompra.event_time as unknown as number);
    expect(enviadoIc.event_time as unknown as number).toBeLessThanOrEqual(Math.floor(AGORA / 1000));
    expect(enviadoIc.user_data).toEqual(enviadaCompra.user_data);
    expect(enviadoIc.user_data).toMatchObject({ fbc: FBC });
    const { order_id: _pedido, ...semPedido } = enviadaCompra.custom_data;
    expect(_pedido).toBe(String(PEDIDO.id));
    expect(enviadoIc.custom_data).toEqual(semPedido);
    // A pagina do produto, nao o /cart/add.js -- nos dois.
    expect(enviadoIc.event_source_url).toBe(`${PUBLICA}/products/blanket`);
    expect(enviadaCompra.event_source_url).toBe(`${PUBLICA}/products/blanket`);
  });

  it("reentrega: mesmo webhook para no marcador; outra entrega do mesmo pedido nao manda nada", async () => {
    await webhook();
    const antes = mundo.saiu.length;

    expect((await webhook(PEDIDO, "wh-1")).corpo).toMatchObject({ duplicado: true });
    const outra = await webhook(PEDIDO, "wh-2");
    expect(outra.corpo).toMatchObject({
      destinos: { "meta:dest-met": "duplicado" },
      checkoutDeGarantia: { "meta:dest-met": "já iniciado" },
    });
    expect(mundo.saiu.length).toBe(antes);
    expect(fila().filter((l) => l.event_id === GARANTIA)).toHaveLength(1);
  });

  it("IC do pixel do mesmo checkout ANTES do webhook: nao dobra", async () => {
    // Checkout normal: o pixel manda o IC dele, com o clientId.
    await coletor({ evento: "begin_checkout", fonte: "pixel", eventId: "begin_checkout_e1", visitorId: CID, clientId: CID, checkoutToken: TOKEN });
    expect(ics()).toHaveLength(1);

    const r = await webhook();
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "já iniciado" } });
    expect(ics()).toHaveLength(1);
    expect(nomes()).toEqual(["InitiateCheckout", "Purchase"]);
  });

  it("IC do pixel sem consentimento (visitante = token): a busca nao acha, o mesmo id segura", async () => {
    await coletor({ evento: "begin_checkout", fonte: "pixel", eventId: "begin_checkout_e1", visitorId: TOKEN, clientId: null, checkoutToken: TOKEN });
    expect(linha(GARANTIA)).toMatchObject({ visitor_id: TOKEN, checkout_token: TOKEN });

    const r = await webhook();
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "duplicado" } });
    expect(ics()).toHaveLength(1);
  });

  it("pixel chegando DEPOIS do webhook: o coletor volta duplicado", async () => {
    await webhook();
    expect(ics()).toHaveLength(1);

    vi.setSystemTime(AGORA + 20e3);
    const r = await coletor({ evento: "begin_checkout", fonte: "pixel", eventId: "begin_checkout_e1", visitorId: TOKEN, clientId: null, checkoutToken: TOKEN });
    expect(r).toMatchObject({ destinos: { "meta:dest-met": "duplicado" } });
    expect(ics()).toHaveLength(1);
  });

  it("expresso PENDENTE do tema conta como ja iniciado; o cron manda so ele", async () => {
    vi.setSystemTime(AGORA - 50e3);
    const clique = await coletor({
      evento: "begin_checkout",
      eventId: "begin_checkout_xp_qualquer",
      origem: "expresso",
      visitorId: VID,
      clientId: CID,
      pageUrl: `${PUBLICA}/products/blanket`,
      produtos: [{ variante: "9011" }],
    });
    expect(clique).toMatchObject({ destinos: { "meta:dest-met": "aguardando o pixel" } });

    vi.setSystemTime(AGORA);
    const r = await webhook();
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "já iniciado" } });
    expect(linha(GARANTIA)).toBeUndefined();
    expect(nomes()).toEqual(["Purchase"]);

    expect(await drenar(AGORA + 5 * MIN)).toMatchObject({ enviados: 1 });
    expect(ics()).toHaveLength(1);
    expect(String(mundo.saiu.at(-1)!.evento.event_id)).toMatch(/^begin_checkout_xp_/);
  });

  it("IC do tema ja enviado (pixel sem cobrir): sem garantia", async () => {
    cenario({
      eventos: [ADD_TO_CART(), linhaDoFunil({ event_name: "begin_checkout", event_id: `begin_checkout_${VID}_1`, visitor_id: VID })],
    });
    const r = await webhook();
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "já iniciado" } });
    expect(nomes()).toEqual(["Purchase"]);
  });

  it("cancelado (enviado sem sent_at) e falhou nao contam: a garantia sai", async () => {
    cenario({
      eventos: [
        ADD_TO_CART(),
        linhaDoFunil({ event_name: "begin_checkout", event_id: `begin_checkout_xp_${VID}_1`, visitor_id: VID, sent_at: null }),
        linhaDoFunil({ event_name: "begin_checkout", event_id: `begin_checkout_${VID}_2`, visitor_id: VID, status: "falhou", sent_at: null }),
      ],
    });
    const r = await webhook();
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "enviado" } });
    expect(ics()).toHaveLength(1);
  });

  it("IC de mais de 24 h antes nao conta", async () => {
    cenario({
      eventos: [
        linhaDoFunil({
          event_name: "begin_checkout",
          event_id: `begin_checkout_${VID}_0`,
          visitor_id: VID,
          created_at: new Date(Date.parse(PEDIDO.created_at!) - 25 * 60 * MIN).toISOString(),
        }),
      ],
    });
    expect((await webhook()).corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "enviado" } });
  });

  it("sem checkout_token (app de COD): id por pedido, e a pagina de chegada fica", async () => {
    const cod: PedidoShopify = {
      ...PEDIDO,
      id: 7700112233,
      checkout_token: null,
      processed_at: null,
      landing_site: "/products/blanket?utm_source=fb",
    };
    const r = await webhook(cod);
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "enviado" } });
    const ic = linha("begin_checkout_pedido_7700112233")!;
    expect(ic).toMatchObject({ order_id: "7700112233", checkout_token: null });
    const [enviadoIc, compra] = mundo.saiu.map((s) => s.evento);
    expect(enviadoIc.event_time).toBe((compra.event_time as number) - 1);
    expect(enviadoIc.event_source_url).toBe(`${PUBLICA}/products/blanket?utm_source=fb`);
  });

  it("TikTok e Meta: cada destino recebe o seu IC, com o mesmo id", async () => {
    mundo.destinos = [META, TIKTOK];
    const r = await webhook();
    expect(r.corpo).toMatchObject({
      checkoutDeGarantia: { "meta:dest-met": "enviado", "tiktok:dest-ttk": "enviado" },
    });
    expect(nomes("tiktok")).toEqual(["InitiateCheckout", "Purchase"]);
    const [ic, compra] = mundo.saiu.filter((s) => s.plataforma === "tiktok").map((s) => s.evento) as Record<string, Record<string, unknown>>[];
    expect(ic.event_id).toBe(GARANTIA);
    expect(ic.page).toEqual(compra.page);
    expect(ic.page).toEqual({ url: `${PUBLICA}/products/blanket` });
    expect(ic.properties).toMatchObject({ currency: "USD", value: 96.18 });
    expect(ic.properties).not.toHaveProperty("order_id");
    expect(compra.properties).toMatchObject({ order_id: String(PEDIDO.id) });
    expect(linha(GARANTIA, TIKTOK.id)).toMatchObject({ destination: "tiktok", event_name: "begin_checkout" });
  });

  it("IC so no destino em que o comprador ainda nao teve", async () => {
    mundo.destinos = [META, TIKTOK];
    cenario({
      eventos: [ADD_TO_CART(), linhaDoFunil({ event_name: "begin_checkout", event_id: `begin_checkout_${VID}_1`, visitor_id: VID })],
    });
    const r = await webhook();
    expect(r.corpo).toMatchObject({
      checkoutDeGarantia: { "meta:dest-met": "já iniciado", "tiktok:dest-ttk": "enviado" },
    });
    expect(ics("meta")).toHaveLength(0);
    expect(ics("tiktok")).toHaveLength(1);
  });

  it("compra de teste: o IC fica na fila sem sair, como a compra", async () => {
    const teste = { ...PEDIDO, note_attributes: [...(PEDIDO.note_attributes || []), { name: "_xc_teste", value: "1" }] };
    const r = await webhook(teste);
    expect(r.corpo).toMatchObject({
      destinos: { "meta:dest-met": "teste: nao enviado" },
      checkoutDeGarantia: { "meta:dest-met": "teste: não enviado" },
    });
    expect(mundo.saiu).toEqual([]);
    expect(linha(GARANTIA)).toMatchObject({ status: "enviado", sent_at: null, payload: expect.objectContaining({ teste: true }) });
  });

  it("sem conseguir conferir a fila: nenhum IC, e a compra sai igual", async () => {
    cenario({
      falhar: (tabela, op) =>
        tabela === "tracking_events" && op === "select" ? { code: "XX000", message: "banco fora" } : null,
    });
    const r = await webhook();
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({
      destinos: { "meta:dest-met": "enviado" },
      checkoutDeGarantia: { "meta:dest-met": "não conferido" },
    });
    expect(nomes()).toEqual(["Purchase"]);
    // A pagina tambem nao veio: a raiz, nunca o endpoint.
    expect(mundo.saiu[0].evento.event_source_url).toBe(`${PUBLICA}/`);
  });

  it("sem chave nenhuma do comprador: o IP do pedido acha o expresso dele (30 min)", async () => {
    const semCarrinho: PedidoShopify = { ...PEDIDO, note_attributes: [], checkout_token: "outro-token" };
    cenario({
      identidades: [],
      eventos: [
        linhaDoFunil({
          event_name: "begin_checkout",
          event_id: `begin_checkout_xp_${VID}_9`,
          visitor_id: VID,
          ip_hash: hashDoIp(IP),
          status: "pendente",
          sent_at: null,
          created_at: new Date(AGORA - 2 * MIN).toISOString(),
        }),
      ],
    });
    expect((await webhook(semCarrinho)).corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "já iniciado" } });

    // Outro IP: e outra pessoa, e a garantia sai -- sem visitante na linha.
    mundo.saiu.length = 0;
    const r = await webhook({ ...semCarrinho, id: 99, browser_ip: "198.51.100.4", client_details: { browser_ip: "198.51.100.4" } }, "wh-9");
    expect(r.corpo).toMatchObject({ checkoutDeGarantia: { "meta:dest-met": "enviado" } });
    expect(linha(idDoEventoDoCheckout("begin_checkout", "outro-token"))).toMatchObject({ visitor_id: null });
  });
});
