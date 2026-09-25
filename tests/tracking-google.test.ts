import { describe, expect, it } from "vitest";
import { apenasNumeroDaConversao } from "../src/lib/tracking/normalizar";
import { montarConversaoGoogle, type PedidoShopify } from "../src/lib/tracking/purchase";

const PEDIDO: PedidoShopify = {
  id: 5544332211,
  currency: "jpy",
  total_price: "12800",
  created_at: "2026-09-25T12:00:00Z",
  note_attributes: [
    { name: "gclid", value: "Cj0KCQ-TESTE" },
    { name: "_xc_vid", value: "abc.123" },
  ],
  line_items: [{ product_id: 1, variant_id: 11, quantity: 2, price: "6400" }],
};

describe("conversao do Google Ads a partir do pedido", () => {
  it("aceita o AW- como o lojista copia e como so numero", () => {
    // O painel do Google mostra "AW-123456789"; o caminho do endpoint leva so
    // o numero. Exigir um formato so renderia o erro mais bobo possivel.
    expect(apenasNumeroDaConversao("AW-123456789")).toBe("123456789");
    expect(apenasNumeroDaConversao("123456789")).toBe("123456789");
    expect(apenasNumeroDaConversao("  AW-987654321 ")).toBe("987654321");
    expect(apenasNumeroDaConversao("AW-")).toBeNull();
    expect(apenasNumeroDaConversao("")).toBeNull();
  });

  it("le o gclid do cart attribute", () => {
    // Cookie nao chega ao checkout da Shopify -- e outro dominio. O cart
    // attribute e a unica ponte entre o clique no anuncio e o pedido.
    expect(montarConversaoGoogle(PEDIDO).gclid).toBe("Cj0KCQ-TESTE");
  });

  it("cai para a identidade guardada quando o atributo nao veio", () => {
    const semAtributo = { ...PEDIDO, note_attributes: [] };
    expect(
      montarConversaoGoogle(semAtributo, { identidade: { gclid: "DO-BANCO" } }).gclid
    ).toBe("DO-BANCO");
  });

  it("sem gclid em lugar nenhum devolve null, nao string vazia", () => {
    // null e o sinal de "conversao sem atribuicao"; "" passaria pelo if e
    // iria para a URL como gclaw vazio.
    const seco = { ...PEDIDO, note_attributes: [] };
    expect(montarConversaoGoogle(seco).gclid).toBeNull();
  });

  it("o oid e o numero do pedido -- e o que deduplica no Google", () => {
    // Mesma conversion action com o mesmo oid: o Google descarta a segunda.
    // Protege contra reentrega de webhook e contra o canal nativo.
    expect(montarConversaoGoogle(PEDIDO).orderId).toBe("5544332211");
  });

  it("valor e moeda saem prontos para a URL", () => {
    const c = montarConversaoGoogle(PEDIDO);
    expect(c.value).toBe(12800);
    expect(c.currency).toBe("JPY");
  });

  it("gbraid e wbraid tambem sao capturados", () => {
    // iOS quebrou o gclid em parte do trafego; o Google manda um destes no
    // lugar. Ignorar os dois perderia a atribuicao desse trafego inteiro.
    const ios = {
      ...PEDIDO,
      note_attributes: [{ name: "gbraid", value: "GB-123" }],
    };
    const c = montarConversaoGoogle(ios);
    expect(c.gbraid).toBe("GB-123");
    expect(c.gclid).toBeNull();
  });
});

/**
 * iOS: o Google manda gbraid OU wbraid no lugar do gclid, nunca os tres.
 * Capturar e nao enviar deixava esse trafego inteiro sem atribuicao.
 */
describe("click id de iOS chega ao envio", () => {
  it("gbraid vira parametro proprio quando nao ha gclid", async () => {
    const { montarConversaoGoogle } = await import("../src/lib/tracking/purchase");
    const c = montarConversaoGoogle({
      id: 1,
      currency: "JPY",
      total_price: "100",
      note_attributes: [{ name: "wbraid", value: "WB-999" }],
    });
    expect(c.gclid).toBeNull();
    expect(c.wbraid).toBe("WB-999");
  });
});
