import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import {
  clickIdDeTeste,
  ehTeste,
  enviaAoDestino,
  lerConsentimento,
  marcasDoPedido,
  payloadComMarcas,
} from "../src/lib/tracking/teste";

// ============================================================================
// Evento de teste e consentimento.
//
// O teste do dono saia para o Google e para o Meta como conversao de verdade:
// 26 dos 38 carrinhos com clique da Softnook numa semana eram teste. Agora ele
// fica na fila marcado, nao vai ao Google, e ao Meta so com codigo de teste.
//
// O consentimento vem da Customer Privacy API da Shopify. Nunca inventado: sem
// leitura, fica sem valor. E o payload do Meta que sai continua igual -- ele
// vai cru para a API deles, e chave desconhecida derruba o evento.
// ============================================================================

function fonte(...partes: string[]) {
  return readFileSync(path.join(process.cwd(), ...partes), "utf8");
}

describe("click id de teste", () => {
  it("pega o que o dono digita", () => {
    for (const v of ["TESTE_V4", "TESTE-ATC-SOFT", "TESTE_TRACK_V4", "ATC-TEST", "teste123", "Test1"]) {
      expect(clickIdDeTeste(v), v).toBe(true);
    }
    // _fbc montado a partir de um fbclid de teste.
    expect(clickIdDeTeste("fb.1.1700000000000.TESTE")).toBe(true);
  });

  it("nao pega click id de verdade", () => {
    expect(
      clickIdDeTeste("Cj0KCQjw9Km3BhDjARIsAGUb4nwZr8XQfYk3PZpLatest_wcB")
    ).toBe(false);
    expect(clickIdDeTeste("IwZXh0bgNhZW0CMTEAAR2contest_aem_AbCdEfGhIjKlMnOpQrStUv")).toBe(false);
    // "TEST" no meio, sem separador antes: acaso, nao teste.
    expect(clickIdDeTeste("EAIaIQobChMIxTESTq9Kp")).toBe(false);
    expect(clickIdDeTeste("0AAAAABcdEf")).toBe(false);
  });

  it("aceita lixo sem estourar", () => {
    for (const v of [null, undefined, 42, {}, ""]) expect(clickIdDeTeste(v)).toBe(false);
  });

  it("marca explicita ou click id de teste", () => {
    expect(ehTeste(true)).toBe(true);
    expect(ehTeste("1")).toBe(true);
    expect(ehTeste(undefined, [null, "G1", "TESTE_V4"])).toBe(true);
    expect(ehTeste(undefined, [null, "G1"])).toBe(false);
    expect(ehTeste(false)).toBe(false);
    expect(ehTeste("0")).toBe(false);
  });
});

describe("consentimento", () => {
  it("so os dois valores conhecidos", () => {
    expect(lerConsentimento("concedido")).toBe("concedido");
    expect(lerConsentimento("negado")).toBe("negado");
    for (const v of ["granted", "CONCEDIDO", "", null, undefined, true]) {
      expect(lerConsentimento(v)).toBeNull();
    }
  });
});

describe("para onde o evento de teste vai", () => {
  const google = { plataforma: "google", testEventCode: null };
  const metaSemCodigo = { plataforma: "meta", testEventCode: null };
  const metaComCodigo = { plataforma: "meta", testEventCode: "TEST123" };

  it("fora de teste, todo destino recebe", () => {
    for (const d of [google, metaSemCodigo, metaComCodigo]) {
      expect(enviaAoDestino(d, false)).toBe(true);
    }
  });

  it("em teste: nunca o Google; o Meta so com codigo de teste", () => {
    expect(enviaAoDestino(google, true)).toBe(false);
    expect(enviaAoDestino(metaSemCodigo, true)).toBe(false);
    expect(enviaAoDestino({ plataforma: "meta", testEventCode: "   " }, true)).toBe(false);
    expect(enviaAoDestino(metaComCodigo, true)).toBe(true);
  });
});

describe("marcas no payload da fila", () => {
  const marcas = { teste: true, consentimento: "negado" as const };

  it("o payload do Meta que sai fica intocado", () => {
    const evento = { event_name: "AddToCart", event_id: "x", user_data: {} };
    expect(payloadComMarcas("meta", evento, marcas, true)).toBe(evento);
    expect(payloadComMarcas("meta", evento, { teste: false, consentimento: "concedido" }, true)).toBe(
      evento
    );
  });

  it("o Google leva teste e consentimento", () => {
    expect(payloadComMarcas("google", { gclid: "G1" }, marcas, false)).toEqual({
      gclid: "G1",
      teste: true,
      consentimento: "negado",
    });
    expect(
      payloadComMarcas("google", { gclid: "G1" }, { teste: false, consentimento: "concedido" }, true)
    ).toEqual({ gclid: "G1", consentimento: "concedido" });
  });

  it("o Meta que nao sai leva a marca de teste", () => {
    expect(payloadComMarcas("meta", { event_name: "AddToCart" }, marcas, false)).toMatchObject({
      teste: true,
    });
  });

  it("sem marca, nenhum campo novo", () => {
    const p = payloadComMarcas("google", { gclid: "G1" }, { teste: false, consentimento: null }, true);
    expect(p).toEqual({ gclid: "G1" });
  });
});

