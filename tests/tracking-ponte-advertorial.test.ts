import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * A ponte roda no advertorial e o snippet roda na loja -- dois arquivos, dois
 * dominios, e nenhum deles sabe do outro em tempo de execucao.
 *
 * O acordo entre eles e uma LISTA DE NOMES de parametro. Se a ponte encaminhar
 * `gclid` e a loja passar a ler outra coisa (ou o contrario), o comprador chega
 * na loja sem click id e a venda vira "direto". A conversao ainda sai, entao nao
 * ha erro nem fila parada -- so o anuncio deixando de receber o credito.
 *
 * Mesma classe de falha do sorteio do rodizio, e travada do mesmo jeito: lendo
 * os dois arquivos do disco e comparando.
 */

const raiz = path.resolve(__dirname, "..", "public");
const ponte = readFileSync(path.join(raiz, "xcart-bridge.js"), "utf8");
const snippet = readFileSync(path.join(raiz, "xcart-click.js"), "utf8");

/** Extrai o array literal de uma `var NOME = [...]`. */
function listaDe(fonte: string, nome: string): string[] {
  const m = fonte.match(new RegExp(`var\\s+${nome}\\s*=\\s*\\[([^\\]]*)\\]`));
  if (!m) throw new Error(`nao achei a lista ${nome}`);
  return [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
}

describe("ponte e snippet falam dos mesmos parametros", () => {
  const daPonte = listaDe(ponte, "CLICK_IDS");
  const doSnippet = listaDe(snippet, "CHAVES");

  it("as duas listas foram encontradas", () => {
    // Guarda contra o teste passar por nao ter achado nada, se alguem renomear.
    expect(daPonte.length).toBeGreaterThan(2);
    expect(doSnippet.length).toBeGreaterThan(2);
  });

  it("a ponte encaminha exatamente o que a loja le", () => {
    expect([...daPonte].sort()).toEqual([...doSnippet].sort());
  });

  it("os tres do Google estao nos dois lados", () => {
    // gbraid/wbraid substituem o gclid no trafego de iOS. Esquecer um deles
    // deixa essa parte inteira da campanha sem atribuicao.
    for (const chave of ["gclid", "gbraid", "wbraid"]) {
      expect(daPonte, `ponte: ${chave}`).toContain(chave);
      expect(doSnippet, `snippet: ${chave}`).toContain(chave);
    }
  });

  it("o fbclid esta nos dois lados", () => {
    // Sem ele o servidor nao reconstroi o _fbc, e o evento do Meta chega sem
    // ligacao com o anuncio.
    expect(daPonte).toContain("fbclid");
    expect(doSnippet).toContain("fbclid");
  });
});

describe("a ponte nao vaza click id para terceiro", () => {
  it("exige a lista de destinos e sai sem ela", () => {
    // Reescrever "todo link externo" mandaria o gclid para o Instagram, o
    // WhatsApp e qualquer outro link da pagina.
    expect(ponte).toContain("data-xcart-destinos");
    expect(ponte).toMatch(/DESTINOS\.length\s*===\s*0\)\s*return/);
  });

  it("nao tem curinga", () => {
    // Um "*" aceito na lista anularia a protecao inteira.
    expect(ponte).not.toMatch(/===\s*["']\*["']/);
    expect(ponte).not.toMatch(/indexOf\(["']\*["']\)/);
  });

  it("casa subdominio pelo ponto, nao por sufixo solto", () => {
    // `host.endsWith(d)` aprovaria "naolinguo.shop" para o destino
    // "linguo.shop". O ponto e o que separa os dois casos.
    expect(ponte).toContain('"." + d');
  });

  it("so encaminha em http(s)", () => {
    // `javascript:` e `data:` num href viram execucao, nao navegacao.
    expect(ponte).toMatch(/protocol !== "http:" && u\.protocol !== "https:"/);
  });
});

describe("a ponte preserva o que a pagina ja definiu", () => {
  it("click id nosso vence, utm da pagina nao", () => {
    // O click id e do clique que esta acontecendo agora, entao manda. Ja um utm
    // escrito naquele botao foi decisao de quem montou a pagina.
    expect(ponte).toMatch(/u\.searchParams\.set\(c, guardados\[c\]\)/);
    expect(ponte).toMatch(/!u\.searchParams\.has\(m\)/);
  });
});

/**
 * _fbp e o id de navegador do Meta e um dos sinais mais fortes dele. Com o pixel
 * do tema desligado -- que e o nosso caso, para a mesma acao nao contar duas
 * vezes -- ninguem grava esse cookie, e todo evento iria sem.
 *
 * O snippet gera quando falta. O que NAO pode acontecer, e o que estes testes
 * travam: gerar um valor novo a cada evento (descreveria uma pessoa diferente a
 * cada vez, piorando o casamento) ou inventar um _fbc sem clique real.
 */
describe("o snippet cuida do _fbp sem inventar _fbc", () => {
  const snippet = readFileSync(
    path.resolve(__dirname, "..", "public", "xcart-click.js"),
    "utf8"
  );

  it("gera o _fbp no formato do Meta quando o cookie nao existe", () => {
    expect(snippet).toMatch(/"fb\.1\." \+ Date\.now\(\)/);
  });

  it("so gera quando falta, e grava em cookie para reusar", () => {
    // Sem o `if (!fbp)` e sem gravar, cada carregamento criaria outro id.
    expect(snippet).toMatch(/if \(!fbp\) \{[\s\S]{0,200}gravarCookie\("_fbp", fbp\)/);
  });

  it("NUNCA fabrica _fbc", () => {
    // _fbc afirma um clique em anuncio. Sem fbclid real, inventar e mentir
    // sobre a origem da visita.
    const trecho = snippet.slice(snippet.indexOf("var fbc = lerCookie"));
    const ateOFim = trecho.slice(0, 400);
    expect(ateOFim).not.toMatch(/gravarCookie\("_fbc"/);
    expect(ateOFim).not.toMatch(/"fb\.1\.[^"]*" \+ Date\.now\(\)[\s\S]{0,60}_fbc/);
  });
});

/**
 * VSL / pagina de oferta com link DIRETO para o checkout (permalink
 * /cart/VARIANTE:QTD). Nenhuma pagina do tema roda no caminho, entao o
 * `?fbclid=` que a ponte poe no link nao e lido por ninguem na loja. A ponte
 * grava os mesmos valores como atributo do carrinho, que o Web Pixel le em
 * `checkout.attributes` e o pedido traz em note_attributes.
 *
 * A ponte roda de verdade aqui, num DOM minimo: o que se confere e a URL que
 * sai, nao o texto do arquivo.
 */
describe("link direto para o checkout leva os click ids como atributo do carrinho", () => {
  function rodar(opts: {
    url: string;
    cookies?: Record<string, string>;
    hrefs: string[];
    tag?: Record<string, string>;
  }) {
    const jar: Record<string, string> = { ...(opts.cookies || {}) };
    const links = opts.hrefs.map((href) => {
      const attrs: Record<string, string> = { href };
      return {
        getAttribute: (n: string) => attrs[n] ?? null,
        setAttribute: (n: string, v: string) => {
          attrs[n] = v;
        },
      };
    });
    const atributos: Record<string, string> = { "data-xcart-destinos": "loja.shop", ...(opts.tag || {}) };
    const envios: { url: string; corpo: Record<string, unknown> }[] = [];
    const storage = new Map<string, string>();
    const document: Record<string, unknown> = {
      currentScript: {
        src: "https://user.xcart.app/xcart-bridge.js",
        getAttribute: (n: string) => atributos[n] ?? null,
      },
      referrer: "https://l.facebook.com/",
      readyState: "complete",
      documentElement: {},
      getElementsByTagName: () => links,
      addEventListener: () => {},
    };
    Object.defineProperty(document, "cookie", {
      get: () =>
        Object.entries(jar)
          .map(([k, v]) => `${k}=${v}`)
          .join("; "),
      set: (s: string) => {
        const [kv] = s.split(";");
        const i = kv.indexOf("=");
        jar[kv.slice(0, i)] = kv.slice(i + 1);
      },
    });
    const u = new URL(opts.url);
    const sandbox: Record<string, unknown> = {
      document,
      location: { href: u.href, search: u.search, protocol: u.protocol },
      URL,
      URLSearchParams,
      // Sem sendBeacon: a ponte cai no fetch, e o corpo chega como texto.
      navigator: {},
      fetch: (url: string, init: { body: string }) => {
        envios.push({ url, corpo: JSON.parse(init.body) });
        return Promise.resolve();
      },
      sessionStorage: {
        getItem: (k: string) => storage.get(k) ?? null,
        setItem: (k: string, v: string) => void storage.set(k, v),
      },
    };
    sandbox.window = sandbox;
    vm.runInNewContext(ponte, sandbox);
    return { links: links.map((l) => l.getAttribute("href") as string), envios, jar };
  }

  const LOJA = { "data-xcart-store": "11111111-2222-3333-4444-555555555555", "data-xcart-shop": "loja-x.myshopify.com" };

  const url = "https://vsl.com/oferta?fbclid=ABC123&ttclid=E.C.P.TT1&utm_source=tiktok";

  it("no permalink /cart/ vai como attributes[...], junto do parametro solto", () => {
    const {
      links: [permalink],
    } = rodar({
      url,
      cookies: { _fbp: "fb.1.1700000000000.42", _fbc: "fb.1.1700000000000.ABC123", _ttp: "UqBuLHl7" },
      hrefs: ["https://loja.shop/cart/4567:1"],
    });
    const p = new URL(permalink).searchParams;
    expect(p.get("fbclid")).toBe("ABC123");
    expect(p.get("utm_source")).toBe("tiktok");
    expect(p.get("attributes[fbclid]")).toBe("ABC123");
    expect(p.get("attributes[ttclid]")).toBe("E.C.P.TT1");
    expect(p.get("attributes[_fbp]")).toBe("fb.1.1700000000000.42");
    expect(p.get("attributes[_fbc]")).toBe("fb.1.1700000000000.ABC123");
    expect(p.get("attributes[_ttp]")).toBe("UqBuLHl7");
    // Nao veio no anuncio: nao vai.
    expect(p.has("attributes[gclid]")).toBe(false);
  });

  it("pagina do tema (produto, /cart) nao recebe atributo: o snippet de la ja le o parametro", () => {
    const {
      links: [produto, carrinho],
    } = rodar({
      url,
      cookies: { _fbp: "fb.1.1.2" },
      hrefs: ["https://loja.shop/products/x", "https://loja.shop/cart"],
    });
    expect(new URL(produto).searchParams.get("fbclid")).toBe("ABC123");
    expect(produto).not.toContain("attributes");
    expect(carrinho).not.toContain("attributes");
  });

  it("link de terceiro continua intocado", () => {
    const {
      links: [ig],
    } = rodar({ url, hrefs: ["https://instagram.com/loja"] });
    expect(ig).toBe("https://instagram.com/loja");
  });

  it("_fbc e _fbp nunca sao inventados: sem cookie do pixel, sem atributo", () => {
    const {
      links: [permalink],
    } = rodar({ url, hrefs: ["https://loja.shop/cart/4567:1"] });
    expect(permalink).not.toContain("_fbc");
    expect(permalink).not.toContain("_fbp");
  });

/**
 * Modo de rastreamento: com a loja identificada, a ponte avisa o coletor do
 * PageView e do ViewContent da propria pagina -- e o servidor fala com o Meta e
 * o TikTok. A pagina NAO tem pixel no navegador, entao e a ponte que gera o
 * _fbp (uma vez por visitante) e NUNCA o _fbc.
 */
describe("a ponte rastreia a propria pagina quando sabe a loja", () => {
  const url = "https://vsl.com/oferta?fbclid=ABC123";

  it("manda page_view e view_item ao coletor, com o visitante e o fbp gerado", () => {
    const { envios, links, jar } = rodar({ url, hrefs: ["https://loja.shop/cart/4567:1"], tag: LOJA });
    expect(envios.map((e) => e.url)).toEqual([
      "https://user.xcart.app/api/tracking/collect",
      "https://user.xcart.app/api/tracking/collect",
    ]);
    const [pv, vc] = envios.map((e) => e.corpo);
    expect(pv.evento).toBe("page_view");
    expect(pv.fonte).toBe("ponte");
    expect(pv.shop).toBe("loja-x.myshopify.com");
    expect(pv.storeId).toBe(LOJA["data-xcart-store"]);
    expect(pv.fbclid).toBe("ABC123");
    expect(pv.referrer).toBe("https://l.facebook.com/");
    expect(pv.pageUrl).toBe(url);
    expect(pv.visitorId).toMatch(/^[a-z0-9]+\.[a-z0-9]+$/);
    expect(pv.eventId).toBe(`page_view_${pv.visitorId}_${(pv.eventId as string).split("_").pop()}`);
    // ViewContent da variante do botao de compra, mesma pessoa, mesmo fbp.
    expect(vc.evento).toBe("view_item");
    expect(vc.produto).toEqual({ variante: "4567" });
    expect(vc.visitorId).toBe(pv.visitorId);
    expect(pv.fbp).toMatch(/^fb\.1\.\d+\.\d+$/);
    expect(vc.fbp).toBe(pv.fbp);
    expect(jar._fbp).toBe(pv.fbp);
    // _fbc nunca e inventado.
    expect(pv.fbc).toBeNull();
    expect(JSON.stringify(pv)).not.toContain('"value"');
    // O visitante vai ao checkout como atributo, com o fbp.
    const p = new URL(links[0]).searchParams;
    expect(p.get("attributes[_xc_vid]")).toBe(pv.visitorId);
    expect(p.get("attributes[_fbp]")).toBe(pv.fbp);
  });

  it("sem botao de compra na pagina so vai o page_view; visita organica tambem vai", () => {
    const { envios } = rodar({ url: "https://vsl.com/oferta", hrefs: [], tag: LOJA });
    expect(envios.map((e) => e.corpo.evento)).toEqual(["page_view"]);
    expect(envios[0].corpo.fbclid).toBeNull();
  });

  it("sem data-xcart-shop, usa o .myshopify.com da lista de destinos -- tag antiga segue valendo", () => {
    const { envios } = rodar({
      url,
      hrefs: ["https://kings.shop/cart/1:1"],
      tag: { "data-xcart-destinos": "abc-12.myshopify.com,kings.shop" },
    });
    expect(envios.length).toBe(2);
    expect(envios[0].corpo.shop).toBe("abc-12.myshopify.com");
    expect(envios[0].corpo).not.toHaveProperty("storeId");
  });

  it("sem loja nenhuma, nao manda nada e nao gera fbp", () => {
    const { envios, jar } = rodar({ url, hrefs: ["https://loja.shop/cart/4567:1"] });
    expect(envios).toEqual([]);
    expect(jar._fbp).toBeUndefined();
  });

  it("recarregar a pagina dentro de 30 min nao repete o evento", () => {
    const { envios } = rodar({ url, hrefs: [], tag: LOJA });
    expect(envios.length).toBe(1);
  });
});
});

describe("o que a ponte grava no carrinho, o pixel e o pedido leem pelo mesmo nome", () => {
  const pixel = readFileSync(path.join(raiz, "xcart-pixel.js"), "utf8");
  const coletor = readFileSync(
    path.resolve(__dirname, "..", "src", "app", "api", "tracking", "collect", "route.ts"),
    "utf8"
  );
  const compra = readFileSync(
    path.resolve(__dirname, "..", "src", "lib", "tracking", "purchase.ts"),
    "utf8"
  );
  // Mais o visitante da ponte (_xc_vid), que o modo de rastreamento poe no permalink.
  const daPonte = [...listaDe(ponte, "CLICK_IDS"), ...listaDe(ponte, "COOKIES_DO_PIXEL"), "_xc_vid"];
  const doPixel = listaDe(pixel, "DO_CARRINHO");

  it("o pixel le do checkout exatamente o que a ponte grava", () => {
    expect([...doPixel].sort()).toEqual([...daPonte].sort());
  });

  it("o pedido (webhook) le cada um desses atributos", () => {
    for (const k of doPixel) expect(compra, k).toContain(`atributo(pedido, "${k}")`);
  });

  it("o coletor le cada campo que o pixel manda", () => {
    for (const campo of ["fbclid", "gclid", "gbraid", "wbraid", "ttclid", "fbp", "fbc", "ttp"]) {
      expect(pixel, campo).toContain(`        ${campo}: atr.`);
      expect(coletor, campo).toContain(`corpo.${campo}`);
    }
  });
});
