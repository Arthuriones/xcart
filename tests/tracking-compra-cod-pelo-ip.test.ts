import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";
import { hashDoIp } from "../src/lib/tracking/ip-balde";
import { sha256 } from "../src/lib/tracking/normalizar";
import {
  CHAVE_IP_DA_NOTA,
  ipDoPedido,
  montarPurchase,
  montarPurchaseTiktok,
  type PedidoShopify,
} from "../src/lib/tracking/purchase";

// ============================================================================
// Pedido do Releasit (COD) acha o visitante pelo IP da nota.
//
// O formulario do Releasit cria o pedido pela API: sem carrinho do tema, sem
// checkout da Shopify. Medido na AmpleStep (10/2026): 5 de 5 pedidos sem
// `browser_ip`, sem `client_details`, sem `checkout_token` e sem `_xc_vid` --
// o IP do comprador so vem na nota, em "IP address". A compra saia para o Meta
// sem fbc, sem fbp, sem IP e sem user agent, desligada do funil.
//
// Agora: o IP da nota vai na compra, e o visitante do tema que o coletor viu
// nesse IP nos 30 min antes empresta o clique, o _fbp, o user agent e o
// external_id. So quando o IP teve UM visitante: com dois, nao da para saber
// quem comprou.
// ============================================================================

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: () => {},
}));

let banco: FakeSupabase;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.client }));

const mundo = vi.hoisted(() => ({
  destinos: [] as Record<string, unknown>[],
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

const STORE = "6a69fa1f-1966-4604-b954-1a168bfd0888";
const SHOP = "5rinvm-i9.myshopify.com";
const SEGREDO = "shpss_dum";
const VID = "mvo9a1b2.k3l4m5n6";
const FBC = "fb.1.1792990000000.IwAR-anuncio";
const FBP = "fb.1.1792990000000.123456789";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)";
const IP = "203.0.113.9";
const MIN = 60e3;
const PEDIDO_EM = "2026-10-27T10:00:00Z";
const AGORA = Date.parse(PEDIDO_EM) + 20e3;

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

/** Como o Releasit cria: COD, sem IP nem navegador no pedido, a nota cheia. */
const RELEASIT: PedidoShopify = {
  id: 6100200300,
  order_number: 1001,
  email: "cliente@exemplo.cz",
  phone: "+420777123456",
  currency: "CZK",
  total_price: "1459.00",
  created_at: PEDIDO_EM,
  browser_ip: null,
  landing_site: null,
  checkout_token: null,
  source_name: "5690175",
  customer: { id: 9001, email: "cliente@exemplo.cz", first_name: "Jana", last_name: "Novakova" },
  shipping_address: { first_name: "Jana", last_name: "Novakova", city: "Praha", zip: "11000", country_code: "CZ" },
  client_details: null,
  note_attributes: [
    { name: "First name", value: "Jana" },
    { name: "Phone", value: "+420777123456" },
    { name: "rsi_currency_rate", value: "23.4" },
    { name: CHAVE_IP_DA_NOTA, value: IP },
  ],
  line_items: [{ product_id: 51, variant_id: 5101, sku: "PARFEM-50", quantity: 1, price: "1459.00" }],
};

type Linha = Record<string, unknown>;

/** O view_item que o coletor gravou para o visitante, na pagina do produto. */
function doFunil(over: Linha = {}): Linha {
  const em = new Date(Date.parse(PEDIDO_EM) - 4 * MIN).toISOString();
  return {
    id: `ev-${Math.random().toString(36).slice(2, 8)}`,
    store_id: STORE,
    destination: "meta",
    destination_id: META.id,
    event_name: "view_item",
    event_id: `view_item_${VID}_1`,
    visitor_id: VID,
    order_id: null,
    checkout_token: null,
    ip_hash: hashDoIp(IP),
    status: "enviado",
    attempts: 1,
    sent_at: em,
    created_at: em,
    payload: {
      event_name: "ViewContent",
      user_data: { fbp: FBP, fbc: FBC, client_ip_address: IP, client_user_agent: UA },
    },
    ...over,
  };
}

function cenario(over: { eventos?: Linha[]; identidades?: Linha[] } = {}) {
  banco = fakeSupabase({
    stores: [{ id: STORE, user_id: "u1", name: "Dům parfémů", shop_domain: SHOP, client_secret: SEGREDO, uninstalled_at: null }],
    tracking_configs: [
      { store_id: STORE, enabled: true, web_pixel_visto_em: null, web_pixel_com_id_em: null, teto_atingido_em: null },
    ],
    tracking_identities: over.identidades ?? [],
    tracking_checkouts: [],
    tracking_events: over.eventos ?? [doFunil()],
    shopify_webhook_events: [],
    routed_checkout_orders: [],
  });
}

async function webhook(pedido: PedidoShopify = RELEASIT) {
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
        "x-shopify-webhook-id": `wh-${Math.random()}`,
        "x-shopify-triggered-at": new Date(AGORA).toISOString(),
      },
    })
  );
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