describe("marcas da compra", () => {
  it("le o que o snippet grava no carrinho", () => {
    expect(
      marcasDoPedido({
        note_attributes: [
          { name: "_xc_teste", value: "1" },
          { name: "_xc_consent", value: "concedido" },
        ],
      })
    ).toEqual({ teste: true, consentimento: "concedido" });
  });

  it("click id de teste marca a compra sem o atributo", () => {
    expect(marcasDoPedido({ note_attributes: [] }, ["TESTE_V4"]).teste).toBe(true);
  });

  it("pedido comum: nada marcado", () => {
    expect(
      marcasDoPedido({ note_attributes: [{ name: "gclid", value: "Cj0KCQjw" }] }, ["Cj0KCQjw", null])
    ).toEqual({ teste: false, consentimento: null });
    expect(marcasDoPedido({}, [])).toEqual({ teste: false, consentimento: null });
  });

  it("consentimento fora do formato vira sem valor", () => {
    expect(
      marcasDoPedido({ note_attributes: [{ name: "_xc_consent", value: "yes" }] }).consentimento
    ).toBeNull();
  });
});

// ----------------------------------------------------------------------------
// O Web Pixel do checkout, rodando de verdade num sandbox de mentira.
// ----------------------------------------------------------------------------

type Evento = Record<string, unknown>;

function rodarPixel(privacidadeInicial: Record<string, unknown> | null) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const assinaturas: Record<string, (e: unknown) => void> = {};
  const beacons: Evento[] = [];
  const api = {
    analytics: {
      subscribe: (nome: string, fn: (e: unknown) => void) => {
        handlers[nome] = fn;
      },
    },
    browser: {
      sendBeacon: (_url: string, texto: string) => {
        beacons.push(JSON.parse(texto));
        return true;
      },
    },
    init: {
      data: { shop: { myshopifyDomain: "loja.myshopify.com" } },
      customerPrivacy: privacidadeInicial,
    },
    customerPrivacy: {
      subscribe: (nome: string, fn: (e: unknown) => void) => {
        assinaturas[nome] = fn;
      },
    },
  };
  const ctx: Record<string, unknown> = {
    ctx: api,
    document: {
      getElementsByTagName: () => [
        { src: "https://app.test/xcart-pixel.js?store=S1&shop=loja.myshopify.com" },
      ],
    },
    URL,
    Date,
    JSON,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonte("public", "xcart-pixel.js"), ctx);

  const checkout = (atributos: { key: string; value: string }[]) => ({
    id: "e1",
    clientId: "cliente-1",
    data: { checkout: { token: "T1", attributes: atributos } },
    context: { document: { location: { href: "https://loja.test/checkouts/x" }, referrer: "" } },
  });

  return { handlers, assinaturas, beacons, checkout };
}

describe("o Web Pixel manda teste e consentimento", () => {
  it("le o _xc_teste dos atributos do carrinho", () => {
    const px = rodarPixel({ marketingAllowed: true });
    px.handlers.checkout_started(px.checkout([{ key: "_xc_teste", value: "1" }]));
    expect(px.beacons[0]).toMatchObject({ evento: "begin_checkout", teste: true });
  });

  it("sem o atributo, sem o campo", () => {
    const px = rodarPixel({ marketingAllowed: true });
    px.handlers.checkout_started(px.checkout([{ key: "gclid", value: "G1" }]));
    expect(px.beacons[0]).not.toHaveProperty("teste");
  });

  it("consentimento do inicio, trocado quando o comprador responde ao banner", () => {
    const px = rodarPixel({ marketingAllowed: false });
    px.handlers.checkout_started(px.checkout([]));
    expect(px.beacons[0].consentimento).toBe("negado");

    px.assinaturas.visitorConsentCollected({ customerPrivacy: { marketingAllowed: true } });
    px.handlers.payment_info_submitted(px.checkout([]));
    expect(px.beacons[1].consentimento).toBe("concedido");
  });

  it("sem leitura de privacidade, sem valor", () => {
    const px = rodarPixel(null);
    px.handlers.checkout_started(px.checkout([]));
    expect(px.beacons[0]).not.toHaveProperty("consentimento");
  });
});

// ----------------------------------------------------------------------------
// Os tres arquivos concordam nos nomes.
// ----------------------------------------------------------------------------

describe("contrato entre snippet, pixel, coletor e webhook", () => {
  const snippet = fonte("public", "xcart-click.js");
  const pixel = fonte("public", "xcart-pixel.js");
  const coletor = fonte("src", "app", "api", "tracking", "collect", "route.ts");
  const webhook = fonte("src", "app", "api", "shopify", "webhooks", "route.ts");

  it("os campos que o navegador manda sao os que o coletor le", () => {
    expect(snippet).toMatch(/teste: TESTE \|\| undefined/);
    expect(snippet).toMatch(/consentimento: consentimento\(\) \|\| undefined/);
    expect(pixel).toMatch(/teste: deTeste\(checkout\) \|\| undefined/);
    expect(pixel).toMatch(/consentimento: consentimento\(\) \|\| undefined/);
    expect(coletor).toContain("ehTeste(corpo.teste");
    expect(coletor).toContain("lerConsentimento(corpo.consentimento)");
  });

  it("o atributo que o snippet grava e o que o pixel le", () => {
    expect(snippet).toContain('achados._xc_teste = "1"');
    expect(pixel).toContain('lista[i].key === "_xc_teste"');
  });

  it("coletor e webhook decidem o envio pela mesma regra", () => {
    expect(coletor).toContain("enviaAoDestino(alvo.destino, marcas.teste)");
    expect(webhook).toContain("enviaAoDestino(d, marcas.teste)");
    // Linha que nao sai nao passa por enfileirar: pendente, o cron mandaria.
    expect(coletor).toMatch(/if \(!envia\) \{\s+const \{ duplicado \} = await registrarSemEnviar/);
    expect(webhook).toMatch(/if \(!alvo\.envia\) \{\s+const \{ duplicado \} = await registrarSemEnviar/);
  });
});
