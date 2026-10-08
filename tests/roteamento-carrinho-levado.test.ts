import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import type { RouteTarget } from "@/lib/checkout-routes/rotation";

// ============================================================================
// O que vai junto com o carrinho para a loja de checkout:
//   1. o cupom aplicado na vitrine (?discount=CODIGO, so o codigo);
//   2. o pais/idioma do checkout POR LOJA DE CHECKOUT (settings do destino),
//      com "pais do comprador" sem country;
//   3. a moeda do carrinho da vitrine na telemetria do routed_ok.
// E o que nao pode se perder no caminho: casar a loja de novo nao apaga o
// ajuste nem o peso.
// ============================================================================

const banco = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  destinos: [] as unknown[],
  inseridos: [] as Record<string, unknown>[],
  rota: { id: "rota-1" } as { id: string } | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (tabela: string) => {
      const api = {
        select: () => api,
        eq: () => api,
        single: async () =>
          tabela === "routed_checkout_configs"
            ? { data: banco.config ?? banco.rota, error: banco.config || banco.rota ? null : { message: "x" } }
            : { data: null, error: null },
        insert: async (linha: Record<string, unknown>) => {
          banco.inseridos.push(linha);
          return { error: null };
        },
      };
      return api;
    },
  }),
}));

vi.mock("@/lib/checkout-routes/targets", () => ({
  destinosParaRotear: async () => banco.destinos,
  RouteTargetsLoadError: class extends Error {},
}));
vi.mock("@/lib/checkout-routes/hidratar-por-sku", () => ({
  hydrateTargetBySku: async (t: unknown) => t,
}));
vi.mock("@/lib/checkout-routes/pedidos-24h", () => ({
  contarPedidos24h: async () => ({}),
}));

const { POST: resolve } = await import("@/app/api/checkout-routes/resolve/route");
const { POST: trackFallback } = await import("@/app/api/checkout-routes/track-fallback/route");
const { buildCartPermalink, normalizarCupons, MAX_CUPONS, MAX_CUPOM } = await import(
  "@/lib/shopify/cart-routing"
);
const { toEmbedTarget } = await import("@/lib/checkout-routes/embed-config");
const { mercadoDoDestino, ajusteParaGravar, checkoutDoDestino, PAIS_DO_COMPRADOR } = await import(
  "@/lib/checkout-routes/mercado"
);
const { linhaDoDestinoConectado } = await import("@/lib/checkout-routes/destino-conectado");
const {
  avisoDeMoeda,
  lerCarrinhoLevado,
  lerMoedaDoLevado,
  resumirMoedas,
  sufixoDaMoeda,
} = await import("@/lib/checkout-routes/carrinho-levado");

const LOADER = readFileSync(path.resolve(__dirname, "../public/routed-checkout-loader.js"), "utf8");

function extrairFuncao(nome: string): string {
  const inicio = LOADER.indexOf(`function ${nome}(`);
  if (inicio === -1) throw new Error(`funcao ${nome} nao encontrada no loader`);
  let nivel = 0;
  let vistoAbre = false;
  for (let i = inicio; i < LOADER.length; i += 1) {
    const c = LOADER[i];
    if (c === "{") {
      nivel += 1;
      vistoAbre = true;
    } else if (c === "}") {
      nivel -= 1;
      if (vistoAbre && nivel === 0) return LOADER.slice(inicio, i + 1);
    }
  }
  throw new Error(`nao consegui fechar a funcao ${nome}`);
}

function constanteDoLoader(nome: string): number {
  const m = new RegExp(`var ${nome} = (\\d+);`).exec(LOADER);
  if (!m) throw new Error(`${nome} sumiu do loader`);
  return Number(m[1]);
}

const cuponsDoLoader = new Function(
  `var MAX_CUPONS = ${constanteDoLoader("MAX_CUPONS")}; var MAX_CUPOM = ${constanteDoLoader("MAX_CUPOM")};
   ${extrairFuncao("cupomValido")}
   ${extrairFuncao("cuponsDoCarrinho")}
   return cuponsDoCarrinho;`
)() as (cart: unknown) => string[];

const LINHAS = [{ variantId: "987", quantity: 1 }];

