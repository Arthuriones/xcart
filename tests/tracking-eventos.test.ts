import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  EVENTOS,
  EVENTOS_DO_NAVEGADOR,
  chaveDoEvento,
  definicaoDoEvento,
  eventoValido,
  idDoEventoDeNavegador,
  limparMapaDeRotulos,
  rotuloDoEvento,
} from "../src/lib/tracking/eventos";

/**
 * No Google Ads cada evento e uma conversion action propria, com rotulo
 * proprio. Errar o rotulo nao da erro: a conversao chega e e contada na action
 * ERRADA -- "adicionar ao carrinho" entrando como venda. Nao ha sintoma no
 * xcart, so um numero estranho no painel do Google semanas depois.
 */

describe("rotulo por evento", () => {
  const mapa = { purchase: "COMPRA_1", add_to_cart: "CARRINHO_1" };

  it("acha o rotulo do evento pedido", () => {
    expect(rotuloDoEvento(mapa, "purchase")).toBe("COMPRA_1");
    expect(rotuloDoEvento(mapa, "add_to_cart")).toBe("CARRINHO_1");
  });

  it("devolve null para evento sem rotulo -- o lojista nao pediu esse", () => {
    expect(rotuloDoEvento(mapa, "view_item")).toBeNull();
    expect(rotuloDoEvento(mapa, "begin_checkout")).toBeNull();
  });

  /**
   * A compra nasce com `event_name: "Purchase"`, que e o nome do Meta, e foi
   * gravada assim nas linhas que ja estao na fila. Sem normalizar a caixa, uma
   * retentativa de linha antiga nao acharia rotulo e a venda pararia de ser
   * enviada.
   */
  it("normaliza a caixa do nome gravado na fila", () => {
    expect(rotuloDoEvento(mapa, "Purchase")).toBe("COMPRA_1");
    expect(rotuloDoEvento(mapa, "  PURCHASE  ")).toBe("COMPRA_1");
  });

  it("ignora nome que nao existe no catalogo", () => {
    expect(rotuloDoEvento(mapa, "checkout_iniciado")).toBeNull();
    expect(rotuloDoEvento(mapa, "")).toBeNull();
  });

  /**
   * O fallback existe para o deploy: as duas versoes do codigo rodam ao mesmo
   * tempo, a antiga gravando a coluna e a nova lendo o mapa. Sem ele, a
   * conversao de venda pararia pelos minutos do deploy.
   */
  it("cai para a coluna legada, mas SO na compra", () => {
    expect(rotuloDoEvento({}, "purchase", "LEGADO")).toBe("LEGADO");
    expect(rotuloDoEvento({}, "add_to_cart", "LEGADO")).toBeNull();
  });

  it("o mapa vence a coluna legada", () => {
    expect(rotuloDoEvento({ purchase: "NOVO" }, "purchase", "LEGADO")).toBe("NOVO");
  });

  it("aceita mapa nulo", () => {
    expect(rotuloDoEvento(null, "purchase")).toBeNull();
    expect(rotuloDoEvento(undefined, "purchase", "LEGADO")).toBe("LEGADO");
  });
});

describe("limpeza do mapa antes de gravar", () => {
  /**
   * O CHECK da tabela testa so `google_labels <> '{}'` -- CHECK nao aceita
   * subconsulta para vasculhar valores. Ele confia nesta funcao para o mapa
   * nunca chegar como {"purchase": ""}, que passaria o CHECK e nao rastrearia
   * nada.
   */
  it("descarta valor vazio, e nao deixa virar chave", () => {
    expect(limparMapaDeRotulos({ purchase: "  ", add_to_cart: "X" })).toEqual({
      add_to_cart: "X",
    });
  });

  it("descarta evento que nao existe", () => {
    expect(limparMapaDeRotulos({ purchase: "A", inventado: "B" })).toEqual({
      purchase: "A",
    });
  });

  it("tira espaco das pontas", () => {
    expect(limparMapaDeRotulos({ purchase: "  A  " })).toEqual({ purchase: "A" });
  });

  it("aceita lixo sem estourar", () => {
    expect(limparMapaDeRotulos(null)).toEqual({});
    expect(limparMapaDeRotulos("texto")).toEqual({});
    expect(limparMapaDeRotulos({ purchase: 42 })).toEqual({});
  });
});

