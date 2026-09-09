import { describe, expect, it } from "vitest";
import {
  caminhoInternoSeguro,
  dominioDeDestino,
  ehMyShopify,
  normalizarDominioColado,
  normalizarDominioDeDestino,
  urlDeCheckout,
} from "@/lib/net/url-guard";
import { normalizeShopDomain } from "@/lib/shopify/domain";

/**
 * Cada caso INVALID abaixo foi confirmado contra o validador antigo antes da
 * correcao. Nao e lista de precaucao: e a lista do que passava.
 *
 * O valor sob teste decide para onde o COMPRADOR vai depois de clicar em
 * finalizar a compra. Errar aqui manda o carrinho -- e o cartao -- para outro
 * lugar.
 */

// ============================================================================
// INVALID -- esquemas
// ============================================================================

describe("INVALID: esquema", () => {
  const casos: [string, string][] = [
    ["javascript:alert(1)", "javascript classico"],
    ["JaVaScRiPt:alert(1)", "javascript com caixa trocada"],
    ["  javascript:alert(1)", "javascript com espaco na frente"],
    ["java\tscript:alert(1)", "javascript com tab no meio"],
    ["javascript:/*--></script><svg onload=alert(1)>", "javascript com quebra de tag"],
    ["data:text/html,<script>alert(1)</script>", "data html"],
    ["data:text/html;base64,PHNjcmlwdD4=", "data base64"],
    ["file:///etc/passwd", "file local"],
    ["file://evil.com/share", "file remoto"],
    ["ftp://evil.com/x", "ftp -- o esquema sumia e virava evil.com"],
    ["blob:https://evil.com/uuid", "blob"],
    ["vbscript:msgbox(1)", "vbscript"],
    ["gopher://127.0.0.1:6379/_INFO", "gopher para redis"],
    ["ws://evil.com", "websocket"],
    ["//evil.com", "relativo a protocolo"],
    ["///evil.com", "tres barras"],
    ["\\\\evil.com", "UNC"],
    ["/\\evil.com", "barra + barra invertida"],
    ["https:\\\\evil.com", "https com barras invertidas"],
    ["http:/\\evil.com", "barras misturadas"],
  ];

  for (const [entrada, nome] of casos) {
    it(`recusa ${nome}`, () => {
      expect(normalizarDominioDeDestino(entrada).ok, entrada).toBe(false);
    });
  }
});

// ============================================================================
// INVALID -- codificacao
// ============================================================================

describe("INVALID: codificacao", () => {
  const casos: [string, string][] = [
    ["%6a%61%76%61%73%63%72%69%70%74:alert(1)", "javascript percent-encoded"],
    ["%25%36%61avascript:alert(1)", "double encoding"],
    ["%6A%61%76%61%73%63%72%69%70%74:alert(1)", "percent-encoded em maiusculas"],
    ["jav%61script:alert(1)", "encoding parcial"],
    ["%2f%2fevil.com", "barras codificadas"],
    ["%5c%5cevil.com", "barras invertidas codificadas"],
    ["аррӏе.com", "homografo cirilico de apple.com"],
    ["xn--80ak6aa92e.com", "o mesmo homografo ja em punycode"],
    ["xn--e1afmkfd.xn--p1ai", "punycode legitimo, recusado por politica"],
    ["lojа.myshopify.com", "myshopify com 'a' cirilico"],
  ];

  for (const [entrada, nome] of casos) {
    it(`recusa ${nome}`, () => {
      expect(normalizarDominioDeDestino(entrada).ok, entrada).toBe(false);
    });
  }
});

// ============================================================================
// INVALID -- truques de autoridade
// ============================================================================