function destino(over: Partial<RouteTarget> = {}): RouteTarget {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    targetStoreId: "s1",
    domain: "checkout-a.myshopify.com",
    weight: 1,
    enabled: true,
    skuMap: { "xc-abc": "987" },
    variantMap: {},
    settings: {},
    targetLanguage: "en-US",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// 1. Cupom
// ---------------------------------------------------------------------------

describe("cupom no permalink", () => {
  it("vai como ?discount=CODIGO, depois do mercado", () => {
    const url = new URL(
      buildCartPermalink("checkout-a.myshopify.com", LINHAS, { country: "US", locale: "en-US" }, {
        discountCodes: ["BEMVINDO10"],
      })
    );
    expect(url.searchParams.get("discount")).toBe("BEMVINDO10");
    expect([...url.searchParams.keys()]).toEqual(["country", "locale", "discount"]);
  });

  it("varios codigos vao separados por virgula, sem repetir (cupom nao diferencia maiuscula)", () => {
    const url = new URL(
      buildCartPermalink("checkout-a.myshopify.com", LINHAS, undefined, {
        discountCodes: ["FRETE", " SAVE10 ", "frete", "VIP"],
      })
    );
    expect(url.searchParams.get("discount")).toBe("FRETE,SAVE10,VIP");
  });

  it("codigo com virgula, vazio, longo ou com controle nao passa; sem cupom valido, sem parametro", () => {
    const url = new URL(
      buildCartPermalink("checkout-a.myshopify.com", LINHAS, undefined, {
        discountCodes: ["a,b", "", "x".repeat(MAX_CUPOM + 1), "tab\there", 42, null],
      })
    );
    expect(url.searchParams.has("discount")).toBe(false);
    expect(url.search).toBe("");
  });

  it("no maximo MAX_CUPONS codigos, e entrada que nao e lista vira nada", () => {
    expect(normalizarCupons(["A", "B", "C", "D", "E", "F", "G"])).toHaveLength(MAX_CUPONS);
    expect(normalizarCupons("SAVE10")).toEqual([]);
    expect(normalizarCupons({ 0: "SAVE10" })).toEqual([]);
  });

  it("loader e servidor aceitam e recusam os mesmos codigos", () => {
    expect(constanteDoLoader("MAX_CUPONS")).toBe(MAX_CUPONS);
    expect(constanteDoLoader("MAX_CUPOM")).toBe(MAX_CUPOM);
    const casos: unknown[][] = [
      ["SAVE10"],
      [" espaco nas pontas "],
      ["com espaço no meio"],
      ["a,b", "OK"],
      ["x".repeat(64), "y".repeat(65)],
      ["dup", "DUP", "Dup"],
      ["constructor", "__proto__", "toString"],
      ["linha\nquebrada", "nul\u0000", "ok"],
      ["A", "B", "C", "D", "E", "F"],
      [7, null, undefined, "", "   "],
    ];
    for (const codigos of casos) {
      const carrinho = { discount_codes: codigos.map((code) => ({ code, applicable: true })) };
      expect(cuponsDoLoader(carrinho), JSON.stringify(codigos)).toEqual(normalizarCupons(codigos));
    }
  });

  it("o loader le o codigo dos tres lugares do /cart.js e ignora o nao aplicavel e o automatico", () => {
    const carrinho = {
      discount_codes: [
        { code: "SAVE10", applicable: true },
        { code: "NAOVALE", applicable: false },
      ],
      cart_level_discount_applications: [
        { type: "discount_code", title: "FRETEGRATIS", value: "100.0" },
        { type: "automatic", title: "Leve 3 pague 2" },
      ],
      items: [
        {
          line_level_discount_allocations: [
            { amount: 250, discount_application: { type: "discount_code", title: "save10" } },
            { amount: 100, discount_application: { type: "script", title: "Bloodroot discount!" } },
            { amount: 50, discount_application: { type: "discount_code", title: "LINHA5" } },
          ],
        },
        { line_level_discount_allocations: null },
      ],
    };
    expect(cuponsDoLoader(carrinho)).toEqual(["SAVE10", "FRETEGRATIS", "LINHA5"]);
    expect(cuponsDoLoader({ items: [] })).toEqual([]);
    expect(cuponsDoLoader(null)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Pais/idioma por loja de checkout
// ---------------------------------------------------------------------------

describe("pais e idioma do checkout, por destino", () => {
  it("sem ajuste: o de sempre, pais do idioma da loja", () => {
    expect(mercadoDoDestino({}, "en-US")).toEqual({ country: "US", locale: "en-US" });
    expect(mercadoDoDestino({ generatedBy: "connect_wizard" }, "pt-BR")).toEqual({
      country: "BR",
      locale: "pt-BR",
    });
    expect(mercadoDoDestino(null, null)).toEqual({});
  });

  it("pais fixo do destino ganha do idioma (o que ja esta gravado em producao: CL/es-CL)", () => {
    expect(mercadoDoDestino({ checkout_country: "CL", checkout_locale: "es-CL" }, "pt-BR")).toEqual({
      country: "CL",
      locale: "es-CL",
    });
  });

  it("pais do comprador nao manda country nem locale", () => {
    expect(mercadoDoDestino({ checkout_country: PAIS_DO_COMPRADOR }, "en-US")).toEqual({});
  });

  it("valor torto vale como nada gravado, nunca vira parametro", () => {
    expect(mercadoDoDestino({ checkout_country: "USA" }, "en-US")).toEqual({ country: "US", locale: "en-US" });
    expect(mercadoDoDestino({ checkout_country: "cl", checkout_locale: "<x>" }, "en-US")).toEqual({
      country: "CL",
    });
  });

  it("embed-config (caminho inline do tema) le o settings do destino", () => {
    expect(toEmbedTarget(destino({ settings: { checkout_country: "MX", checkout_locale: "es-MX" } }))).toMatchObject({
      country: "MX",
      locale: "es-MX",
    });
    const auto = toEmbedTarget(destino({ settings: { checkout_country: PAIS_DO_COMPRADOR } }));
    expect(auto.country).toBe("");
    expect(auto.locale).toBe("");
    expect(toEmbedTarget(destino())).toMatchObject({ country: "US", locale: "en-US" });
  });

  it("o que a tela grava: padrao apaga, auto e o comprador, pais fixo leva o idioma da lista", () => {
    expect(ajusteParaGravar("")).toEqual({ ok: true, checkout_country: null, checkout_locale: null });
    expect(ajusteParaGravar("AUTO")).toEqual({ ok: true, checkout_country: "auto", checkout_locale: null });
    expect(ajusteParaGravar("fr")).toEqual({ ok: true, checkout_country: "FR", checkout_locale: "fr-FR" });
    expect(ajusteParaGravar("NZ")).toEqual({ ok: true, checkout_country: "NZ", checkout_locale: null });
    expect(ajusteParaGravar("Brasil").ok).toBe(false);
    expect(ajusteParaGravar("BR", "pt_BR;drop").ok).toBe(false);
    expect(checkoutDoDestino({ checkout_country: "auto", checkout_domain: " pay.loja.com " })).toEqual({
      modo: "comprador",
      pais: null,
      dominio: "pay.loja.com",
    });
  });
});

// ---------------------------------------------------------------------------
// /resolve: settings do destino sorteado + cupom
// ---------------------------------------------------------------------------

describe("/api/checkout-routes/resolve", () => {
  beforeEach(() => {
    banco.config = {
      id: "rota-1",
      name: "Rota",
      enabled: true,
      mode: "enterprise_static",
      rotation: { strategy: "sticky" },
      sku_map: {},
      variant_map: {},
      // Ajuste antigo na ROTA: nao vale para destino com linha propria.
      settings: { checkout_country: "JP", checkout_locale: "ja-JP" },
      target_store_id: "s1",
      target: null,
    };
  });

  async function chamar(corpo: Record<string, unknown>) {
    const r = await resolve(
      new NextRequest("http://x/api/checkout-routes/resolve", {
        method: "POST",
        body: JSON.stringify({
          token: "tok",
          lines: [{ sku: "XC-ABC", sourceVariantId: "gid://shopify/ProductVariant/111", quantity: 2 }],
          ...corpo,
        }),
      })
    );
    expect(r.status).toBe(200);
    return new URL(((await r.json()) as { redirectUrl: string }).redirectUrl);
  }

  it("usa o pais fixo do DESTINO, nao o da rota, e leva o cupom", async () => {
    banco.destinos = [destino({ settings: { checkout_country: "CL", checkout_locale: "es-CL" } })];
    const url = await chamar({ discountCodes: ["BEMVINDO10", "a,b"] });
    expect(url.host).toBe("checkout-a.myshopify.com");
    expect(url.pathname).toBe("/cart/987:2");
    expect(url.searchParams.get("country")).toBe("CL");
    expect(url.searchParams.get("locale")).toBe("es-CL");
    expect(url.searchParams.get("discount")).toBe("BEMVINDO10");
  });

  it("pais do comprador: sem country no permalink", async () => {
    banco.destinos = [destino({ settings: { checkout_country: "auto" } })];
    const url = await chamar({});
    expect(url.searchParams.has("country")).toBe(false);
    expect(url.searchParams.has("locale")).toBe(false);
    expect(url.searchParams.has("discount")).toBe(false);
  });

  it("destino sem ajuste continua como sempre: pais do idioma da loja", async () => {
    banco.destinos = [destino()];
    const url = await chamar({ discountCodes: "SAVE10" });
    expect(url.searchParams.get("country")).toBe("US");
    // Cupom que nao veio como lista nao passa.
    expect(url.searchParams.has("discount")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Casar a loja de novo nao apaga o ajuste nem o peso
// ---------------------------------------------------------------------------

describe("connect-by-sku: loja que ja estava na rota", () => {
  const base = {
    routeId: "rota-1",
    targetStoreId: "s1",
    skuMap: { a: "1" },
    variantMap: { b: "2" },
    position: 2,
  };

  it("mantem pais, idioma, dominio e o peso; refaz so o mapa", () => {
    const linha = linhaDoDestinoConectado({
      ...base,
      seguro: true,
      existente: {
        weight: 3,
        settings: {
          generatedBy: "connect_wizard",
          checkout_country: "auto",
          checkout_domain: "pay.loja.com",
        },
      },
    });
    expect(linha.weight).toBe(3);
    expect(linha.settings).toEqual({
      generatedBy: "connect_wizard",
      checkout_country: "auto",
      checkout_domain: "pay.loja.com",
    });
    expect(linha.sku_map).toEqual({ a: "1" });
    expect(linha.variant_map).toEqual({ b: "2" });
    expect(linha.position).toBe(2);
  });

  it("peso 0 escolhido pelo lojista continua 0", () => {
    expect(linhaDoDestinoConectado({ ...base, seguro: true, existente: { weight: 0, settings: {} } }).weight).toBe(0);
  });

  it("loja nova: peso 1, e 0 com cobertura ruim; cobertura ruim zera tambem a que ja estava", () => {
    const nova = linhaDoDestinoConectado({ ...base, seguro: true });
    expect(nova.weight).toBe(1);
    expect(nova.settings).toEqual({ generatedBy: "connect_by_sku" });
    expect(linhaDoDestinoConectado({ ...base, seguro: false }).weight).toBe(0);
    expect(
      linhaDoDestinoConectado({
        ...base,
        seguro: false,
        existente: { weight: 5, settings: { checkout_country: "CL" } },
      })
    ).toMatchObject({ weight: 0, settings: { checkout_country: "CL" } });
  });

  it("a rota usa o helper com o weight e o settings que leu", () => {
    const fonte = readFileSync(
      path.resolve(__dirname, "../src/app/api/checkout-routes/connect-by-sku/route.ts"),
      "utf8"
    );
    expect(fonte).toContain(".select(\"target_store_id, position, variant_map, weight, settings\")");
    expect(fonte).toContain("linhaDoDestinoConectado(");
    // O upsert antigo gravava isto por cima de todo destino que ja existia.
    expect(fonte).not.toMatch(/upsert\(\s*\{[^}]*settings: \{ generatedBy: "connect_by_sku" \}/);
  });
});

// ---------------------------------------------------------------------------
// 3. Moeda do carrinho na telemetria
// ---------------------------------------------------------------------------

describe("moeda do carrinho no routed_ok", () => {
  it("o sufixo so sai com moeda valida; pais vazio e 'auto'", () => {
    expect(sufixoDaMoeda("eur", "US")).toBe(" moeda=EUR pais=US");
    expect(sufixoDaMoeda("EUR", "")).toBe(" moeda=EUR pais=auto");
    expect(sufixoDaMoeda("EUR", undefined)).toBe(" moeda=EUR");
    expect(sufixoDaMoeda("EURO", "US")).toBe("");
    expect(sufixoDaMoeda(undefined, "US")).toBe("");
    expect(sufixoDaMoeda("EUR", "<script>")).toBe(" moeda=EUR");
  });

  it("le itens e dominio com e sem o sufixo, e a moeda so quando ha", () => {
    expect(lerCarrinhoLevado("3 itens -> loja.myshopify.com moeda=EUR pais=US")).toEqual({
      itens: 3,
      dominio: "loja.myshopify.com",
    });
    expect(lerCarrinhoLevado("3 itens -> loja.myshopify.com")).toEqual({ itens: 3, dominio: "loja.myshopify.com" });
    expect(lerMoedaDoLevado("3 itens -> loja.myshopify.com moeda=EUR pais=US")).toEqual({ moeda: "EUR", pais: "US" });
    expect(lerMoedaDoLevado("3 itens -> loja.myshopify.com moeda=EUR pais=auto")).toEqual({ moeda: "EUR", pais: null });
    expect(lerMoedaDoLevado("3 itens -> loja.myshopify.com")).toBeNull();
    expect(lerMoedaDoLevado("TypeError: Failed to fetch")).toBeNull();
  });

  it("avisa quando o carrinho e o checkout ficam em moedas diferentes, e so quando da para saber", () => {
    expect(avisoDeMoeda("2 itens -> a.myshopify.com moeda=EUR pais=US")).toBe(" Carrinho em EUR, checkout em USD.");
    expect(avisoDeMoeda("2 itens -> a.myshopify.com moeda=USD pais=US")).toBe("");
    expect(avisoDeMoeda("2 itens -> a.myshopify.com moeda=EUR pais=auto")).toBe("");
    expect(avisoDeMoeda("2 itens -> a.myshopify.com moeda=EUR pais=NZ")).toBe("");
    expect(avisoDeMoeda("2 itens -> a.myshopify.com")).toBe("");
  });

  it("resume as moedas dos carrinhos, da mais comum para a menos", () => {
    expect(
      resumirMoedas([
        "1 itens -> a moeda=EUR pais=US",
        "1 itens -> a moeda=USD pais=US",
        "1 itens -> a moeda=EUR pais=auto",
        "1 itens -> a",
        null,
      ])
    ).toEqual([
      { moeda: "EUR", carrinhos: 2 },
      { moeda: "USD", carrinhos: 1 },
    ]);
  });

  it("track-fallback grava o sufixo no routed_ok, escrito pelo servidor", async () => {
    banco.config = null;
    banco.rota = { id: "rota-1" };
    banco.inseridos.length = 0;
    const enviar = (corpo: Record<string, unknown>) =>
      trackFallback(
        new NextRequest("http://x/api/checkout-routes/track-fallback", {
          method: "POST",
          headers: { "Content-Type": "text/plain;charset=UTF-8" },
          body: JSON.stringify({ token: "tok", ...corpo }),
        })
      );

    await enviar({
      reason: "routed_ok",
      // Texto do navegador com chave=valor forjado: sai antes do sufixo.
      detail: "2 itens -> a.myshopify.com moeda=BRL",
      moeda: "EUR",
      paisCheckout: "",
    });
    await enviar({ reason: "cart_checkout_error", detail: "Load failed", moeda: "EUR", paisCheckout: "US" });
    await enviar({ reason: "routed_ok", detail: "1 itens -> a.myshopify.com" });

    expect(banco.inseridos.map((l) => l.detail)).toEqual([
      "2 itens -> a.myshopify.com moeda=EUR pais=auto",
      "Load failed",
      "1 itens -> a.myshopify.com",
    ]);
  });
});
