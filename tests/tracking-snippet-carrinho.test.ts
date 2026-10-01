import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";

// ============================================================================
// O snippet do tema e o carrinho.
//
// O cart attribute e o que leva o clique ate o pedido -- e o pedido e de onde
// sai a conversao de compra. Tres jeitos de o clique morrer no caminho, todos
// por mao do proprio snippet, e todos sem erro nenhum (a venda so passa a
// aparecer como "direto"):
//
// 1. A marca de "ja gravado" nao sabia de QUAL carrinho era. Carrinho novo na
//    mesma aba (comprou, voltou, comprou de novo) nunca recebia o clique.
// 2. O Safari apaga os nossos cookies em 7 dias. O snippet inventava _xc_vid e
//    _fbp novos e escrevia POR CIMA do carrinho, que ainda tinha os do clique.
// 3. Clique novo no Google somava ao velho em vez de substituir: o gbraid de
//    hoje ia junto com o gclid da semana passada.
//
// Aqui o snippet RODA de verdade, num navegador de mentira montado com vm: os
// cookies, o sessionStorage, o /cart.js e o sendBeacon sao trocados por
// gravadores. Nada sai para a rede.
// ============================================================================

const fonte = readFileSync(
  path.resolve(__dirname, "..", "public", "xcart-click.js"),
  "utf8"
);

type Atributos = Record<string, string>;
interface Carrinho {
  token: string;
  attributes: Atributos;
}

/** O que sobrevive entre paginas: cookies, aba e o carrinho da Shopify. */
interface Navegador {
  cookies: Map<string, string>;
  sessao: Map<string, string>;
  /** "pendurado" = /cart.js nunca responde. */
  carrinho: Carrinho | "pendurado";
  /** O que a Shopify faz com o carrinho quando alguem adiciona um item. */
  aoAdicionar?: (atual: Carrinho) => Carrinho;
}

function navegador(inicio: Partial<Navegador> = {}): Navegador {
  return {
    cookies: inicio.cookies ?? new Map(),
    sessao: inicio.sessao ?? new Map(),
    carrinho: inicio.carrinho ?? { token: "c1", attributes: {} },
    aoAdicionar: inicio.aoAdicionar,
  };
}

interface Corpo {
  evento: string;
  visitorId: string;
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbp: string | null;
  fbc: string | null;
}