describe("INVALID: userinfo, porta e mascara de host", () => {
  const casos: [string, string][] = [
    ["https://google.com@evil.com", "@ com esquema"],
    ["google.com@evil.com", "@ sem esquema"],
    ["user:pass@evil.com", "userinfo com senha"],
    ["loja.myshopify.com@evil.com", "myshopify como isca antes do @"],
    ["evil.com#@loja.myshopify.com", "host real escondido antes do #"],
    ["evil.com?x=loja.myshopify.com", "myshopify na query"],
    ["evil.com/loja.myshopify.com", "myshopify no caminho"],
    ["loja.myshopify.com:8080", "porta no dominio da loja"],
    ["evil.com:22", "porta de sonda"],
    ["evil.com:0", "porta zero"],
    ["evil.com.", "ponto final -- outro host para o navegador"],
    ["evil.com..", "dois pontos finais"],
    ["-evil.com", "rotulo comecando com hifen"],
    ["evil-.com", "rotulo terminando com hifen"],
    ["ev..il.com", "rotulo vazio no meio"],
  ];

  for (const [entrada, nome] of casos) {
    it(`recusa ${nome}`, () => {
      expect(normalizarDominioDeDestino(entrada).ok, entrada).toBe(false);
    });
  }
});

// ============================================================================
// INVALID -- SSRF
// ============================================================================

describe("INVALID: destino interno (SSRF)", () => {
  const casos: [string, string][] = [
    ["http://127.0.0.1", "loopback"],
    ["127.0.0.1", "loopback sem esquema"],
    ["http://localhost", "localhost"],
    ["localhost", "localhost sem esquema"],
    ["http://169.254.169.254", "metadados da nuvem"],
    ["169.254.169.254", "metadados sem esquema"],
    ["http://[::1]", "IPv6 loopback"],
    ["[::ffff:127.0.0.1]", "IPv4 mapeado em IPv6"],
    ["http://10.0.0.5", "rede privada"],
    ["http://192.168.1.1", "rede privada"],
    ["2130706433", "loopback em decimal"],
    ["0x7f.0x0.0x0.0x1", "loopback em hexadecimal"],
  ];

  for (const [entrada, nome] of casos) {
    it(`recusa ${nome}`, () => {
      expect(normalizarDominioDeDestino(entrada).ok, entrada).toBe(false);
    });
  }

  it("recusa nome publico que resolve para IP interno", () => {
    // nip.io e sslip.io passavam na regex antiga e resolvem para o IP do nome.
    // Aqui eles morrem antes do DNS, na forma; o DNS e a segunda barreira, em
    // src/lib/net/safe-url.ts, para o caso de um A record apontar para dentro.
    for (const h of ["169.254.169.254.nip.io", "10.0.0.1.sslip.io", "127.0.0.1.nip.io"]) {
      expect(normalizarDominioDeDestino(h).ok, h).toBe(false);
    }
  });

  it("recusa sufixo de rede interna", () => {
    for (const h of ["metadata.google.internal", "redis.local", "admin.svc.cluster.local"]) {
      expect(normalizarDominioDeDestino(h).ok, h).toBe(false);
    }
  });
});

// ============================================================================
// INVALID -- CRLF e malformadas
// ============================================================================

describe("INVALID: CRLF e lixo", () => {
  const casos: [string, string][] = [
    ["loja.myshopify.com\r\nX-Injected: 1", "CRLF cru"],
    ["loja.myshopify.com\nSet-Cookie: a=b", "LF cru"],
    ["loja.myshopify.com%0d%0aX-Injected:1", "CRLF codificado"],
    ["loja.myshopify.com\r", "CR solto"],
    ["loja myshopify com", "espacos"],
    ["loja.myshopify.com ", "espaco no fim (depois do trim, valido)"],
    ["", "vazio"],
    ["   ", "so espaco"],
    [".", "ponto"],
    ["..", "dois pontos"],
    ["...", "tres pontos"],
    ["com", "so TLD"],
    [".com", "comecando com ponto"],
    ["evil", "sem TLD"],
    ["evil.c", "TLD de uma letra"],
    ["evil.123", "TLD numerico"],
    ["http://", "esquema sem host"],
    ["https://?", "esquema com query vazia"],
  ];

  for (const [entrada, nome] of casos) {
    it(`trata ${nome}`, () => {
      const r = normalizarDominioDeDestino(entrada);
      // "loja.myshopify.com " com espaco no fim e o unico que sobrevive: o
      // trim acontece antes de tudo, de proposito.
      if (entrada.trim() === "loja.myshopify.com") {
        expect(r.ok).toBe(true);
      } else {
        expect(r.ok, entrada).toBe(false);
      }
    });
  }

  it("nao lanca para nenhuma entrada, inclusive tipo errado", () => {
    for (const lixo of [null, undefined, 42, {}, [], true, Symbol("x")]) {
      expect(() => normalizarDominioDeDestino(lixo)).not.toThrow();
      expect(normalizarDominioDeDestino(lixo).ok).toBe(false);
    }
  });
});

