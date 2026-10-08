import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

/**
 * O loader roda no tema da vitrine, e dois buracos dele mandavam o comprador
 * para o checkout da PROPRIA vitrine (que nao cobra) ou faziam a vitrine
 * cobrar:
 *
 * 1. Segundo toque durante o roteamento. O loader barrava o primeiro toque
 *    antes do tema e nao mostrava nada; o comprador tocava de novo, o guard
 *    `if (isRouting) return` saia SEM preventDefault, e o submit nativo do
 *    tema levava a vitrine. Visto na NORAH (gaveta do Shrine, "Secure
 *    checkout"): 27 "Load failed" no Safari em 30 dias, quase todos sem venda
 *    roteada no minuto seguinte.
 * 2. Carteiras (Shop Pay, Apple/Google Pay, PayPal) em shadow DOM fechado: o
 *    alvo chega trocado pelo hospedeiro, sem texto nem name, e o loader nao
 *    reconhecia o clique.
 *
 * Estes testes rodam o arquivo REAL de public/ num DOM de mentira, pequeno o
 * bastante para caber aqui: so o que o loader usa (closest, matches com
 * seletor composto, captura/alvo/bolha, acao padrao de link e submit).
 */

const LOADER = readFileSync(
  path.resolve(__dirname, "../public/routed-checkout-loader.js"),
  "utf8"
);

// ---------------------------------------------------------------------------
// Seletor CSS minimo: lista de compostos (tag, #id, .classe, [attr op valor]).
// Combinador e pseudo-classe nao casam nada -- o loader so usa isso em
// openCartPreview, que nao esta no caminho do checkout.
// ---------------------------------------------------------------------------

