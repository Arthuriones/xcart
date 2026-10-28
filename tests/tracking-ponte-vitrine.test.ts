import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * A ponte no tema da VITRINE de uma rota vitrine -> checkout.
 *
 * O carrinho acontece na vitrine, onde a loja de checkout nao tem snippet nem
 * pixel. Medido em 25/10 na Stepz Club: 105 carrinhos roteados, 0 AddToCart e
 * 0 ViewContent no pixel da loja de checkout -- o Meta via o InitiateCheckout e
 * a compra sem nada antes. Com o loader de roteamento na pagina, a ponte manda
 * view_item e add_to_cart ao coletor COMO a loja de checkout, com a variante do
 * catalogo DELA (o mapa da rota, o mesmo xcart-config.json do loader).
 *
 * A ponte roda de verdade aqui, num navegador de mentira montado com vm.
 */

const raiz = path.resolve(__dirname, "..", "public");
const ponte = readFileSync(path.join(raiz, "xcart-bridge.js"), "utf8");
const snippet = readFileSync(path.join(raiz, "xcart-click.js"), "utf8");

const SHOP = "checkout-x.myshopify.com";
const STORE = "11111111-2222-3333-4444-555555555555";
const TAG = {
  "data-xcart-destinos": `${SHOP},checkout-x.store`,
  "data-xcart-store": STORE,
  "data-xcart-shop": SHOP,
};
const URL_DO_MAPA = "//vitrine.com/cdn/shop/t/7/assets/xcart-config.json?v=1";

/**
 * O mapa da rota, no formato do embed-config: chave = variante da VITRINE (gid
 * e numero), valor = variante do CHECKOUT. 111 e 222 tem par por SKU; 333 so
 * pelo variant_map (o SKU da vitrine mudou); 444 nao tem par. O outro destino
 * (rodizio) tem outro par para a 111 e nao pode ser usado.
 */
const MAPA = {
  rotation: { strategy: "sticky" },
  targets: [
    {
      id: "t-outra",
      domain: "outra.myshopify.com",
      weight: 1,
      skuMap: { "tenis-38": "7777" },
      variantMap: { "gid://shopify/ProductVariant/111": "7777" },
    },
    {
      id: "t-1",
      domain: SHOP,
      weight: 1,
      skuMap: { "tenis-38": "9111", "tenis-39": "9222" },
      variantMap: {
        "gid://shopify/ProductVariant/111": "9111",
        "111": "9111",
        "gid://shopify/ProductVariant/222": "gid://shopify/ProductVariant/9222",
        "333": "9333",
      },
    },
  ],
};

const PRODUTO = {
  id: 55,
  variants: [
    { id: 111, sku: "TENIS-38" },
    { id: 222, sku: "tenis-39" },
    { id: 333, sku: "tenis-40" },
    { id: 444, sku: "tenis-41" },
  ],
};

interface Corpo {
  evento: string;
  shop?: string;
  storeId?: string;
  visitorId?: string;
  fonte?: string;
  pageUrl?: string;
  produto?: unknown;
}

/** Response de uma vez so, como a de verdade: o corpo lido nao se le de novo. */
function resposta(corpo: unknown, ok = true, tipo = "application/json") {
  let lido = false;
  const r = {
    ok,
    status: ok ? 200 : 422,
    headers: { get: (n: string) => (n.toLowerCase() === "content-type" ? tipo : null) },
    json: () => {
      if (lido) return Promise.reject(new TypeError("body used already"));
      lido = true;
      return Promise.resolve(JSON.parse(JSON.stringify(corpo)));
    },
    clone: () => {
      if (lido) throw new TypeError("clone after body used");
      return resposta(corpo, ok, tipo);
    },
  };
  return r;
}

type Resposta = ReturnType<typeof resposta>;

class XhrFalso {
  status = 0;
  responseType = "";
  responseText = "";
  ouvintes: Record<string, (() => void)[]> = {};
  open(_metodo: string, _url: string) {}
  addEventListener(tipo: string, fn: () => void) {
    (this.ouvintes[tipo] ||= []).push(fn);
  }
  responder(status: number, corpo: unknown) {
    this.status = status;
    this.responseText = JSON.stringify(corpo);
    for (const fn of this.ouvintes.load || []) fn.call(this);
  }
}