// ============================================================================
// VALID
// ============================================================================

describe("VALID: destinos legitimos", () => {
  const casos: [string, string][] = [
    ["loja.myshopify.com", "myshopify simples"],
    ["q2mdgs-ag.myshopify.com", "myshopify com hifen (formato real da conta)"],
    ["elise-boutique-5439.myshopify.com", "myshopify com numeros"],
    ["LOJA.MYSHOPIFY.COM", "maiusculas viram minusculas"],
    ["  loja.myshopify.com  ", "espaco em volta"],
    ["https://loja.myshopify.com", "com esquema https"],
    ["http://loja.myshopify.com", "com esquema http"],
    ["https://loja.myshopify.com/", "com barra final"],
    ["www.blockstore.cl", "dominio customizado"],
    ["checkout.minhaloja.com.br", "subdominio com TLD composto"],
    ["a.co", "o mais curto valido"],
  ];

  for (const [entrada, nome] of casos) {
    it(`aceita ${nome}`, () => {
      expect(normalizarDominioDeDestino(entrada).ok, entrada).toBe(true);
    });
  }

  it("normaliza para host minusculo sem esquema", () => {
    expect(dominioDeDestino("HTTPS://Loja.MyShopify.Com/")).toBe("loja.myshopify.com");
  });

  it("a origem sai pronta para concatenar, sempre https", () => {
    const r = normalizarDominioDeDestino("http://loja.myshopify.com");
    expect(r.ok && r.origem).toBe("https://loja.myshopify.com");
  });
});

// ============================================================================
// EDGE CASES
// ============================================================================

describe("EDGE: o motivo da recusa e util", () => {
  const esperado: [string, string][] = [
    ["javascript:alert(1)", "esquema"],
    ["google.com@evil.com", "userinfo"],
    ["evil.com:22", "porta"],
    ["evil.com#@loja.myshopify.com", "caminho"],
    ["127.0.0.1", "ip_literal"],
    ["аррӏе.com", "nao_ascii"],
    ["xn--80ak6aa92e.com", "punycode"],
    ["evil.com.", "ponto_final"],
    ["", "vazio"],
  ];

  for (const [entrada, motivo] of esperado) {
    it(`${JSON.stringify(entrada)} -> ${motivo}`, () => {
      const r = normalizarDominioDeDestino(entrada);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.motivo).toBe(motivo);
    });
  }
});

describe("EDGE: divergencia com o validador antigo", () => {
  /**
   * Estes sao os casos em que o antigo APROVAVA e o novo recusa. Se algum dia
   * alguem trocar o novo pelo antigo achando que sao equivalentes, isto quebra.
   */
  const antigoAprovava = [
    "ftp://evil.com/x",
    "//evil.com",
    "/\\evil.com",
    "evil.com#@loja.myshopify.com",
    "evil.com.",
    "169.254.169.254.nip.io",
    "10.0.0.1.sslip.io",
    "metadata.google.internal",
  ];

  for (const entrada of antigoAprovava) {
    it(`o antigo aprovava ${JSON.stringify(entrada)}; o novo recusa`, () => {
      expect(normalizeShopDomain(entrada), "o antigo").not.toBeNull();
      expect(normalizarDominioDeDestino(entrada).ok, "o novo").toBe(false);
    });
  }
});