/** Abre uma pagina da loja neste navegador e roda o snippet nela. */
function abrir(nav: Navegador, url = "https://loja.test/products/camisa") {
  const u = new URL(url);
  const updates: Atributos[] = [];
  const beacons: Corpo[] = [];
  const timers = new Map<number, () => void>();
  const ouvintes: Record<string, () => void> = {};
  let seq = 0;
  let leituras = 0;
  let abortos = 0;

  const responder = (corpo: unknown) =>
    Promise.resolve({
      ok: true,
      json: () => Promise.resolve(JSON.parse(JSON.stringify(corpo))),
    });

  function fetch(entrada: unknown, init?: { body?: string; signal?: AbortSignal }) {
    const alvo = String(entrada);
    if (alvo.endsWith("/cart.js")) {
      leituras++;
      if (nav.carrinho === "pendurado") {
        return new Promise((_, rejeitar) => {
          init?.signal?.addEventListener("abort", () => {
            abortos++;
            rejeitar(new Error("abortado"));
          });
        });
      }
      return responder(nav.carrinho);
    }
    if (alvo.endsWith("/cart/update.js")) {
      const attrs = JSON.parse(init?.body ?? "{}").attributes as Atributos;
      updates.push(attrs);
      if (nav.carrinho === "pendurado") return responder({ token: null });
      // Como a Shopify: mescla, e vazio apaga.
      const atual: Atributos = { ...nav.carrinho.attributes };
      for (const [k, v] of Object.entries(attrs)) {
        if (v === "") delete atual[k];
        else atual[k] = v;
      }
      nav.carrinho = { ...nav.carrinho, attributes: atual };
      return responder({ ...nav.carrinho, token: nav.carrinho.token + "?key=x" });
    }
    if (alvo.includes("/cart/add")) {
      if (nav.carrinho !== "pendurado" && nav.aoAdicionar) {
        nav.carrinho = nav.aoAdicionar(nav.carrinho);
      }
      return responder({ id: 1 });
    }
    return Promise.reject(new Error(`fetch inesperado: ${alvo}`));
  }

  const documento = {
    get cookie() {
      return [...nav.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(linha: string) {
      const [par, ...resto] = linha.split(";");
      const i = par.indexOf("=");
      const nome = par.slice(0, i).trim();
      const expira = resto
        .map((a) => a.trim())
        .find((a) => a.toLowerCase().startsWith("expires="));
      if (expira && new Date(expira.slice(8)).getTime() < Date.now()) {
        nav.cookies.delete(nome);
      } else {
        nav.cookies.set(nome, par.slice(i + 1));
      }
    },
    readyState: "complete",
    referrer: "",
    currentScript: {
      src: "https://app.test/xcart-click.js",
      getAttribute: (n: string) => (n === "data-xcart-store" ? "loja-1" : null),
    },
    addEventListener() {},
    querySelector() {
      return null;
    },
  };

  class BlobFalso {
    texto: string;
    constructor(partes: string[]) {
      this.texto = partes.join("");
    }
  }

  const ctx: Record<string, unknown> = {
    document: documento,
    location: {
      href: u.href,
      search: u.search,
      pathname: u.pathname,
      hostname: u.hostname,
      protocol: u.protocol,
    },
    sessionStorage: {
      getItem: (k: string) => (nav.sessao.has(k) ? nav.sessao.get(k) : null),
      setItem: (k: string, v: string) => nav.sessao.set(k, String(v)),
    },
    navigator: {
      sendBeacon: (_url: string, blob: BlobFalso) => {
        beacons.push(JSON.parse(blob.texto));
        return true;
      },
    },
    Blob: BlobFalso,
    URL,
    URLSearchParams,
    AbortController,
    fetch,
    setTimeout: (fn: () => void) => {
      timers.set(++seq, fn);
      return seq;
    },
    clearTimeout: (id: number) => timers.delete(id),
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: (ev: string, fn: () => void) => {
      ouvintes[ev] = fn;
    },
    Shopify: { shop: "loja.myshopify.com", routes: { root: "/" } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  const rodar = () => vm.runInContext(fonte, ctx);
  rodar();

  return {
    updates,
    beacons,
    rodar,
    leituras: () => leituras,
    abortos: () => abortos,
    cookie: (nome: string) => {
      const v = nav.cookies.get(nome);
      return v === undefined ? undefined : decodeURIComponent(v);
    },
    /** Estoura o teto de espera do /cart.js. */
    estourarTimers: () => {
      const fila = [...timers.values()];
      timers.clear();
      fila.forEach((fn) => fn());
    },
    sair: () => ouvintes.pagehide?.(),
    /** O tema adicionando um item, pelo fetch que o snippet embrulhou. */
    adicionar: () =>
      (ctx.fetch as typeof fetch)("/cart/add.js", { body: "{}" }),
  };
}

/** Deixa as promessas encadeadas (cart.js -> json -> update) terminarem. */
async function assentar() {
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
}

const CLIQUE_ANTIGO: Atributos = {
  _xc_vid: "vid-do-clique",
  _fbp: "fb.1.1700000000000.1234567890",
  gclid: "G-do-clique",
  fbclid: "F-do-clique",
  _fbc: "fb.1.1700000000000.F-do-clique",
};

describe("ITP apagou os cookies: o carrinho devolve o clique", () => {
  it("restaura vid, _fbp, gclid e _fbc do carrinho em vez de inventar", async () => {
    const nav = navegador({
      carrinho: { token: "c1", attributes: { ...CLIQUE_ANTIGO } },
    });
    const p = abrir(nav);
    await assentar();

    expect(p.cookie("_xc_vid")).toBe("vid-do-clique");
    expect(p.cookie("_fbp")).toBe(CLIQUE_ANTIGO._fbp);
    expect(p.cookie("_xc_gclid")).toBe("G-do-clique");
    expect(p.cookie("_xc_fbc")).toBe(CLIQUE_ANTIGO._fbc);

    // O carrinho nunca recebe um id inventado por cima do do clique.
    for (const u of p.updates) {
      expect(u._xc_vid).toBe("vid-do-clique");
      expect(u._fbp).toBe(CLIQUE_ANTIGO._fbp);
    }
    expect(nav.carrinho).toMatchObject({ attributes: CLIQUE_ANTIGO });

    // E o primeiro evento da pagina ja sai com a identidade restaurada.
    const [vi] = p.beacons;
    expect(vi.evento).toBe("view_item");
    expect(vi.visitorId).toBe("vid-do-clique");
    expect(vi.gclid).toBe("G-do-clique");
    expect(vi.fbc).toBe(CLIQUE_ANTIGO._fbc);
  });

  it("cookie vivo vence o carrinho", async () => {
    const nav = navegador({
      cookies: new Map([["_xc_vid", "vid-do-cookie"]]),
      carrinho: { token: "c1", attributes: { _xc_vid: "vid-velho" } },
    });
    const p = abrir(nav);
    await assentar();
    expect(p.cookie("_xc_vid")).toBe("vid-do-cookie");
    expect(p.beacons[0].visitorId).toBe("vid-do-cookie");
  });

  it("clique na URL vence o carrinho", async () => {
    const nav = navegador({
      carrinho: { token: "c1", attributes: { gclid: "G-velho" } },
    });
    const p = abrir(nav, "https://loja.test/products/camisa?gclid=G-novo");
    await assentar();
    expect(p.beacons[0].gclid).toBe("G-novo");
    expect(p.updates.at(-1)?.gclid).toBe("G-novo");
  });

  it("_fbc de outro clique nao volta quando a URL traz fbclid novo", async () => {
    const nav = navegador({
      carrinho: { token: "c1", attributes: { ...CLIQUE_ANTIGO } },
    });
    const p = abrir(nav, "https://loja.test/products/camisa?fbclid=F-novo");
    await assentar();
    expect(p.beacons[0].fbc).toMatch(/^fb\.1\.\d+\.F-novo$/);
  });

  it("carrinho sem id: o gerado fica e e escrito", async () => {
    const nav = navegador();
    const p = abrir(nav);
    await assentar();
    const vid = p.cookie("_xc_vid");
    expect(vid).toBeTruthy();
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0]._xc_vid).toBe(vid);
  });
});

describe("o primeiro evento espera o carrinho, mas nunca para sempre", () => {
  it("segura o evento ate o teto e entao solta, abortando a leitura", async () => {
    const nav = navegador({ carrinho: "pendurado" });
    const p = abrir(nav, "https://loja.test/products/camisa?gclid=G1");
    await assentar();
    expect(p.beacons).toHaveLength(0);

    p.estourarTimers();
    await assentar();
    expect(p.abortos()).toBe(1);
    expect(p.beacons).toHaveLength(1);
    expect(p.beacons[0].gclid).toBe("G1");
  });

  it("sem ler o carrinho, nao escreve id inventado nele", async () => {
    const nav = navegador({ carrinho: "pendurado" });
    const p = abrir(nav, "https://loja.test/products/camisa?gclid=G1");
    p.estourarTimers();
    await assentar();
    // O clique da URL vai; o vid e o _fbp recem-inventados, nao.
    expect(p.updates).toHaveLength(1);
    expect(p.updates[0].gclid).toBe("G1");
    expect(p.updates[0]).not.toHaveProperty("_xc_vid");
    expect(p.updates[0]).not.toHaveProperty("_fbp");
  });

  it("sair da pagina solta a fila sem esperar o teto", async () => {
    const nav = navegador({ carrinho: "pendurado" });
    const p = abrir(nav);
    p.sair();
    await assentar();
    expect(p.beacons).toHaveLength(1);
    // Saindo, nao escreve: o update morreria no meio.
    expect(p.updates).toHaveLength(0);
  });
});

describe("a marca de gravado e por carrinho", () => {
  it("carrinho novo na mesma aba recebe o clique de novo", async () => {
    const nav = navegador({
      cookies: new Map([["_xc_gclid", "G1"]]),
      carrinho: { token: "pedido-1", attributes: {} },
    });
    abrir(nav);
    await assentar();
    expect(nav.carrinho).toMatchObject({ attributes: { gclid: "G1" } });

    // Pedido fechado: a Shopify zera o carrinho. Mesma aba, mesma sessao.
    nav.carrinho = { token: "pedido-2", attributes: {} };
    const p2 = abrir(nav, "https://loja.test/");
    await assentar();
    expect(p2.updates).toHaveLength(1);
    expect(p2.updates[0].gclid).toBe("G1");
  });

  it("mesmo carrinho, ja gravado: nenhuma requisicao", async () => {
    const nav = navegador({ cookies: new Map([["_xc_gclid", "G1"]]) });
    abrir(nav);
    await assentar();
    const p2 = abrir(nav, "https://loja.test/");
    await assentar();
    expect(p2.updates).toHaveLength(0);
  });

  it("compara o token so ate o `?key=`", async () => {
    const nav = navegador({ cookies: new Map([["_xc_gclid", "G1"]]) });
    abrir(nav);
    await assentar();
    // A resposta do update veio com `?key=x`; a leitura seguinte, com outra.
    nav.carrinho = { ...(nav.carrinho as Carrinho), token: "c1?key=outra" };
    const p2 = abrir(nav, "https://loja.test/");
    await assentar();
    expect(p2.updates).toHaveLength(0);
  });

  it("atributo sumido do carrinho e reescrito mesmo com a marca dizendo gravado", async () => {
    const nav = navegador({ cookies: new Map([["_xc_gclid", "G1"]]) });
    abrir(nav);
    await assentar();
    (nav.carrinho as Carrinho).attributes = {};
    const p2 = abrir(nav, "https://loja.test/");
    await assentar();
    expect(p2.updates).toHaveLength(1);
    expect(p2.updates[0].gclid).toBe("G1");
  });

  it("marca no formato antigo (mapa solto) nao impede a escrita", async () => {
    const nav = navegador({
      cookies: new Map([["_xc_gclid", "G1"]]),
      sessao: new Map([["_xc_enviado", JSON.stringify({ gclid: "G1" })]]),
    });
    const p = abrir(nav);
    await assentar();
    expect(p.updates).toHaveLength(1);
  });

  it("carrinho que nasce no primeiro adicionar recebe os atributos", async () => {
    const nav = navegador({
      cookies: new Map([["_xc_gclid", "G1"]]),
      carrinho: { token: "provisorio", attributes: {} },
      // O carrinho de verdade nasce no add, com outro token e sem atributos.
      aoAdicionar: () => ({ token: "real", attributes: {} }),
    });
    const p = abrir(nav);
    await assentar();
    expect(p.updates).toHaveLength(1);

    await p.adicionar();
    await assentar();
    expect(p.updates).toHaveLength(2);
    expect(nav.carrinho).toMatchObject({
      token: "real",
      attributes: { gclid: "G1", _xc_vid: p.cookie("_xc_vid") },
    });
  });

  it("adicionar com o carrinho ja certo nao escreve de novo", async () => {
    const nav = navegador({ cookies: new Map([["_xc_gclid", "G1"]]) });
    const p = abrir(nav);
    await assentar();
    await p.adicionar();
    await assentar();
    expect(p.updates).toHaveLength(1);
    expect(p.beacons.map((b) => b.evento)).toContain("add_to_cart");
  });
});

describe("clique novo substitui o conjunto anterior", () => {
  it("gbraid na URL apaga gclid do cookie e do carrinho", async () => {
    const nav = navegador({
      cookies: new Map([
        ["_xc_gclid", "G-velho"],
        ["_gcl_aw", "GCL.1700000000.G-do-google"],
      ]),
      carrinho: { token: "c1", attributes: { gclid: "G-velho" } },
    });
    const p = abrir(nav, "https://loja.test/products/camisa?gbraid=B1");
    await assentar();

    expect(p.cookie("_xc_gclid")).toBeUndefined();
    expect(p.cookie("_xc_gbraid")).toBe("B1");
    expect(p.updates[0]).toMatchObject({ gbraid: "B1", gclid: "", wbraid: "" });
    expect((nav.carrinho as Carrinho).attributes).not.toHaveProperty("gclid");
    // Nem do _gcl_aw: ele guarda o clique de antes.
    expect(p.beacons[0]).toMatchObject({ gbraid: "B1", gclid: null });
  });

  it("_gcl_aw so completa quando nao ha nenhum dos tres", async () => {
    const semNada = abrir(
      navegador({ cookies: new Map([["_gcl_aw", "GCL.1700000000.G-do-google"]]) })
    );
    await assentar();
    expect(semNada.beacons[0].gclid).toBe("G-do-google");

    const comWbraid = abrir(
      navegador({
        cookies: new Map([
          ["_gcl_aw", "GCL.1700000000.G-do-google"],
          ["_xc_wbraid", "W1"],
        ]),
      })
    );
    await assentar();
    expect(comWbraid.beacons[0]).toMatchObject({ gclid: null, wbraid: "W1" });
  });

  it("carrinho nao devolve um id do Google quando ja ha outro vivo", async () => {
    const nav = navegador({
      cookies: new Map([["_xc_wbraid", "W1"]]),
      carrinho: { token: "c1", attributes: { gclid: "G-velho" } },
    });
    const p = abrir(nav);
    await assentar();
    expect(p.beacons[0]).toMatchObject({ gclid: null, wbraid: "W1" });
  });

  it("fbclid novo vence o _fbc fossil do pixel do Meta, e o carimbo se mantem", async () => {
    const nav = navegador({
      cookies: new Map([["_fbc", "fb.1.1600000000000.VELHO"]]),
    });
    const p = abrir(nav, "https://loja.test/products/camisa?fbclid=NOVO");
    await assentar();
    const montado = p.beacons[0].fbc;
    expect(montado).toMatch(/^fb\.1\.\d+\.NOVO$/);
    expect(p.cookie("_xc_fbc")).toBe(montado);

    // Pagina seguinte, sem fbclid na URL: o mesmo valor, nao o fossil nem um
    // carimbo novo.
    const p2 = abrir(nav, "https://loja.test/products/outra");
    await assentar();
    expect(p2.beacons[0].fbc).toBe(montado);
  });

  it("sem fbclid novo, o _fbc do Meta continua valendo", async () => {
    const nav = navegador({
      cookies: new Map([["_fbc", "fb.1.1600000000000.DO-META"]]),
    });
    const p = abrir(nav);
    await assentar();
    expect(p.beacons[0].fbc).toBe("fb.1.1600000000000.DO-META");
  });
});

describe("uma execucao por pagina", () => {
  it("rodar o arquivo duas vezes nao duplica leitura nem wrapper", async () => {
    const nav = navegador({ cookies: new Map([["_xc_gclid", "G1"]]) });
    const p = abrir(nav);
    p.rodar();
    await assentar();
    expect(p.leituras()).toBe(1);
    expect(p.updates).toHaveLength(1);

    await p.adicionar();
    await assentar();
    // Uma leitura do add (2b), nao duas.
    expect(p.leituras()).toBe(2);
    expect(p.beacons.filter((b) => b.evento === "add_to_cart")).toHaveLength(1);
  });
});
