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
    const ouvintes: { tipo: string; fn: (e: unknown) => void }[] = [];
    const document: Record<string, unknown> = {
      currentScript: {
        src: "https://user.xcart.app/xcart-bridge.js",
        getAttribute: (n: string) => atributos[n] ?? null,
      },
      referrer: "https://l.facebook.com/",
      readyState: "complete",
      documentElement: {},
      getElementsByTagName: () => links,
      // Pagina sem loader de roteamento nem formulario de compra (VSL, advertorial).
      querySelector: () => null,
      addEventListener: (tipo: string, fn: (e: unknown) => void) => void ouvintes.push({ tipo, fn }),
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
    /** O clique no link `i` (o ouvinte de captura da ponte). Devolve o href na hora da navegacao. */
    const clicar = (i: number) => {
      const evento = { target: { closest: (sel: string) => (sel === "a[href]" ? links[i] : null) } };
      for (const o of ouvintes) if (o.tipo === "click") o.fn(evento);
      return links[i].getAttribute("href") as string;
    };
    return { links: links.map((l) => l.getAttribute("href") as string), envios, jar, clicar };
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

/**
 * VSL com link direto para o checkout: a campanha, o conjunto e o anuncio so
 * chegam ao pedido como atributo (nenhuma pagina da loja roda). Medido na
 * imftvs-gc: 292 eventos do advertorial com utm_campaign em 15 dias, e 0 dos
 * visitantes com identidade.
 */
describe("a ponte leva as UTMs ao pedido, com a hora do clique", () => {
  const comUtm =
    "https://vsl.com/oferta?fbclid=ABC123&utm_source=fb&utm_medium=paid&utm_campaign=111111&utm_content=333333&utm_term=222222";

  it("no permalink: attributes[_xc_utm_*] e _xc_utm_em; o pedido sai com a origem", async () => {
    const {
      links: [permalink],
    } = rodar({ url: comUtm, hrefs: ["https://loja.shop/cart/4567:1"] });
    const p = new URL(permalink).searchParams;
    expect(p.get("attributes[_xc_utm_campaign]")).toBe("111111");
    expect(p.get("attributes[_xc_utm_term]")).toBe("222222");
    expect(p.get("attributes[_xc_utm_content]")).toBe("333333");
    expect(Number(p.get("attributes[_xc_utm_em]"))).toBeGreaterThan(Date.now() - 60_000);
    // O que a Shopify poe no pedido: os atributos do permalink.
    const note_attributes = [...p.entries()]
      .filter(([k]) => k.startsWith("attributes["))
      .map(([k, v]) => ({ name: k.slice(11, -1), value: v }));
    const { origemDoWebhook } = await import("../src/lib/tracking/origem-pedido");
    expect(origemDoWebhook({ created_at: new Date().toISOString(), note_attributes }, null)).toMatchObject({
      plataforma: "meta",
      campanha_id: "111111",
      conjunto_id: "222222",
      anuncio_id: "333333",
    });
  });

  it("UTM guardada de mais de 7 dias nao vai, nem no link nem como atributo", () => {
    const velha = String(Date.now() - 8 * 864e5);
    const {
      links: [permalink, produto],
    } = rodar({
      url: "https://vsl.com/oferta",
      cookies: { _xcb_utm_campaign: "111111", _xcb_utm_em: velha },
      hrefs: ["https://loja.shop/cart/4567:1", "https://loja.shop/products/x"],
    });
    expect(permalink).not.toContain("utm");
    expect(produto).not.toContain("utm_campaign");
  });

  it("UTM nova troca o conjunto: o utm_term do clique antigo nao se mistura", () => {
    const recente = String(Date.now() - 864e5);
    const {
      links: [permalink],
      jar,
    } = rodar({
      url: "https://vsl.com/oferta?utm_source=tiktok&utm_campaign=999999",
      cookies: { _xcb_utm_term: "222222", _xcb_utm_em: recente },
      hrefs: ["https://loja.shop/cart/4567:1"],
    });
    const p = new URL(permalink).searchParams;
    expect(p.get("attributes[_xc_utm_campaign]")).toBe("999999");
    expect(p.has("attributes[_xc_utm_term]")).toBe(false);
    expect(jar._xcb_utm_term ?? "").toBe("");
  });

  it("clique novo so com gclid tambem troca o conjunto: a campanha do clique anterior nao vai", () => {
    const recente = String(Date.now() - 864e5);
    const {
      links: [permalink, produto],
      jar,
    } = rodar({
      url: "https://vsl.com/oferta?gclid=Cj0KCQ&gad_campaignid=21234567890",
      cookies: { _xcb_utm_source: "fb", _xcb_utm_campaign: "111111", _xcb_utm_em: recente },
      hrefs: ["https://loja.shop/cart/4567:1", "https://loja.shop/products/x"],
    });
    const p = new URL(permalink).searchParams;
    expect(p.get("attributes[_xc_utm_clique]")).toBe("google");
    expect(p.get("attributes[_xc_utm_gad]")).toBe("21234567890");
    expect(p.has("attributes[_xc_utm_campaign]")).toBe(false);
    expect(Number(p.get("attributes[_xc_utm_em]"))).toBeGreaterThan(Date.now() - 60_000);
    expect(jar._xcb_utm_campaign ?? "").toBe("");
    // Na pagina da loja: o gad_campaignid e a hora do clique vao junto.
    const q = new URL(produto).searchParams;
    expect(q.get("gad_campaignid")).toBe("21234567890");
    expect(q.has("utm_campaign")).toBe(false);
    expect(Number(q.get("xcart_clique_em"))).toBeGreaterThan(Date.now() - 60_000);
  });

  it("click id de semanas atras repassado a loja leva a hora do clique, e o conjunto vencido nao vai", () => {
    const velho = String(Date.now() - 20 * 864e5);
    const {
      links: [permalink, produto],
    } = rodar({
      url: "https://vsl.com/oferta",
      cookies: { _xcb_gclid: "Cj0VELHO", _xcb_clique: "google", _xcb_utm_em: velho },
      hrefs: ["https://loja.shop/cart/4567:1", "https://loja.shop/products/x"],
    });
    expect(permalink).not.toContain("_xc_utm");
    const q = new URL(produto).searchParams;
    expect(q.get("gclid")).toBe("Cj0VELHO");
    expect(q.get("xcart_clique_em")).toBe(velho);
  });

  it("recarregar com o mesmo click id nao muda a hora do clique", () => {
    const antes = String(Date.now() - 2 * 864e5);
    const {
      links: [permalink],
    } = rodar({
      url: "https://vsl.com/oferta?gclid=Cj0KCQ",
      cookies: { _xcb_gclid: "Cj0KCQ", _xcb_clique: "google", _xcb_utm_em: antes },
      hrefs: ["https://loja.shop/cart/4567:1"],
    });
    expect(new URL(permalink).searchParams.get("attributes[_xc_utm_em]")).toBe(antes);
  });

  it("o coletor recebe o conjunto do clique (vai para a identidade)", () => {
    const { envios } = rodar({
      url: "https://vsl.com/oferta?fbclid=ABC123&utm_source=fb&utm_campaign=111111",
      hrefs: [],
      tag: { "data-xcart-store": "11111111-2222-3333-4444-555555555555", "data-xcart-shop": "loja-x.myshopify.com" },
    });
    expect(envios[0].corpo.utm).toMatchObject({ utm_source: "fb", utm_campaign: "111111", clique: "meta" });
    expect(typeof (envios[0].corpo.utm as Record<string, unknown>).em).toBe("number");
  });
});

/**
 * Pagina de vendas que leva a um CHECKOUT EXTERNO (Cakto, Fase D): o botao
 * aponta para o link da oferta, sem nada a mais. A ponte poe nele o visitante
 * (`callback=xc.<vid>`, que a Cakto devolve no webhook), as UTMs e os click
 * ids (o gclid e da tag do Google que fica na Cakto), e avisa o coletor -- para
 * o checkout, nao para loja -- do PageView ao abrir e do InitiateCheckout no
 * clique do botao. Sem valor.
 */
describe("a ponte numa pagina de vendas de checkout externo (Cakto)", () => {
  const CK = "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b";
  const CAKTO = { "data-xcart-destinos": "pay.cakto.com.br", "data-xcart-checkout": CK };
  const anuncio = "https://vsl.com/oferta?fbclid=IwAR_abc&gclid=Cj0KCQ&utm_source=FB&utm_campaign=111111&utm_content=333333";

  it("o link da oferta ganha callback=xc.<vid>, as UTMs e os click ids -- e nada de atributo de carrinho", async () => {
    const { links, envios } = rodar({ url: anuncio, hrefs: ["https://pay.cakto.com.br/a8BcHrY_1101387"], tag: CAKTO });
    const p = new URL(links[0]).searchParams;
    const vid = envios[0].corpo.visitorId as string;
    expect(p.get("callback")).toBe(`xc.${vid}`);
    expect(p.get("utm_source")).toBe("FB");
    expect(p.get("utm_campaign")).toBe("111111");
    expect(p.get("utm_content")).toBe("333333");
    expect(p.get("fbclid")).toBe("IwAR_abc");
    expect(p.get("gclid")).toBe("Cj0KCQ");
    expect(links[0]).not.toContain("attributes");
    expect(links[0]).not.toContain("xcart_clique_em");
    expect(p.has("sck")).toBe(false);
    // O webhook le o mesmo vid de volta (o formato que o CHECK da 073 aceita).
    const { vidDoParametro, RE_VID } = await import("../src/lib/checkouts-externos/plataformas/comum");
    expect(vidDoParametro(p.get("callback"))).toBe(vid);
    expect(RE_VID.test(vid)).toBe(true);
  });

  it("PageView ao abrir, para o CHECKOUT: sem loja, sem produto, sem valor, com o clique e o fbp gerado", () => {
    const { envios, jar } = rodar({ url: anuncio, hrefs: ["https://pay.cakto.com.br/a8BcHrY_1101387"], tag: CAKTO });
    expect(envios.map((e) => [e.url, e.corpo.evento])).toEqual([["https://user.xcart.app/api/tracking/collect", "page_view"]]);
    const pv = envios[0].corpo;
    expect(pv.checkoutId).toBe(CK);
    expect(pv).not.toHaveProperty("shop");
    expect(pv).not.toHaveProperty("storeId");
    expect(pv).not.toHaveProperty("produto");
    expect(pv.fonte).toBe("ponte");
    expect(pv.fbclid).toBe("IwAR_abc");
    expect(pv.gclid).toBe("Cj0KCQ");
    expect(pv.fbp).toMatch(/^fb\.1\.\d+\.\d+$/);
    expect(jar._fbp).toBe(pv.fbp);
    expect(pv.fbc).toBeNull();
    expect(pv.utm).toMatchObject({ utm_source: "FB", utm_campaign: "111111" });
    expect(JSON.stringify(pv)).not.toMatch(/"value"|"currency"/);
  });

  it("InitiateCheckout no clique do botao da Cakto, uma vez na aba; o link de terceiro nao dispara nem muda", () => {
    const { envios, clicar } = rodar({
      url: anuncio,
      hrefs: ["https://pay.cakto.com.br/a8BcHrY_1101387", "https://instagram.com/loja", "https://loja.shop/cart/1:1"],
      tag: CAKTO,
    });
    expect(clicar(1)).toBe("https://instagram.com/loja");
    // Fora da lista de destinos: nem o permalink de uma loja muda.
    expect(clicar(2)).toBe("https://loja.shop/cart/1:1");
    expect(envios.map((e) => e.corpo.evento)).toEqual(["page_view"]);

    const href = clicar(0);
    expect(new URL(href).searchParams.get("callback")).toBe(`xc.${envios[0].corpo.visitorId}`);
    clicar(0);
    expect(envios.map((e) => e.corpo.evento)).toEqual(["page_view", "begin_checkout"]);
    const ic = envios[1].corpo;
    expect(ic).toMatchObject({ checkoutId: CK, visitorId: envios[0].corpo.visitorId, fbclid: "IwAR_abc", fonte: "ponte" });
    expect(JSON.stringify(ic)).not.toMatch(/"value"|"currency"/);
  });

  it("o coletor aceita o corpo que a ponte manda e grava o clique na identidade do checkout", async () => {
    const { envios } = rodar({ url: anuncio, hrefs: ["https://pay.cakto.com.br/oferta"], tag: CAKTO });
    const pv = envios[0].corpo;
    const { coletarDoCheckout } = await import("../src/lib/checkouts-externos/coletor");
    const identidades: Record<string, unknown>[] = [];
    const eventos: string[] = [];
    const repo: Parameters<typeof coletarDoCheckout>[0] = {
      checkout: async (id) => ({ id, user_id: "u-1", plataforma: "cakto", ativo: true }),
      destinos: async () => [{ id: "d-meta", plataforma: "meta", conta: "123456789012345", token: "EAAtoken123456", testEventCode: null, ativo: true }],
      atualizarIdentidade: async () => false,
      identidadesNovas: async () => ({ doCheckout: 0, doIp: 0 }),
      inserirIdentidade: async (l) => void identidades.push({ ...l }),
      contarEnvios: async () => 0,
      inicioDesde: async () => false,
      enfileirar: async (ls) => {
        eventos.push(...ls.map((l) => l.event_name));
        return ls.map((l, i) => ({ ...l, id: `e${i}`, attempts: 0 }));
      },
      entregar: async (lista) => lista.map((x) => ({ id: x.envio.id, ok: true })),
    };
    const r = await coletarDoCheckout(repo, pv, { agoraMs: Date.now(), ip: "203.0.113.7", ipHash: null, userAgent: "Mozilla/5.0", pais: "BR" });
    expect(r.ok).toBe(true);
    expect(eventos).toEqual(["PageView"]);
    expect(identidades[0]).toMatchObject({
      checkout_id: CK,
      visitor_id: pv.visitorId,
      fbclid: "IwAR_abc",
      gclid: "Cj0KCQ",
      fbp: pv.fbp,
      utm: { source: "FB", campaign: "111111", content: "333333" },
    });
  });

  it("callback que o link ja traz fica (quem montou a pagina pode usa-lo); data-xcart-param-vid=sck leva no sck", () => {
    const {
      links: [proprio],
    } = rodar({ url: anuncio, hrefs: ["https://pay.cakto.com.br/oferta?callback=meu-token"], tag: CAKTO });
    expect(new URL(proprio).searchParams.getAll("callback")).toEqual(["meu-token"]);

    const {
      links: [comSck],
      envios,
    } = rodar({ url: anuncio, hrefs: ["https://pay.cakto.com.br/oferta"], tag: { ...CAKTO, "data-xcart-param-vid": "sck" } });
    const p = new URL(comSck).searchParams;
    expect(p.get("sck")).toBe(`xc.${envios[0].corpo.visitorId}`);
    expect(p.has("callback")).toBe(false);
  });

  it("id de checkout torto: nao rastreia nem poe visitante (so leva o clique, como a ponte simples)", () => {
    const { links, envios, clicar } = rodar({
      url: anuncio,
      hrefs: ["https://pay.cakto.com.br/oferta"],
      tag: { "data-xcart-destinos": "pay.cakto.com.br", "data-xcart-checkout": "nao-e-uuid" },
    });
    clicar(0);
    expect(envios).toEqual([]);
    expect(links[0]).not.toContain("callback");
    expect(new URL(links[0]).searchParams.get("fbclid")).toBe("IwAR_abc");
  });

  it("pagina de LOJA: o clique no permalink manda o InitiateCheckout da LOJA, nunca o do checkout externo nem callback", () => {
    const { envios, clicar } = rodar({ url: anuncio, hrefs: ["https://loja.shop/cart/4567:1"], tag: LOJA });
    const href = clicar(0);
    expect(href).not.toContain("callback");
    expect(envios.map((e) => e.corpo.evento)).toEqual(["page_view", "view_item", "begin_checkout"]);
    for (const e of envios) {
      expect(e.corpo.shop).toBe("loja-x.myshopify.com");
      expect(e.corpo).not.toHaveProperty("checkoutId");
    }
  });
});

/**
 * Abriu checkout = InitiateCheckout, tambem na VSL com link direto para o
 * checkout (/cart/VARIANTE:QTD): nenhuma pagina do tema roda, e o IC dependia
 * do Web Pixel. O clique no permalink da loja rastreada avisa o coletor; com o
 * pixel cobrindo vira reserva, que o pixel cancela pelo `_xc_vid` que vai no
 * permalink (o mesmo visitante do evento).
 */
describe("a ponte manda o InitiateCheckout no clique do permalink da loja", () => {
  const vsl = "https://vsl.com/oferta?fbclid=ABC123";
  const inicios = (envios: { corpo: Record<string, unknown> }[]) =>
    envios.map((e) => e.corpo).filter((c) => c.evento === "begin_checkout");

  it("como a loja, com o visitante que vai no permalink, sem produto e sem valor; uma vez na aba", () => {
    const { envios, clicar } = rodar({ url: vsl, hrefs: ["https://loja.shop/cart/4567:2,4568:1"], tag: LOJA });
    const href = clicar(0);
    clicar(0);
    const ics = inicios(envios);
    expect(ics.length).toBe(1);
    expect(ics[0]).toMatchObject({
      shop: "loja-x.myshopify.com",
      storeId: LOJA["data-xcart-store"],
      fonte: "ponte",
      fbclid: "ABC123",
      produto: null,
      pageUrl: vsl,
    });
    expect(ics[0].visitorId).toBe(envios[0].corpo.visitorId);
    // O pixel do checkout le este atributo como vidDoTema e cancela a reserva.
    expect(new URL(href).searchParams.get("attributes[_xc_vid]")).toBe(ics[0].visitorId);
    expect(JSON.stringify(ics[0])).not.toMatch(/"value"|"currency"|"price"/);
  });

  it("o dominio permanente (data-xcart-shop) conta mesmo fora da lista -- e o link fica como esta", () => {
    const { envios, clicar } = rodar({ url: vsl, hrefs: ["https://loja-x.myshopify.com/cart/4567:1"], tag: LOJA });
    expect(clicar(0)).toBe("https://loja-x.myshopify.com/cart/4567:1");
    expect(inicios(envios).length).toBe(1);
  });

  it("so o permalink de variante da loja: pagina do tema, /cart, outra loja e terceiro nao sao IC", () => {
    const { envios, clicar } = rodar({
      url: vsl,
      hrefs: [
        "https://loja.shop/products/x",
        "https://loja.shop/cart",
        "https://outra-loja.shop/cart/4567:1",
        "https://instagram.com/loja",
      ],
      tag: LOJA,
    });
    for (let i = 0; i < 4; i++) clicar(i);
    expect(inicios(envios)).toEqual([]);
  });

  it("sem a loja identificada (so a lista), so leva o clique: nada vai ao coletor", () => {
    const { envios, clicar } = rodar({ url: vsl, hrefs: ["https://loja.shop/cart/4567:1"] });
    clicar(0);
    expect(envios).toEqual([]);
  });

  it("a reserva da ponte e da familia da reserva do clique comum (o coletor esta em tracking-checkout-expresso)", async () => {
    const { idDaReservaDaPonte, PREFIXO_RESERVA_DA_PONTE, PREFIXO_RESERVA_DO_CHECKOUT, ehReservaDeCheckout } =
      await import("../src/lib/tracking/eventos");
    const id = idDaReservaDaPonte("mg1abc0.k2j3h4x9", Date.parse("2026-10-28T12:00:00Z"));
    // A mesma familia da reserva do clique comum: drain, garantia e historico a tratam igual.
    expect(id.startsWith(PREFIXO_RESERVA_DO_CHECKOUT)).toBe(true);
    expect(id.startsWith(PREFIXO_RESERVA_DA_PONTE)).toBe(true);
    expect(ehReservaDeCheckout(id)).toBe(true);
  });
});
});