describe("EDGE: normaliza em vez de recusar", () => {
  /**
   * Estes chegam como tentativa de mascarar, mas o parser resolve a ambiguidade
   * em vez de haver o que mascarar. Recusar seria teatro: o host resultante e
   * unico e explicito.
   */
  it("fragmento e query VAZIOS somem, sobra o host", () => {
    expect(dominioDeDestino("evil.com#")).toBe("evil.com");
    expect(dominioDeDestino("evil.com?")).toBe("evil.com");
  });

  it("mas fragmento ou query COM conteudo sao recusados", () => {
    // Aqui ha o que mascarar: "evil.com#@loja.myshopify.com" parece terminar
    // em myshopify.com na barra de endereco.
    expect(normalizarDominioDeDestino("evil.com#@loja.myshopify.com").ok).toBe(false);
    expect(normalizarDominioDeDestino("evil.com?x=loja.myshopify.com").ok).toBe(false);
  });

  it("sufixo confundido e um dominio valido -- quem barra e ehMyShopify", () => {
    // "loja.myshopify.com.evil.com" e estruturalmente um host normal sob
    // evil.com. Recusar por formato seria arbitrario; o que nao pode e alguem
    // tratar isso como loja da Shopify.
    expect(dominioDeDestino("loja.myshopify.com.evil.com")).toBe(
      "loja.myshopify.com.evil.com"
    );
    expect(ehMyShopify("loja.myshopify.com.evil.com")).toBe(false);
  });
});

describe("EDGE: ehMyShopify", () => {
  it("aceita so o dominio da propria Shopify", () => {
    expect(ehMyShopify("loja.myshopify.com")).toBe(true);
  });
  it("recusa sufixo forjado e subdominio a mais", () => {
    expect(ehMyShopify("loja.myshopify.com.evil.com")).toBe(false);
    expect(ehMyShopify("evil.loja.myshopify.com")).toBe(false);
    expect(ehMyShopify("myshopify.com")).toBe(false);
  });
});

describe("EDGE: urlDeCheckout", () => {
  it("monta o permalink do carrinho", () => {
    const url = urlDeCheckout("loja.myshopify.com", "/cart/123:1", {
      country: "CL",
      locale: "es",
    });
    expect(url?.toString()).toBe(
      "https://loja.myshopify.com/cart/123:1?country=CL&locale=es"
    );
  });

  it("devolve null para dominio recusado, nunca uma URL para o atacante", () => {
    for (const ruim of ["javascript:alert(1)", "google.com@evil.com", "//evil.com"]) {
      expect(urlDeCheckout(ruim, "/cart/1:1"), ruim).toBeNull();
    }
  });

  it("param sem valor nao entra na query", () => {
    const url = urlDeCheckout("loja.myshopify.com", "/cart/1:1", { country: undefined });
    expect(url?.search).toBe("");
  });

  it("o caminho nao consegue trocar o host", () => {
    // O caminho vai para url.pathname, que o parser escapa -- nao ha como
    // sair do host por ali.
    const url = urlDeCheckout("loja.myshopify.com", "//evil.com/cart");
    expect(url?.hostname).toBe("loja.myshopify.com");
  });
});

// ============================================================================
// caminho interno (?next=)
// ============================================================================

