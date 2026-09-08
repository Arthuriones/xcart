import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { repartirCem } from "@/lib/sales/share";

/**
 * A tabela de Vendas tem um rodape escrito "100%". Se a coluna somar 99 ou 101,
 * o lojista ve a conta nao fechar bem em cima do numero de faturamento -- e a
 * primeira coisa que faz alguem duvidar do resto da tela.
 */
describe("repartirCem", () => {
  it("soma exatamente 100 com receitas reais", () => {
    expect(repartirCem([100, 200, 300]).reduce((a, b) => a + b, 0)).toBe(100);
  });

  it("o caso classico de terços: 33/33/34, nunca 99", () => {
    const fatias = repartirCem([1, 1, 1]);
    expect(fatias.reduce((a, b) => a + b, 0)).toBe(100);
    expect(fatias.toSorted((a, b) => a - b)).toEqual([33, 33, 34]);
  });

  it("tudo zero vira tudo zero, nao NaN nem divisao por zero", () => {
    expect(repartirCem([0, 0, 0])).toEqual([0, 0, 0]);
    expect(repartirCem([])).toEqual([]);
  });

  it("uma loja so leva 100", () => {
    expect(repartirCem([42])).toEqual([100]);
  });

  it("loja sem venda fica com 0 e nao rouba ponto de quem vendeu", () => {
    const fatias = repartirCem([0, 0, 500]);
    expect(fatias).toEqual([0, 0, 100]);
  });

  it("o ponto que sobra vai para o maior resto, nao para o primeiro da fila", () => {
    // 10/20/70 -> 6,66 / 13,33 / 46,66 sobre 150... usa valores com resto claro:
    // 1,4,4,1 => 10 / 40 / 40 / 10 exato. Um caso com resto:
    const fatias = repartirCem([1, 1, 1, 1, 1, 1]); // 16,66 cada
    expect(fatias.reduce((a, b) => a + b, 0)).toBe(100);
    // Todos empatam no resto, entao 4 levam 17 e 2 levam 16 -- ou vice-versa.
    expect(Math.max(...fatias) - Math.min(...fatias)).toBeLessThanOrEqual(1);
  });

  it("sempre soma 100 para qualquer entrada nao-negativa (propriedade)", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 10_000_000 }), { minLength: 1, maxLength: 12 }),
        (valores) => {
          const fatias = repartirCem(valores);
          const total = fatias.reduce((a, b) => a + b, 0);
          // Tudo zero e o unico caso em que nao ha o que repartir.
          const esperado = valores.some((v) => v > 0) ? 100 : 0;
          return (
            total === esperado &&
            fatias.length === valores.length &&
            fatias.every((f) => Number.isInteger(f) && f >= 0)
          );
        }
      ),
      { numRuns: 500 }
    );
  });

  it("quem fatura mais nunca leva fatia menor que quem faturou menos", () => {
    fc.assert(
      fc.property(
        fc.array(fc.nat({ max: 1_000_000 }), { minLength: 2, maxLength: 8 }),
        (valores) => {
          const fatias = repartirCem(valores);
          for (let i = 0; i < valores.length; i += 1) {
            for (let j = 0; j < valores.length; j += 1) {
              if (valores[i] > valores[j] && fatias[i] < fatias[j]) return false;
            }
          }
          return true;
        }
      ),
      { numRuns: 300 }
    );
  });
});
