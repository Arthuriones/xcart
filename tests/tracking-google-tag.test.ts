import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { apenasNumeroDaConversao } from "../src/lib/tracking/normalizar";
import {
  contaDoGoogle,
  contasGoogleParaNavegador,
  pixelCobrindoCheckout,
} from "../src/lib/tracking/google-tag";

// ============================================================================
// O Google Ads pelo NAVEGADOR, com a tag do Google (gtag.js).
//
// Decisao do dono (03/10/2026): o Google sai do navegador, como o WeTracked, e
// nada mais sai do servidor para o Google. O Meta (CAPI pelo servidor) nao
// muda. O que este arquivo trava:
//
//   1. o que /api/tracking/google-config devolve (so dado publico, id E
//      dominio, interruptor da loja, cache curto);
//   2. a fila: linha 'google' nao sai para a rede, e a do Meta sai igual;
//   3. a montagem dos eventos gtag no Web Pixel e no snippet do tema, rodando
//      os arquivos de verdade num navegador de mentira.
// ============================================================================

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  rede: null as unknown as (url: string, init?: RequestInit) => Promise<Response>,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: (url: string, init?: RequestInit) => mundo.rede(url, init),
}));

function fonte(...partes: string[]) {
  return readFileSync(path.join(process.cwd(), ...partes), "utf8");
}

// ---------------------------------------------------------------------------
// Banco falso: cada `from` devolve o que `responder` decidir.
// ---------------------------------------------------------------------------
type Filtro = [string, string, unknown];
interface Consulta {
  tabela: string;
  op: "select" | "update";
  valores: Record<string, unknown> | null;
  filtros: Filtro[];
  unica: boolean;
}

function bancoFalso(
  responder: (c: Consulta) => { data: unknown; error?: { message: string } | null }
) {
  const consultas: Consulta[] = [];
  const admin = {
    from(tabela: string) {
      const c: Consulta = { tabela, op: "select", valores: null, filtros: [], unica: false };
      const b: Record<string, unknown> = {};
      const anota = (op: string) => (col: string, v: unknown) => {
        c.filtros.push([op, col, v]);
        return b;
      };
      Object.assign(b, {
        select: () => b,
        update: (v: Record<string, unknown>) => {
          c.op = "update";
          c.valores = v;
          return b;
        },
        eq: anota("eq"),
        is: anota("is"),
        in: anota("in"),
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          c.unica = true;
          return b;
        },
        then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
          consultas.push(c);
          const r = c.op === "select" ? responder(c) : { data: null };
          return Promise.resolve({ data: r.data, error: r.error ?? null }).then(ok, erro);
        },
      });
      return b;
    },
  };
  mundo.admin = admin;
  return { admin: admin as never, consultas, updates: () => consultas.filter((c) => c.op === "update") };
}

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "loja.myshopify.com";

// ===========================================================================
// 1. O que sai para o navegador
// ===========================================================================

describe("contas Google para o navegador", () => {
  it("aceita o AW- como o lojista copia e como so numero", () => {
    expect(contaDoGoogle("AW-123456789")).toBe("AW-123456789");
    expect(contaDoGoogle(" aw-123456789 ")).toBe("AW-123456789");
    expect(contaDoGoogle("123456789")).toBe("AW-123456789");
    expect(contaDoGoogle("AW-")).toBeNull();
    expect(contaDoGoogle('AW-1"><script>')).toBeNull();
    // O formulario guarda so os digitos pelo mesmo helper.
    expect(apenasNumeroDaConversao("AW-123456789")).toBe("123456789");
  });

  it("so os eventos conhecidos, rotulo limpo, conta repetida vira uma", () => {
    const contas = contasGoogleParaNavegador([
      {
        conta: "AW-111111111",
        ativo: true,
        labels: { purchase: "Compra_1", add_to_cart: " Cart-1 ", payment_info: "PI", lixo: "x" },
      },
      { conta: "AW-111111111", ativo: true, labels: { purchase: "OUTRO", view_item: "Ver1" } },
      { conta: "AW-222222222", ativo: true, labels: { begin_checkout: "bad label!" } },
      { conta: "nao-e-conta", ativo: true, labels: { purchase: "x" } },
      { conta: "AW-333333333", ativo: false, labels: { purchase: "x" } },
    ]);
    expect(contas).toEqual([
      {
        conta: "AW-111111111",
        // O destino mais antigo vence o rotulo; o outro completa o que falta.
        labels: { purchase: "Compra_1", add_to_cart: "Cart-1", view_item: "Ver1" },
      },
      // Sem rotulo valido a conta continua: a tag configura, so nao converte.
      { conta: "AW-222222222", labels: {} },
    ]);
  });

  it("pixel cobrindo o checkout: visto nas ultimas 24 h", () => {
    const agora = Date.parse("2026-10-03T12:00:00Z");
    expect(pixelCobrindoCheckout("2026-10-03T00:00:00Z", agora)).toBe(true);
    expect(pixelCobrindoCheckout("2026-10-01T00:00:00Z", agora)).toBe(false);
    expect(pixelCobrindoCheckout(null, agora)).toBe(false);
  });
});