describe("ponte, snippet e servidor falam das mesmas UTMs", () => {
  it("a ponte grava as UTMs que o snippet guarda", () => {
    expect(listaDe(ponte, "UTM").sort()).toEqual(listaDe(snippet, "UTM").sort());
  });

  it("o servidor le cada atributo _xc_utm_* (e a hora)", async () => {
    const { utmDosAtributos } = await import("../src/lib/tracking/utm");
    const atributos = listaDe(snippet, "UTM").map((k) => ({ name: `_xc_${k}`, value: "123456" }));
    const r = utmDosAtributos([...atributos, { name: "_xc_utm_em", value: String(Date.now()) }]);
    expect(Object.keys(r.nosso?.utm ?? {}).sort()).toEqual(["campaign", "content", "id", "medium", "source", "term"]);
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

  it("sem atributo, o pixel le o clique da URL do checkout (anuncio direto para o permalink)", () => {
    // O Meta anexa ?fbclid= ao link do anuncio; num link direto para
    // /cart/ID:1 a Shopify leva a query ate a pagina do checkout, e e o unico
    // lugar onde o clique existe. Atributo do carrinho vence a URL.
    expect(pixel).toContain("cliquesDaUrl(paginaDoEvento(event))");
    for (const campo of ["fbclid", "gclid", "gbraid", "wbraid", "ttclid"]) {
      expect(pixel, campo).toContain(`${campo}: atr.${campo} || daUrl.${campo}`);
    }
    expect([...listaDe(pixel, "DA_URL")].sort()).toEqual([...listaDe(ponte, "CLICK_IDS")].sort());
  });

  it("o coletor le cada campo que o pixel manda", () => {
    for (const campo of ["fbclid", "gclid", "gbraid", "wbraid", "ttclid", "fbp", "fbc", "ttp"]) {
      expect(pixel, campo).toContain(`        ${campo}: atr.`);
      expect(coletor, campo).toContain(`corpo.${campo}`);
    }
  });
});
