import { describe, expect, it } from "vitest";
import { apenasNumeroDaConversao } from "../src/lib/tracking/normalizar";
import { montarUrlDeConversao } from "../src/lib/tracking/google-url";
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

/**
 * A requisicao do nosso servidor foi espelhada numa requisicao REAL do gtag,
 * capturada na conta do lojista. O que estes testes travam e o que fazia a
 * nossa parecer outra coisa.
 */
describe("a requisicao imita o gtag de verdade", () => {
  const base = { conversionId: "AW-18419000686", label: "RotuloX" };

  function urlDe(extra: Record<string, unknown> = {}) {
    // O modulo puro, nao google-ads.ts: aquele tem "server-only" e o vitest
    // nao consegue importar. Foi por isso que a montagem da URL saiu de la.
    const u = montarUrlDeConversao({ ...base, ...extra });
    return new URL(u!);
  }

  it("declara o evento com en=conversion", () => {
    // Antes mandavamos `script=0`, que e o caminho do <noscript> -- pixel de
    // imagem sem JavaScript. E uma afirmacao diferente da que queremos fazer.
    const u = urlDe();
    expect(u.searchParams.get("en")).toBe("conversion");
    expect(u.searchParams.get("script")).toBeNull();
  });

  it("leva o auid, que atribui mesmo sem click id", () => {
    const u = urlDe({ auid: "1502556589.1790803952" });
    expect(u.searchParams.get("auid")).toBe("1502556589.1790803952");
  });

  it("omite o auid quando nao ha, em vez de mandar vazio", () => {
    const u = urlDe();
    expect(u.searchParams.has("auid")).toBe(false);
  });

  it("NAO inventa consentimento nem dados do navegador", () => {
    // gcd, tag_exp e os uaa..uapv descrevem coisas que so o navegador sabe.
    // Preencher do servidor seria afirmar o que nao foi observado.
    const u = urlDe({ auid: "1.2" });
    for (const proibido of ["gcd", "tag_exp", "uaa", "uap", "uapv", "em", "emd"]) {
      expect(u.searchParams.has(proibido), proibido).toBe(false);
    }
  });

  it("continua deduplicando por oid e levando o click id", () => {
    const u = urlDe({ gclid: "G123", orderId: "pedido-7" });
    expect(u.searchParams.get("gclaw")).toBe("G123");
    expect(u.searchParams.get("oid")).toBe("pedido-7");
  });
});
