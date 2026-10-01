import { describe, it, expect } from "vitest";
import {
  TEMPLATE_PADRAO,
  TEMPLATES_SUGERIDOS,
  montarIdDeProduto,
  montarIdsDeProdutos,
  validarTemplate,
} from "@/lib/tracking/id-produto";

// ============================================================================
// O id de produto tem que casar BYTE A BYTE com o catalogo da plataforma.
//
// Quando nao casa, nada falha: o evento e aceito, o painel mostra "enviado", e
// o anuncio dinamico simplesmente nao serve aquele item. Por isso estes testes
// existem -- e a unica forma de perceber o erro antes do lojista.
// ============================================================================

const ITEM = {
  variantId: 67606346727697,
  productId: 15406223950097,
  sku: "MAX-BREEZE",
};

describe("montarIdDeProduto", () => {
  it("sem template, continua mandando o id da variante", () => {
    // Destino de antes da configuracao existir nao pode mudar de formato: ele
    // ja podia estar casando com o catalogo.
    expect(montarIdDeProduto(null, ITEM)).toBe("67606346727697");
    expect(montarIdDeProduto("", ITEM)).toBe("67606346727697");
    expect(montarIdDeProduto(TEMPLATE_PADRAO, ITEM)).toBe("67606346727697");
  });

  it("monta o formato do feed da Shopify para o Merchant Center", () => {
    // Era exatamente este o buraco: mandavamos "67606346727697" e o feed tinha
    // "shopify_US_15406223950097_67606346727697".
    expect(montarIdDeProduto("shopify_US_{product_id}_{variant_id}", ITEM)).toBe(
      "shopify_US_15406223950097_67606346727697"
    );
  });

  it("aceita produto e sku", () => {
    expect(montarIdDeProduto("{product_id}", ITEM)).toBe("15406223950097");
    expect(montarIdDeProduto("{sku}", ITEM)).toBe("MAX-BREEZE");
  });

  it("devolve null quando falta o dado que o template pede", () => {
    // `shopify_US__67606346727697` nao casa com nada e PARECE valido. Item sem
    // id some da lista; item com id errado mente.
    expect(
      montarIdDeProduto("shopify_US_{product_id}_{variant_id}", {
        variantId: 123,
        productId: null,
      })
    ).toBeNull();
    expect(montarIdDeProduto("{sku}", { variantId: 123 })).toBeNull();
    expect(montarIdDeProduto("{sku}", { sku: "   " })).toBeNull();
  });

  it("nao confunde numero zero com ausencia", () => {
    expect(montarIdDeProduto("{variant_id}", { variantId: 0 })).toBe("0");
  });
});

describe("montarIdsDeProdutos", () => {
  it("tira repetido e pula item sem id", () => {
    const ids = montarIdsDeProdutos("{product_id}", [
      { productId: 1, variantId: 10 },
      { productId: 1, variantId: 11 },
      { productId: null, variantId: 12 },
      { productId: 2, variantId: 13 },
    ]);
    expect(ids).toEqual(["1", "2"]);
  });

  it("lista vazia nao vira [''] ", () => {
    // `content_ids: [""]` e id invalido para o Meta e pode derrubar o evento
    // inteiro.
    expect(montarIdsDeProdutos("{sku}", [{ variantId: 1 }])).toEqual([]);
  });
});

describe("validarTemplate", () => {
  it("aceita os sugeridos da tela", () => {
    for (const s of TEMPLATES_SUGERIDOS) {
      expect(validarTemplate(s.template)).toBeNull();
    }
  });

  it("recusa template sem marcador", () => {
    // Sem marcador, TODO produto sai com o mesmo id e o catalogo vira um item.
    expect(validarTemplate("shopify_US_123")).toMatch(/marcador/i);
  });

  it("recusa marcador desconhecido", () => {
    // Iria literalmente como "{variante}" para a plataforma.
    expect(validarTemplate("{variante}")).toMatch(/desconhecido/i);
  });

  it("recusa caractere que nao aparece em id de catalogo", () => {
    expect(validarTemplate("shopify US_{variant_id}")).toMatch(/letras/i);
    expect(validarTemplate("<b>{variant_id}</b>")).toMatch(/letras/i);
  });

  it("recusa vazio", () => {
    expect(validarTemplate("")).toMatch(/vazio/i);
  });
});