type Teste = (el: El) => boolean;
const TOKEN =
  /^(?:([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([*^$]?=)(?:"([^"]*)"|'([^']*)'|([^\]\s]*)))?\])/;
const compilados = new Map<string, Teste | null>();

function compilar(seletor: string): Teste | null {
  const chave = seletor.trim();
  if (compilados.has(chave)) return compilados.get(chave)!;
  let resto = chave;
  const testes: Teste[] = [];
  let ok = resto.length > 0;
  while (ok && resto) {
    const m = TOKEN.exec(resto);
    if (!m) {
      ok = false;
      break;
    }
    resto = resto.slice(m[0].length);
    if (m[1]) {
      const tag = m[1].toUpperCase();
      testes.push((el) => el.tagName === tag);
    } else if (m[2]) {
      const id = m[2];
      testes.push((el) => el.getAttribute("id") === id);
    } else if (m[3]) {
      const classe = m[3];
      testes.push((el) => el.classList.contains(classe));
    } else {
      const nome = m[4];
      const op = m[5];
      const valor = m[6] ?? m[7] ?? m[8] ?? "";
      testes.push((el) => {
        const v = el.getAttribute(nome);
        if (v === null) return false;
        if (!op) return true;
        if (op === "=") return v === valor;
        if (op === "*=") return valor !== "" && v.includes(valor);
        if (op === "^=") return valor !== "" && v.startsWith(valor);
        return valor !== "" && v.endsWith(valor);
      });
    }
  }
  const teste = ok ? (el: El) => testes.every((t) => t(el)) : null;
  compilados.set(chave, teste);
  return teste;
}

function dividirLista(lista: string): string[] {
  const partes: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const c of lista) {
    if (c === "[" || c === "(") nivel += 1;
    if (c === "]" || c === ")") nivel -= 1;
    if (c === "," && nivel === 0) {
      partes.push(atual);
      atual = "";
    } else atual += c;
  }
  partes.push(atual);
  return partes;
}

function casaLista(el: El, lista: string): boolean {
  return dividirLista(lista).some((s) => {
    const t = compilar(s);
    return t ? t(el) : false;
  });
}

// ---------------------------------------------------------------------------
// DOM de mentira
// ---------------------------------------------------------------------------

type Ouvinte = { tipo: string; fn: (e: Evento) => void; captura: boolean };

interface Evento {
  type: string;
  target: El;
  defaultPrevented: boolean;
  submitter?: El | null;
  persisted?: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
  composedPath(): unknown[];
}

interface Pagina {
  tocar(alvo: El): Evento;
  enviarFormulario(form: El, submitter: El | null): Evento;
  getElementById(id: string): El | null;
  submitsPorJs: string[];
}

function captura(opcao: unknown): boolean {
  if (opcao === true) return true;
  return Boolean(opcao && typeof opcao === "object" && (opcao as { capture?: boolean }).capture);
}

class El {
  nodeType = 1;
  tagName: string;
  parentNode: El | null = null;
  filhos: El[] = [];
  ouvintes: Ouvinte[] = [];
  style: Record<string, string> = { opacity: "", cursor: "", display: "" };
  rel = "";
  private atributos = new Map<string, string>();
  private texto = "";

  constructor(
    private pagina: Pagina,
    tag: string,
    atributos: Record<string, string> = {},
    texto = ""
  ) {
    this.tagName = tag.toUpperCase();
    for (const [k, v] of Object.entries(atributos)) this.setAttribute(k, v);
    this.texto = texto;
  }

  get textContent(): string {
    return this.texto + this.filhos.map((f) => f.textContent).join("");
  }
  set textContent(v: string) {
    this.texto = v;
    this.filhos = [];
  }
  get id() {
    return this.getAttribute("id") ?? "";
  }
  set id(v: string) {
    this.setAttribute("id", v);
  }
  get href() {
    return this.getAttribute("href") ?? "";
  }
  set href(v: string) {
    this.setAttribute("href", v);
  }
  get value() {
    return this.getAttribute("value") ?? undefined;
  }
  get dataset() {
    return {};
  }
  get classList() {
    const lista = () => (this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
    return {
      contains: (c: string) => lista().includes(c),
      add: (c: string) => {
        const l = lista();
        if (!l.includes(c)) this.setAttribute("class", [...l, c].join(" "));
      },
      remove: (c: string) => this.setAttribute("class", lista().filter((x) => x !== c).join(" ")),
    };
  }

  getAttribute(nome: string): string | null {
    return this.atributos.get(nome.toLowerCase()) ?? null;
  }
  setAttribute(nome: string, valor: string) {
    this.atributos.set(nome.toLowerCase(), String(valor));
  }
  removeAttribute(nome: string) {
    this.atributos.delete(nome.toLowerCase());
  }

  appendChild(filho: El) {
    if (filho.parentNode) filho.parentNode.removeChild(filho);
    filho.parentNode = this;
    this.filhos.push(filho);
    return filho;
  }
  insertBefore(filho: El) {
    return this.appendChild(filho);
  }
  get firstChild() {
    return this.filhos[0] ?? null;
  }
  removeChild(filho: El) {
    this.filhos = this.filhos.filter((f) => f !== filho);
    filho.parentNode = null;
    return filho;
  }
  remove() {
    this.parentNode?.removeChild(this);
  }

  matches(seletor: string) {
    return casaLista(this, seletor);
  }
  closest(seletor: string): El | null {
    if (this.matches(seletor)) return this;
    return this.parentNode ? this.parentNode.closest(seletor) : null;
  }
  descendentes(): El[] {
    return this.filhos.flatMap((f) => [f, ...f.descendentes()]);
  }
  querySelector(seletor: string) {
    return this.descendentes().find((d) => d.matches(seletor)) ?? null;
  }
  querySelectorAll(seletor: string) {
    return this.descendentes().filter((d) => d.matches(seletor));
  }

  addEventListener(tipo: string, fn: (e: Evento) => void, opcao?: unknown) {
    this.ouvintes.push({ tipo, fn, captura: captura(opcao) });
  }

  click() {
    this.pagina.tocar(this);
  }
  submit() {
    this.pagina.submitsPorJs.push(this.getAttribute("action") ?? "");
  }
  getBoundingClientRect() {
    return { width: 10, height: 10 };
  }
}

type Resposta = { ok: boolean; status: number; json: () => Promise<unknown> };
const resposta = (dados: unknown, ok = true): Resposta => ({
  ok,
  status: ok ? 200 : 500,
  json: () => Promise.resolve(dados),
});

interface Opcoes {
  /** Caminho da pagina da vitrine. */
  caminho?: string;
  /** Carrinho inicial (padrao: CARRINHO). O add.js do teste soma nele. */
  carrinho?: Carrinho;
  /** Monta o tema ANTES do loader rodar (ele liga os botoes no init). */
  tema: (h: Harness) => void;
}

type Harness = ReturnType<typeof criarVitrine>;

type Carrinho = {
  item_count: number;
  items: { id: number; variant_id: number; sku: string; quantity: number }[];
};

const CARRINHO: Carrinho = {
  item_count: 1,
  items: [{ id: 111, variant_id: 111, sku: "xc-abc", quantity: 1 }],
};

function criarVitrine(opcoes: Opcoes) {
  const caminho = opcoes.caminho ?? "/products/wander-matelasse";
  const navegacoes: string[] = [];
  const buscas: string[] = [];
  const beacons: { reason: string; detail: string; targetDomain: string }[] = [];
  const submitsNativos: { action: string | null; botao: string | null }[] = [];
  const doTema: string[] = [];
  const pendentesRota: {
    resolver: (r: Resposta) => void;
    rejeitar: (e: unknown) => void;
  }[] = [];
  const ouvintesJanela: Ouvinte[] = [];
  const ouvintesDoc: Ouvinte[] = [];
  const intervalos: (() => void)[] = [];
  const carrinho: Carrinho = JSON.parse(JSON.stringify(opcoes.carrinho ?? CARRINHO));
  /** O que cada /cart/add.js mandou (o add.js de verdade SOMA na linha). */
  const adicionados: { id: number; quantidade: number }[] = [];
  /** Corpo de cada chamada ao /resolve. */
  const corposRota: { lines: { sourceVariantId: string; quantity: number }[] }[] = [];

  // Relogio de mentira: os timers so andam quando o teste manda.
  let agora = 0;
  let seq = 0;
  const timers: { id: number; quando: number; fn: () => void; vivo: boolean }[] = [];
  const avancar = (ms: number) => {
    agora += ms;
    for (;;) {
      const proximo = timers
        .filter((t) => t.vivo && t.quando <= agora)
        .sort((a, b) => a.quando - b.quando)[0];
      if (!proximo) break;
      proximo.vivo = false;
      proximo.fn();
    }
  };

  const pagina: Pagina = {
    tocar: (alvo) => tocar(alvo),
    enviarFormulario: (form, submitter) => enviarFormulario(form, submitter),
    getElementById: (id) => html.querySelector(`#${id}`),
    submitsPorJs: [],
  };
  // Classe propria por vitrine: o loader troca HTMLFormElement.prototype.submit
  // e a troca nao pode vazar de um teste para o outro.
  class ElDaPagina extends El {}
  const el = (tag: string, atributos: Record<string, string> = {}, ...filhos: (El | string)[]) => {
    const texto = filhos.filter((f): f is string => typeof f === "string").join("");
    const novo = new ElDaPagina(pagina, tag, atributos, texto);
    for (const f of filhos) if (typeof f !== "string") novo.appendChild(f);
    return novo;
  };

  const html = el("html");
  const head = el("head");
  const body = el("body");
  html.appendChild(head);
  html.appendChild(body);

  const documento = {
    nodeType: 9,
    readyState: "complete",
    documentElement: html,
    head,
    body,
    currentScript: {
      src: "https://user.xcart.app/routed-checkout-loader.js",
      dataset: { token: "tok-norah" } as Record<string, string>,
      getAttribute: () => null,
    },
    createElement: (tag: string) => el(tag),
    getElementById: (id: string) => html.querySelector(`#${id}`),
    querySelector: (s: string) => html.querySelector(s),
    querySelectorAll: (s: string) => html.querySelectorAll(s),
    addEventListener: (tipo: string, fn: (e: Evento) => void, opcao?: unknown) =>
      ouvintesDoc.push({ tipo, fn, captura: captura(opcao) }),
    dispatchEvent: () => true,
  };

  function despachar(tipo: string, alvo: El, extra: Partial<Evento> = {}): Evento {
    const ancestrais: El[] = [];
    for (let n = alvo.parentNode; n; n = n.parentNode) ancestrais.push(n);
    let parado = false;
    let imediato = false;
    const ev: Evento = {
      type: tipo,
      target: alvo,
      defaultPrevented: false,
      preventDefault() {
        ev.defaultPrevented = true;
      },
      stopPropagation() {
        parado = true;
      },
      stopImmediatePropagation() {
        parado = true;
        imediato = true;
      },
      // Shadow fechado: visto de fora, o caminho comeca no hospedeiro.
      composedPath: () => [alvo, ...ancestrais, documento, ctx],
      ...extra,
    };
    const rodar = (lista: Ouvinte[], fase: "captura" | "alvo" | "bolha") => {
      for (const o of lista) {
        if (o.tipo !== tipo) continue;
        if (fase === "captura" && !o.captura) continue;
        if (fase === "bolha" && o.captura) continue;
        o.fn(ev);
        if (imediato) return;
      }
    };
    rodar(ouvintesJanela, "captura");
    if (parado) return ev;
    rodar(ouvintesDoc, "captura");
    if (parado) return ev;
    for (const a of [...ancestrais].reverse()) {
      rodar(a.ouvintes, "captura");
      if (parado) return ev;
    }
    rodar(alvo.ouvintes, "alvo");
    if (parado) return ev;
    for (const a of ancestrais) {
      rodar(a.ouvintes, "bolha");
      if (parado) return ev;
    }
    rodar(ouvintesDoc, "bolha");
    if (parado) return ev;
    rodar(ouvintesJanela, "bolha");
    return ev;
  }

  /** Toque do comprador: o evento e, se ninguem barrou, a acao padrao. */
  function tocar(alvo: El): Evento {
    const ev = despachar("click", alvo);
    if (ev.defaultPrevented) return ev;
    const link = alvo.closest("a");
    if (link && link.getAttribute("href")) {
      navegacoes.push(link.getAttribute("href")!);
      return ev;
    }
    const botao = alvo.closest("button");
    if (botao && (botao.getAttribute("type") ?? "submit") === "submit") {
      const idDoForm = botao.getAttribute("form");
      const form = idDoForm ? html.querySelector(`#${idDoForm}`) : botao.closest("form");
      if (form) enviarFormulario(form, botao);
    }
    return ev;
  }

  function enviarFormulario(form: El, submitter: El | null): Evento {
    const ev = despachar("submit", form, { submitter });
    if (!ev.defaultPrevented) {
      submitsNativos.push({
        action: form.getAttribute("action"),
        botao: submitter?.getAttribute("name") ?? null,
      });
    }
    return ev;
  }

  // FormData como o navegador monta: os campos de dentro do <form> e os de
  // fora ligados por form="id" (no Dawn a quantidade fica assim).
  class FormDataFalso {
    campos = new Map<string, string>();
    constructor(form?: El) {
      if (!form) return;
      const idDoForm = form.getAttribute("id");
      const ligados = idDoForm
        ? html.descendentes().filter((d) => d.getAttribute("form") === idDoForm)
        : [];
      for (const d of [...form.descendentes(), ...ligados]) {
        const nome = d.getAttribute("name");
        const valor = d.getAttribute("value");
        if (nome && valor !== null && !this.campos.has(nome)) this.campos.set(nome, valor);
      }
    }
    set(k: string, v: string) {
      this.campos.set(k, String(v));
    }
    get(k: string) {
      return this.campos.get(k) ?? null;
    }
  }

  const fetchFalso = (
    url: string,
    init: { body?: string | FormDataFalso; signal?: AbortSignal } = {}
  ) => {
    buscas.push(url);
    if (url.endsWith("/cart.js")) {
      return Promise.resolve(resposta(JSON.parse(JSON.stringify(carrinho))));
    }
    if (url.endsWith("/cart/add.js")) {
      const corpo = init.body as FormDataFalso;
      const id = Number(corpo.get("id"));
      const quantidade = Number(corpo.get("quantity") ?? 1) || 1;
      adicionados.push({ id, quantidade });
      const linha = carrinho.items.find((i) => i.variant_id === id);
      if (linha) linha.quantity += quantidade;
      else carrinho.items.push({ id, variant_id: id, sku: `xc-${id}`, quantity: quantidade });
      carrinho.item_count += quantidade;
      return Promise.resolve(resposta({ id, variant_id: id, quantity: quantidade }));
    }
    if (url.includes("/api/checkout-routes/resolve")) {
      corposRota.push(JSON.parse(String(init.body)));
      return new Promise<Resposta>((resolver, rejeitar) => {
        pendentesRota.push({ resolver, rejeitar });
        init.signal?.addEventListener("abort", () => rejeitar(new Error("aborted")));
      });
    }
    return Promise.reject(new Error(`fetch inesperado: ${url}`));
  };

  class BlobFalso {
    texto: string;
    constructor(partes: string[]) {
      this.texto = partes.join("");
    }
  }

  const armazenamento = () => {
    const m = new Map<string, string>();
    return {
      getItem: (k: string) => m.get(k) ?? null,
      setItem: (k: string, v: string) => void m.set(k, String(v)),
    };
  };

  const ctx: Record<string, unknown> = {
    document: documento,
    location: {
      get href() {
        return `https://norahmade.com${caminho}`;
      },
      set href(v: string) {
        navegacoes.push(String(v));
      },
      origin: "https://norahmade.com",
      pathname: caminho,
      assign: (u: string) => navegacoes.push(`assign:${u}`),
      replace: (u: string) => navegacoes.push(`replace:${u}`),
    },
    navigator: {
      sendBeacon: (_url: string, blob: BlobFalso) => {
        beacons.push(JSON.parse(blob.texto));
        return true;
      },
    },
    localStorage: armazenamento(),
    sessionStorage: armazenamento(),
    fetch: fetchFalso,
    setTimeout: (fn: () => void, ms?: number) => {
      seq += 1;
      timers.push({ id: seq, quando: agora + (ms ?? 0), fn, vivo: true });
      return seq;
    },
    clearTimeout: (id: number) => {
      const t = timers.find((x) => x.id === id);
      if (t) t.vivo = false;
    },
    setInterval: (fn: () => void) => {
      intervalos.push(fn);
      return intervalos.length;
    },
    clearInterval: () => {},
    URL,
    Blob: BlobFalso,
    FormData: FormDataFalso,
    AbortController,
    CustomEvent: class {
      constructor(public type: string) {}
    },
    HTMLFormElement: { prototype: ElDaPagina.prototype },
    Shopify: { routes: { root: "/" } },
    console: { warn() {}, error() {}, log() {} },
    addEventListener: (tipo: string, fn: (e: Evento) => void, opcao?: unknown) =>
      ouvintesJanela.push({ tipo, fn, captura: captura(opcao) }),
  };
  ctx.window = ctx;

  const h = {
    el,
    body,
    head,
    navegacoes,
    buscas,
    beacons,
    submitsNativos,
    doTema,
    pagina,
    adicionados,
    corposRota,
    avancar,
    /** Roda uma volta dos intervalos do loader (o rescan). */
    rodarIntervalos: () => intervalos.forEach((fn) => fn()),
    /** Quantidade da variante no carrinho da vitrine. */
    noCarrinho: (id: number) =>
      carrinho.items.filter((i) => i.variant_id === id).reduce((n, i) => n + i.quantity, 0),
    /** Quantidade da variante na ultima chamada ao /resolve. */
    naRota: (id: number) =>
      (corposRota[corposRota.length - 1]?.lines ?? [])
        .filter((l) => l.sourceVariantId === `gid://shopify/ProductVariant/${id}`)
        .reduce((n, l) => n + l.quantity, 0),
    tocar,
    enviarFormulario,
    /** Quantas vezes o carrinho foi lido para rotear. */
    leiturasDoCarrinho: () => buscas.filter((u) => u.endsWith("/cart.js")).length,
    motivos: () => beacons.map((b) => b.reason).filter((r) => r !== "loader_ready"),
    /** A API de rota responde a chamada pendente mais antiga. */
    responderRota: (redirectUrl = "https://tdicbr-3u.myshopify.com/cart/987:1") => {
      const p = pendentesRota.shift();
      if (!p) throw new Error("nenhuma chamada de rota pendente");
      p.resolver(
        resposta({ redirectUrl, targetId: null, targetDomain: new URL(redirectUrl).hostname })
      );
    },
    falharRota: (erro: unknown = new TypeError("Load failed")) => {
      const p = pendentesRota.shift();
      if (!p) throw new Error("nenhuma chamada de rota pendente");
      p.rejeitar(erro);
    },
    pageshow: (persisted: boolean) => {
      for (const o of ouvintesJanela) {
        if (o.tipo === "pageshow") o.fn({ persisted } as Evento);
      }
    },
  };

  opcoes.tema(h);
  vm.createContext(ctx);
  vm.runInContext(LOADER, ctx);
  return h;
}

/** Deixa as promessas do loader andarem ate parar numa espera de verdade. */
const esvaziar = async () => {
  for (let i = 0; i < 3; i += 1) await new Promise((r) => setImmediate(r));
};

/** A gaveta do Shrine da NORAH, como esta no tema (norah-home.html). */
function gavetaShrine(h: Harness) {
  const rotulo = h.el("span", { class: "button__label" }, "SECURE CHECKOUT");
  const spinner = h.el("div", { class: "loading-overlay__spinner hidden" });
  const botao = h.el(
    "button",
    {
      type: "submit",
      id: "CartDrawer-Checkout",
      class: "cart__checkout-button button",
      name: "checkout",
      form: "CartDrawer-Form",
    },
    rotulo,
    spinner
  );
  // onclick="checkoutLoad(event)": so poe o spinner, nao barra o submit.
  botao.addEventListener("click", () => h.doTema.push("checkoutLoad"));
  const form = h.el("form", { id: "CartDrawer-Form", action: "/cart", method: "post" });
  h.body.appendChild(h.el("cart-drawer", {}, form, h.el("div", { class: "cart__ctas" }, botao)));
  return { botao, rotulo, spinner, form };
}

function montarGaveta(caminho?: string) {
  let partes!: ReturnType<typeof gavetaShrine>;
  const h = criarVitrine({ caminho, tema: (v) => (partes = gavetaShrine(v)) });
  return { h, ...partes };
}

describe("trava do roteamento: o segundo toque nao vaza para a vitrine", () => {
  it("segundo toque com a rota pendente e barrado e o botao mostra que esta carregando", async () => {
    const { h, botao, rotulo, spinner } = montarGaveta();

    const primeiro = h.tocar(rotulo);
    expect(primeiro.defaultPrevented).toBe(true);
    await esvaziar();
    expect(h.leiturasDoCarrinho()).toBe(1);

    // O comprador acha que nao pegou e toca de novo, ~400 ms depois.
    const segundo = h.tocar(rotulo);
    expect(segundo.defaultPrevented).toBe(true);
    expect(h.submitsNativos).toEqual([]);
    expect(h.doTema).toEqual([]);
    expect(h.leiturasDoCarrinho()).toBe(1);

    expect(botao.getAttribute("aria-busy")).toBe("true");
    expect(botao.classList.contains("loading")).toBe(true);
    expect(spinner.classList.contains("hidden")).toBe(false);

    h.responderRota();
    await esvaziar();
    expect(h.navegacoes).toEqual(["https://tdicbr-3u.myshopify.com/cart/987:1"]);
    expect(h.motivos()).toEqual(["routed_ok"]);
    expect(h.submitsNativos).toEqual([]);
  });

  it("a trava segue depois do redirect: toque enquanto a loja de checkout carrega nao sai", async () => {
    const { h, rotulo } = montarGaveta();
    h.tocar(rotulo);
    await esvaziar();
    h.responderRota();
    await esvaziar();

    // Antes a trava caia 1,5 s depois do redirect e o toque aqui ia para a
    // vitrine, cancelando a navegacao para a loja de checkout.
    h.avancar(1500);
    const tarde = h.tocar(rotulo);
    expect(tarde.defaultPrevented).toBe(true);
    expect(h.submitsNativos).toEqual([]);
    expect(h.leiturasDoCarrinho()).toBe(1);
    expect(h.navegacoes).toHaveLength(1);
  });

  it("volta pelo bfcache libera a trava e o botao", async () => {
    const { h, rotulo, botao, spinner } = montarGaveta();
    h.tocar(rotulo);
    await esvaziar();
    h.responderRota();
    await esvaziar();

    h.pageshow(false);
    expect(botao.getAttribute("aria-busy")).toBe("true");

    h.pageshow(true);
    expect(botao.getAttribute("aria-busy")).toBeNull();
    expect(botao.classList.contains("loading")).toBe(false);
    expect(spinner.classList.contains("hidden")).toBe(true);

    const deNovo = h.tocar(rotulo);
    expect(deNovo.defaultPrevented).toBe(true);
    await esvaziar();
    expect(h.leiturasDoCarrinho()).toBe(2);
  });

  it("erro libera a trava, conta os toques e nao manda para a vitrine", async () => {
    const { h, rotulo, botao } = montarGaveta();
    h.tocar(rotulo);
    await esvaziar();
    h.tocar(rotulo);
    h.tocar(rotulo);

    h.falharRota(new TypeError("Load failed"));
    await esvaziar();

    const erro = h.beacons.find((b) => b.reason === "cart_checkout_error");
    expect(erro?.detail).toBe("Load failed (+2 toques durante a rota)");
    expect(h.submitsNativos).toEqual([]);
    expect(h.navegacoes).toEqual([]);
    expect(botao.getAttribute("aria-busy")).toBeNull();

    // Tentar de novo roteia de novo.
    expect(h.tocar(rotulo).defaultPrevented).toBe(true);
    await esvaziar();
    expect(h.leiturasDoCarrinho()).toBe(2);
  });

  it("valvula: a trava cai sozinha se a navegacao nao vingou", async () => {
    const { h, rotulo, botao } = montarGaveta();
    h.tocar(rotulo);
    await esvaziar();
    h.responderRota();
    await esvaziar();

    h.avancar(9999);
    expect(botao.getAttribute("aria-busy")).toBe("true");
    h.avancar(1);
    expect(botao.getAttribute("aria-busy")).toBeNull();

    expect(h.tocar(rotulo).defaultPrevented).toBe(true);
    await esvaziar();
    expect(h.leiturasDoCarrinho()).toBe(2);
    expect(h.submitsNativos).toEqual([]);
  });

  it("rede travada: o prazo derruba a tentativa em vez de prender o botao", async () => {
    const { h, rotulo, botao } = montarGaveta();
    h.tocar(rotulo);
    await esvaziar();

    h.avancar(15000);
    await esvaziar();

    const erro = h.beacons.find((b) => b.reason === "cart_checkout_error");
    expect(erro?.detail).toContain("Prazo esgotado");
    expect(botao.getAttribute("aria-busy")).toBeNull();
    expect(h.submitsNativos).toEqual([]);
  });

  it("o redirect do proprio loader passa mesmo com 'checkout' no dominio de destino", async () => {
    const { h, rotulo } = montarGaveta();
    h.tocar(rotulo);
    await esvaziar();
    h.responderRota("https://checkout.minhaloja.com.br/cart/987:1");
    await esvaziar();
    expect(h.navegacoes).toEqual(["https://checkout.minhaloja.com.br/cart/987:1"]);
  });

  it("form.submit() do tema com a rota em curso e engolido; fora dela, vira rota", async () => {
    let form!: El;
    let botao!: El;
    const h = criarVitrine({
      caminho: "/cart",
      tema: (v) => {
        botao = v.el("button", { type: "submit", name: "checkout" }, "Checkout");
        form = v.el("form", { id: "cart", action: "/cart", method: "post" }, botao);
        v.body.appendChild(form);
      },
    });

    h.tocar(botao);
    await esvaziar();
    form.submit();
    expect(h.pagina.submitsPorJs).toEqual([]);
    expect(h.motivos()).not.toContain("bypass_form_submit");

    h.falharRota();
    await esvaziar();
    form.submit();
    await esvaziar();
    expect(h.pagina.submitsPorJs).toEqual([]);
    expect(h.motivos()).toContain("bypass_form_submit");
    expect(h.leiturasDoCarrinho()).toBe(2);
  });

  it("formulario que posta direto em /checkout e levado, seja qual for o botao", async () => {
    let botao!: El;
    const h = criarVitrine({
      caminho: "/cart",
      tema: (v) => {
        botao = v.el("button", { type: "submit" }, "Pay");
        v.body.appendChild(v.el("form", { action: "/checkout", method: "post" }, botao));
      },
    });
    h.tocar(botao);
    expect(h.submitsNativos).toEqual([]);
    await esvaziar();
    expect(h.leiturasDoCarrinho()).toBe(1);
  });
});

describe("carteiras e botao dinamico (shadow DOM fechado)", () => {
  function paginaDeProduto(
    opcoes: {
      carrinho?: Carrinho;
      /** Quantidade num campo FORA do <form>, ligado por form="..." (Dawn). */
      quantidadeFora?: string;
      /** Produto esgotado: o tema desliga o "Adicionar". */
      esgotado?: boolean;
    } = {}
  ) {
    let host!: El;
    let maisOpcoes!: El;
    let comprarAgora!: El;
    let adicionar!: El;
    let link!: El;
    let involucro!: El;
    let form!: El;
    const abriuCarteira: string[] = [];
    const h = criarVitrine({
      carrinho: opcoes.carrinho,
      tema: (v) => {
        host = v.el("shopify-accelerated-checkout");
        host.addEventListener("click", () => abriuCarteira.push("shop-pay"));
        maisOpcoes = v.el(
          "button",
          { type: "button", class: "shopify-payment-button__more-options" },
          "More payment options"
        );
        comprarAgora = v.el(
          "button",
          {
            type: "button",
            class: "shopify-payment-button__button shopify-payment-button__button--unbranded",
          },
          "Buy it now"
        );
        adicionar = v.el(
          "button",
          { type: "submit", name: "add", ...(opcoes.esgotado ? { disabled: "" } : {}) },
          opcoes.esgotado ? "Sold out" : "Add to bag"
        );
        adicionar.addEventListener("click", () => v.doTema.push("add"));
        link = v.el("a", { href: "/collections/all" }, "Shop all");
        v.body.appendChild(link);
        if (opcoes.quantidadeFora) {
          v.body.appendChild(
            v.el("input", {
              type: "number",
              name: "quantity",
              value: opcoes.quantidadeFora,
              form: "product-form-main",
            })
          );
        }
        involucro = v.el(
          "div",
          { class: "shopify-payment-button", "data-shopify": "payment-button" },
          host,
          comprarAgora,
          maisOpcoes
        );
        form = v.el(
          "form",
          { id: "product-form-main", action: "/cart/add", method: "post" },
          v.el("input", { type: "hidden", name: "id", value: "4242" }),
          adicionar,
          involucro
        );
        v.body.appendChild(form);
      },
    });
    return { h, host, maisOpcoes, comprarAgora, adicionar, link, abriuCarteira, involucro, form };
  }

  it("carteira do carrinho leva o carrinho inteiro, sem abrir a carteira da vitrine", async () => {
    let host!: El;
    const abriuCarteira: string[] = [];
    const h = criarVitrine({
      caminho: "/cart",
      tema: (v) => {
        host = v.el("shopify-accelerated-checkout-cart");
        host.addEventListener("click", () => abriuCarteira.push("paypal"));
        v.body.appendChild(
          v.el(
            "div",
            { class: "cart__dynamic-checkout-buttons additional-checkout-buttons" },
            v.el(
              "div",
              { id: "dynamic-checkout-cart", "data-shopify": "dynamic-checkout-cart" },
              host
            )
          )
        );
      },
    });

    const ev = h.tocar(host);
    expect(ev.defaultPrevented).toBe(true);
    expect(abriuCarteira).toEqual([]);
    await esvaziar();
    expect(h.buscas.some((u) => u.endsWith("/cart/add.js"))).toBe(false);
    h.responderRota();
    await esvaziar();
    expect(h.navegacoes).toEqual(["https://tdicbr-3u.myshopify.com/cart/987:1"]);
  });

  it("carteira na pagina de produto compra a variante do formulario e leva", async () => {
    const { h, host, abriuCarteira } = paginaDeProduto();
    expect(h.tocar(host).defaultPrevented).toBe(true);
    expect(abriuCarteira).toEqual([]);
    await esvaziar();
    // Le o carrinho, adiciona o que falta e le de novo para rotear.
    const add = h.buscas.findIndex((u) => u.endsWith("/cart/add.js"));
    const leituras = h.buscas
      .map((u, i) => (u.endsWith("/cart.js") ? i : -1))
      .filter((i) => i >= 0);
    expect(leituras[0]).toBeLessThan(add);
    expect(leituras[leituras.length - 1]).toBeGreaterThan(add);
    expect(h.adicionados).toEqual([{ id: 4242, quantidade: 1 }]);
    expect(h.naRota(4242)).toBe(1);
  });

  it("rota falha depois do add e o comprador toca de novo: a variante entra uma vez so", async () => {
    const { h, comprarAgora } = paginaDeProduto();
    h.tocar(comprarAgora);
    await esvaziar();
    expect(h.adicionados).toEqual([{ id: 4242, quantidade: 1 }]);
    h.falharRota(new TypeError("Load failed"));
    await esvaziar();

    expect(h.tocar(comprarAgora).defaultPrevented).toBe(true);
    await esvaziar();
    expect(h.adicionados).toHaveLength(1);
    expect(h.noCarrinho(4242)).toBe(1);
    expect(h.naRota(4242)).toBe(1);
    h.responderRota();
    await esvaziar();
    expect(h.navegacoes).toEqual(["https://tdicbr-3u.myshopify.com/cart/987:1"]);
  });

  it("item que ja estava no carrinho nao e adicionado de novo pela carteira", async () => {
    const { h, host } = paginaDeProduto({
      carrinho: {
        item_count: 2,
        items: [
          { id: 111, variant_id: 111, sku: "xc-abc", quantity: 1 },
          { id: 4242, variant_id: 4242, sku: "xc-4242", quantity: 1 },
        ],
      },
    });
    h.tocar(host);
    await esvaziar();
    expect(h.adicionados).toEqual([]);
    // O carrinho lido antes ja serve para a rota: uma leitura so.
    expect(h.leiturasDoCarrinho()).toBe(1);
    expect(h.naRota(4242)).toBe(1);
  });

  it("quantidade do formulario (campo fora do form, como no Dawn): adiciona so o que falta", async () => {
    const parcial = paginaDeProduto({
      quantidadeFora: "3",
      carrinho: { item_count: 1, items: [{ id: 4242, variant_id: 4242, sku: "xc-4242", quantity: 1 }] },
    });
    parcial.h.tocar(parcial.comprarAgora);
    await esvaziar();
    expect(parcial.h.adicionados).toEqual([{ id: 4242, quantidade: 2 }]);
    expect(parcial.h.naRota(4242)).toBe(3);

    // Nada no carrinho: o add sai como o formulario manda, sem sobrepor.
    const vazio = paginaDeProduto({ quantidadeFora: "3" });
    vazio.h.tocar(vazio.comprarAgora);
    await esvaziar();
    expect(vazio.h.adicionados).toEqual([{ id: 4242, quantidade: 3 }]);
  });

  it("'More payment options' e 'Buy it now' sao levados como compra imediata", async () => {
    for (const qual of ["maisOpcoes", "comprarAgora"] as const) {
      const p = paginaDeProduto();
      expect(p.h.tocar(p[qual]).defaultPrevented, qual).toBe(true);
      await esvaziar();
      expect(p.h.buscas.some((u) => u.endsWith("/cart/add.js")), qual).toBe(true);
      expect(p.h.submitsNativos, qual).toEqual([]);
    }
  });

  it("adicionar ao carrinho e link comum continuam com o tema", () => {
    const { h, adicionar, link } = paginaDeProduto();
    expect(h.tocar(adicionar).defaultPrevented).toBe(false);
    expect(h.doTema).toEqual(["add"]);
    expect(h.submitsNativos).toEqual([{ action: "/cart/add", botao: "add" }]);

    expect(h.tocar(link).defaultPrevented).toBe(false);
    expect(h.navegacoes).toEqual(["/collections/all"]);
    expect(h.leiturasDoCarrinho()).toBe(0);
  });

  it("capa sobre o bloco de pagamento: o toque nela (PayPal em iframe) e levado como compra imediata", async () => {
    const { h, involucro } = paginaDeProduto();
    const capas = involucro.querySelectorAll("[data-xcart-capa]");
    expect(capas).toHaveLength(1);
    const capa = capas[0];
    expect(involucro.style.position).toBe("relative");
    // Contexto proprio: o z-index da capa nao passa por cima de gaveta.
    expect(involucro.style.isolation).toBe("isolate");
    expect(capa.style.cssText).toContain("position:absolute");
    expect(capa.getAttribute("aria-hidden")).toBe("true");

    expect(h.tocar(capa).defaultPrevented).toBe(true);
    await esvaziar();
    expect(h.adicionados).toEqual([{ id: 4242, quantidade: 1 }]);
    expect(involucro.getAttribute("aria-busy")).toBe("true");
    h.responderRota();
    await esvaziar();
    expect(h.navegacoes).toEqual(["https://tdicbr-3u.myshopify.com/cart/987:1"]);
  });

  it("bloco trocado pelo tema (troca de variante) ganha capa de novo, sem duplicar", () => {
    const { h, involucro, form } = paginaDeProduto();
    h.rodarIntervalos();
    expect(involucro.querySelectorAll("[data-xcart-capa]")).toHaveLength(1);

    form.removeChild(involucro);
    const novo = h.el(
      "div",
      { class: "shopify-payment-button", "data-shopify": "payment-button" },
      h.el("shopify-accelerated-checkout")
    );
    form.appendChild(novo);
    h.rodarIntervalos();
    expect(novo.querySelectorAll("[data-xcart-capa]")).toHaveLength(1);
  });

  it("produto esgotado: toque na capa nao leva nada, como o botao nativo desligado", async () => {
    const { h, involucro } = paginaDeProduto({ esgotado: true });
    const capa = involucro.querySelector("[data-xcart-capa]")!;
    h.tocar(capa);
    await esvaziar();
    expect(h.buscas).toEqual([]);
    expect(h.navegacoes).toEqual([]);
    expect(involucro.getAttribute("aria-busy")).toBeNull();
  });

  it("o CSS esconde as carteiras do carrinho e, em regra propria, o botao de carteira em iframe", () => {
    const { h } = paginaDeProduto();
    const estilo = h.head.querySelector("#xcart-rota-carteiras");
    expect(estilo).not.toBeNull();
    const regras = estilo!.textContent.split("}").map((r) => r.trim()).filter(Boolean);
    expect(regras).toHaveLength(2);
    // Navegador sem :has descarta a regra inteira: a do carrinho nao pode ter.
    expect(regras[0]).not.toContain(":has");
    for (const sel of ["shopify-accelerated-checkout-cart", ".additional-checkout-buttons"]) {
      expect(regras[0]).toContain(sel);
    }
    expect(regras[0]).toContain("display:none!important");
    expect(regras[1]).toContain(".shopify-payment-button__button--branded:has(iframe)");
    // O componente da pagina de produto tambem traz o "Comprar agora": fica.
    expect(regras[0].split("{")[0].split(",").map((s) => s.trim())).not.toContain(
      "shopify-accelerated-checkout"
    );
  });
});