function abrir(opts: {
  url?: string;
  tag?: Record<string, string>;
  /** Pagina sem o loader de roteamento. */
  semLoader?: boolean;
  loader?: Record<string, string>;
  /** A loja desta pagina (window.Shopify.shop). */
  loja?: string | null;
  produto?: unknown;
  /** A variante do formulario de compra da pagina. */
  varianteDoForm?: string;
  /** O mapa que o tema serve; "pendurado" = a busca nunca volta. */
  mapa?: unknown;
  sessao?: Map<string, string>;
}) {
  const u = new URL(opts.url ?? "https://vitrine.com/products/tenis?variant=111");
  const atributos: Record<string, string> = { ...TAG, ...(opts.tag || {}) };
  const envios: Corpo[] = [];
  const leiturasDoMapa: { url: string; cache?: string }[] = [];
  const jar: Record<string, string> = {};
  const storage = opts.sessao ?? new Map<string, string>();
  const doDocumento: { tipo: string; fn: (e: unknown) => void }[] = [];
  const daJanela: { tipo: string; fn: (e: unknown) => void }[] = [];
  const timers: (() => void)[] = [];
  let relogio = Date.now();

  const loaderTag = {
    getAttribute: (n: string) =>
      (opts.loader ?? { src: "https://user.xcart.app/routed-checkout-loader.js", "data-config-url": URL_DO_MAPA })[n] ??
      null,
  };
  const formDaPagina = formulario("/cart/add", opts.varianteDoForm ?? "111");

  const document: Record<string, unknown> = {
    currentScript: {
      src: "https://user.xcart.app/xcart-bridge.js",
      getAttribute: (n: string) => atributos[n] ?? null,
    },
    referrer: "https://vitrine.com/collections/todos",
    readyState: "complete",
    documentElement: {},
    getElementsByTagName: () => [],
    querySelector: (sel: string) => {
      if (sel.includes("routed-checkout-loader.js")) return opts.semLoader ? null : loaderTag;
      if (sel.includes('form[action*="/cart/add"]')) return formDaPagina;
      return null;
    },
    addEventListener: (tipo: string, fn: (e: unknown) => void) => void doDocumento.push({ tipo, fn }),
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

  // O que o tema chama. A ponte troca este fetch pelo dela.
  const servidor = { add: (): Resposta => resposta({ variant_id: 111, sku: "TENIS-38" }) };
  function fetch(entrada: unknown, init?: { cache?: string }) {
    const alvo = String(entrada);
    if (alvo.includes("xcart-config.json")) {
      leiturasDoMapa.push({ url: alvo, cache: init?.cache });
      if (opts.mapa === "pendurado") return new Promise(() => {});
      return Promise.resolve(resposta(opts.mapa ?? MAPA));
    }
    if (alvo.includes("/cart/")) return Promise.resolve(servidor.add());
    return Promise.reject(new Error(`fetch inesperado: ${alvo}`));
  }

  class BlobFalso {
    texto: string;
    constructor(partes: string[]) {
      this.texto = partes.join("");
    }
  }

  class DataFalsa extends Date {
    static now() {
      return relogio;
    }
  }

  const sandbox: Record<string, unknown> = {
    document,
    location: { href: u.href, search: u.search, pathname: u.pathname, protocol: u.protocol },
    URL,
    URLSearchParams,
    Date: DataFalsa,
    Blob: BlobFalso,
    navigator: {
      sendBeacon: (_url: string, blob: BlobFalso) => {
        envios.push(JSON.parse(blob.texto));
        return true;
      },
    },
    fetch,
    // Uma classe por pagina: a ponte troca o `open` do prototipo.
    XMLHttpRequest: class extends XhrFalso {},
    setTimeout: (fn: () => void) => {
      timers.push(fn);
      return timers.length;
    },
    sessionStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
    },
    addEventListener: (tipo: string, fn: (e: unknown) => void) => void daJanela.push({ tipo, fn }),
    Shopify: opts.loja === null ? undefined : { shop: opts.loja ?? "vitrine-1.myshopify.com" },
    ShopifyAnalytics: { meta: { product: opts.produto === undefined ? PRODUTO : opts.produto } },
  };
  sandbox.window = sandbox;
  vm.runInNewContext(ponte, sandbox);

  return {
    envios,
    leiturasDoMapa,
    sessao: storage,
    servidor,
    fetchOriginal: fetch,
    fetchDaPagina: () => sandbox.fetch as typeof fetch,
    /** O tema adicionando pelo fetch (ja embrulhado), e lendo a resposta depois. */
    adicionar: async (url = "/cart/add.js") => {
      const r = (await (sandbox.fetch as typeof fetch)(url)) as Resposta;
      return r.json();
    },
    xhr: (url = "/cart/add.js") => {
      const x = new (sandbox.XMLHttpRequest as typeof XhrFalso)();
      x.open("POST", url);
      return x;
    },
    /** Um submit; `prevenido` = o tema segurou para adicionar por AJAX. */
    enviar: (form: unknown, prevenido: boolean) => {
      const e = { target: form, defaultPrevented: prevenido };
      for (const o of doDocumento) if (o.tipo === "submit") o.fn(e);
    },
    sair: () => {
      for (const o of daJanela) if (o.tipo === "pagehide") o.fn({});
    },
    /** O clique (sintetico ou nao) num link: os ouvintes de captura do document. Devolve o href na navegacao. */
    clicar: (a: ReturnType<typeof link>) => {
      const e = { target: { closest: (sel: string) => (sel === "a[href]" ? a : null) } };
      for (const o of doDocumento) if (o.tipo === "click") o.fn(e);
      return a.getAttribute("href");
    },
    rodarTimers: () => timers.splice(0).forEach((fn) => fn()),
    andar: (ms: number) => {
      relogio += ms;
    },
  };
}