describe("GET /api/tracking/google-config", () => {
  async function chamar(qs: string) {
    const { GET } = await import("../src/app/api/tracking/google-config/route");
    const { NextRequest } = await import("next/server");
    const r = await GET(new NextRequest(`https://user.xcart.app/api/tracking/google-config?${qs}`));
    return { r, corpo: await r.json() };
  }

  function lojaComGoogle(over: { enabled?: boolean; loja?: boolean; erro?: boolean } = {}) {
    return bancoFalso((c) => {
      if (over.erro) return { data: null, error: { message: "caiu" } };
      if (c.tabela === "stores") return { data: over.loja === false ? null : { id: STORE } };
      if (c.tabela === "tracking_configs") {
        return {
          data: {
            enabled: over.enabled ?? true,
            web_pixel_visto_em: new Date(Date.now() - 3600e3).toISOString(),
          },
        };
      }
      if (c.tabela === "tracking_destinations") {
        return {
          data: [
            { conta: "AW-111111111", ativo: true, labels: { purchase: "P1", view_item: "V1" } },
            { conta: "AW-222222222", ativo: true, labels: { add_to_cart: "C2" } },
          ],
        };
      }
      return { data: null };
    });
  }

  it("devolve as contas e os rotulos, com cache curto e CORS aberto", async () => {
    const banco = lojaComGoogle();
    const { r, corpo } = await chamar(`store=${STORE}&shop=${SHOP}`);
    expect(r.status).toBe(200);
    expect(corpo).toEqual([
      { conta: "AW-111111111", labels: { purchase: "P1", view_item: "V1" } },
      { conta: "AW-222222222", labels: { add_to_cart: "C2" } },
    ]);
    expect(r.headers.get("cache-control")).toBe("public, max-age=300, s-maxage=300");
    expect(r.headers.get("access-control-allow-origin")).toBe("*");
    expect(r.headers.get("x-xcart-pixel-checkout")).toBe("1");
    // Confere id E dominio, sem loja desinstalada, e so Google ativo.
    const loja = banco.consultas.find((c) => c.tabela === "stores")!;
    expect(loja.filtros).toEqual([
      ["eq", "id", STORE],
      ["eq", "shop_domain", SHOP],
      ["is", "uninstalled_at", null],
    ]);
    const dest = banco.consultas.find((c) => c.tabela === "tracking_destinations")!;
    expect(dest.filtros).toEqual(
      expect.arrayContaining([
        ["eq", "store_id", STORE],
        ["eq", "plataforma", "google"],
        ["eq", "ativo", true],
      ])
    );
  });

  it("pedido mal formado nao chega ao banco", async () => {
    const banco = lojaComGoogle();
    for (const qs of [`shop=${SHOP}`, `store=${STORE}`, `store=x&shop=${SHOP}`, `store=${STORE}&shop=evil.com`]) {
      const { corpo } = await chamar(qs);
      expect(corpo).toEqual([]);
    }
    expect(banco.consultas).toHaveLength(0);
  });

  it("id de outra loja, ou rastreamento desligado: lista vazia", async () => {
    lojaComGoogle({ loja: false });
    expect((await chamar(`store=${STORE}&shop=${SHOP}`)).corpo).toEqual([]);
    lojaComGoogle({ enabled: false });
    expect((await chamar(`store=${STORE}&shop=${SHOP}`)).corpo).toEqual([]);
  });

  it("erro de banco: vazio SEM cache, para nao virar 'loja sem Google' por 5 min", async () => {
    lojaComGoogle({ erro: true });
    const erroConsole = vi.spyOn(console, "error").mockImplementation(() => {});
    const { r, corpo } = await chamar(`store=${STORE}&shop=${SHOP}`);
    erroConsole.mockRestore();
    expect(corpo).toEqual([]);
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

// ===========================================================================
// 2. A fila: o Google nao sai do servidor, o Meta sai igual
// ===========================================================================

describe("fila do servidor sem o Google", () => {
  const chamadas: { url: string; init?: RequestInit }[] = [];
  beforeEach(() => {
    chamadas.length = 0;
    mundo.rede = async (url: string, init?: RequestInit) => {
      chamadas.push({ url, init });
      if (url.startsWith("https://graph.facebook.com/")) {
        return new Response(JSON.stringify({ events_received: 1 }), { status: 200 });
      }
      throw new Error(`rede inesperada: ${url}`);
    };
  });

  const META = {
    id: "dest-meta",
    storeId: "s1",
    plataforma: "meta" as const,
    nome: null,
    conta: "123456",
    labels: {},
    testEventCode: null,
    idTemplate: null,
    ativo: true,
    token: "EAAB",
  };
  const GOOGLE = { ...META, id: "dest-g", plataforma: "google" as const, conta: "AW-1", labels: { purchase: "P" }, token: null };

  it("linha do Meta sai com o payload intocado", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso(() => ({ data: null }));
    const evento = {
      event_name: "AddToCart",
      event_time: 1759500000,
      event_id: "add_to_cart_v_1",
      action_source: "website",
      user_data: { fbc: "fb.1.1.x", fbp: "fb.1.2.y", client_ip_address: "1.2.3.4" },
      custom_data: { content_type: "product", content_ids: ["11"] },
    };
    const r = await entregar(
      banco.admin,
      { id: "l1", store_id: "s1", destination: "meta", destination_id: "dest-meta", event_name: "add_to_cart", payload: evento, attempts: 0 },
      { destino: META, lojaLigada: true }
    );
    expect(r.ok).toBe(true);
    expect(chamadas).toHaveLength(1);
    expect(chamadas[0].url).toContain("graph.facebook.com");
    expect(JSON.parse(String(chamadas[0].init?.body)).data[0]).toEqual(evento);
    expect(banco.updates()[0].valores).toMatchObject({ status: "enviado" });
  });

  it("linha 'google' antiga fecha sem rede, com o motivo", async () => {
    const { entregar } = await import("../src/lib/tracking/fila");
    const banco = bancoFalso(() => ({ data: null }));
    const r = await entregar(
      banco.admin,
      { id: "l2", store_id: "s1", destination: "google", destination_id: "dest-g", event_name: "Purchase", payload: { gclid: "G" }, attempts: 0 },
      { destino: GOOGLE, lojaLigada: true }
    );
    expect(r.ok).toBe(false);
    expect(chamadas).toHaveLength(0);
    expect(banco.updates()[0].valores).toMatchObject({
      status: "falhou",
      last_error: "o Google vai pelo navegador (tag do Google), não pelo servidor",
    });
  });

  it("destino Google nunca e destino de fila, mas a tag dispara a compra com rotulo", async () => {
    const { destinoAceita, tagDoGoogleDispara } = await import("../src/lib/tracking/destinos");
    expect(destinoAceita(GOOGLE)).toBe(false);
    expect(destinoAceita(META)).toBe(true);
    expect(tagDoGoogleDispara(GOOGLE, "Purchase")).toBe(true);
    expect(tagDoGoogleDispara(GOOGLE, "add_to_cart")).toBe(false);
    expect(tagDoGoogleDispara({ ...GOOGLE, ativo: false }, "purchase")).toBe(false);
    expect(tagDoGoogleDispara(META, "purchase")).toBe(false);
  });

  it("o servidor nao tem mais saida para o Google", () => {
    // O coletor e o webhook so pegam destino Meta; a fila nao importa nada do
    // Google. Se alguem religar, este teste quebra antes do deploy.
    const coletor = fonte("src", "app", "api", "tracking", "collect", "route.ts");
    const webhook = fonte("src", "app", "api", "shopify", "webhooks", "route.ts");
    const fila = fonte("src", "lib", "tracking", "fila.ts");
    expect(coletor).toContain('d.plataforma === "meta" && destinoAceita(d)');
    expect(webhook).toContain('d.plataforma === "meta" && destinoAceita(d)');
    for (const f of [coletor, webhook, fila]) {
      expect(f).not.toMatch(/destination: "google"/);
      expect(f).not.toMatch(/google-(ads|dm|url)/);
      expect(f).not.toContain("googleadservices");
    }
  });
});

// ===========================================================================
// 3a. O Web Pixel do checkout
// ===========================================================================

type Args = unknown[];

function rodarPixel(opcoes: {
  privacidade?: Record<string, unknown> | null;
  contas?: unknown;
  store?: string;
}) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const beacons: Record<string, unknown>[] = [];
  const scripts: string[] = [];
  const buscas: string[] = [];
  const api = {
    analytics: {
      subscribe: (nome: string, fn: (e: unknown) => void) => {
        handlers[nome] = fn;
      },
    },
    browser: {
      sendBeacon: (_url: string, texto: string) => {
        beacons.push(JSON.parse(texto));
        return true;
      },
    },
    init: {
      data: { shop: { myshopifyDomain: SHOP } },
      customerPrivacy: opcoes.privacidade === undefined ? null : opcoes.privacidade,
    },
  };
  const store = opcoes.store ?? STORE;
  const ctx: Record<string, unknown> = {
    ctx: api,
    document: {
      getElementsByTagName: () => [
        { src: `https://app.test/xcart-pixel.js?store=${store}&shop=${SHOP}` },
      ],
      createElement: () => ({}) as Record<string, unknown>,
      head: {
        appendChild: (s: { src?: string }) => {
          scripts.push(String(s.src));
          return s;
        },
      },
    },
    fetch: (url: string) => {
      buscas.push(url);
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(opcoes.contas ?? []),
      });
    },
    URL,
    Date,
    JSON,
    isFinite,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonte("public", "xcart-pixel.js"), ctx);
  const camada = () => ((ctx.dataLayer as Args[] | undefined) ?? []).map((a) => Array.from(a));
  return { handlers, beacons, scripts, buscas, camada };
}