/** O user_data da compra que saiu para o Meta. */
const compraMeta = () =>
  mundo.saiu.find((s) => s.plataforma === "meta" && s.evento.event_name === "Purchase")?.evento.user_data as
    | Record<string, unknown>
    | undefined;

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

describe("o IP do pedido", () => {
  it("o do checkout primeiro; sem ele, o da nota do Releasit", () => {
    expect(ipDoPedido(RELEASIT)).toBe(IP);
    expect(ipDoPedido({ ...RELEASIT, browser_ip: "198.51.100.7" })).toBe("198.51.100.7");
    expect(ipDoPedido({ ...RELEASIT, client_details: { browser_ip: "2001:db8::1" } })).toBe("2001:db8::1");
  });

  it("so a chave do Releasit, e so IP valido: a nota e texto do formulario", () => {
    const com = (name: string, value: string) => ({ ...RELEASIT, note_attributes: [{ name, value }] });
    expect(ipDoPedido(com("IP address", "  203.0.113.9 "))).toBe("203.0.113.9");
    expect(ipDoPedido(com("ip address", "203.0.113.9"))).toBe("203.0.113.9");
    expect(ipDoPedido(com("IP address", "nao sei"))).toBeNull();
    expect(ipDoPedido(com("IP address", "999.1.1.1"))).toBeNull();
    expect(ipDoPedido(com("Address", "203.0.113.9"))).toBeNull();
    expect(ipDoPedido({ ...RELEASIT, note_attributes: [] })).toBeNull();
  });

  it("a compra leva o IP da nota no Meta e no TikTok, mesmo sem visitante", () => {
    expect(montarPurchase(RELEASIT).userData.client_ip_address).toBe(IP);
    expect(montarPurchaseTiktok(RELEASIT, { dominioLoja: SHOP }).user.ip).toBe(IP);
  });
});

