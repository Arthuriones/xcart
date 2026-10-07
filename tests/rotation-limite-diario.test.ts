import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { pickTarget, type RouteTarget } from "@/lib/checkout-routes/rotation";
import { toEmbedTarget } from "@/lib/checkout-routes/embed-config";
import { limiteValido, mudancasDaLista } from "@/app/(dashboard)/clone/routed-checkout/logica";

/**
 * Teto de pedidos por dia no rodizio: para aquecer uma conta de pagamento se
 * manda poucos pedidos para ela e o resto para a principal. Regras travadas:
 *
 *   - destino que bateu o teto sai do sorteio;
 *   - cobertura vem antes do teto (teto nunca custa item de carrinho);
 *   - teto macio: todos cheios, o carrinho vai assim mesmo;
 *   - sem contagem (rota sem teto) nada muda -- e o que mantem a paridade com
 *     o loader, que nao conhece a contagem e por isso nem sorteia inline
 *     quando ha teto.
 */

function alvo(id: string, over: Partial<RouteTarget> = {}): RouteTarget {
  return {
    id,
    targetStoreId: `loja-${id}`,
    domain: `${id}.myshopify.com`,
    weight: 1,
    enabled: true,
    skuMap: { "sku-1": `${id}-v1`, "sku-2": `${id}-v2` },
    variantMap: {},
    settings: {},
    dailyLimit: null,
    ...over,
  };
}

const UMA_LINHA = [{ sku: "sku-1", quantity: 1 }];
const CHAVES = Array.from({ length: 30 }, (_, i) => `comprador-${i}`);

function escolhidos(alvos: RouteTarget[], pedidos24h?: Record<string, number>, lines = UMA_LINHA) {
  return new Set(
    CHAVES.map((k) => pickTarget(alvos, lines, { rotationKey: k, strategy: "sticky", pedidos24h })?.chosen.target.id)
  );
}

describe("teto de pedidos por dia no sorteio", () => {
  it("destino que bateu o teto sai do sorteio", () => {
    const alvos = [alvo("a", { dailyLimit: 1 }), alvo("b")];
    expect(escolhidos(alvos, { "loja-a": 1 })).toEqual(new Set(["b"]));
    // Abaixo do teto ele disputa normalmente.
    expect(escolhidos(alvos, { "loja-a": 0 })).toEqual(new Set(["a", "b"]));
  });

  it("sem contagem o teto nao segura (rota sem teto: paridade com o loader)", () => {
    const alvos = [alvo("a", { dailyLimit: 1 }), alvo("b")];
    expect(escolhidos(alvos)).toEqual(new Set(["a", "b"]));
  });

  it("teto macio: todos cheios, o carrinho vai assim mesmo e o motivo diz", () => {
    const alvos = [alvo("a", { dailyLimit: 1 }), alvo("b", { dailyLimit: 2 })];
    const pick = pickTarget(alvos, UMA_LINHA, { rotationKey: "x", pedidos24h: { "loja-a": 1, "loja-b": 2 } });
    expect(pick).not.toBeNull();
    expect(["a", "b"]).toContain(pick!.chosen.target.id);
    expect(pick!.reason).toBe("all_full");
  });

  it("cobertura vem antes do teto: loja cheia que cobre o carrinho inteiro ganha da parcial com vaga", () => {
    const duasLinhas = [
      { sku: "sku-1", quantity: 1 },
      { sku: "sku-2", quantity: 1 },
    ];
    const alvos = [
      alvo("cheia", { dailyLimit: 1 }),
      alvo("parcial", { skuMap: { "sku-1": "p-v1" } }),
    ];
    expect(escolhidos(alvos, { cheia: 0, "loja-cheia": 1 }, duasLinhas)).toEqual(new Set(["cheia"]));
  });

  it("peso 0 continua fora, mesmo com vaga", () => {
    const alvos = [alvo("a", { weight: 0, dailyLimit: 5 }), alvo("b", { dailyLimit: 5 })];
    expect(escolhidos(alvos, {})).toEqual(new Set(["b"]));
  });
});

describe("o loader nao sorteia inline quando ha teto", () => {
  const loader = readFileSync(path.resolve(__dirname, "../public/routed-checkout-loader.js"), "utf8");

  it("resolveInlineUrl cai na API antes de pickInlineTarget", () => {
    const inicio = loader.indexOf("function resolveInlineUrl(");
    const trecho = loader.slice(inicio, loader.indexOf("pickInlineTarget(lines)", inicio));
    expect(trecho).toContain("dailyLimit");
    expect(trecho).toContain("return null");
  });

  it("o embed leva o teto so quando existe", () => {
    expect(toEmbedTarget(alvo("a", { dailyLimit: 3 })).dailyLimit).toBe(3);
    expect(toEmbedTarget(alvo("a"))).not.toHaveProperty("dailyLimit");
  });
});

describe("tela: teto por loja", () => {
  it("aceita vazio ou inteiro de 1 a 100000", () => {
    expect(limiteValido("")).toBe(true);
    expect(limiteValido(" 20 ")).toBe(true);
    expect(limiteValido("0")).toBe(false);
    expect(limiteValido("1.5")).toBe(false);
    expect(limiteValido("abc")).toBe(false);
  });

  it("junta divisao e teto numa entrada por loja, e null tira o teto", () => {
    const alvos = [
      { id: "a", legacy: false, dailyLimit: null },
      { id: "b", legacy: false, dailyLimit: 3 },
      { id: "c", legacy: true, dailyLimit: null },
    ];
    const lista = mudancasDaLista(alvos, [{ id: "a", weight: 70 }], { a: "20", b: "", c: "9" });
    expect(lista).toEqual([
      { id: "a", weight: 70, dailyLimit: 20 },
      { id: "b", dailyLimit: null },
    ]);
    // Nada mudou: nada vai.
    expect(mudancasDaLista(alvos, [], { a: "", b: "3" })).toEqual([]);
  });
});