describe("caminhoInternoSeguro", () => {
  it("VALID: caminhos do proprio app", () => {
    expect(caminhoInternoSeguro("/stores")).toBe("/stores");
    expect(caminhoInternoSeguro("/api/shopify/auth?shop=x")).toBe(
      "/api/shopify/auth?shop=x"
    );
    expect(caminhoInternoSeguro("/clone/routed-checkout#mapa")).toBe(
      "/clone/routed-checkout#mapa"
    );
  });

  it("INVALID: os tres bypasses confirmados do validador antigo", () => {
    // O antigo era `startsWith("/") && !startsWith("//")`. Cada um destes
    // passava e levava o usuario para evil.com depois do login.
    expect(caminhoInternoSeguro("/\\evil.com")).toBeNull();
    expect(caminhoInternoSeguro("/\\/evil.com")).toBeNull();
    expect(caminhoInternoSeguro("/\t/evil.com")).toBeNull();
  });

  it("INVALID: absolutos e esquemas", () => {
    for (const ruim of [
      "//evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "data:text/html,x",
      "\\\\evil.com",
      "stores",
      "",
      "   ",
    ]) {
      expect(caminhoInternoSeguro(ruim), ruim).toBeNull();
    }
  });

  it("EDGE: controle e CRLF nao passam", () => {
    expect(caminhoInternoSeguro("/stores\r\nX-Injected: 1")).toBeNull();
    expect(caminhoInternoSeguro("/stores\n/evil")).toBeNull();
  });

  it("EDGE: tipo errado devolve null em vez de lancar", () => {
    for (const lixo of [null, undefined, 42, {}, []]) {
      expect(() => caminhoInternoSeguro(lixo)).not.toThrow();
      expect(caminhoInternoSeguro(lixo)).toBeNull();
    }
  });

  it("EDGE: percent-encoding nao vira barra depois", () => {
    // "/%2f%2fevil.com" continua sendo caminho interno; o navegador nao
    // decodifica para "//" antes de resolver.
    const r = caminhoInternoSeguro("/%2f%2fevil.com");
    expect(r).not.toBeNull();
    expect(new URL(r as string, "https://user.xcart.app").host).toBe("user.xcart.app");
  });

  it("EDGE: travessia de diretorio e resolvida, nao escapa da origem", () => {
    const r = caminhoInternoSeguro("/../../etc/passwd");
    expect(r).toBe("/etc/passwd");
  });
});

// ============================================================================
// normalizarDominioColado -- o campo onde o lojista informa a propria loja
// ============================================================================

describe("normalizarDominioColado", () => {
  it("VALID: aceita URL colada e devolve so o host", () => {
    expect(normalizarDominioColado("https://minha-loja.myshopify.com/admin")).toMatchObject(
      { ok: true, host: "minha-loja.myshopify.com" }
    );
    expect(
      normalizarDominioColado("https://loja.myshopify.com/admin/products?x=1")
    ).toMatchObject({ ok: true, host: "loja.myshopify.com" });
  });

  it("EDGE: o caminho nao mascara o host", () => {
    // Quem decide o destino e o host que o parser separou, nao o texto.
    expect(normalizarDominioColado("evil.com/loja.myshopify.com")).toMatchObject({
      ok: true,
      host: "evil.com",
    });
    expect(ehMyShopify("evil.com")).toBe(false);
  });

  it("INVALID: afrouxa SO o caminho, o resto continua valendo", () => {
    for (const ruim of [
      "javascript:alert(1)",
      "google.com@evil.com",
      "//evil.com",
      "/\\evil.com",
      "loja.myshopify.com:8080",
      "127.0.0.1",
      "169.254.169.254.nip.io",
      "metadata.google.internal",
      "аррӏе.com",
      "evil.com.",
    ]) {
      expect(normalizarDominioColado(ruim).ok, ruim).toBe(false);
    }
  });

  it("EDGE: o destino de checkout continua ESTRITO", () => {
    // A diferenca entre as duas e so o caminho, e ela e proposital: caminho no
    // campo de destino e sinal de mascara, no campo da loja e copiar e colar.
    const comCaminho = "loja.myshopify.com/admin";
    expect(normalizarDominioColado(comCaminho).ok).toBe(true);
    expect(normalizarDominioDeDestino(comCaminho).ok).toBe(false);
  });
});
