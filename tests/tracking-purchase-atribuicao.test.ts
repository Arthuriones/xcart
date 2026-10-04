import { describe, expect, it, vi } from "vitest";

// identidade-do-pedido.ts importa "server-only", que so existe no bundler do
// Next. A funcao testada aqui e pura; o mock so deixa o modulo carregar.
vi.mock("server-only", () => ({}));

import {
  cliquesDaLanding,
  montarPurchase,
  type PedidoShopify,
} from "../src/lib/tracking/purchase";
import {
  consolidarIdentidades,
  ehClientIdSentinela,
  temClique,
} from "../src/lib/tracking/identidade-do-pedido";

// ============================================================================
// A compra tem que achar o clique mesmo quando o pedido NAO traz cart attribute.
//
// Medido em producao: nenhuma das compras reais trazia `_xc_vid`, e duas de
// tres sairam para o Google sem click id. Sem gclid o endpoint /pagead nao
// atribui -- a venda some da campanha e o Smart Bidding corta lance justamente
// do que vende. Estes testes travam a cascata que resolve isso.
// ============================================================================

/** Pedido de "Comprar agora": nenhum note_attribute. */
function pedidoSemCarrinho(extra: Partial<PedidoShopify> = {}): PedidoShopify {
  return {
    id: 18917236605201,
    email: "cliente@exemplo.com",
    currency: "USD",
    total_price: "63.90",
    created_at: "2026-09-29T17:09:16Z",
    note_attributes: [],
    line_items: [{ product_id: 1, variant_id: 2, quantity: 1, price: "63.90" }],
    ...extra,
  };
}

describe("cliquesDaLanding", () => {
  it("le gclid e fbclid da URL de chegada", () => {
    const c = cliquesDaLanding("/products/x?utm_source=g&gclid=ABC123&fbclid=FB1");
    expect(c.gclid).toBe("ABC123");
    expect(c.fbclid).toBe("FB1");
  });

  it("sem query nao inventa nada", () => {
    expect(cliquesDaLanding("/products/x")).toEqual({
      gclid: null,
      gbraid: null,
      wbraid: null,
      fbclid: null,
    });
    expect(cliquesDaLanding(null).gclid).toBeNull();
  });

  it("perto do corte de 255 da Shopify descarta o ultimo parametro", () => {
    // Um gclid pela metade e pior que nenhum: o Google descarta e ainda parece
    // que foi enviado.
    const longa = "/p?utm_campaign=" + "x".repeat(220) + "&gclid=CORTADOPELAMET";
    expect(longa.length).toBeGreaterThanOrEqual(250);
    expect(cliquesDaLanding(longa).gclid).toBeNull();
  });
});

describe("compra sem cart attribute", () => {
  it("Meta reconstroi o fbc a partir do fbclid da URL de chegada", () => {
    const { evento } = montarPurchase(
      pedidoSemCarrinho({ landing_site: "/products/x?fbclid=FBX" })
    );
    expect(evento.user_data.fbc).toMatch(/^fb\.1\.\d+\.FBX$/);
  });

  it("o external_id da compra inclui visitante e clientId da identidade", () => {
    // O funil manda [visitorId, clientId]. Sem eles na compra, ela nao casava
    // com o proprio funil.
    const comIds = montarPurchase(pedidoSemCarrinho(), {
      identidade: { visitorId: "vid-1", clientId: "cli-1", fbc: "fb.1.1.X" },
    }).evento.user_data.external_id;
    const semIds = montarPurchase(pedidoSemCarrinho()).evento.user_data.external_id;
    expect(comIds?.length).toBe(2);
    expect(semIds ?? []).toHaveLength(0);
  });
});

describe("Purchase no formato que o Meta aceita", () => {
  it("customer_segmentation vai DENTRO de custom_data, com o enum do Meta", () => {
    // A primeira versao punha no topo do evento com valores que o Meta nao
    // aceita -- erro 100, permanente, derrubaria toda compra.
    const novo = montarPurchase(
      pedidoSemCarrinho({
        customer: { id: 9, email: "a@b.com", orders_count: 1 },
      })
    ).evento;
    expect(novo.custom_data?.customer_segmentation).toBe("new_customer_to_business");
    expect("customer_segmentation" in novo).toBe(false);

    const antigo = montarPurchase(
      pedidoSemCarrinho({ customer: { id: 9, orders_count: 4 } })
    ).evento;
    expect(antigo.custom_data?.customer_segmentation).toBe(
      "existing_customer_to_business"
    );
  });

  it("sem orders_count, nao chuta", () => {
    const e = montarPurchase(pedidoSemCarrinho()).evento;
    expect(e.custom_data?.customer_segmentation).toBeUndefined();
  });

  it("event_source_url sai no dominio PUBLICO, nao no myshopify", () => {
    const e = montarPurchase(
      pedidoSemCarrinho({
        landing_site: "/products/x",
        order_status_url: "https://lashbestie.shop/123/orders/abc/authenticate?key=z",
      }),
      { dominioLoja: "qkgknv-w3.myshopify.com" }
    ).evento;
    expect(e.event_source_url).toBe("https://lashbestie.shop/products/x");
  });

  it("sem order_status_url, cai para o dominio cadastrado", () => {
    const e = montarPurchase(pedidoSemCarrinho({ landing_site: "/" }), {
      dominioLoja: "qkgknv-w3.myshopify.com",
    }).evento;
    expect(e.event_source_url).toBe("https://qkgknv-w3.myshopify.com/");
  });

  it("as chaves de topo do evento sao so as que o Meta conhece", () => {
    const e = montarPurchase(pedidoSemCarrinho(), { dominioLoja: "a.myshopify.com" })
      .evento;
    const conhecidas = new Set([
      "event_name",
      "event_time",
      "event_id",
      "event_source_url",
      "action_source",
      "user_data",
      "custom_data",
    ]);
    for (const k of Object.keys(e)) expect(conhecidas.has(k)).toBe(true);
  });
});

describe("consolidarIdentidades", () => {
  it("duas linhas do mesmo clientId nao anulam a identidade", () => {
    // Era o maybeSingle(): com duas linhas (ITP do Safari), devolvia erro e o
    // checkout saia sem gclid nem fbc.
    const id = consolidarIdentidades([
      { visitor_id: "novo", shopify_client_id: "cli", fbp: "fb.1.2.2" },
      { visitor_id: "velho", shopify_client_id: "cli", gclid: "G1", fbc: "fb.1.1.F" },
    ]);
    expect(id?.gclid).toBe("G1");
    expect(id?.fbc).toBe("fb.1.1.F");
    expect(id?.fbp).toBe("fb.1.2.2");
    expect(id?.visitorId).toBe("novo");
    expect(temClique(id)).toBe(true);
  });

  it("o clique do Google vem inteiro de uma linha", () => {
    const id = consolidarIdentidades([
      { gbraid: "GB_RECENTE" },
      { gclid: "G_ANTIGO" },
    ]);
    expect(id).toMatchObject({ gbraid: "GB_RECENTE", gclid: null });
  });

  it("sem linhas, sem identidade", () => {
    expect(consolidarIdentidades([])).toBeNull();
  });
});

describe("clientId zerado da Shopify", () => {
  it("e reconhecido e nao vira identidade", () => {
    expect(ehClientIdSentinela("00000000-0000-0000-5000-000000000000")).toBe(true);
    expect(ehClientIdSentinela("3a7341a1-8435-4d79-a058-11f9908f89a2")).toBe(false);
    expect(ehClientIdSentinela(null)).toBe(false);
  });
});
