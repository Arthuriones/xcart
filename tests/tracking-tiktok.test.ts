import { beforeEach, describe, expect, it, vi } from "vitest";
import { montarUserTiktok, sha256, telefoneE164 } from "../src/lib/tracking/normalizar";
import { montarEventoDeFunilTiktok, MOEDAS_TIKTOK } from "../src/lib/tracking/tiktok-evento";
import {
  idDoEvento,
  montarPurchase,
  montarPurchaseTiktok,
  type PedidoShopify,
} from "../src/lib/tracking/purchase";
import { EVENTOS } from "../src/lib/tracking/eventos";
import { enviaAoDestino, payloadComMarcas } from "../src/lib/tracking/teste";

// ============================================================================
// TikTok Ads pela Events API, do servidor -- o mesmo molde do Meta.
//
// O que este arquivo trava:
//   1. o `user` do TikTok: e-mail, telefone (E.164 COM '+') e external_id em
//      SHA-256, contra os exemplos da documentacao; ttclid, ttp, IP e UA em
//      claro;
//   2. o evento de funil: o nome padrao do TikTok, o MESMO event_id do Meta e
//      nada de valor (vem do coletor publico);
//   3. a compra: "Purchase", valor e moeda so aqui, ttclid em cascata;
//   4. o envio: v1.3 /event/track/, token no header, sucesso so com code 0;
//   5. a fila despachando por destino: linha do TikTok vai ao TikTok, a do
//      Meta continua indo ao Meta.
// ============================================================================

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  rede: null as unknown as (url: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: (url: string, init?: RequestInit) => mundo.rede(url, init),
}));

const ENDPOINT = "https://business-api.tiktok.com/open_api/v1.3/event/track/";

// ---------------------------------------------------------------------------
// 1. O user
// ---------------------------------------------------------------------------