/**
 * Um <a>. `rota` = o link que o loader cria e clica para levar o carrinho a
 * loja de checkout (irParaCheckout, marca data-xcart-rota).
 */
function link(href: string, rota = false) {
  const attrs: Record<string, string> = { href, ...(rota ? { "data-xcart-rota": "1" } : {}) };
  return {
    getAttribute: (n: string) => attrs[n] ?? null,
    setAttribute: (n: string, v: string) => {
      attrs[n] = v;
    },
  };
}

function formulario(action: string, variante: string) {
  return {
    getAttribute: (n: string) => (n === "action" ? action : null),
    querySelector: (s: string) => (s === '[name="id"]' ? { value: variante } : null),
  };
}

/** Deixa as promessas encadeadas (fetch -> clone -> json -> mapa) terminarem. */
async function assentar() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

const eventos = (envios: Corpo[]) => envios.map((e) => e.evento);
const doCarrinho = (envios: Corpo[]) => envios.filter((e) => e.evento === "add_to_cart");

describe("ponte na vitrine de rota: ver produto", () => {
  it("view_item para a LOJA DE CHECKOUT, com a variante do catalogo dela", async () => {
    const p = abrir({});
    await assentar();
    expect(eventos(p.envios)).toEqual(["page_view", "view_item"]);
    const vi = p.envios[1];
    expect(vi).toMatchObject({ shop: SHOP, storeId: STORE, fonte: "ponte" });
    // 111 da vitrine = 9111 do checkout; o SKU confirmado pelo sku_map vai como e na vitrine.
    expect(vi.produto).toEqual({ variante: "9111", sku: "TENIS-38" });
    expect(vi.pageUrl).toBe("https://vitrine.com/products/tenis?variant=111");
    expect(JSON.stringify(vi)).not.toMatch(/"value"|"currency"|"price"/);
    // O mesmo asset do loader, do cache do navegador.
    expect(p.leiturasDoMapa).toEqual([{ url: URL_DO_MAPA, cache: "force-cache" }]);
  });

  it("uma vez por produto em 30 min na aba; outro produto conta", async () => {
    const sessao = new Map<string, string>();
    abrir({ sessao });
    await assentar();
    const recarga = abrir({ sessao });
    await assentar();
    expect(eventos(recarga.envios)).toEqual([]);
    const outro = abrir({ sessao, url: "https://vitrine.com/products/sandalia?variant=222" });
    await assentar();
    expect(eventos(outro.envios)).toEqual(["view_item"]);
    expect(outro.envios[0].produto).toEqual({ variante: "9222", sku: "tenis-39" });
  });

  it("fora da pagina de produto: so o page_view, e o mapa nem e lido", async () => {
    const p = abrir({ url: "https://vitrine.com/collections/todos", produto: null });
    await assentar();
    expect(eventos(p.envios)).toEqual(["page_view"]);
    expect(p.leiturasDoMapa).toEqual([]);
  });

  it("variante sem par vai SEM produto -- nunca o id da vitrine", async () => {
    const p = abrir({ url: "https://vitrine.com/products/tenis?variant=444" });
    await assentar();
    expect(p.envios[1].evento).toBe("view_item");
    expect(p.envios[1].produto).toBeNull();
    // Fora a URL da pagina, o id da vitrine nao aparece em lugar nenhum.
    expect(JSON.stringify({ ...p.envios[1], pageUrl: null })).not.toMatch(/\b444\b/);
  });

  it("par so pelo variant_map: vai a variante, sem o SKU (que pode ser outro no checkout)", async () => {
    const p = abrir({ url: "https://vitrine.com/products/tenis?variant=333" });
    await assentar();
    expect(p.envios[1].produto).toEqual({ variante: "9333" });
  });
});

