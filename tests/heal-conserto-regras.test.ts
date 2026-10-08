import { describe, expect, it, vi } from "vitest";

const gravados = vi.hoisted(() => [] as { productId: string; updates: { variantId: string; sku: string }[] }[]);
vi.mock("@/lib/shopify/client", () => ({
  updateVariantSkus: async (_c: unknown, productId: string, updates: { variantId: string; sku: string }[]) => {
    gravados.push({ productId, updates });
  },
}));

import {
  COBERTURA_MINIMA_PARA_CRIAR,
  MAX_PRODUTOS_POR_PASSADA,
  decidirCriacao,
  mensagemDeCriacaoPendente,
  parPeloMapaAntigo,
} from "@/lib/checkout-routes/conserto-regras";
import { produtoNoDestino } from "@/lib/checkout-routes/produto-no-destino";
import { donoDoSkuRepetido, normalizarSkus, skuNeutro } from "@/lib/shopify/sku-stamp";

const CREDS = { shopDomain: "v.myshopify.com", clientId: "a", clientSecret: "b" };

describe("par pelo variant_map antigo (SKU trocado na vitrine)", () => {
  const checkout = new Map([
    ["7001", { sku: "sku-velho" }],
    ["7002", { sku: "" }],
    ["7003", { sku: "de-outro-produto" }],
  ]);
  const base = {
    checkoutPorId: checkout,
    reivindicadas: new Set<string>(),
    skusDaVitrine: new Set(["sku-novo", "de-outro-produto"]),
  };

  it("adota a variante viva para onde o mapa ja apontava", () => {
    expect(parPeloMapaAntigo({ ...base, varianteId: 1000, mapaAntigo: { "1000": "7001" } })).toBe("7001");
  });

  it("le chave em gid e valor em gid", () => {
    expect(
      parPeloMapaAntigo({
        ...base,
        varianteId: 1000,
        mapaAntigo: { "gid://shopify/ProductVariant/1000": "gid://shopify/ProductVariant/7002" },
      })
    ).toBe("7002");
  });

  it("variante apagada no checkout: ai falta de verdade", () => {
    expect(parPeloMapaAntigo({ ...base, varianteId: 1000, mapaAntigo: { "1000": "7999" } })).toBeNull();
  });

  it("variante que ja e par de outra nesta passada: nao adota", () => {
    expect(
      parPeloMapaAntigo({
        ...base,
        reivindicadas: new Set(["7001"]),
        varianteId: 1000,
        mapaAntigo: { "1000": "7001" },
      })
    ).toBeNull();
  });

  it("variante cujo SKU e de outra variante viva da vitrine: o mapa e que esta errado", () => {
    expect(parPeloMapaAntigo({ ...base, varianteId: 1000, mapaAntigo: { "1000": "7003" } })).toBeNull();
  });

  it("sem entrada no mapa: nada", () => {
    expect(parPeloMapaAntigo({ ...base, varianteId: 1000, mapaAntigo: {} })).toBeNull();
  });
});

describe("trava de criacao do conserto", () => {
  const saudavel = {
    confirmado: false,
    rotaLigada: true,
    destinoLigado: true,
    peso: 1,
    variantesComPar: 90,
    variantesTotal: 100,
    produtosNovos: 5,
  };

  it("par saudavel e leva pequena: cria", () => {
    expect(decidirCriacao(saudavel)).toEqual({ criarProdutos: true, estenderProdutos: true, motivo: null });
  });

  it("rota pausada, loja pausada ou com peso 0: so mapeia", () => {
    for (const caso of [{ rotaLigada: false }, { destinoLigado: false }, { peso: 0 }]) {
      const d = decidirCriacao({ ...saudavel, ...caso });
      expect(d.criarProdutos).toBe(false);
      expect(d.estenderProdutos).toBe(false);
      expect(d.motivo).toBeTruthy();
    }
  });

  it("cobertura abaixo do piso: o par nao parece o certo", () => {
    const abaixo = Math.floor(COBERTURA_MINIMA_PARA_CRIAR * 100) - 1;
    const d = decidirCriacao({ ...saudavel, variantesComPar: abaixo });
    expect(d.criarProdutos).toBe(false);
    expect(d.estenderProdutos).toBe(false);
    expect(d.motivo).toContain(`${abaixo}%`);
  });

  it("muitos produtos de uma vez: estende, mas nao cria produto novo", () => {
    const d = decidirCriacao({ ...saudavel, produtosNovos: MAX_PRODUTOS_POR_PASSADA + 1 });
    expect(d.criarProdutos).toBe(false);
    expect(d.estenderProdutos).toBe(true);
  });

  it("confirmado pelo lojista: cria mesmo barrado", () => {
    const d = decidirCriacao({ ...saudavel, confirmado: true, peso: 0, variantesComPar: 1 });
    expect(d.criarProdutos).toBe(true);
  });

  it("frase do card", () => {
    expect(mensagemDeCriacaoPendente(7, 9, "a rota está pausada")).toBe(
      "7 produtos da vitrine faltam na loja de checkout e não foram criados sozinhos (a rota está pausada). Confira e confirme em Diagnóstico."
    );
    expect(mensagemDeCriacaoPendente(0, 1, "x")).toContain("1 variante da vitrine falta");
  });
});

