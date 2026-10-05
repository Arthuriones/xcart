import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { apenasNumeroDaConversao } from "../src/lib/tracking/normalizar";
import { idDoCheckoutExpresso } from "../src/lib/tracking/eventos";
import {
  contaDoGoogle,
  contasGoogleParaNavegador,
  JANELA_PIXEL_CHECKOUT_MS,
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

  it("pixel cobrindo o checkout: visto nos ultimos 7 dias", () => {
    const agora = Date.parse("2026-10-10T12:00:00Z");
    expect(JANELA_PIXEL_CHECKOUT_MS).toBe(7 * 864e5);
    expect(pixelCobrindoCheckout("2026-10-10T00:00:00Z", agora)).toBe(true);
    // Loja sem checkout ha dois dias continua coberta: com um dia, o tema
    // voltava a disparar e o begin_checkout saia em dobro.
    expect(pixelCobrindoCheckout("2026-10-08T00:00:00Z", agora)).toBe(true);
    expect(pixelCobrindoCheckout("2026-10-03T00:00:00Z", agora)).toBe(false);
    expect(pixelCobrindoCheckout(null, agora)).toBe(false);
  });

  it("coletor e Google usam a mesma janela, e o pixel nao repete o checkout do tema", () => {
    const coletor = fonte("src", "app", "api", "tracking", "collect", "route.ts");
    expect(coletor).toContain("Date.now() - vistoEm < JANELA_PIXEL_CHECKOUT_MS");
    expect(coletor).not.toMatch(/vistoEm < 864e5/);
    expect(coletor).toMatch(
      /doPixel && evento === "begin_checkout" && visitanteDoTema[\s\S]{0,400}\.eq\("visitor_id", visitanteDoTema\)/
    );
    // Quem ja existe so atualiza; identidade NOVA tem teto e, estourado, nao nasce.
    expect(coletor).toMatch(/\.update\(campos\)[\s\S]{0,200}\.select\("id"\)[\s\S]{0,700}>= TETO_IDENTIDADES_HORA\) return;/);
  });

  /**
   * O checkout expresso (Shop Pay, Apple Pay...) pula a pagina onde o pixel
   * roda. Suprimido como o clique comum, o InitiateCheckout dele sumia -- foi o
   * buraco da Softnook. Comportamento: tests/tracking-checkout-expresso.test.ts.
   */
  it("coletor: o expresso fura a supressao do pixel, mas o pixel vence ele", () => {
    const coletor = fonte("src", "app", "api", "tracking", "collect", "route.ts");
    expect(coletor).toMatch(
      /const expresso =\s+!doPixel && evento === "begin_checkout" && origemDoCheckout\(corpo\.origem\) === "expresso";/
    );
    expect(coletor).toContain("if (expresso) eventId = idDoCheckoutExpresso(visitorId, Date.now());");
    expect(coletor).toContain('if (!doPixel && evento === "begin_checkout" && pixelCobrindo && !expresso)');
    // A dedupe de 10 min do pixel NAO vale contra o expresso: o IC do pixel e
    // o rico, e e ele que cancela o outro.
    const dedupe = coletor.slice(coletor.indexOf('if (doPixel && evento === "begin_checkout" && visitanteDoTema)'));
    const consulta = dedupe.slice(0, dedupe.indexOf("checkout ja contado pelo tema"));
    expect(consulta).toContain('.eq("event_name", "begin_checkout")');
    expect(consulta).toContain('.not("event_id", "like", `${PREFIXO_CHECKOUT_EXPRESSO}%`)');
    // O expresso vai para a fila com atraso e NAO passa por `entregar` na hora.
    const fila = coletor.slice(coletor.indexOf("const { id, duplicado } = await enfileirar("));
    expect(fila).toMatch(/proximaTentativaEm: new Date\(Date\.now\(\) \+ ATRASO_CHECKOUT_EXPRESSO_MS\)/);
    expect(fila.indexOf("if (expresso) {")).toBeGreaterThan(-1);
    expect(fila.indexOf("if (expresso) {")).toBeLessThan(fila.indexOf("await entregar("));
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
  /** Valor do cookie _xc_teste lido pelo sandbox; "falha" rejeita. */
  cookieTeste?: string;
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
      // `browser.cookie.get` da Web Pixel API: responde Promise.
      ...(opcoes.cookieTeste === undefined
        ? {}
        : {
            cookie: {
              get: (nome: string) =>
                opcoes.cookieTeste === "falha"
                  ? Promise.reject(new Error("sem cookie"))
                  : Promise.resolve(nome === "_xc_teste" ? opcoes.cookieTeste : ""),
            },
          }),
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

  it("Comprar agora: sem o atributo, o cookie _xc_teste ainda marca teste", async () => {
    // "Comprar agora" pula o carrinho: o checkout nasce sem _xc_teste nos
    // atributos. O cookie do tema e o que sobra.
    const px = rodarPixel({ contas: DUAS_CONTAS, cookieTeste: "1" });
    px.handlers.checkout_started(eventoCheckout({}));
    px.handlers.checkout_completed(eventoCheckout(COMPRA));
    await assentar();
    expect(px.camada().filter((a) => a[0] === "event" || a[0] === "set")).toEqual([]);
    expect(px.beacons).toHaveLength(1);
    expect(px.beacons[0]).toMatchObject({ evento: "begin_checkout", teste: true });
  });

  it("cookie vazio ou API falhando: conversao normal", async () => {
    for (const cookieTeste of ["", "falha"]) {
      const px = rodarPixel({ contas: DUAS_CONTAS, cookieTeste });
      px.handlers.checkout_started(eventoCheckout({}));
      await assentar();
      expect(px.camada().filter((a) => a[0] === "event")).toEqual([
        ["event", "begin_checkout", { send_to: "AW-111111111/IC1", transaction_id: "begin_checkout_ck_T1" }],
      ]);
      expect(px.beacons[0]).not.toHaveProperty("teste");
    }
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
  /** data-xcart-remarketing gravado no tema. */
  remarketing?: string;
  privacidade?: boolean;
  /** Itens que /cart.js devolve. */
  itens?: unknown[];
  /** Itens que /cart/change.js devolve (o carrinho depois da mudanca). */
  itensDepoisDeMudar?: unknown[];
  /** O uniqToken do trekkie: o clientId da Shopify. */
  clientId?: string;
}) {
  const u = new URL(opcoes.url ?? "https://loja.test/products/camisa");
  const beacons: Record<string, unknown>[] = [];
  const scripts: string[] = [];
  const buscas: string[] = [];
  const ouvintes: Record<string, ((e: unknown) => void)[]> = {};
  const cookies = new Map<string, string>(
    (opcoes.cookies ?? "").split("; ").filter(Boolean).map((p) => p.split("=") as [string, string])
  );

  const resposta = (corpo: unknown, cabecalhos: Record<string, string> = {}): Record<string, unknown> => ({
    ok: true,
    headers: { get: (k: string) => cabecalhos[k.toLowerCase()] ?? null },
    json: () => Promise.resolve(JSON.parse(JSON.stringify(corpo))),
    clone: () => resposta(corpo, cabecalhos),
  });
  const responder = (corpo: unknown, cabecalhos: Record<string, string> = {}) =>
    Promise.resolve(resposta(corpo, cabecalhos));
  const JSON_ = { "content-type": "application/json; charset=utf-8" };

  function fetch(entrada: unknown) {
    const alvo = String(entrada);
    buscas.push(alvo);
    if (alvo.endsWith("/cart.js")) {
      return responder({ token: "c1", attributes: {}, items: opcoes.itens ?? [] });
    }
    if (alvo.endsWith("/cart/update.js")) return responder({ token: "c1", attributes: {} });
    if (alvo.includes("/cart/change")) {
      return responder({ token: "c1", attributes: {}, items: opcoes.itensDepoisDeMudar ?? [] }, JSON_);
    }
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
      getAttribute: (n: string) =>
        n === "data-xcart-store"
          ? STORE
          : n === "data-xcart-remarketing"
            ? (opcoes.remarketing ?? null)
            : null,
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

  /** O XHR de tema jQuery ($.post): so open, ouvinte de load e send. */
  class XhrFalso {
    url = "";
    status = 0;
    responseType = "";
    responseText = "";
    ouvintes: (() => void)[] = [];
    open(_metodo: string, url: string) {
      this.url = url;
    }
    addEventListener(ev: string, fn: () => void) {
      if (ev === "load") this.ouvintes.push(fn);
    }
    send() {
      buscas.push(`xhr:${this.url}`);
      this.status = 200;
      this.responseText = this.url.includes("/cart/change")
        ? JSON.stringify({ token: "c1", items: opcoes.itensDepoisDeMudar ?? [] })
        : JSON.stringify({ id: 1 });
      for (const fn of this.ouvintes) fn.call(this);
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
    XMLHttpRequest: XhrFalso,
    URL,
    URLSearchParams,
    AbortController,
    fetch,
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener: () => {},
    Shopify: {
      shop: SHOP,
      routes: { root: "/" },
      ...(opcoes.privacidade === undefined
        ? {}
        : { customerPrivacy: { marketingAllowed: () => opcoes.privacidade } }),
    },
    ShopifyAnalytics: {
      meta: { product: { id: 7, variants: [{ id: 11, sku: "S", price: 1000 }] } },
      ...(opcoes.clientId
        ? { lib: { user: () => ({ traits: () => ({ uniqToken: opcoes.clientId }) }) } }
        : {}),
    },
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
    /** O tema mudando o carrinho (tirar item, quantidade) pelo fetch dele. */
    mudarCarrinho: () => (ctx.fetch as typeof fetch)("/cart/change.js"),
    /** O mesmo, por XHR: tema jQuery com $.post('/cart/change.js'). */
    mudarCarrinhoPorXhr: () => {
      const x = new (ctx.XMLHttpRequest as typeof XhrFalso)();
      x.open("POST", "/cart/change.js");
      x.send();
    },
    clicarCheckout: () =>
      ouvintes.click?.forEach((fn) =>
        fn({ target: { closest: (sel: string) => (sel === '[name="checkout"]' ? {} : null) } })
      ),
    /**
     * Clique visto do document: `composedPath` do elemento mais de dentro que
     * o document enxerga ate o window. Com shadow fechado o primeiro e o
     * hospedeiro; o resto e o DOM normal da pagina.
     */
    clicarExpresso: (caminho: ElementoFalso[]) =>
      ouvintes.click?.forEach((fn) =>
        fn({
          target: caminho[0],
          composedPath: () => [...caminho, { nodeType: 9 }, ctx],
        })
      ),
  };
}

type ElementoFalso = {
  nodeType: number;
  matches: (seletor: string) => boolean;
  querySelector: (seletor: string) => { value: string } | null;
};

/**
 * Elemento de mentira que entende o pouco de seletor que o snippet usa: tag,
 * `.classe` e `form[action*="..."]`.
 */
function el(tag: string, attrs: { classe?: string; action?: string; variante?: string } = {}): ElementoFalso {
  return {
    nodeType: 1,
    matches: (seletor) =>
      seletor.split(",").some((bruto) => {
        const s = bruto.trim();
        if (s.startsWith(".")) return (attrs.classe ?? "").split(" ").includes(s.slice(1));
        const m = /^([a-z-]+)\[action\*="([^"]+)"\]$/.exec(s);
        if (m) return m[1] === tag && (attrs.action ?? "").includes(m[2]);
        return s === tag;
      }),
    querySelector: (s) => (s === '[name="id"]' && attrs.variante ? { value: attrs.variante } : null),
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
    expect(sn.camada().filter((a) => a[0] === "event" && a[1] !== "page_view")).toEqual([
      ["event", "view_item", { send_to: "AW-111111111/V1", transaction_id: ver.eventId }],
      ["event", "add_to_cart", { send_to: "AW-111111111/C1", transaction_id: carrinho.eventId }],
      ["event", "add_to_cart", { send_to: "AW-222222222/C2", transaction_id: carrinho.eventId }],
    ]);
    // Config sem page_view automatico: o hit de remarketing sai explicito,
    // com o produto, logo abaixo.
    expect(sn.camada().filter((a) => a[0] === "config")).toEqual([
      ["config", "AW-111111111", { send_page_view: false }],
      ["config", "AW-222222222", { send_page_view: false }],
    ]);
  });

  it("conta cadastrada depois da instalacao ganha remarketing sem reinstalar", async () => {
    // O tema foi instalado sem data-xcart-remarketing; as contas so existem
    // na configuracao. Antes, essas contas ficavam sem remarketing.
    const sn = rodarSnippet({ contas: CONTAS });
    await assentarMuito();
    const hits = sn.camada().filter((a) => a[0] === "event" && a[1] === "page_view");
    expect(hits.map((a) => (a[2] as { send_to: string }).send_to)).toEqual([
      "AW-111111111",
      "AW-222222222",
    ]);
    // Um hit por conta, nao dois.
    sn.adicionar();
    await assentarMuito();
    expect(sn.camada().filter((a) => a[0] === "event" && a[1] === "page_view")).toHaveLength(2);
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

  it("remarketing do tema: consentimento antes do config, sem page_view automatico", async () => {
    const sn = rodarSnippet({ contas: [], remarketing: "AW-333333333", privacidade: false });
    await assentarMuito();
    const l = sn.camada();
    const iConsent = l.findIndex((a) => a[0] === "consent");
    const iConfig = l.findIndex((a) => a[0] === "config");
    expect(iConsent).toBeGreaterThan(-1);
    expect(iConsent).toBeLessThan(iConfig);
    expect(l[iConsent][2]).toMatchObject({ ad_storage: "denied" });
    expect(l.filter((a) => a[0] === "config")).toEqual([
      ["config", "AW-333333333", { send_page_view: false }],
    ]);
    // Um hit so, o explicito, com o tipo da pagina.
    const hits = l.filter((a) => a[0] === "event" && a[1] === "page_view");
    expect(hits).toHaveLength(1);
    expect(hits[0][2]).toMatchObject({ send_to: "AW-333333333", ecomm_pagetype: "product" });
  });

  it("remarketing do tema respeita o modo teste", async () => {
    const sn = rodarSnippet({
      contas: [],
      remarketing: "AW-333333333",
      url: "https://loja.test/products/camisa?xcart_teste=1",
    });
    await assentarMuito();
    expect(sn.scripts).toEqual([]);
    expect(sn.camada()).toEqual([]);
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

// ===========================================================================
// 3c. O snippet do tema: checkout expresso (so o Meta)
//
// Shop Pay, Apple Pay e Google Pay no botao expresso pulam a pagina do
// checkout, onde o Web Pixel roda: o clique e o unico InitiateCheckout que
// existe. Medido na Softnook (04-05/10/2026): as 5 compras por carteira
// expressa, de 8, chegaram sem nenhum.
// ===========================================================================

describe("snippet do tema: checkout expresso", () => {
  const CONTAS = [{ conta: "AW-111111111", labels: { begin_checkout: "IC1" } }];

  // Com shadow fechado, o document so ve o hospedeiro; dele para fora e o DOM
  // normal do tema.
  const naPaginaDoProduto = (variante = "11", primeiro = el("shopify-accelerated-checkout")) => [
    primeiro,
    el("div", { classe: "shopify-payment-button" }),
    el("form", { action: "/cart/add", variante }),
    el("body"),
  ];
  const noCarrinho = () => [
    el("shopify-apple-pay-button"),
    el("shopify-accelerated-checkout-cart"),
    el("div", { classe: "cart__dynamic-checkout-buttons additional-checkout-buttons" }),
    el("form", { action: "/cart" }),
    el("body"),
  ];
  const expressos = (sn: ReturnType<typeof rodarSnippet>) =>
    sn.beacons.filter((b) => b.origem === "expresso");

  it("vai ao coletor marcado, com id por balde, e NAO vai ao Google", async () => {
    // Pixel fora e conta com rotulo: e o caso em que o begin_checkout COMUM
    // iria ao Google. O expresso nao vai nem assim.
    const sn = rodarSnippet({ contas: CONTAS, pixelCobre: "0" });
    await assentarMuito();
    const antes = Date.now();
    sn.clicarExpresso(naPaginaDoProduto());
    await assentarMuito();
    const depois = Date.now();

    const ic = expressos(sn);
    expect(ic).toHaveLength(1);
    expect(ic[0]).toMatchObject({ evento: "begin_checkout", origem: "expresso" });
    const vid = String(ic[0].visitorId);
    expect([idDoCheckoutExpresso(vid, antes), idDoCheckoutExpresso(vid, depois)]).toContain(ic[0].eventId);
    expect(JSON.stringify(ic[0])).not.toMatch(/"value"|"currency"/);
    expect(sn.camada().filter((a) => a[1] === "begin_checkout")).toEqual([]);
    // O mesmo clique nao virou tambem o begin_checkout comum.
    expect(sn.beacons.filter((b) => b.evento === "begin_checkout")).toHaveLength(1);
  });

  it("na pagina de produto, so a variante do formulario -- o expresso pula o carrinho", async () => {
    const sn = rodarSnippet({ itens: [{ id: 999, variant_id: 999, product_id: 9, sku: "X" }] });
    await assentarMuito();
    sn.clicarExpresso(naPaginaDoProduto("11", el("shop-pay-wallet-button")));
    await assentarMuito();
    expect(expressos(sn)[0].produtos).toEqual([{ variante: "11", produto: "7", sku: "S" }]);

    // Formulario de outro produto (compra rapida): o produto da pagina nao e o dele.
    const outro = rodarSnippet({});
    await assentarMuito();
    outro.clicarExpresso(naPaginaDoProduto("22"));
    await assentarMuito();
    expect(expressos(outro)[0].produtos).toEqual([{ variante: "22", produto: null, sku: null }]);
  });

  it("no carrinho, os itens do carrinho -- e a resposta de mudanca atualiza sem buscar de novo", async () => {
    const A = { id: 101, variant_id: 101, product_id: 1, sku: "A" };
    const B = { id: 202, variant_id: 202, product_id: 2, sku: "B" };
    const sn = rodarSnippet({ url: "https://loja.test/cart", itens: [A, B] });
    await assentarMuito();
    sn.clicarExpresso(noCarrinho());
    await assentarMuito();
    expect(expressos(sn)[0].produtos).toEqual([
      { variante: "101", produto: "1", sku: "A" },
      { variante: "202", produto: "2", sku: "B" },
    ]);

    const tirou = rodarSnippet({ url: "https://loja.test/cart", itens: [A, B], itensDepoisDeMudar: [B] });
    await assentarMuito();
    tirou.mudarCarrinho();
    await assentarMuito();
    const leituras = tirou.buscas.filter((b) => b.endsWith("/cart.js")).length;
    tirou.clicarExpresso(noCarrinho());
    await assentarMuito();
    expect(expressos(tirou)[0].produtos).toEqual([{ variante: "202", produto: "2", sku: "B" }]);
    expect(tirou.buscas.filter((b) => b.endsWith("/cart.js"))).toHaveLength(leituras);
  });

  it("cliques repetidos no mesmo balde viram um so", async () => {
    const sn = rodarSnippet({});
    await assentarMuito();
    sn.clicarExpresso(naPaginaDoProduto());
    sn.clicarExpresso(naPaginaDoProduto());
    sn.clicarExpresso(noCarrinho());
    await assentarMuito();
    expect(expressos(sn)).toHaveLength(1);
  });

  /**
   * O "Comprar agora" sem marca e o "Mais opcoes de pagamento" levam ao
   * checkout NORMAL, onde o pixel manda o begin_checkout dele. Sairem daqui
   * tambem seria um IC a mais.
   */
  it("Comprar agora sem marca e Mais opcoes nao disparam pelo seletor", async () => {
    const sn = rodarSnippet({});
    await assentarMuito();
    const dinamico = el("div", { classe: "shopify-payment-button" });
    const form = el("form", { action: "/cart/add", variante: "11" });
    // Tema antigo, botao dinamico sem componente.
    sn.clicarExpresso([
      el("button", { classe: "shopify-payment-button__button shopify-payment-button__button--unbranded" }),
      dinamico,
      form,
    ]);
    sn.clicarExpresso([el("button", { classe: "shopify-payment-button__more-options" }), dinamico, form]);
    // Componente novo com os filhos visiveis: o hospedeiro casa, mas o
    // caminho passa pelo "Comprar agora" ou pelo link de mais opcoes.
    const hospedeiro = el("shopify-accelerated-checkout");
    sn.clicarExpresso([el("button"), el("shopify-buy-it-now-button"), hospedeiro, dinamico, form]);
    sn.clicarExpresso([el("a"), el("more-payment-options-link"), hospedeiro, dinamico, form]);
    await assentarMuito();
    expect(sn.beacons.filter((b) => b.evento === "begin_checkout")).toEqual([]);

    // O botao da CARTEIRA no tema antigo continua valendo.
    sn.clicarExpresso([
      el("button", { classe: "shopify-payment-button__button shopify-payment-button__button--branded" }),
      dinamico,
      form,
    ]);
    await assentarMuito();
    expect(expressos(sn)).toHaveLength(1);
  });

  it("o clique comum logo depois do expresso (ou antes) e a mesma acao", async () => {
    const sn = rodarSnippet({});
    await assentarMuito();
    sn.clicarExpresso(naPaginaDoProduto());
    sn.clicarCheckout();
    await assentarMuito();
    expect(sn.beacons.filter((b) => b.evento === "begin_checkout")).toHaveLength(1);
    expect(expressos(sn)).toHaveLength(1);

    const outro = rodarSnippet({});
    await assentarMuito();
    outro.clicarCheckout();
    outro.clicarExpresso(noCarrinho());
    await assentarMuito();
    expect(outro.beacons.filter((b) => b.evento === "begin_checkout")).toHaveLength(1);
    expect(expressos(outro)).toEqual([]);
  });

  it("leva o clientId da Shopify, que o pixel usa para cancelar o expresso", async () => {
    const sn = rodarSnippet({ clientId: "cli-abc" });
    await assentarMuito();
    sn.clicarExpresso(naPaginaDoProduto());
    await assentarMuito();
    expect(expressos(sn)[0]).toMatchObject({ clientId: "cli-abc" });
  });

  it("mudanca do carrinho por XHR (tema jQuery) tambem atualiza os itens", async () => {
    const A = { id: 101, variant_id: 101, product_id: 1, sku: "A" };
    const B = { id: 202, variant_id: 202, product_id: 2, sku: "B" };
    const sn = rodarSnippet({ url: "https://loja.test/cart", itens: [A, B], itensDepoisDeMudar: [B] });
    await assentarMuito();
    sn.mudarCarrinhoPorXhr();
    await assentarMuito();
    const leituras = sn.buscas.filter((b) => b.endsWith("/cart.js")).length;
    sn.clicarExpresso(noCarrinho());
    await assentarMuito();
    expect(expressos(sn)[0].produtos).toEqual([{ variante: "202", produto: "2", sku: "B" }]);
    expect(sn.buscas.filter((b) => b.endsWith("/cart.js"))).toHaveLength(leituras);
  });

  /**
   * Sem a leitura do carrinho, o primeiro formulario da pagina pode ser de
   * upsell ou recomendacao: content_ids errado e pior que nenhum.
   */
  it("no carrinho sem itens conhecidos, vai sem produtos -- nunca o primeiro formulario da pagina", async () => {
    const sn = rodarSnippet({ url: "https://loja.test/cart" });
    await assentarMuito();
    sn.clicarExpresso(noCarrinho());
    await assentarMuito();
    expect(expressos(sn)).toHaveLength(1);
    expect(expressos(sn)[0]).not.toHaveProperty("produtos");
  });

  it("teste e consentimento vao marcados, como nos outros eventos", async () => {
    const sn = rodarSnippet({
      contas: CONTAS,
      pixelCobre: "0",
      url: "https://loja.test/products/camisa?xcart_teste=1",
      privacidade: false,
    });
    await assentarMuito();
    sn.clicarExpresso(naPaginaDoProduto());
    await assentarMuito();
    expect(expressos(sn)[0]).toMatchObject({ teste: true, consentimento: "negado" });
    expect(sn.camada().filter((a) => a[0] === "event")).toEqual([]);
  });

  it("clique fora dos botoes expressos nao dispara; o checkout comum segue sem a marca", async () => {
    const sn = rodarSnippet({});
    await assentarMuito();
    sn.clicarExpresso([el("button", { classe: "product-form__submit" }), el("form", { action: "/cart/add" })]);
    await assentarMuito();
    expect(sn.beacons.some((b) => b.evento === "begin_checkout")).toBe(false);

    sn.clicarCheckout();
    await assentarMuito();
    const comum = sn.beacons.find((b) => b.evento === "begin_checkout")!;
    expect(comum).not.toHaveProperty("origem");
    expect(comum).not.toHaveProperty("produtos");
  });
});