describe("ponte na vitrine de rota: adicionar ao carrinho", () => {
  it("fetch do tema: 1 add_to_cart com o item que o /cart/add devolveu, e o tema le a resposta intacta", async () => {
    // Compra rapida de OUTRO produto: a pagina mostra a 111, o carrinho recebeu a 222.
    const p = abrir({});
    await assentar();
    p.servidor.add = () => resposta({ id: 222, variant_id: 222, sku: "tenis-39", quantity: 1 });
    const lidoPeloTema = await p.adicionar();
    await assentar();
    expect(lidoPeloTema).toMatchObject({ variant_id: 222 });
    const adds = doCarrinho(p.envios);
    expect(adds.length).toBe(1);
    expect(adds[0]).toMatchObject({ shop: SHOP, storeId: STORE, fonte: "ponte" });
    expect(adds[0].produto).toEqual({ variante: "9222", sku: "tenis-39" });
    expect(adds[0].visitorId).toBe(p.envios[0].visitorId);
    expect(JSON.stringify(adds[0])).not.toMatch(/"value"|"currency"|"price"/);
  });

  it("add de varios itens (items[]): o primeiro", async () => {
    const p = abrir({});
    p.servidor.add = () => resposta({ items: [{ variant_id: 222, sku: "tenis-39" }, { variant_id: 111, sku: "TENIS-38" }] });
    await p.adicionar();
    await assentar();
    expect(doCarrinho(p.envios)[0].produto).toEqual({ variante: "9222", sku: "tenis-39" });
  });

  it("duas chamadas ao /cart/add no mesmo clique (o brinde, 3 a 4 s depois) contam um carrinho", async () => {
    const p = abrir({});
    await p.adicionar();
    p.andar(3500);
    await p.adicionar();
    await assentar();
    expect(doCarrinho(p.envios).length).toBe(1);
    // Passada a janela, e outro carrinho.
    p.andar(8000);
    await p.adicionar();
    await assentar();
    expect(doCarrinho(p.envios).length).toBe(2);
  });

  it("adicionar que falhou nao conta; change/update/clear nao sao carrinho", async () => {
    const p = abrir({});
    p.servidor.add = () => resposta({ status: 422, message: "Sem estoque" }, false);
    await p.adicionar();
    p.servidor.add = () => resposta({ items: [] });
    await p.adicionar("/cart/change.js");
    await p.adicionar("/cart/update.js");
    await assentar();
    expect(doCarrinho(p.envios)).toEqual([]);
  });

  it("resposta que nao e JSON: o produto da pagina", async () => {
    const p = abrir({});
    p.servidor.add = () => resposta("<html>", true, "text/html");
    await (p.fetchDaPagina())("/cart/add");
    await assentar();
    expect(doCarrinho(p.envios)[0].produto).toEqual({ variante: "9111", sku: "TENIS-38" });
  });

  it("XHR (tema jQuery): conta pelo item da resposta, so com 2xx", async () => {
    const p = abrir({});
    p.xhr().responder(422, { status: 422 });
    p.xhr("/cart/add.js").responder(200, { variant_id: 222, sku: "tenis-39" });
    await assentar();
    const adds = doCarrinho(p.envios);
    expect(adds.length).toBe(1);
    expect(adds[0].produto).toEqual({ variante: "9222", sku: "tenis-39" });
  });

  it("submit nativo que ninguem segurou conta, com a variante do formulario enviado", async () => {
    const p = abrir({});
    // O mapa ja chegou (pagina de produto): os timers abaixo sao so o do submit.
    await assentar();
    p.enviar(formulario("/cart/add", "222"), false);
    expect(doCarrinho(p.envios)).toEqual([]);
    p.rodarTimers();
    await assentar();
    const adds = doCarrinho(p.envios);
    expect(adds.length).toBe(1);
    expect(adds[0].produto).toEqual({ variante: "9222", sku: "tenis-39" });
  });

  it("submit que o tema segurou fica para o fetch: um carrinho so", async () => {
    const p = abrir({});
    await assentar();
    p.enviar(formulario("/cart/add", "111"), true);
    p.rodarTimers();
    await p.adicionar();
    await assentar();
    expect(doCarrinho(p.envios).length).toBe(1);
    // Formulario que nao e de adicionar nao e carrinho.
    p.andar(9000);
    p.enviar(formulario("/cart", "111"), false);
    p.rodarTimers();
    await assentar();
    expect(doCarrinho(p.envios).length).toBe(1);
  });

  it("mapa que nao chega nao segura o evento: a pagina saindo manda sem produto", async () => {
    const p = abrir({ url: "https://vitrine.com/collections/todos", produto: null, mapa: "pendurado" });
    await p.adicionar();
    await assentar();
    expect(doCarrinho(p.envios)).toEqual([]);
    p.sair();
    const adds = doCarrinho(p.envios);
    expect(adds.length).toBe(1);
    expect(adds[0].produto).toBeNull();
  });

  it("mapa que nao chega em 4 s: vai sem produto", async () => {
    const p = abrir({ mapa: "pendurado" });
    await assentar();
    expect(eventos(p.envios)).toEqual(["page_view"]);
    p.rodarTimers();
    expect(eventos(p.envios)).toEqual(["page_view", "view_item"]);
    expect(p.envios[1].produto).toBeNull();
  });
});