describe("catalogo", () => {
  it("so a compra vem de webhook", () => {
    const deWebhook = EVENTOS.filter((e) => e.origem === "webhook").map((e) => e.chave);
    expect(deWebhook).toEqual(["purchase"]);
  });

  /**
   * `payment_info` so existe dentro do checkout da Shopify, que NAO e tema --
   * o snippet nunca alcanca. Marcar como 'navegador' faria a tela pedir ao
   * lojista um evento que o tema nao tem como disparar.
   */
  it("dados de pagamento so vem do Web Pixel", () => {
    const doPixel = EVENTOS.filter((e) => e.origem === "pixel").map((e) => e.chave);
    expect(doPixel).toEqual(["payment_info"]);
  });

  /**
   * Valor vindo do navegador e numero que qualquer um pode inflar chamando o
   * coletor, e valor de conversao inflado distorce o lance automatico. So a
   * compra leva valor, e ela vem da Shopify.
   */
  it("so a compra leva valor", () => {
    const comValor = EVENTOS.filter((e) => e.temValor).map((e) => e.chave);
    expect(comValor).toEqual(["purchase"]);
  });

  /**
   * O Meta reconhece SO os nomes dele para evento padrao. "add_to_cart" chega,
   * aparece no Events Manager e NAO serve para otimizacao de campanha nem para
   * publico -- vira evento personalizado. Nao ha erro nem aviso.
   */
  it("todo evento tem o nome que o Meta reconhece", () => {
    const esperado: Record<string, string> = {
      view_item: "ViewContent",
      add_to_cart: "AddToCart",
      begin_checkout: "InitiateCheckout",
      payment_info: "AddPaymentInfo",
      purchase: "Purchase",
    };
    for (const e of EVENTOS) {
      expect(e.nomeNoMeta, e.chave).toBe(esperado[e.chave]);
    }
  });

  it("o nome do Meta nunca e igual a nossa chave", () => {
    // Se alguem "simplificar" reusando a chave, o evento deixa de ser padrao.
    for (const e of EVENTOS) expect(e.nomeNoMeta).not.toBe(e.chave);
  });

  it("nao tem chave repetida", () => {
    const chaves = EVENTOS.map((e) => e.chave);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("eventoValido concorda com o catalogo", () => {
    for (const e of EVENTOS) expect(eventoValido(e.chave)).toBe(true);
    expect(eventoValido("nada")).toBe(false);
  });

  it("definicaoDoEvento estoura em evento fora do catalogo", () => {
    // O coletor recebe string da rede. Se um evento sair do catalogo sem sair
    // do snippet, melhor estourar aqui do que mandar conversao sem rotulo.
    expect(() => definicaoDoEvento("fantasma" as never)).toThrow();
  });

  it("chaveDoEvento so aceita o que existe", () => {
    expect(chaveDoEvento("Add_To_Cart")).toBe("add_to_cart");
    expect(chaveDoEvento("addtocart")).toBeNull();
  });
});

describe("id do evento de navegador", () => {
  it("muda a cada acao -- adicionar duas vezes sao dois eventos", () => {
    const a = idDoEventoDeNavegador("add_to_cart", "vid1", 1000);
    const b = idDoEventoDeNavegador("add_to_cart", "vid1", 2000);
    expect(a).not.toBe(b);
  });

  it("e igual para a mesma acao -- reenvio nao vira segunda conversao", () => {
    expect(idDoEventoDeNavegador("add_to_cart", "vid1", 1000)).toBe(
      idDoEventoDeNavegador("add_to_cart", "vid1", 1000)
    );
  });

  it("separa visitantes", () => {
    expect(idDoEventoDeNavegador("add_to_cart", "a", 1)).not.toBe(
      idDoEventoDeNavegador("add_to_cart", "b", 1)
    );
  });
});

/**
 * O snippet roda no tema da loja e o catalogo roda no servidor: sao dois
 * arquivos que precisam concordar sobre o conjunto de eventos. Se o snippet
 * mandar um nome que o catalogo nao conhece, o coletor recusa e o evento
 * desaparece sem ninguem notar -- a mesma classe de falha do sorteio do rodizio,
 * que e travada por tests/rotation-parity.test.ts.
 */
describe("o snippet do tema concorda com o catalogo", () => {
  const snippet = readFileSync(
    path.resolve(__dirname, "..", "public", "xcart-click.js"),
    "utf8"
  );

  const disparados = [...snippet.matchAll(/mandar\(\s*"([a-z_]+)"\s*\)/g)].map(
    (m) => m[1]
  );

  it("o regex realmente achou os disparos", () => {
    // Guarda contra o proprio teste passar por nao ter achado nada, se alguem
    // reescrever `mandar(...)` com outro nome.
    expect(disparados.length).toBeGreaterThan(0);
  });

  it("todo evento que o snippet dispara existe no catalogo", () => {
    for (const nome of disparados) {
      expect(eventoValido(nome), `snippet dispara "${nome}"`).toBe(true);
    }
  });

  it("o snippet nao dispara evento que e de webhook", () => {
    // `purchase` vindo do navegador deixaria qualquer um declarar uma venda.
    for (const nome of disparados) {
      expect(EVENTOS_DO_NAVEGADOR).toContain(nome);
    }
  });

  it("o snippet cobre todos os eventos de navegador do catalogo", () => {
    for (const chave of EVENTOS_DO_NAVEGADOR) {
      expect(disparados, `catalogo tem "${chave}"`).toContain(chave);
    }
  });

  it("o snippet nao manda valor monetario", () => {
    // O coletor ignora, mas mandar daria a impressao de que o valor e usado --
    // e alguem "consertaria" o coletor para ler.
    const corpo = snippet.slice(snippet.indexOf("function mandar("));
    const enviado = corpo.slice(0, corpo.indexOf("JSON.stringify") + 600);
    expect(enviado).not.toMatch(/\bvalue\b|\bcurrency\b/);
  });
});
