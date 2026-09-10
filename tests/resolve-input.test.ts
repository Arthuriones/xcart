import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { normalizarLinhas, MAX_LINHAS, MAX_QUANTIDADE } from "@/lib/checkout-routes/linhas";

/**
 * /api/checkout-routes/resolve e PUBLICO: sem sessao, com CORS *, e o token
 * que ele pede fica no HTML da vitrine.
 *
 * As linhas do carrinho chegavam por cast -- `body.lines as CheckoutRouteLine[]`
 * -- sem teto nem validacao de elemento. Um corpo com 100 mil linhas fazia o
 * servidor varrer todas e, para cada SKU nao resolvido, paginar o
 * products.json INTEIRO da loja de checkout. De graca, por quem quisesse.
 */

describe("normalizarLinhas: teto de tamanho", () => {
  it("corta em MAX_LINHAS", () => {
    const enorme = Array.from({ length: 100_000 }, (_, i) => ({ sku: `S${i}` }));
    expect(normalizarLinhas(enorme)).toHaveLength(MAX_LINHAS);
  });

  it("corta o SKU gigante", () => {
    const [linha] = normalizarLinhas([{ sku: "S".repeat(5000) }]);
    expect(linha.sku!.length).toBeLessThanOrEqual(120);
  });

  it("carrinho de verdade passa inteiro", () => {
    const cesta = Array.from({ length: 12 }, (_, i) => ({
      sku: `TENIS-${i}`,
      quantity: 2,
    }));
    const saida = normalizarLinhas(cesta);
    expect(saida).toHaveLength(12);
    expect(saida[0]).toMatchObject({ sku: "TENIS-0", quantity: 2 });
  });
});

describe("normalizarLinhas: quantidade", () => {
  const casos: [unknown, number][] = [
    [3, 3],
    [1, 1],
    ["4", 4],
    [0, 1],
    [-5, 1],
    [2.7, 2],
    [NaN, 1],
    [Infinity, 1],
    [undefined, 1],
    [null, 1],
    ["abc", 1],
    [{}, 1],
    [1e9, MAX_QUANTIDADE],
  ];

  for (const [entrada, esperado] of casos) {
    it(`quantity ${JSON.stringify(entrada)} -> ${esperado}`, () => {
      // A quantidade entra no permalink do carrinho. NaN virava a string "NaN"
      // dentro da URL, e negativo/zero nao existe em carrinho.
      expect(normalizarLinhas([{ sku: "X", quantity: entrada }])[0].quantity).toBe(
        esperado
      );
    });
  }
});

describe("normalizarLinhas: lixo", () => {
  it("descarta linha sem nenhum identificador", () => {
    expect(normalizarLinhas([{ quantity: 3 }, {}, null, undefined, 42])).toEqual([]);
  });

  it("entrada que nao e array vira lista vazia", () => {
    for (const lixo of [null, undefined, "x", 42, {}]) {
      expect(normalizarLinhas(lixo)).toEqual([]);
    }
  });

  it("aceita id de variante como numero ou string", () => {
    const saida = normalizarLinhas([
      { sourceVariantId: 123 },
      { targetVariantId: "456" },
    ]);
    expect(saida[0].sourceVariantId).toBe("123");
    expect(saida[1].targetVariantId).toBe("456");
  });

  it("nunca lanca, para qualquer corpo (propriedade)", () => {
    fc.assert(
      fc.property(fc.anything(), (qualquer) => {
        const saida = normalizarLinhas(qualquer);
        return (
          Array.isArray(saida) &&
          saida.length <= MAX_LINHAS &&
          saida.every(
            (l) =>
              Number.isInteger(l.quantity) &&
              (l.quantity as number) >= 1 &&
              (l.quantity as number) <= MAX_QUANTIDADE
          )
        );
      }),
      { numRuns: 2000 }
    );
  });
});