/**
 * Abriu checkout = InitiateCheckout. Na rota o comprador clica em "Finalizar
 * compra" na VITRINE; o loader cria um <a data-xcart-rota> com o permalink da
 * loja de checkout sorteada e da .click() -- e o clique passa pelos ouvintes de
 * captura do document, onde a ponte o ve. Sem isto, o IC so saia se o Web Pixel
 * do checkout rodasse (consentimento negado e Shop Pay em shop.app ficavam sem
 * IC; medido na Stepz: 64 do pixel contra 32 de garantia em 7 dias).
 */
describe("ponte na vitrine de rota: abriu checkout = InitiateCheckout", () => {
  const inicios = (envios: Corpo[]) => envios.filter((e) => e.evento === "begin_checkout");
  const CARRINHO = "https://vitrine.com/cart";

  it("o link do loader para ESTA loja: begin_checkout como a loja de checkout, sem produto e sem valor", async () => {
    const p = abrir({ url: CARRINHO, produto: null });
    await assentar();
    p.clicar(link(`https://${SHOP}/cart/9111:1,9222:2?country=GB`, true));
    const ics = inicios(p.envios);
    expect(ics.length).toBe(1);
    expect(ics[0]).toMatchObject({
      shop: SHOP,
      storeId: STORE,
      fonte: "ponte",
      visitorId: p.envios[0].visitorId,
      pageUrl: CARRINHO,
    });
    // O carrinho pode ter varios itens: sem produto, como o clique do tema.
    expect(ics[0].produto).toBeNull();
    expect(JSON.stringify(ics[0])).not.toMatch(/"value"|"currency"|"price"/);
  });

  it("pelo dominio de checkout da lista tambem; uma vez por aba em 30 min", async () => {
    const sessao = new Map<string, string>();
    const destino = () => link("https://www.checkout-x.store/cart/9111:1", true);
    const p = abrir({ url: CARRINHO, produto: null, sessao });
    p.clicar(destino());
    p.clicar(destino());
    expect(inicios(p.envios).length).toBe(1);
    // Voltou do checkout (outra pagina, mesma aba) e clicou de novo: a mesma tentativa.
    const volta = abrir({ url: CARRINHO, produto: null, sessao });
    volta.clicar(destino());
    expect(inicios(volta.envios)).toEqual([]);
    // Passados os 30 min, e outra.
    volta.andar(31 * 60e3);
    volta.clicar(destino());
    expect(inicios(volta.envios).length).toBe(1);
  });

  it("rodizio com as duas lojas rastreadas (uma tag por loja): o IC de uma nao tranca o da outra na mesma aba", async () => {
    // As duas tags rodam na mesma pagina e dividem o sessionStorage da aba.
    const sessao = new Map<string, string>();
    const B = "outra.myshopify.com";
    const a = abrir({ url: CARRINHO, produto: null, sessao });
    const b = abrir({
      url: CARRINHO,
      produto: null,
      sessao,
      tag: { "data-xcart-destinos": B, "data-xcart-shop": B, "data-xcart-store": "99999999-2222-3333-4444-555555555555" },
    });
    // 1o Finalizar: o sorteio cai na A.
    a.clicar(link(`https://${SHOP}/cart/9111:1`, true));
    expect(inicios(a.envios).map((e) => e.shop)).toEqual([SHOP]);
    // Voltou e clicou de novo, minutos depois: agora o sorteio cai na B.
    b.clicar(link(`https://${B}/cart/7777:1`, true));
    expect(inicios(b.envios).map((e) => e.shop)).toEqual([B]);
    // E a A segue com a janela dela.
    a.clicar(link(`https://${SHOP}/cart/9111:1`, true));
    expect(inicios(a.envios).length).toBe(1);
  });

  it("rodizio: o sorteio mandou a OUTRA loja de checkout -- nada sai como esta, e o link fica intocado", async () => {
    const p = abrir({ url: CARRINHO, produto: null });
    const outra = "https://outra.myshopify.com/cart/7777:1?country=GB";
    expect(p.clicar(link(outra, true))).toBe(outra);
    expect(inicios(p.envios)).toEqual([]);
  });

  it("so o link do checkout: o /checkout da vitrine, o produto e o /cart da loja nao sao IC", async () => {
    const p = abrir({ url: CARRINHO, produto: null });
    p.clicar(link("/checkout"));
    p.clicar(link(`https://${SHOP}/products/tenis`));
    p.clicar(link(`https://${SHOP}/cart`));
    p.clicar(link(`https://${SHOP}.evil.com/cart/9111:1`, true));
    expect(inicios(p.envios)).toEqual([]);
  });

  it("na propria loja do rastreamento, nada: quem conta e o snippet do tema e o pixel", async () => {
    const p = abrir({ url: `https://${SHOP}/cart`, produto: null, loja: SHOP });
    p.clicar(link(`https://${SHOP}/cart/9111:1`, true));
    expect(inicios(p.envios)).toEqual([]);
  });

  it("pagina de checkout externo (Cakto) nao manda IC de loja", async () => {
    const p = abrir({
      url: CARRINHO,
      produto: null,
      tag: { "data-xcart-checkout": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" },
    });
    p.clicar(link(`https://${SHOP}/cart/9111:1`, true));
    expect(inicios(p.envios).filter((e) => e.shop)).toEqual([]);
  });
});

describe("ponte na vitrine de rota: o mapa", () => {
  it("mapa embutido no loader (data-config), no formato antigo de um destino", async () => {
    const antigo = { domain: SHOP, skuMap: { "tenis-38": "9111" }, variantMap: { "111": "9111" } };
    const p = abrir({
      loader: { src: "https://user.xcart.app/routed-checkout-loader.js", "data-config": JSON.stringify(antigo) },
    });
    await assentar();
    expect(p.envios[1].produto).toEqual({ variante: "9111", sku: "TENIS-38" });
    expect(p.leiturasDoMapa).toEqual([]);
  });

  it("destino guardado pelo dominio de checkout da lista", async () => {
    const mapa = { targets: [{ ...MAPA.targets[1], domain: "https://www.checkout-x.store" }] };
    const p = abrir({ mapa });
    await assentar();
    expect(p.envios[1].produto).toEqual({ variante: "9111", sku: "TENIS-38" });
  });

  it("rota que nao tem esta loja: sem produto (o par de outra loja nao serve)", async () => {
    const p = abrir({ mapa: { targets: [MAPA.targets[0]] } });
    await assentar();
    expect(p.envios[1].evento).toBe("view_item");
    expect(p.envios[1].produto).toBeNull();
  });
});

describe("a ponte so mede o carrinho na vitrine de uma rota", () => {
  it("sem o loader de roteamento: fetch intocado, sem carrinho nem view_item da loja", async () => {
    const p = abrir({ semLoader: true });
    expect(p.fetchDaPagina()).toBe(p.fetchOriginal);
    await p.adicionar();
    await assentar();
    expect(eventos(p.envios)).toEqual(["page_view"]);
  });

  it("na propria loja do rastreamento quem conta e o snippet do tema", async () => {
    const p = abrir({ loja: SHOP });
    expect(p.fetchDaPagina()).toBe(p.fetchOriginal);
    await assentar();
    expect(eventos(p.envios)).toEqual(["page_view"]);
  });

  it("fora da Shopify (VSL com loader colado por engano): nada muda", async () => {
    const p = abrir({ loja: null });
    expect(p.fetchDaPagina()).toBe(p.fetchOriginal);
  });

  it("pagina de checkout externo (Cakto) nao vira vitrine", async () => {
    const p = abrir({
      tag: { "data-xcart-destinos": "pay.cakto.com.br", "data-xcart-checkout": "6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b" },
    });
    expect(p.fetchDaPagina()).toBe(p.fetchOriginal);
  });
});

describe("ponte e snippet contam o carrinho do mesmo jeito", () => {
  it("a mesma janela anti-duplicata (8 s)", () => {
    const daPonte = ponte.match(/var JANELA_CARRINHO_MS = (\d+);/);
    const doSnippet = snippet.match(/var JANELA_MS = (\d+);/);
    expect(daPonte?.[1]).toBeDefined();
    expect(daPonte?.[1]).toBe(doSnippet?.[1]);
  });

  it("o mesmo teste de URL: so /cart/add", () => {
    expect(ponte).toContain('String(url).indexOf("/cart/add") !== -1');
    expect(snippet).toContain('texto.indexOf("/cart/add") !== -1');
  });

  it("os tres caminhos nos dois: fetch, XHR e submit nativo conferido depois dos ouvintes", () => {
    for (const fonte of [ponte, snippet]) {
      expect(fonte).toContain("window.fetch = function");
      expect(fonte).toContain("XMLHttpRequest.prototype.open = function");
      expect(fonte).toMatch(/if \(!e\.defaultPrevented\) (adicionou|mandar)\(/);
    }
  });
});