describe("pedido do Releasit no webhook: o visitante pelo IP", () => {
  it("um visitante no IP nos 30 min: a compra sai com o fbc, o fbp, o IP, o user agent e o external_id dele", async () => {
    const r = await webhook();
    expect(r.status).toBe(200);
    expect(r.corpo).toMatchObject({ identidade: "ip" });
    const ud = compraMeta()!;
    expect(ud).toMatchObject({ fbc: FBC, fbp: FBP, client_ip_address: IP, client_user_agent: UA });
    // O mesmo external_id que o funil mandou: a compra costura com o view_item.
    expect(ud.external_id).toContain(sha256(VID));
    // E o que o Releasit ja dava continua: telefone e nome.
    expect(ud.ph).toBeTruthy();
    expect(ud.fn).toBeTruthy();
  });

  it("o clique guardado do visitante (identidade) vence o do evento", async () => {
    const guardado = "fb.1.1792980000000.IwAR-cookie";
    cenario({
      identidades: [{ store_id: STORE, visitor_id: VID, fbc: guardado, fbp: FBP, updated_at: new Date(AGORA - 10 * MIN).toISOString() }],
    });
    await webhook();
    expect(compraMeta()).toMatchObject({ fbc: guardado, fbp: FBP, client_user_agent: UA });
  });

  it("TikTok: o ttclid, o _ttp, o IP e o user agent do visitante", async () => {
    mundo.destinos = [TIKTOK];
    cenario({
      eventos: [
        doFunil({
          destination: "tiktok",
          destination_id: TIKTOK.id,
          payload: { event: "ViewContent", user: { ttclid: "E.C.P.TT1", ttp: "UqBuLHl7", ip: IP, user_agent: UA } },
        }),
      ],
    });
    await webhook();
    const compra = mundo.saiu.find((s) => s.plataforma === "tiktok" && s.evento.event === "Purchase")!.evento;
    expect(compra.user).toMatchObject({ ttclid: "E.C.P.TT1", ttp: "UqBuLHl7", ip: IP, user_agent: UA });
  });

  it("dois visitantes no mesmo IP (wifi, CGNAT): nao escolhe -- vai o IP, sem o clique de ninguem", async () => {
    cenario({
      eventos: [doFunil(), doFunil({ visitor_id: "outro.visitante", event_id: "view_item_outro.visitante_1" })],
    });
    const r = await webhook();
    expect(r.corpo).toMatchObject({ identidade: "nenhuma" });
    const ud = compraMeta()!;
    expect(ud.client_ip_address).toBe(IP);
    expect(ud).not.toHaveProperty("fbc");
    expect(ud).not.toHaveProperty("fbp");
  });

  it("evento de mais de 30 min antes, outro IP ou linha do pixel nao contam", async () => {
    for (const fora of [
      doFunil({ created_at: new Date(Date.parse(PEDIDO_EM) - 31 * MIN).toISOString() }),
      doFunil({ ip_hash: hashDoIp("198.51.100.77") }),
      doFunil({ checkout_token: "tok-1", visitor_id: "b1c2d3e4-0000-4000-8000-00000000c1d0" }),
    ]) {
      mundo.saiu.length = 0;
      cenario({ eventos: [fora] });
      const r = await webhook();
      expect(r.corpo).toMatchObject({ identidade: "nenhuma" });
      expect(compraMeta()).not.toHaveProperty("fbc");
    }
  });

  it("pedido COM chave nao troca de pessoa pelo IP: o visitante do carrinho e o do checkout ficam", async () => {
    // O carrinho leva o _xc_vid: o IP de outro visitante da mesma rede nao entra.
    const comCarrinho: PedidoShopify = {
      ...RELEASIT,
      note_attributes: [...(RELEASIT.note_attributes || []), { name: "_xc_vid", value: "dono.do.carrinho" }],
    };
    await webhook(comCarrinho);
    const ud = compraMeta()!;
    expect(ud.external_id).toContain(sha256("dono.do.carrinho"));
    expect(ud.external_id).not.toContain(sha256(VID));
    expect(ud).not.toHaveProperty("fbc");

    // Com checkout da Shopify, quem responde e o passo do checkout, nunca o IP.
    mundo.saiu.length = 0;
    cenario();
    const r = await webhook({ ...RELEASIT, checkout_token: "tok-qualquer", browser_ip: IP });
    expect(r.corpo).not.toMatchObject({ identidade: "ip" });
    expect(compraMeta()).not.toHaveProperty("fbc");
  });

  it("o IC de garantia sai com o mesmo comprador", async () => {
    await webhook();
    const ic = mundo.saiu.find((s) => s.evento.event_name === "InitiateCheckout")?.evento;
    expect(ic?.user_data).toEqual(compraMeta());
    expect(banco.tabelas.tracking_events.find((l) => l.event_id === "begin_checkout_pedido_6100200300")).toMatchObject({
      visitor_id: VID,
    });
  });
});
