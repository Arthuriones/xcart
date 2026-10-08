import { describe, expect, it } from "vitest";
import {
  casarVariantesDoProduto,
  ehOMesmoProduto,
  type ProdutoParaCasar,
} from "@/lib/checkout-routes/casar-variantes";

// ============================================================================
// create-destination (modo "gerar" do assistente). Duas bolsas diferentes,
// neutralizadas para o mesmo titulo ("Small Leather Shoulder Bag"), caiam no
// mesmo handle: a segunda achava a primeira como "ja existe", casava as
// variantes pela POSICAO e gravava o SKU dela por cima do da primeira.
// ============================================================================

function produto(handle: string, variantes: [id: string, sku: string | null, cor: string][]): ProdutoParaCasar {
  return {
    handle,
    variants: {
      nodes: variantes.map(([id, sku, cor]) => ({ id, sku, selectedOptions: [{ name: "Cor", value: cor }] })),
    },
  };
}

const bolsaA = produto("small-leather-shoulder-bag", [
  ["ckA1", "gucci-marmont-preta", "Preta"],
  ["ckA2", "gucci-marmont-bege", "Bege"],
]);
const bolsaB = produto("prada-arque", [
  ["vB1", "prada-arque-preta", "Black"],
  ["vB2", "prada-arque-branca", "White"],
]);

describe("o produto achado pelo handle e mesmo o desta bolsa?", () => {
  it("handle do titulo da IA, produto la com SKU de outra bolsa: NAO", () => {
    expect(ehOMesmoProduto(bolsaB, bolsaA, { handleConfiavel: false })).toBe(false);
    expect(ehOMesmoProduto(bolsaB, bolsaA, { handleConfiavel: true })).toBe(false);
  });

  it("um SKU da vitrine no produto achado: sim", () => {
    const la = produto("x", [["ck1", "prada-arque-preta", "Preto"]]);
    expect(ehOMesmoProduto(bolsaB, la, { handleConfiavel: false })).toBe(true);
  });

  it("produto la sem SKU nenhum: so com o handle da propria vitrine", () => {
    const semSku = produto("x", [["ck1", null, "Black"]]);
    expect(ehOMesmoProduto(bolsaB, semSku, { handleConfiavel: false })).toBe(false);
    expect(ehOMesmoProduto(bolsaB, semSku, { handleConfiavel: true })).toBe(true);
  });
});

describe("variante a variante", () => {
  it("produto que ja existia: sem casamento por posicao, e sem regravar SKU de outra", () => {
    // Mesmo se ehOMesmoProduto deixasse passar, as opcoes nao batem e os SKUs
    // la sao de outra bolsa: nada casa.
    const r = casarVariantesDoProduto(bolsaB, bolsaA, { porPosicao: false });
    expect(r.variantMap).toEqual({});
    expect(r.preencherSku).toEqual([]);
  });

  it("produto recem-criado com opcoes traduzidas: casa pela posicao", () => {
    const criado = produto("x", [
      ["ck1", "prada-arque-preta", "Preto"],
      ["ck2", "prada-arque-branca", "Branco"],
    ]);
    const r = casarVariantesDoProduto(bolsaB, criado, { porPosicao: true });
    expect(r.variantMap).toEqual({ vB1: "ck1", vB2: "ck2" });
  });

  it("recem-criado sem SKU (vitrine sem SKU) e opcao traduzida: posicao, e preenche SKU so se houver", () => {
    const vitrine = produto("v", [
      ["v1", null, "Black"],
      ["v2", "sku-2", "White"],
    ]);
    const criado = produto("x", [
      ["ck1", null, "Preto"],
      ["ck2", null, "Branco"],
    ]);
    const r = casarVariantesDoProduto(vitrine, criado, { porPosicao: true });
    expect(r.variantMap).toEqual({ v1: "ck1", v2: "ck2" });
    expect(r.preencherSku).toEqual([{ variantId: "ck2", sku: "sku-2" }]);
  });

  it("posicao so vale com o mesmo numero de variantes (a Shopify descartou combinacao repetida)", () => {
    const vitrine = produto("v", [
      ["v1", null, "Black"],
      ["v2", null, "Black"],
      ["v3", null, "White"],
    ]);
    const criado = produto("x", [
      ["ck1", null, "Preto"],
      ["ck2", null, "Branco"],
    ]);
    const r = casarVariantesDoProduto(vitrine, criado, { porPosicao: true });
    expect(r.variantMap).toEqual({});
  });

  it("SKU primeiro, depois opcoes; nunca duas da vitrine na mesma do checkout", () => {
    const vitrine = produto("v", [
      ["v1", "s1", "Preta"],
      ["v2", "s2", "Preta"],
    ]);
    const la = produto("x", [["ck1", "s1", "Preta"]]);
    const r = casarVariantesDoProduto(vitrine, la, { porPosicao: false });
    expect(r.variantMap).toEqual({ v1: "ck1" });
  });

  it("variante do checkout sem SKU e mesma opcao: casa e preenche o SKU nela", () => {
    const vitrine = produto("v", [["v1", "s1", "Preta"]]);
    const la = produto("x", [["ck1", null, "Preta"]]);
    const r = casarVariantesDoProduto(vitrine, la, { porPosicao: false });
    expect(r.variantMap).toEqual({ v1: "ck1" });
    expect(r.skuMap).toEqual({ s1: "ck1" });
    expect(r.preencherSku).toEqual([{ variantId: "ck1", sku: "s1" }]);
  });

  it("variante do checkout com OUTRO SKU e mesma opcao: nao casa (e par de outra)", () => {
    const vitrine = produto("v", [["v1", "s-novo", "Preta"]]);
    const la = produto("x", [["ck1", "s-velho", "Preta"]]);
    const r = casarVariantesDoProduto(vitrine, la, { porPosicao: false });
    expect(r.variantMap).toEqual({});
  });
});