const DUAS_CONTAS = [
  { conta: "AW-111111111", labels: { begin_checkout: "IC1", purchase: "P1" } },
  { conta: "AW-222222222", labels: { purchase: "P2" } },
];

function eventoCheckout(checkout: Record<string, unknown>) {
  return {
    id: "e1",
    clientId: "cliente-1",
    data: { checkout: { token: "T1", attributes: [], ...checkout } },
    context: { document: { location: { href: "https://loja.test/checkouts/x" }, referrer: "" } },
  };
}

const COMPRA = {
  email: "Cliente@Exemplo.com",
  phone: "(11) 99999-8888",
  order: { id: "gid://shopify/Order/5544332211" },
  totalPrice: { amount: 197.9, currencyCode: "BRL" },
  billingAddress: {
    firstName: "Ana",
    lastName: "Souza",
    address1: "Rua A, 10",
    city: "São Paulo",
    provinceCode: "SP",
    zip: "01000-000",
    countryCode: "BR",
  },
};

/** Deixa a busca da configuracao (fetch -> json) terminar. */
const assentar = () => new Promise((r) => setTimeout(r, 0));

describe("Web Pixel: a tag do Google no checkout", () => {
  it("busca a configuracao com id E dominio e carrega UM gtag.js com conversoes otimizadas", async () => {
    const px = rodarPixel({ contas: DUAS_CONTAS });
    await assentar();
    expect(px.buscas).toEqual([
      `https://app.test/api/tracking/google-config?store=${STORE}&shop=${SHOP}`,
    ]);
    expect(px.scripts).toEqual(["https://www.googletagmanager.com/gtag/js?id=AW-111111111"]);
    const l = px.camada();
    expect(l[0][0]).toBe("js");
    expect(l.filter((a) => a[0] === "config")).toEqual([
      ["config", "AW-111111111", { allow_enhanced_conversions: true }],
      ["config", "AW-222222222", { allow_enhanced_conversions: true }],
    ]);
  });

  it("checkout_started: begin_checkout so na conta com rotulo, id por checkout", async () => {
    const px = rodarPixel({ contas: DUAS_CONTAS });
    px.handlers.checkout_started(eventoCheckout({}));
    await assentar();
    expect(px.camada().filter((a) => a[0] === "event")).toEqual([
      ["event", "begin_checkout", { send_to: "AW-111111111/IC1", transaction_id: "begin_checkout_ck_T1" }],
    ]);
    // O evento do Meta continua indo ao coletor, igual.
    expect(px.beacons).toHaveLength(1);
    expect(px.beacons[0]).toMatchObject({ evento: "begin_checkout", fonte: "pixel", checkoutToken: "T1" });
  });

  it("checkout_completed: user_data antes, compra em todas as contas, e nada ao coletor", async () => {
    const px = rodarPixel({ contas: DUAS_CONTAS, privacidade: { marketingAllowed: true } });
    await assentar();
    px.handlers.checkout_completed(eventoCheckout(COMPRA));
    const l = px.camada();
    const iUser = l.findIndex((a) => a[0] === "set");
    const iCompra = l.findIndex((a) => a[0] === "event");
    expect(iUser).toBeGreaterThan(-1);
    expect(iUser).toBeLessThan(iCompra);
    expect(l[iUser]).toEqual([
      "set",
      "user_data",
      {
        email: "Cliente@Exemplo.com",
        phone_number: "+5511999998888",
        address: {
          first_name: "Ana",
          last_name: "Souza",
          street: "Rua A, 10",
          city: "São Paulo",
          region: "SP",
          postal_code: "01000-000",
          country: "BR",
        },
      },
    ]);
    expect(l.filter((a) => a[0] === "event")).toEqual([
      ["event", "purchase", { send_to: "AW-111111111/P1", transaction_id: "5544332211", value: 197.9, currency: "BRL" }],
      ["event", "purchase", { send_to: "AW-222222222/P2", transaction_id: "5544332211", value: 197.9, currency: "BRL" }],
    ]);
    // A compra do Meta vem do webhook: o pixel nao avisa o coletor.
    expect(px.beacons).toHaveLength(0);
  });

  it("eventos antes da configuracao chegar esperam por ela", async () => {
    const px = rodarPixel({ contas: DUAS_CONTAS });
    px.handlers.checkout_completed(eventoCheckout(COMPRA));
    expect(px.camada().filter((a) => a[0] === "event")).toHaveLength(0);
    await assentar();
    expect(px.camada().filter((a) => a[0] === "event")).toHaveLength(2);
  });

  it("consentimento: concedido -> granted, negado -> denied, sem leitura -> nada", async () => {
    const consent = async (privacidade: Record<string, unknown> | null) => {
      const px = rodarPixel({ contas: DUAS_CONTAS, privacidade });
      await assentar();
      return px.camada().filter((a) => a[0] === "consent");
    };
    const granted = { ad_storage: "granted", ad_user_data: "granted", ad_personalization: "granted" };
    const denied = { ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" };
    expect((await consent({ marketingAllowed: true }))[0]).toEqual(["consent", "update", granted]);
    expect((await consent({ marketingAllowed: false }))[0]).toEqual(["consent", "update", denied]);
    // Nunca forca granted, como o WeTracked faz.
    expect(await consent(null)).toEqual([]);
  });

  it("teste do dono (?xcart_teste=1) nao dispara a tag", async () => {
    const px = rodarPixel({ contas: DUAS_CONTAS });
    await assentar();
    const teste = [{ key: "_xc_teste", value: "1" }];
    px.handlers.checkout_started(eventoCheckout({ attributes: teste }));
    px.handlers.checkout_completed(eventoCheckout({ ...COMPRA, attributes: teste }));
    expect(px.camada().filter((a) => a[0] === "event" || a[0] === "set")).toEqual([]);
    // O coletor continua recebendo o checkout marcado como teste.
    expect(px.beacons[0]).toMatchObject({ teste: true });
  });

  it("loja sem Google: nenhum script, nenhuma conversao", async () => {
    const px = rodarPixel({ contas: [] });
    await assentar();
    px.handlers.checkout_completed(eventoCheckout(COMPRA));
    expect(px.scripts).toEqual([]);
    expect(px.camada()).toEqual([]);
  });

  it("telefone so em E.164 quando ha certeza", async () => {
    const fone = async (phone: string, countryCode: string) => {
      const px = rodarPixel({ contas: DUAS_CONTAS });
      await assentar();
      px.handlers.checkout_completed(
        eventoCheckout({ ...COMPRA, phone, billingAddress: { ...COMPRA.billingAddress, countryCode } })
      );
      const set = px.camada().find((a) => a[0] === "set");
      return (set?.[2] as { phone_number?: string } | undefined)?.phone_number;
    };
    expect(await fone("+55 11 99999-8888", "BR")).toBe("+5511999998888");
    expect(await fone("5511999998888", "BR")).toBe("+5511999998888");
    expect(await fone("011 99999-8888", "BR")).toBe("+5511999998888");
    expect(await fone("0044 7700 900123", "GB")).toBe("+447700900123");
    expect(await fone("(415) 555-0100", "US")).toBe("+14155550100");
    // Pais fora da tabela e sem "+": melhor sem do que errado.
    expect(await fone("612345678", "XX")).toBeUndefined();
  });
});

// ===========================================================================
// 3b. O snippet do tema
// ===========================================================================

function rodarSnippet(opcoes: {
  contas?: unknown;
  pixelCobre?: "1" | "0";
  url?: string;
  cookies?: string;
}) {
  const u = new URL(opcoes.url ?? "https://loja.test/products/camisa");
  const beacons: Record<string, unknown>[] = [];
  const scripts: string[] = [];
  const buscas: string[] = [];
  const ouvintes: Record<string, ((e: unknown) => void)[]> = {};
  const cookies = new Map<string, string>(
    (opcoes.cookies ?? "").split("; ").filter(Boolean).map((p) => p.split("=") as [string, string])
  );

  const responder = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
    Promise.resolve({
      ok: true,
      headers: { get: (k: string) => cabecalhos[k.toLowerCase()] ?? null },
      json: () => Promise.resolve(JSON.parse(JSON.stringify(corpo))),
    });

  function fetch(entrada: unknown) {
    const alvo = String(entrada);
    buscas.push(alvo);
    if (alvo.endsWith("/cart.js")) return responder({ token: "c1", attributes: {} });
    if (alvo.endsWith("/cart/update.js")) return responder({ token: "c1", attributes: {} });
    if (alvo.includes("/cart/add")) return responder({ id: 1 });
    if (alvo.includes("/api/tracking/google-config")) {
      return responder(opcoes.contas ?? [], { "x-xcart-pixel-checkout": opcoes.pixelCobre ?? "1" });
    }
    return Promise.reject(new Error(`fetch inesperado: ${alvo}`));
  }

  const documento = {
    get cookie() {
      return [...cookies].map(([k, v]) => `${k}=${v}`).join("; ");
    },
    set cookie(linha: string) {
      const [par] = linha.split(";");
      const i = par.indexOf("=");
      cookies.set(par.slice(0, i).trim(), par.slice(i + 1));
    },
    readyState: "complete",
    referrer: "",
    currentScript: {
      src: "https://app.test/xcart-click.js",
      getAttribute: (n: string) => (n === "data-xcart-store" ? STORE : null),
    },
    addEventListener: (ev: string, fn: (e: unknown) => void) => {
      (ouvintes[ev] ||= []).push(fn);
    },
    querySelector: () => null,
    createElement: () => ({}) as Record<string, unknown>,
    head: {
      appendChild: (s: { src?: string }) => {
        scripts.push(String(s.src));
        return s;
      },
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
    sessionStorage: { getItem: () => null, setItem: () => {} },
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
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    Shopify: { shop: SHOP, routes: { root: "/" } },
    ShopifyAnalytics: { meta: { product: { id: 7, variants: [{ id: 11, sku: "S", price: 1000 }] } } },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fonte("public", "xcart-click.js"), ctx);
  const camada = () => ((ctx.dataLayer as Args[] | undefined) ?? []).map((a) => Array.from(a));
  return {
    beacons,
    scripts,
    buscas,
    camada,
    adicionar: () => (ctx.fetch as typeof fetch)("/cart/add.js"),
    clicarCheckout: () =>
      ouvintes.click?.forEach((fn) =>
        fn({ target: { closest: (sel: string) => (sel === '[name="checkout"]' ? {} : null) } })
      ),
  };
}

const assentarMuito = async () => {
  for (let i = 0; i < 10; i++) await assentar();
};

describe("snippet do tema: a tag do Google", () => {
  const CONTAS = [
    { conta: "AW-111111111", labels: { view_item: "V1", add_to_cart: "C1", begin_checkout: "IC1" } },
    { conta: "AW-222222222", labels: { add_to_cart: "C2" } },
  ];

  it("view_item e add_to_cart viram conversao com o mesmo id do coletor", async () => {
    const sn = rodarSnippet({ contas: CONTAS });
    await assentarMuito();
    sn.adicionar();
    await assentarMuito();

    expect(sn.buscas).toContain(
      `https://app.test/api/tracking/google-config?store=${STORE}&shop=${SHOP}`
    );
    expect(sn.scripts).toEqual(["https://www.googletagmanager.com/gtag/js?id=AW-111111111"]);
    const ver = sn.beacons.find((b) => b.evento === "view_item")!;
    const carrinho = sn.beacons.find((b) => b.evento === "add_to_cart")!;
    expect(sn.camada().filter((a) => a[0] === "event")).toEqual([
      ["event", "view_item", { send_to: "AW-111111111/V1", transaction_id: ver.eventId }],
      ["event", "add_to_cart", { send_to: "AW-111111111/C1", transaction_id: carrinho.eventId }],
      ["event", "add_to_cart", { send_to: "AW-222222222/C2", transaction_id: carrinho.eventId }],
    ]);
    // Conta so de conversao: config sem page_view (o remarketing e a parte).
    expect(sn.camada().filter((a) => a[0] === "config")).toEqual([
      ["config", "AW-111111111", { send_page_view: false }],
      ["config", "AW-222222222", { send_page_view: false }],
    ]);
  });

  it("begin_checkout so sai do tema quando o pixel NAO cobre o checkout", async () => {
    const coberto = rodarSnippet({ contas: CONTAS, pixelCobre: "1", url: "https://loja.test/cart" });
    await assentarMuito();
    coberto.clicarCheckout();
    await assentarMuito();
    expect(coberto.beacons.some((b) => b.evento === "begin_checkout")).toBe(true);
    expect(coberto.camada().filter((a) => a[1] === "begin_checkout")).toEqual([]);

    const sem = rodarSnippet({ contas: CONTAS, pixelCobre: "0", url: "https://loja.test/cart" });
    await assentarMuito();
    sem.clicarCheckout();
    await assentarMuito();
    const ic = sem.beacons.find((b) => b.evento === "begin_checkout")!;
    expect(sem.camada().filter((a) => a[1] === "begin_checkout")).toEqual([
      ["event", "begin_checkout", { send_to: "AW-111111111/IC1", transaction_id: ic.eventId }],
    ]);
  });

  it("teste do dono nao dispara conversao; o coletor recebe marcado", async () => {
    const sn = rodarSnippet({ contas: CONTAS, url: "https://loja.test/products/camisa?xcart_teste=1" });
    await assentarMuito();
    sn.adicionar();
    await assentarMuito();
    expect(sn.camada().filter((a) => a[0] === "event")).toEqual([]);
    expect(sn.beacons.find((b) => b.evento === "add_to_cart")).toMatchObject({ teste: true });
  });

  it("loja sem Google: nada carrega e o corpo do coletor nao muda", async () => {
    const sn = rodarSnippet({ contas: [] });
    await assentarMuito();
    expect(sn.scripts).toEqual([]);
    expect(sn.camada()).toEqual([]);
    // O corpo que o Meta usa: as mesmas chaves de sempre, nada do Google.
    expect(Object.keys(sn.beacons.find((b) => b.evento === "view_item")!).sort()).toEqual(
      [
        "auid", "clientId", "evento", "eventId", "fbc", "fbclid", "fbp", "gbraid", "gclid",
        "pageUrl", "produto", "referrer", "shop", "storeId", "visitorId", "wbraid",
      ].sort()
    );
  });
});