describe("produto do checkout pela irma casada (por SKU ou pelo mapa)", () => {
  it("aceita uma funcao: a irma casada pelo variant_map conta", () => {
    const pares = new Map([[1001, { variantId: "7001", productId: "P" }]]);
    const variantes = [
      { id: 1000, sku: "nova" },
      { id: 1001, sku: "trocada" },
    ];
    expect(produtoNoDestino(variantes, (v) => pares.get(v.id))?.productId).toBe("P");
    expect(produtoNoDestino([{ id: 1000, sku: "nova" }], (v) => pares.get(v.id))).toBeNull();
  });
});

describe("SKU repetido: dono deterministico", () => {
  it("prefere a mapeada; sem mapeada, o menor id (ids maiores que Number)", () => {
    const a = { numero: "46141126344751" };
    const b = { numero: "9007199254740993" };
    expect(donoDoSkuRepetido([b, a], new Set())).toBe(a);
    expect(donoDoSkuRepetido([a, b], new Set(["9007199254740993"]))).toBe(b);
  });

  it("a ordem do feed nao muda o dono (products.json vem do mais novo)", async () => {
    gravados.length = 0;
    const novoPrimeiro = [
      { id: 200, title: "copia", variants: [{ id: 2000, sku: "BOLSA" }] },
      { id: 100, title: "original", variants: [{ id: 1000, sku: "bolsa" }] },
    ];
    const r = await normalizarSkus(CREDS, novoPrimeiro);
    expect(r.desduplicadas).toBe(1);
    expect(r.skuPorVariante.get("gid://shopify/ProductVariant/1000")).toBe("bolsa");
    expect(r.skuPorVariante.get("gid://shopify/ProductVariant/2000")).toBe(skuNeutro(2000));
    expect(gravados).toEqual([
      {
        productId: "gid://shopify/Product/200",
        updates: [{ variantId: "gid://shopify/ProductVariant/2000", sku: skuNeutro(2000) }],
      },
    ]);
  });

  it("a variante ja mapeada fica com o SKU, mesmo sendo a mais nova", async () => {
    gravados.length = 0;
    const r = await normalizarSkus(
      CREDS,
      [
        { id: 100, title: "original", variants: [{ id: 1000, sku: "bolsa" }] },
        { id: 200, title: "nova", variants: [{ id: 2000, sku: "bolsa" }] },
      ],
      { mapeadas: ["gid://shopify/ProductVariant/2000"] }
    );
    expect(r.skuPorVariante.get("gid://shopify/ProductVariant/2000")).toBe("bolsa");
    expect(r.skuPorVariante.get("gid://shopify/ProductVariant/1000")).toBe(skuNeutro(1000));
  });

  it("soSemSku: carimba quem nao tem e deixa repetido como esta", async () => {
    gravados.length = 0;
    const r = await normalizarSkus(
      CREDS,
      [
        { id: 100, title: "a", variants: [{ id: 1000, sku: "x" }, { id: 1001, sku: null }] },
        { id: 200, title: "b", variants: [{ id: 2000, sku: "x" }] },
      ],
      { soSemSku: true }
    );
    expect(r.carimbadas).toBe(1);
    expect(r.desduplicadas).toBe(0);
    expect(r.skuPorVariante.get("gid://shopify/ProductVariant/2000")).toBe("x");
    expect(gravados).toHaveLength(1);
  });
});
