import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  ATRASO_CHECKOUT_EXPRESSO_MS,
  BALDE_CHECKOUT_EXPRESSO_MS,
  JANELA_CHECKOUT_EXPRESSO_MS,
  PREFIXO_CHECKOUT_EXPRESSO,
  EVENTOS,
  EVENTOS_DO_NAVEGADOR,
  ORIGENS_DO_CHECKOUT,
  chaveDoEvento,
  definicaoDoEvento,
  eventoValido,
  idDoCheckoutExpresso,
  idDoEventoDeNavegador,
  lerRotulos,
  limparMapaDeRotulos,
  origemDoCheckout,
  rotuloDoEvento,
  separarRotulo,
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
 * Checkout expresso (Shop Pay, Apple Pay...): o clique e o unico
 * InitiateCheckout que existe, porque o Web Pixel nao roda na tela do Shop Pay
 * nem na janela da carteira. Abrir a folha, fechar e abrir de novo e a mesma
 * tentativa -- o id e por balde de 30 min, nao por instante.
 */
describe("id do checkout expresso", () => {
  const T = Date.parse("2026-10-05T12:00:00Z"); // inicio de um balde

  it("balde de 30 minutos", () => {
    expect(BALDE_CHECKOUT_EXPRESSO_MS).toBe(30 * 60 * 1000);
  });

  it("cliques no mesmo balde dao o mesmo id -- o indice unico junta", () => {
    expect(idDoCheckoutExpresso("v1", T)).toBe(idDoCheckoutExpresso("v1", T + 29 * 60 * 1000));
  });

  it("balde seguinte e outra tentativa", () => {
    expect(idDoCheckoutExpresso("v1", T)).not.toBe(idDoCheckoutExpresso("v1", T + 30 * 60 * 1000));
  });

  it("separa visitantes, e nao colide com o id do clique comum", () => {
    expect(idDoCheckoutExpresso("a", T)).not.toBe(idDoCheckoutExpresso("b", T));
    expect(idDoCheckoutExpresso("v1", T)).toMatch(/^begin_checkout_xp_v1_\d+$/);
    expect(idDoCheckoutExpresso("v1", T)).not.toBe(idDoEventoDeNavegador("begin_checkout", "v1", T));
  });

  /**
   * O pixel vence: o expresso espera na fila o tempo de o checkout_started
   * chegar e cancelar. A janela e deslizante, e cobre o balde inteiro.
   */
  it("atraso de 5 min, janela de 30, e o prefixo que o coletor procura", () => {
    expect(ATRASO_CHECKOUT_EXPRESSO_MS).toBe(5 * 60 * 1000);
    expect(JANELA_CHECKOUT_EXPRESSO_MS).toBe(30 * 60 * 1000);
    expect(JANELA_CHECKOUT_EXPRESSO_MS).toBeGreaterThanOrEqual(BALDE_CHECKOUT_EXPRESSO_MS);
    expect(idDoCheckoutExpresso("v1", T).startsWith(PREFIXO_CHECKOUT_EXPRESSO)).toBe(true);
    // O clique comum e o do pixel nunca caem no prefixo -- senao o pixel
    // cancelaria a si mesmo, ou a dedupe de 10 min deixaria de ver o tema. O
    // _xc_vid do snippet e base36 + "." + base36: nunca comeca com "xp_".
    const vid = "mg1abc0.k2j3h4x9";
    expect(idDoEventoDeNavegador("begin_checkout", vid, T).startsWith(PREFIXO_CHECKOUT_EXPRESSO)).toBe(false);
    expect("begin_checkout_ck_T1".startsWith(PREFIXO_CHECKOUT_EXPRESSO)).toBe(false);
  });

  it("origem e lista fechada: so o valor conhecido conta", () => {
    expect(ORIGENS_DO_CHECKOUT).toEqual(["expresso"]);
    expect(origemDoCheckout("expresso")).toBe("expresso");
    expect(origemDoCheckout(" expresso ")).toBe("expresso");
    for (const lixo of ["Expresso", "normal", "", null, undefined, 1, { a: 1 }]) {
      expect(origemDoCheckout(lixo)).toBeNull();
    }
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

  describe("checkout expresso", () => {
    const secao = snippet.slice(
      snippet.indexOf("// ---- 3.4 checkout expresso"),
      snippet.indexOf("// 4. REMARKETING DO GOOGLE")
    );
    const funcao = secao.slice(secao.indexOf("function checkoutExpresso("));

    it("a secao existe e manda um evento do catalogo, com a origem da lista", () => {
      expect(funcao.length).toBeGreaterThan(0);
      const nomes = [...funcao.matchAll(/corpoDoEvento\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
      expect(nomes).toEqual(["begin_checkout"]);
      const origens = [...funcao.matchAll(/origem:\s*"([a-z_]+)"/g)].map((m) => m[1]);
      expect(origens.length).toBeGreaterThan(0);
      for (const o of origens) expect(ORIGENS_DO_CHECKOUT).toContain(o);
    });

    it("id por balde, no mesmo formato e com o mesmo balde do servidor", () => {
      expect(funcao).toContain('"begin_checkout_xp_" + vid + "_" + balde');
      expect(funcao).toContain("Math.floor(Date.now() / BALDE_EXPRESSO_MS)");
      const balde = /var BALDE_EXPRESSO_MS = ([\d\s*]+);/.exec(secao);
      expect(balde).not.toBeNull();
      const ms = balde![1].split("*").reduce((total, fator) => total * Number(fator.trim()), 1);
      expect(ms).toBe(BALDE_CHECKOUT_EXPRESSO_MS);
    });

    /**
     * No Google o begin_checkout sai do navegador e so deduplica por
     * transaction_id; o clique e o checkout_started nao compartilham, e o
     * expresso que cai no checkout normal contaria dois.
     */
    it("nao vai ao Google e nao manda valor", () => {
      expect(funcao).not.toMatch(/converterNoGoogle\(|gtag\(/);
      expect(secao).not.toMatch(/\bvalue\b|\bcurrency\b/);
    });

    const lista = (nome: string) => {
      const m = new RegExp(`var ${nome} = \\[([\\s\\S]*?)\\]\\.join`).exec(secao);
      // Sem os comentarios: texto entre aspas ali nao e seletor.
      const codigo = m ? m[1].replace(/\/\/.*$/gm, "") : "";
      return [...codigo.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    };

    it("escuta os elementos que a Shopify documenta, com o hospedeiro de reserva", () => {
      expect(lista("SELETOR_EXPRESSO")).toEqual([
        "shop-pay-wallet-button",
        "shopify-apple-pay-button",
        "shopify-google-pay-button",
        "shopify-paypal-button",
        "shopify-amazon-pay-button",
        "shopify-accelerated-checkout",
        "shopify-accelerated-checkout-cart",
        // Do botao dinamico antigo, so o da carteira: o sem marca e o
        // "Comprar agora", que leva ao checkout normal.
        ".shopify-payment-button__button--branded",
      ]);
      expect(secao).toContain("composedPath");
    });

    /**
     * "Comprar agora" e "Mais opcoes de pagamento" levam ao checkout NORMAL,
     * onde o pixel manda o IC dele. Pegos aqui, virariam um segundo.
     */
    it("recusa o que leva ao checkout normal, mesmo dentro do botao dinamico", () => {
      expect(lista("SELETOR_NAO_EXPRESSO")).toEqual([
        "shopify-buy-it-now-button",
        "more-payment-options-link",
        ".shopify-payment-button__button--unbranded",
        ".shopify-payment-button__more-options",
      ]);
      expect(secao).toMatch(
        /function ehExpresso\(e\) \{\s+return !!noCaminho\(e, SELETOR_EXPRESSO\) && !noCaminho\(e, SELETOR_NAO_EXPRESSO\);/
      );
    });

    /**
     * Chave propria: com a do begin_checkout comum, "Finalizar compra" logo
     * depois de fechar a carteira voltava cedo e o begin_checkout do Google
     * (que o expresso nao manda) se perdia.
     */
    it("tem janela anti-duplicata com chave propria, separada do begin_checkout comum", () => {
      expect(funcao).toMatch(/if \(repetido\("begin_checkout_xp"\)\) return;[\s\S]*corpoDoEvento\(/);
      expect(funcao).not.toMatch(/repetido\("begin_checkout"\)/);
    });
  });
});

describe("rotulo colado como AW-123/AbC", () => {
  it("separa a conta do rotulo", () => {
    expect(separarRotulo("AW-123456789/AbC-d_E")).toEqual({ conta: "123456789", rotulo: "AbC-d_E" });
    expect(separarRotulo(" AbC ")).toEqual({ conta: null, rotulo: "AbC" });
    expect(separarRotulo("AW-123456789/")).toBeNull();
    expect(separarRotulo("ab c")).toBeNull();
  });

  it("preenche a conta vazia e recusa rotulo de outra conta", () => {
    expect(lerRotulos({ purchase: "AW-123456789/AbC" }, "")).toEqual({
      labels: { purchase: "AbC" },
      conta: "AW-123456789",
    });
    expect(lerRotulos({ purchase: "AW-123456789/AbC", add_to_cart: "Xy" }, "AW-123456789")).toEqual({
      labels: { purchase: "AbC", add_to_cart: "Xy" },
      conta: "AW-123456789",
    });
    const outra = lerRotulos({ purchase: "AW-999999999/AbC" }, "AW-123456789");
    expect(outra).toMatchObject({ evento: "purchase" });
    expect("erro" in outra && outra.erro).toMatch(/outra conta/);
    expect(lerRotulos({ purchase: "a/b/c" }, "AW-123456789")).toMatchObject({ evento: "purchase" });
  });
});
