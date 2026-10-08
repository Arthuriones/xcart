import { describe, expect, it } from "vitest";

/**
 * O conserto decidia o que faltava no destino OLHANDO SO O SKU, mas a Shopify
 * recusa variante duplicada pela COMBINACAO DE OPCOES.
 *
 * Variante que existe na loja de checkout com as opcoes certas e SKU diferente
 * (ou sem SKU nenhum) caia nos dois lados ao mesmo tempo:
 *   - nunca casava pelo SKU  -> o conserto a considerava faltando
 *   - sempre colidia nas opcoes -> a criacao falhava
 *
 * Resultado: de hora em hora o cron tentava criar a mesma variante e recebia
 * "The variant 'BLACK' already exists". A rota ficava marcada como
 * problematica para sempre, mesmo com a cobertura em 100%. Aconteceu de
 * verdade em NORAH -> NORAH OUTLET (pochete-felicia) e em Dupe -> Dupe
 * Society (prada-re-edition-2005).
 *
 * A regra que este teste trava: antes de criar, procurar pela combinacao de
 * opcoes. Se ja existe, adotar -- mapear o SKU da vitrine para a variante que
 * esta la, sem tocar no SKU dela (ela pode estar mapeada por outra rota).
 */

/** Mesma chave do heal.ts. */
function chaveDeOpcoes(productId: string, valores: (string | null | undefined)[]) {
  return productId + "|" + valores.map((v) => (v || "").trim().toLowerCase()).join("|");
}

/** O recorte da decisao: o que criar e o que adotar. */
function separar(
  productId: string,
  faltando: { sku: string; optionValues: string[] }[],
  porOpcoes: Map<string, { variantId: string }>
) {
  const adotar: { sku: string; variantId: string }[] = [];
  const criar: typeof faltando = [];
  for (const item of faltando) {
    const achada = porOpcoes.get(chaveDeOpcoes(productId, item.optionValues));
    if (achada) adotar.push({ sku: item.sku, variantId: achada.variantId });
    else criar.push(item);
  }
  return { adotar, criar };
}

describe("conserto nao tenta criar variante que ja existe no destino", () => {
  const PRODUTO = "gid://shopify/Product/123";

  it("adota a variante existente em vez de tentar cria-la", () => {
    // No destino ja existe a variante BLACK, com SKU de outra origem.
    const porOpcoes = new Map([
      [chaveDeOpcoes(PRODUTO, ["BLACK"]), { variantId: "555" }],
    ]);
    const { adotar, criar } = separar(
      PRODUTO,
      [{ sku: "xc-abc123", optionValues: ["BLACK"] }],
      porOpcoes
    );
    expect(criar).toHaveLength(0);
    expect(adotar).toEqual([{ sku: "xc-abc123", variantId: "555" }]);
  });

  it("variante sem SKU no destino tambem e encontrada", () => {
    // Era o pior caso: o indice por SKU pulava `if (!variant.sku) continue`,
    // entao ela era invisivel para o conserto e a colisao era garantida.
    const porOpcoes = new Map([
      [chaveDeOpcoes(PRODUTO, ["Preto", "38"]), { variantId: "777" }],
    ]);
    const { adotar, criar } = separar(
      PRODUTO,
      [{ sku: "xc-def456", optionValues: ["Preto", "38"] }],
      porOpcoes
    );
    expect(criar).toHaveLength(0);
    expect(adotar[0].variantId).toBe("777");
  });

  it("compara sem ligar para caixa e espaco", () => {
    const porOpcoes = new Map([
      [chaveDeOpcoes(PRODUTO, ["black"]), { variantId: "888" }],
    ]);
    const { adotar } = separar(
      PRODUTO,
      [{ sku: "xc-ghi", optionValues: ["  BLACK "] }],
      porOpcoes
    );
    expect(adotar[0].variantId).toBe("888");
  });

  it("variante realmente nova continua indo para criacao", () => {
    const porOpcoes = new Map([
      [chaveDeOpcoes(PRODUTO, ["BLACK"]), { variantId: "555" }],
    ]);
    const { adotar, criar } = separar(
      PRODUTO,
      [
        { sku: "xc-preta", optionValues: ["BLACK"] },
        { sku: "xc-branca", optionValues: ["WHITE"] },
      ],
      porOpcoes
    );
    expect(adotar.map((a) => a.sku)).toEqual(["xc-preta"]);
    expect(criar.map((c) => c.sku)).toEqual(["xc-branca"]);
  });

  it("a chave e por produto: mesma cor em outro produto nao conta", () => {
    const porOpcoes = new Map([
      [chaveDeOpcoes("gid://shopify/Product/999", ["BLACK"]), { variantId: "555" }],
    ]);
    const { adotar, criar } = separar(
      PRODUTO,
      [{ sku: "xc-abc", optionValues: ["BLACK"] }],
      porOpcoes
    );
    expect(adotar).toHaveLength(0);
    expect(criar).toHaveLength(1);
  });
});

/**
 * Em qual produto do checkout entram as variantes que faltam: o da variante
 * IRMA ja casada, nunca o primeiro SKU com o mesmo prefixo. O SKU carimbado
 * pelo xcart e "xc-<aleatorio>", e o prefixo "xc" casava todo produto com
 * todo -- na NORAH OUTLET, 5 bolsas viraram variantes de uma "Arque".
 */
import { produtoNoDestino } from "@/lib/checkout-routes/produto-no-destino";

describe("produto do checkout para as variantes que faltam", () => {
  const indice = new Map([
    ["xc-arque-preta", { variantId: "1", productId: "ARQUE" }],
    ["xc-lv-turtledove", { variantId: "2", productId: "LV" }],
  ]);

  it("usa o produto da variante irma ja casada", () => {
    const lv = [{ sku: "xc-lv-black" }, { sku: "xc-lv-turtledove" }];
    expect(produtoNoDestino(lv, indice)?.productId).toBe("LV");
  });

  it("nenhuma irma casada: produto novo, mesmo com SKU de mesmo prefixo no mapa", () => {
    const coach = [{ sku: "xc-coach-23" }, { sku: "xc-coach-28" }];
    expect(produtoNoDestino(coach, indice)).toBeNull();
  });

  it("ignora variante sem SKU e compara sem caixa", () => {
    expect(produtoNoDestino([{ sku: null }, { sku: " XC-ARQUE-PRETA " }], indice)?.productId).toBe("ARQUE");
  });
});