describe("user do TikTok", () => {
  it("hash igual aos exemplos da documentacao do TikTok", () => {
    const u = montarUserTiktok({
      email: " ALICE_abc@gmail.com ",
      telefone: "(+1)2133734253",
      externalIds: ["user_123"],
    });
    expect(u.email).toBe("848a771458438fc2ec420560d769fb9b9b86851ee338ec56517baabd79d3bb4f");
    expect(u.phone).toBe("9f7ec22d72092cd3c0b58726ed9c2d91b92e51a3f29837508fb2948bb22dd2fd");
    expect(u.external_id).toEqual([
      "80fba0ae1c48e3978e43e4efc365e14e12ea0c830ba8ba5b9a2dafc7e3f2ab8b",
    ]);
  });

  it("telefone em E.164 COM '+': o hash nao e o do Meta", () => {
    expect(telefoneE164("11 98765-4321", "BR")).toBe("+5511987654321");
    expect(telefoneE164("+33 6 12 34 56 78")).toBe("+33612345678");
    expect(telefoneE164("", "BR")).toBeNull();
    // Nacional de pais sem DDI na tabela nao vira E.164: fora, sem hash que nunca casa.
    expect(telefoneE164("0612345678", "NL")).toBeNull();
    expect(telefoneE164("0612345678")).toBeNull();
    expect(telefoneE164("0031 6 12345678")).toBe("+31612345678");
    const u = montarUserTiktok({ telefone: "11 98765-4321", pais: "BR" });
    expect(u.phone).toBe(sha256("+5511987654321"));
    expect(u.phone).not.toBe(sha256("5511987654321"));
  });

  it("ttclid, ttp, IP e user agent vao em claro; o ttclid inteiro", () => {
    const ttclid = `E.C.P.${"x".repeat(600)}`;
    const u = montarUserTiktok(
      { externalIds: ["vid-1", "vid-1", null, "cli-1"] },
      { ttclid, ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP", clientIp: "1.2.3.4", userAgent: "UA" }
    );
    expect(u).toEqual({
      external_id: [sha256("vid-1"), sha256("cli-1")],
      ttclid,
      ttp: "UqBuLHl7TuWsDXUu-ViOGOLA5YP",
      ip: "1.2.3.4",
      user_agent: "UA",
    });
  });

  it("sem dado, sem campo -- nunca hash de string vazia", () => {
    expect(montarUserTiktok({ email: "sem-arroba", telefone: " ", externalIds: ["", null] })).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// 2. O evento de funil
// ---------------------------------------------------------------------------

describe("evento de funil do TikTok", () => {
  const base = {
    eventId: "add_to_cart_vid-1_1759750000000",
    quandoMs: 1759750000123,
    user: { ttclid: "E.C.P.abc" },
    url: "https://loja.shop/products/x?ttclid=E.C.P.abc",
    contentIds: ["111"],
  };

  it("usa o nome padrao do TikTok para cada evento do catalogo", () => {
    const nomes = EVENTOS.filter((e) => e.origem !== "webhook").map(
      (e) => montarEventoDeFunilTiktok({ ...base, evento: e.chave }).event
    );
    expect(nomes).toEqual(["ViewContent", "AddToCart", "InitiateCheckout", "AddPaymentInfo"]);
  });

  it("o mesmo event_id, em segundos, com page.url e o id do produto -- sem valor", () => {
    const e = montarEventoDeFunilTiktok({ ...base, evento: "add_to_cart" });
    expect(e).toEqual({
      event: "AddToCart",
      event_time: 1759750000,
      event_id: "add_to_cart_vid-1_1759750000000",
      user: { ttclid: "E.C.P.abc" },
      page: { url: "https://loja.shop/products/x" },
      properties: { content_type: "product", contents: [{ content_id: "111" }] },
    });
    expect(JSON.stringify(e)).not.toMatch(/"value"|"currency"/);
  });

  it("id do produto vira product_group; variante e SKU, product", () => {
    const tipo = (idTemplate: string | null) =>
      montarEventoDeFunilTiktok({ ...base, evento: "view_item", idTemplate }).properties?.content_type;
    expect(tipo(null)).toBe("product");
    expect(tipo("{product_id}")).toBe("product_group");
    expect(tipo("shopify_US_{product_id}_{variant_id}")).toBe("product");
    expect(tipo("{sku}")).toBe("product");
  });

  it("ttclid acima de 1.000 caracteres fica fora do user, sem corte", () => {
    const u = montarUserTiktok({}, { ttclid: "E.C.P." + "x".repeat(1000) });
    expect(u).not.toHaveProperty("ttclid");
  });

  it("sem produto, sem properties", () => {
    const e = montarEventoDeFunilTiktok({ ...base, evento: "begin_checkout", contentIds: [] });
    expect(e).not.toHaveProperty("properties");
  });
});

// ---------------------------------------------------------------------------
// 3. A compra
// ---------------------------------------------------------------------------

function pedido(over: Partial<PedidoShopify> = {}): PedidoShopify {
  return {
    id: 6100000000001,
    email: "Cliente@Exemplo.com",
    currency: "usd",
    total_price: "59.90",
    created_at: "2026-10-06T12:00:00Z",
    browser_ip: "8.8.8.8",
    landing_site: "/products/x?utm_source=tiktok",
    order_status_url: "https://amplestep.shop/6100/orders/abc/authenticate?key=k",
    customer: { id: 77, phone: "+1 213 373 4253" },
    client_details: { user_agent: "Mozilla/5.0", browser_ip: "8.8.4.4" },
    note_attributes: [
      { name: "ttclid", value: "E.C.P.DO_CARRINHO" },
      { name: "_ttp", value: "TTP_DO_CARRINHO" },
      { name: "_xc_vid", value: "vid-9" },
    ],
    line_items: [
      { variant_id: 11, product_id: 1, quantity: 2, price: "20.00", discount_allocations: [{ amount: "4.00" }] },
      { variant_id: 12, product_id: 1, quantity: 1, price: "23.90" },
    ],
    ...over,
  };
}

describe("compra no TikTok", () => {
  const ctx = { dominioLoja: "qkgknv-w3.myshopify.com" };

  it("Purchase com valor, moeda, itens pelo preco pago e o event_id do Meta", () => {
    const e = montarPurchaseTiktok(pedido(), ctx);
    expect(e.event).toBe("Purchase");
    expect(e.event_id).toBe(idDoEvento(6100000000001));
    expect(e.event_id).toBe(montarPurchase(pedido(), ctx).evento.event_id);
    expect(e.event_time).toBe(Math.floor(Date.parse("2026-10-06T12:00:00Z") / 1000));
    expect(e.page).toEqual({ url: "https://amplestep.shop/products/x?utm_source=tiktok" });
    expect(e.properties).toEqual({
      currency: "USD",
      value: 59.9,
      content_type: "product",
      // 2 x 20 com 4 de desconto = 18 por unidade; o preco e por UNIDADE.
      contents: [
        { content_id: "11", quantity: 2, price: 18 },
        { content_id: "12", quantity: 1, price: 23.9 },
      ],
      num_items: 3,
      order_id: "6100000000001",
    });
  });

  it("user: e-mail e telefone em hash (telefone com '+'), ids do Meta, clique do carrinho", () => {
    const u = montarPurchaseTiktok(pedido(), ctx).user;
    expect(u.email).toBe(sha256("cliente@exemplo.com"));
    expect(u.phone).toBe(sha256("+12133734253"));
    expect(u.external_id).toEqual([sha256("77"), sha256("vid-9")]);
    expect(u.ttclid).toBe("E.C.P.DO_CARRINHO");
    expect(u.ttp).toBe("TTP_DO_CARRINHO");
    expect(u.ip).toBe("8.8.4.4");
    expect(u.user_agent).toBe("Mozilla/5.0");
  });

  it("ttclid em cascata: carrinho, depois identidade, depois URL de chegada", () => {
    const semAtributo = pedido({ note_attributes: [] });
    expect(
      montarPurchaseTiktok(semAtributo, { ...ctx, identidade: { ttclid: "E.C.P.IDENT", ttp: "TTP_ID" } }).user
    ).toMatchObject({ ttclid: "E.C.P.IDENT", ttp: "TTP_ID" });

    const daLanding = pedido({ note_attributes: [], landing_site: "/p?ttclid=E.C.P.LANDING&x=1" });
    expect(montarPurchaseTiktok(daLanding, ctx).user.ttclid).toBe("E.C.P.LANDING");

    expect(montarPurchaseTiktok(pedido({ note_attributes: [], landing_site: "/" }), ctx).user).not.toHaveProperty(
      "ttclid"
    );
  });

  it("moeda fora da lista do TikTok: a compra sai, sem valor e sem moeda", () => {
    expect(MOEDAS_TIKTOK.has("UYU")).toBe(false);
    expect(MOEDAS_TIKTOK.has("BRL")).toBe(true);
    const e = montarPurchaseTiktok(pedido({ currency: "UYU" }), ctx);
    expect(e.properties).not.toHaveProperty("value");
    expect(e.properties).not.toHaveProperty("currency");
    expect(e.properties?.order_id).toBe("6100000000001");
  });

  it("sem URL de status, a origem e o dominio cadastrado", () => {
    const e = montarPurchaseTiktok(pedido({ order_status_url: null, landing_site: null }), ctx);
    expect(e.page.url).toBe("https://qkgknv-w3.myshopify.com/");
  });

  it("as chaves sao so as que a Events API conhece", () => {
    const e = montarPurchaseTiktok(pedido(), ctx);
    const topo = new Set(["event", "event_time", "event_id", "user", "page", "properties"]);
    for (const k of Object.keys(e)) expect(topo.has(k), k).toBe(true);
    const user = new Set(["email", "phone", "external_id", "ttclid", "ttp", "ip", "user_agent"]);
    for (const k of Object.keys(e.user)) expect(user.has(k), k).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. O envio
// ---------------------------------------------------------------------------

const EVENTO = montarEventoDeFunilTiktok({
  evento: "view_item",
  eventId: "view_item_v_1",
  quandoMs: 1759750000000,
  user: { ttclid: "E.C.P.abc", ip: "1.2.3.4" },
  url: "https://loja.shop/products/x",
  contentIds: ["11"],
});

const chamadas: { url: string; init?: RequestInit }[] = [];
function responder(corpo: unknown, status = 200) {
  mundo.rede = async (url, init) => {
    chamadas.push({ url, init });
    return new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), { status });
  };
}

describe("enviarParaTiktok", () => {
  beforeEach(() => {
    chamadas.length = 0;
  });

  it("v1.3 /event/track/, token no header (nunca na URL nem no corpo)", async () => {
    responder({ code: 0, message: "OK", request_id: "r1", data: {} });
    const { enviarParaTiktok } = await import("../src/lib/tracking/tiktok-api");
    const r = await enviarParaTiktok("CUSG5HBC77UD11VVRQEG", "tok-secreto", [EVENTO], {
      testEventCode: " TEST123 ",
    });
    expect(r).toMatchObject({ ok: true, codigo: 0, trace: "r1" });
    expect(chamadas[0].url).toBe(ENDPOINT);
    const headers = chamadas[0].init?.headers as Record<string, string>;
    expect(headers["Access-Token"]).toBe("tok-secreto");
    const corpo = JSON.parse(String(chamadas[0].init?.body));
    expect(corpo).toEqual({
      event_source: "web",
      event_source_id: "CUSG5HBC77UD11VVRQEG",
      data: [EVENTO],
      test_event_code: "TEST123",
    });
    expect(chamadas[0].url + String(chamadas[0].init?.body)).not.toContain("tok-secreto");
  });

  it("HTTP 200 com code diferente de 0 NAO e entregue", async () => {
    responder({ code: 40001, message: "No permission to operate pixel code: X", request_id: "r2" });
    const { enviarParaTiktok } = await import("../src/lib/tracking/tiktok-api");
    const r = await enviarParaTiktok("PX", "t", [EVENTO]);
    expect(r).toMatchObject({ ok: false, codigo: 40001, podeTentarDeNovo: false });
    expect(r.erro).toContain("40001");
  });

  it("permanente x retentavel", async () => {
    const { enviarParaTiktok } = await import("../src/lib/tracking/tiktok-api");
    const casos: [unknown, number, boolean][] = [
      [{ code: 40105, message: "invalid token" }, 200, false],
      [{ code: 40002, message: "Invalid value for data.0.event_id" }, 200, false],
      [{ code: 40100, message: "too many requests" }, 200, true],
      [{ code: 50000, message: "system error" }, 200, true],
      [{ code: 60001, message: "maintenance" }, 200, true],
      ["<html>bad gateway</html>", 502, true],
      ["nao e json", 400, false],
    ];
    for (const [corpo, status, volta] of casos) {
      responder(corpo, status);
      const r = await enviarParaTiktok("PX", "t", [EVENTO]);
      expect(r.ok).toBe(false);
      expect(r.podeTentarDeNovo, JSON.stringify(corpo)).toBe(volta);
    }
  });

  it("rede caindo volta para a fila", async () => {
    mundo.rede = async () => {
      throw new Error("timeout");
    };
    const { enviarParaTiktok } = await import("../src/lib/tracking/tiktok-api");
    expect(await enviarParaTiktok("PX", "t", [EVENTO])).toMatchObject({
      ok: false,
      status: 0,
      podeTentarDeNovo: true,
    });
  });

  it("a conferencia do token e um evento custom, nunca uma compra", async () => {
    responder({ code: 0, message: "OK" });
    const { validarEscritaNoTiktok } = await import("../src/lib/tracking/tiktok-api");
    expect((await validarEscritaNoTiktok("PX", "t", "TEST9")).ok).toBe(true);
    const corpo = JSON.parse(String(chamadas[0].init?.body));
    expect(corpo.test_event_code).toBe("TEST9");
    expect(corpo.data).toHaveLength(1);
    expect(corpo.data[0].event).toBe("XcartCredentialCheck");
    expect(corpo.data[0]).not.toHaveProperty("properties");
    expect(corpo.data[0].page.url).toMatch(/^https:\/\/example\.com\//);

    await validarEscritaNoTiktok("PX", "t", null);
    expect(JSON.parse(String(chamadas[1].init?.body))).not.toHaveProperty("test_event_code");
  });
});

// ---------------------------------------------------------------------------
// 5. A fila: despacho por destino
// ---------------------------------------------------------------------------

function bancoFalso() {
  const updates: Record<string, unknown>[] = [];
  const admin = {
    from() {
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        update: (v: Record<string, unknown>) => {
          updates.push(v);
          return b;
        },
        eq: () => b,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok),
      });
      return b;
    },
  };
  mundo.admin = admin;
  return { admin: admin as never, updates };
}

const TIKTOK = {
  id: "dest-tt",
  storeId: "s1",
  plataforma: "tiktok" as const,
  nome: null,
  conta: "CUSG5HBC77UD11VVRQEG",
  labels: {},
  testEventCode: null as string | null,
  idTemplate: null,
  ativo: true,
  token: "tok-tt",
};
const META = { ...TIKTOK, id: "dest-meta", plataforma: "meta" as const, conta: "123456", token: "EAAB" };

describe("fila: cada linha vai para a plataforma dela", () => {
  beforeEach(() => {
    chamadas.length = 0;
    mundo.rede = async (url, init) => {
      chamadas.push({ url, init });
      if (url.startsWith("https://graph.facebook.com/")) {
        return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
      }
      if (url === ENDPOINT) return new Response(JSON.stringify({ code: 0, message: "OK" }), { status: 200 });
      throw new Error(`rede inesperada: ${url}`);
    };
  });

  const linha = (destination: string, destinationId: string, payload: unknown) => ({
    id: "l1",
    store_id: "s1",
    destination,
    destination_id: destinationId,
    event_name: "view_item",
    payload,
    attempts: 0,
  });

  it("linha do TikTok sai para a Events API, com o payload intocado e o codigo de teste do destino", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso();
    const r = await entregar(banco.admin, linha("tiktok", "dest-tt", EVENTO), {
      destino: { ...TIKTOK, testEventCode: "TEST1" },
      lojaLigada: true,
    });
    expect(r.ok).toBe(true);
    expect(chamadas.map((c) => c.url)).toEqual([ENDPOINT]);
    const corpo = JSON.parse(String(chamadas[0].init?.body));
    expect(corpo.data[0]).toEqual(EVENTO);
    expect(corpo.event_source_id).toBe("CUSG5HBC77UD11VVRQEG");
    expect(corpo.test_event_code).toBe("TEST1");
    expect(banco.updates[0]).toMatchObject({ status: "enviado", last_error: null });
  });

  it("sem ttclid sai igual, com o aviso na linha", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso();
    const semClique = { ...EVENTO, user: { ip: "1.2.3.4" } };
    await entregar(banco.admin, linha("tiktok", "dest-tt", semClique), { destino: TIKTOK, lojaLigada: true });
    expect(banco.updates[0]).toMatchObject({
      status: "enviado",
      last_error: "sem ttclid: nao veio de clique em anuncio do TikTok",
    });
  });

  it("token recusado pelo TikTok fecha como 'falhou'; limite de taxa volta para a fila", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    let banco = bancoFalso();
    responder({ code: 40105, message: "Access token is invalid" });
    expect((await entregar(banco.admin, linha("tiktok", "dest-tt", EVENTO), { destino: TIKTOK, lojaLigada: true })).ok).toBe(false);
    expect(banco.updates[0]).toMatchObject({ status: "falhou", response: { code: 40105 } });

    banco = bancoFalso();
    responder({ code: 40100, message: "rate limit" });
    await entregar(banco.admin, linha("tiktok", "dest-tt", EVENTO), { destino: TIKTOK, lojaLigada: true });
    expect(banco.updates[0]).toMatchObject({ status: "pendente" });
  });

  it("a linha do Meta continua indo ao Meta", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso();
    const evento = { event_name: "ViewContent", event_id: "x", event_time: 1, action_source: "website", user_data: { fbc: "fb.1.1.x" } };
    expect((await entregar(banco.admin, linha("meta", "dest-meta", evento), { destino: META, lojaLigada: true })).ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toContain("graph.facebook.com");
  });

  it("linha de uma plataforma apontando para destino de outra fecha sem rede", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso();
    const r = await entregar(banco.admin, linha("tiktok", "dest-meta", EVENTO), { destino: META, lojaLigada: true });
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
    expect(banco.updates[0]).toMatchObject({ status: "falhou" });
  });

  it("destino do TikTok entra na fila com Pixel Code e token; sem token, nao", async () => {
    const { destinoAceita, porQueRecusa } = await import("../src/lib/tracking/destinos");
    expect(destinoAceita(TIKTOK)).toBe(true);
    expect(destinoAceita({ ...TIKTOK, token: null })).toBe(false);
    expect(porQueRecusa({ ...TIKTOK, token: null })).toBe("destino do TikTok sem token da Events API");
    expect(destinoAceita({ ...TIKTOK, ativo: false })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 6. Teste do dono: o TikTok segue a regra do Meta
// ---------------------------------------------------------------------------

describe("evento de teste no TikTok", () => {
  it("so sai com o codigo de teste do destino", () => {
    expect(enviaAoDestino({ plataforma: "tiktok", testEventCode: null }, true)).toBe(false);
    expect(enviaAoDestino({ plataforma: "tiktok", testEventCode: "TEST1" }, true)).toBe(true);
    expect(enviaAoDestino({ plataforma: "tiktok", testEventCode: null }, false)).toBe(true);
  });

  it("o payload do TikTok que sai vai cru; o que nao sai leva a marca", () => {
    const marcas = { teste: true, consentimento: "negado" as const };
    expect(payloadComMarcas("tiktok", EVENTO, marcas, true)).toBe(EVENTO);
    expect(payloadComMarcas("tiktok", EVENTO, marcas, false)).toMatchObject({ teste: true });
  });
});
