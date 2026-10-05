import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import {
  ATRASO_CHECKOUT_EXPRESSO_MS,
  idDoCheckoutExpresso,
} from "../src/lib/tracking/eventos";

// ============================================================================
// O coletor e o checkout EXPRESSO: o pixel vence, o clique e so reserva.
//
// Shop Pay, Apple Pay e Google Pay no botao expresso pulam a pagina do
// checkout: o Shop Pay roda em shop.app, a carteira na janela do sistema, e o
// Web Pixel nao roda em nenhum dos dois. Medido na Softnook (04-05/10/2026): de
// 8 compras, as 5 pagas por carteira expressa chegaram sem InitiateCheckout.
//
// Mas o tema nao separa a carteira do "Comprar agora" quando o shadow DOM e
// fechado, e o "Comprar agora" cai no checkout normal, onde o pixel manda o IC
// dele -- mais rico, com e-mail e endereco. O que este arquivo trava, rodando
// o POST de verdade e o drain de verdade contra um banco de mentira:
//
//   1. com o pixel cobrindo, o begin_checkout comum do tema continua suprimido
//      e o expresso entra PENDENTE, com atraso, sem sair na hora;
//   2. o cron so manda depois do atraso, com o event_time do clique;
//   3. o begin_checkout do pixel do mesmo comprador cancela o expresso
//      pendente (pelo visitante do tema ou pelo clientId) e segue normal;
//   4. o expresso nunca cancela nem descarta o do pixel;
//   5. janela DESLIZANTE de 30 min, e nao balde fixo.
// ============================================================================

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "loja.myshopify.com";
const AGORA = Date.parse("2026-10-05T12:07:00Z");
const MIN = 60e3;

interface Linha {
  id: string;
  store_id: string;
  destination: string;
  destination_id: string;
  event_name: string;
  event_id: string;
  visitor_id: string | null;
  shopify_client_id: string | null;
  checkout_token: string | null;
  status: string;
  attempts: number;
  next_attempt_at: string;
  created_at: string;
  sent_at: string | null;
  last_error: string | null;
  response: unknown;
  payload: Record<string, unknown>;
}

const mundo = vi.hoisted(() => ({
  eventos: [] as Linha[],
  /** O que chegou ao Meta, e por onde: na hora (coletor) ou pelo cron. */
  meta: [] as { event_id: string; via: "na hora" | "cron"; payload: Record<string, unknown> }[],
  /** tracking_identities: o que o tema publicou por visitante. */
  identidades: [] as { store_id: string; visitor_id: string; shopify_client_id: string | null }[],
  pixelVistoEm: 0,
  admin: null as unknown,
  // Ganchos para encenar corrida: rodam NO MEIO de uma operacao.
  /** Antes de a fila do coletor gravar a linha deste event_id. */
  antesDeEnfileirar: null as null | ((eventId: string) => Promise<void>),
  /** Depois de o drain ler as pendentes, antes de entregar a primeira. */
  aoLerPendentes: null as null | (() => Promise<void>),
  /** Durante a chamada ao Meta pelo cron. */
  duranteMeta: null as null | (() => Promise<void>),
  /** O que o Meta responde ao cron. null = ok. */
  respostaMeta: null as null | { ok: false; erro: string; podeTentarDeNovo: boolean },
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));

const META = vi.hoisted(() => ({
  id: "dest-meta-0001",
  storeId: "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01",
  plataforma: "meta" as const,
  nome: null,
  conta: "123456",
  labels: {},
  testEventCode: null,
  idTemplate: null,
  ativo: true,
  token: "EAAB",
}));

vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => [META],
  destinoPorId: async () => META,
  destinoAceita: () => true,
  porQueRecusa: () => null,
}));

// O drain de verdade chama isto. Nada sai para a rede.
vi.mock("@/lib/tracking/meta-capi", () => ({
  MAX_TENTATIVAS: 8,
  proximaTentativaEm: () => new Date(Date.now() + 60e3),
  enviarParaMeta: async (_conta: string, _token: string, eventos: Record<string, unknown>[]) => {
    const durante = mundo.duranteMeta;
    mundo.duranteMeta = null;
    if (durante) await durante();
    if (mundo.respostaMeta) return { ...mundo.respostaMeta, corpo: null };
    for (const ev of eventos) {
      mundo.meta.push({ event_id: String(ev.event_id), via: "cron", payload: ev });
    }
    return { ok: true, corpo: {} };
  },
}));

// A fila que o COLETOR usa: a mesma tabela de mentira, com o indice unico por
// (store, destino, event_id). O drain usa a fila de verdade (vi.importActual).
vi.mock("@/lib/tracking/fila", () => ({
  enfileirar: async (
    _admin: unknown,
    e: {
      storeId: string;
      destination: string;
      destinationId: string;
      evento: { event_name: string; event_id: string };
      visitorId: string | null;
      checkoutToken?: string | null;
      payload: Record<string, unknown>;
      proximaTentativaEm?: Date | null;
      shopifyClientId?: string | null;
    }
  ) => {
    const antes = mundo.antesDeEnfileirar;
    if (antes) await antes(e.evento.event_id);
    const repetida = mundo.eventos.some(
      (l) =>
        l.store_id === e.storeId &&
        l.destination_id === e.destinationId &&
        l.event_id === e.evento.event_id
    );
    if (repetida) return { id: null, duplicado: true };
    const id = `l${mundo.eventos.length + 1}`;
    mundo.eventos.push({
      id,
      store_id: e.storeId,
      destination: e.destination,
      destination_id: e.destinationId,
      event_name: e.evento.event_name,
      event_id: e.evento.event_id,
      visitor_id: e.visitorId,
      checkout_token: e.checkoutToken ?? null,
      shopify_client_id: e.shopifyClientId ?? null,
      status: "pendente",
      attempts: 0,
      next_attempt_at: (e.proximaTentativaEm ?? new Date()).toISOString(),
      created_at: new Date().toISOString(),
      sent_at: null,
      last_error: null,
      response: null,
      payload: e.payload,
    });
    return { id, duplicado: false };
  },
  // O envio na hora do coletor: sai e fecha a linha.
  entregar: async (_admin: unknown, l: { id: string }) => {
    const linha = mundo.eventos.find((x) => x.id === l.id)!;
    linha.status = "enviado";
    linha.sent_at = new Date().toISOString();
    mundo.meta.push({ event_id: linha.event_id, via: "na hora", payload: linha.payload });
    return { ok: true };
  },
}));

// O clientId do checkout aponta para o visitante do tema que clicou. O cli-9
// nao tem identidade: so o clientId direto na linha acha o expresso dele.
vi.mock("@/lib/tracking/identidade-do-pedido", () => ({
  ehClientIdSentinela: () => false,
  identidadePorCliente: async (_a: unknown, _s: unknown, clientId: string) =>
    clientId === "cli-1" ? { visitorId: "vid-1" } : null,
}));

type Filtro = { tipo: string; col: string; v: unknown };

/** LIKE do Postgres: % e qualquer sequencia, _ e um caractere. */
function casaLike(texto: unknown, padrao: string): boolean {
  const re = padrao
    .split("")
    .map((c) => (c === "%" ? ".*" : c === "_" ? "." : c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
    .join("");
  return new RegExp(`^${re}$`).test(String(texto ?? ""));
}

function passa(l: Record<string, unknown>, { tipo, col, v }: Filtro): boolean {
  const atual = l[col];
  if (tipo === "eq") return atual === v;
  if (tipo === "in") return (v as unknown[]).includes(atual);
  if (tipo === "gte") return String(atual) >= String(v);
  if (tipo === "lte") return String(atual) <= String(v);
  if (tipo === "like") return casaLike(atual, String(v));
  if (tipo === "not.like") return !casaLike(atual, String(v));
  if (tipo === "not.is") return atual !== null && atual !== undefined;
  if (tipo === "is") return atual === null || atual === undefined;
  return true;
}

/** Banco de mentira: so o que o coletor e o drain consultam neste caminho. */
function bancoFalso() {
  const admin = {
    from(tabela: string) {
      const filtros: Filtro[] = [];
      let op = "select";
      let campos: Record<string, unknown> = {};
      let soContagem = false;
      let umSo = false;
      const b: Record<string, unknown> = {};
      const anota = (tipo: string) => (col: string, v: unknown) => {
        filtros.push({ tipo, col, v });
        return b;
      };
      Object.assign(b, {
        select: (_c?: string, opcoes?: { head?: boolean }) => {
          soContagem = Boolean(opcoes?.head);
          return b;
        },
        update: (c: Record<string, unknown>) => {
          op = "update";
          campos = c;
          return b;
        },
        upsert: () => {
          op = "upsert";
          return b;
        },
        insert: () => {
          op = "insert";
          return b;
        },
        eq: anota("eq"),
        is: anota("is"),
        in: anota("in"),
        gte: anota("gte"),
        lte: anota("lte"),
        like: anota("like"),
        not: (col: string, operador: string, v: unknown) => {
          filtros.push({ tipo: `not.${operador}`, col, v });
          return b;
        },
        order: () => b,
        limit: () => b,
        maybeSingle: () => {
          umSo = true;
          return b;
        },
        then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
          let r: { data: unknown; count?: number } = { data: null };
          if (tabela === "stores") r = { data: [{ id: STORE }] };
          else if (tabela === "tracking_configs" && op === "select") {
            const cfg = {
              store_id: STORE,
              enabled: true,
              web_pixel_visto_em: new Date(mundo.pixelVistoEm).toISOString(),
              web_pixel_com_id_em: new Date(mundo.pixelVistoEm).toISOString(),
              teto_atingido_em: null,
            };
            r = { data: umSo ? cfg : [cfg] };
          } else if (tabela === "tracking_identities" && op === "update") {
            r = { data: [{ id: "i1" }] };
          } else if (tabela === "tracking_identities" && op === "select") {
            const casam = mundo.identidades.filter((l) =>
              filtros.every((f) => passa(l as unknown as Record<string, unknown>, f))
            );
            r = { data: umSo ? (casam[0] ?? null) : casam };
          } else if (tabela === "tracking_events") {
            const casam = mundo.eventos.filter((l) =>
              filtros.every((f) => passa(l as unknown as Record<string, unknown>, f))
            );
            if (op === "update") {
              for (const l of casam) Object.assign(l, campos);
            } else if (op === "select") {
              const linhas = casam.map((l) => ({ ...l }));
              r = {
                data: soContagem ? null : umSo ? (linhas[0] ?? null) : linhas,
                count: casam.length,
              };
              // A leitura do drain: so ela filtra pendente E vencida.
              const doDrain =
                filtros.some((f) => f.tipo === "eq" && f.col === "status" && f.v === "pendente") &&
                filtros.some((f) => f.tipo === "lte" && f.col === "next_attempt_at");
              const gancho = doDrain ? mundo.aoLerPendentes : null;
              if (gancho) {
                mundo.aoLerPendentes = null;
                const pronto = { data: r.data, count: r.count ?? null, error: null };
                return gancho().then(() => pronto).then(ok, erro);
              }
            }
          }
          return Promise.resolve({ data: r.data, count: r.count ?? null, error: null }).then(ok, erro);
        },
      });
      return b;
    },
  };
  mundo.admin = admin;
}

async function postar(corpo: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/tracking/collect/route");
  const { NextRequest } = await import("next/server");
  const r = await POST(
    new NextRequest("https://user.xcart.app/api/tracking/collect", {
      method: "POST",
      body: JSON.stringify({ shop: SHOP, storeId: STORE, ...corpo }),
      headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": "teste" },
    })
  );
  return (await r.json()) as Record<string, unknown>;
}

/** Uma rodada do cron de verdade, no instante pedido. */
async function drenar(emMs: number) {
  vi.setSystemTime(emMs);
  const fila = await vi.importActual<typeof import("../src/lib/tracking/fila")>(
    "../src/lib/tracking/fila"
  );
  return fila.drenarFila();
}

const noMeta = () => mundo.meta.map((m) => m.event_id);
const linha = (eventId: string) => mundo.eventos.find((l) => l.event_id === eventId)!;

const xp = (vid: string, quando = AGORA) => idDoCheckoutExpresso(vid, quando);

/** O clientId que a Shopify manda sem consentimento: o mesmo para todo mundo. */
const ZERADO = "00000000-0000-0000-0000-000000000000";

/**
 * Roda o xcart-pixel.js de verdade num sandbox e devolve o corpo que ele
 * manda ao coletor no checkout_started. `cookies` e o que `browser.cookie.get`
 * responde -- o mesmo caminho do _xc_teste.
 */
async function beaconDoPixel(opcoes: { clientId: string; token: string; cookies: Record<string, string> }) {
  const handlers: Record<string, (e: unknown) => void> = {};
  const beacons: Record<string, unknown>[] = [];
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
      cookie: { get: (nome: string) => Promise.resolve(opcoes.cookies[nome] ?? "") },
    },
    init: { data: { shop: { myshopifyDomain: SHOP } }, customerPrivacy: null },
  };
  const ctx: Record<string, unknown> = {
    ctx: api,
    document: {
      getElementsByTagName: () => [{ src: `https://app.test/xcart-pixel.js?store=${STORE}&shop=${SHOP}` }],
    },
    URL,
    Date,
    JSON,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(readFileSync(join(__dirname, "..", "public", "xcart-pixel.js"), "utf8"), ctx);
  handlers.checkout_started({
    id: "e7",
    clientId: opcoes.clientId,
    data: { checkout: { token: opcoes.token, attributes: [] } },
    context: { document: { location: { href: "https://loja.test/checkouts/x" }, referrer: "" } },
  });
  // As leituras de cookie sao Promise: o evento espera por elas.
  for (let i = 0; i < 10; i++) await Promise.resolve();
  expect(beacons).toHaveLength(1);
  return beacons[0];
}

const DO_TEMA = {
  evento: "begin_checkout",
  eventId: "begin_checkout_vid-1_1",
  visitorId: "vid-1",
  pageUrl: "https://loja.test/products/camisa",
};

const EXPRESSO = {
  ...DO_TEMA,
  eventId: "begin_checkout_xp_vid-1_999",
  origem: "expresso",
  clientId: "cli-1",
  produtos: [{ variante: "11", produto: "7", sku: "S" }, { variante: "12" }],
};

const DO_PIXEL = {
  evento: "begin_checkout",
  fonte: "pixel",
  eventId: "begin_checkout_e1",
  visitorId: "cli-1",
  clientId: "cli-1",
  checkoutToken: "T1",
};

describe("coletor: checkout expresso (o pixel vence)", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    mundo.eventos.length = 0;
    mundo.meta.length = 0;
    mundo.identidades.length = 0;
    mundo.antesDeEnfileirar = null;
    mundo.aoLerPendentes = null;
    mundo.duranteMeta = null;
    mundo.respostaMeta = null;
    // Pixel visto ha 10 min: cobrindo o checkout, sem recarimbar.
    mundo.pixelVistoEm = AGORA - 10 * MIN;
    bancoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pixel cobrindo: o comum segue suprimido; o expresso entra PENDENTE, com atraso, sem sair na hora", async () => {
    expect(await postar(DO_TEMA)).toMatchObject({ ignorado: "checkout coberto pelo Web Pixel" });
    expect(mundo.eventos).toHaveLength(0);

    const r = await postar(EXPRESSO);
    expect(r.destinos).toEqual({ "meta:dest-met": "aguardando o pixel" });
    expect(mundo.eventos).toHaveLength(1);
    const l = mundo.eventos[0];
    expect(l).toMatchObject({
      destination: "meta",
      event_name: "begin_checkout",
      visitor_id: "vid-1",
      shopify_client_id: "cli-1",
      status: "pendente",
      next_attempt_at: new Date(AGORA + ATRASO_CHECKOUT_EXPRESSO_MS).toISOString(),
    });
    expect(ATRASO_CHECKOUT_EXPRESSO_MS).toBe(5 * MIN);
    // O id e o do servidor, por balde -- nao o que o navegador mandou.
    expect(l.event_id).toBe(idDoCheckoutExpresso("vid-1", AGORA));
    expect(l.payload).toMatchObject({
      event_name: "InitiateCheckout",
      event_id: idDoCheckoutExpresso("vid-1", AGORA),
      event_time: Math.floor(AGORA / 1000),
      custom_data: { content_type: "product", content_ids: ["11", "12"] },
    });
    // Valor nunca vem do navegador.
    expect(JSON.stringify(l.payload)).not.toMatch(/"value"|"currency"/);
    // Nada saiu na hora.
    expect(mundo.meta).toEqual([]);
  });

  it("o cron so manda depois do atraso, com o event_time do clique", async () => {
    await postar(EXPRESSO);
    const id = idDoCheckoutExpresso("vid-1", AGORA);

    expect(await drenar(AGORA + 1 * MIN)).toMatchObject({ pegos: 0 });
    expect(mundo.meta).toEqual([]);
    expect(linha(id).status).toBe("pendente");

    expect(await drenar(AGORA + 5 * MIN)).toMatchObject({ pegos: 1, enviados: 1 });
    expect(mundo.meta).toEqual([
      expect.objectContaining({ event_id: id, via: "cron" }),
    ]);
    expect(mundo.meta[0].payload.event_time).toBe(Math.floor(AGORA / 1000));
    expect(linha(id)).toMatchObject({ status: "enviado" });
    expect(linha(id).sent_at).not.toBeNull();
  });

  it("o pixel do mesmo comprador cancela o expresso pendente e segue normalmente", async () => {
    await postar(EXPRESSO);
    // Outro comprador, com expresso proprio: nao e da conta deste pixel.
    await postar({ ...EXPRESSO, visitorId: "vid-2", clientId: "cli-2" });
    vi.setSystemTime(AGORA + 2 * MIN);

    const r = await postar(DO_PIXEL);
    expect(r).not.toHaveProperty("ignorado");
    expect(noMeta()).toEqual(["begin_checkout_ck_T1"]);

    const cancelado = linha(idDoCheckoutExpresso("vid-1", AGORA));
    expect(cancelado).toMatchObject({
      status: "enviado",
      sent_at: null,
      response: { enviado: false, substituido_por: "pixel" },
    });
    expect(cancelado.last_error).toMatch(/cancelado/);
    expect(linha(idDoCheckoutExpresso("vid-2", AGORA)).status).toBe("pendente");

    // O cron depois do atraso: so o expresso do outro comprador sai.
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T1", idDoCheckoutExpresso("vid-2", AGORA)]);
  });

  it("cancela tambem pelo clientId direto, sem identidade do tema", async () => {
    await postar({ ...EXPRESSO, visitorId: "vid-9", clientId: "cli-9" });
    vi.setSystemTime(AGORA + 1 * MIN);
    await postar({ ...DO_PIXEL, visitorId: "cli-9", clientId: "cli-9", checkoutToken: "T9" });

    expect(linha(idDoCheckoutExpresso("vid-9", AGORA))).toMatchObject({
      status: "enviado",
      sent_at: null,
    });
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T9"]);
  });

  it("o expresso nao cancela nem descarta o pixel", async () => {
    // Pixel primeiro: o comprador foi ao checkout normal, voltou e clicou no
    // Shop Pay. A janela acha a linha do pixel pelo clientId.
    await postar(DO_PIXEL);
    vi.setSystemTime(AGORA + 3 * MIN);
    expect(await postar(EXPRESSO)).toMatchObject({
      ignorado: "checkout ja iniciado nos ultimos 30 min",
    });
    expect(mundo.eventos).toHaveLength(1);
    expect(linha("begin_checkout_ck_T1")).toMatchObject({ status: "enviado" });
    expect(linha("begin_checkout_ck_T1").sent_at).not.toBeNull();
  });

  it("expresso que ja saiu nao faz o pixel ser descartado: o IC rico nunca e trocado pelo clique", async () => {
    await postar(EXPRESSO);
    await drenar(AGORA + 5 * MIN);
    vi.setSystemTime(AGORA + 7 * MIN);
    // Antes, a dedupe de 10 min do pixel descartava o checkout_started aqui.
    const r = await postar(DO_PIXEL);
    expect(r).not.toHaveProperty("ignorado");
    expect(noMeta()).toContain("begin_checkout_ck_T1");
  });

  it("janela deslizante de 30 min, e nao balde fixo", async () => {
    const primeiro = Date.parse("2026-10-05T12:29:50Z");
    vi.setSystemTime(primeiro);
    await postar(EXPRESSO);

    // 15 s depois, em outro balde: o balde sozinho deixava passar.
    const segundo = Date.parse("2026-10-05T12:30:05Z");
    expect(idDoCheckoutExpresso("vid-1", segundo)).not.toBe(idDoCheckoutExpresso("vid-1", primeiro));
    vi.setSystemTime(segundo);
    expect(await postar({ ...EXPRESSO, eventId: "outro-id-qualquer" })).toMatchObject({
      ignorado: "checkout ja iniciado nos ultimos 30 min",
    });
    expect(mundo.eventos).toHaveLength(1);

    // Passados os 30 min, e outra tentativa.
    vi.setSystemTime(primeiro + 30 * MIN + 10e3);
    expect(await postar(EXPRESSO)).toMatchObject({ destinos: { "meta:dest-met": "aguardando o pixel" } });
    expect(mundo.eventos).toHaveLength(2);
  });

  it("sem pixel, o clique comum do tema tambem vence o expresso pendente", async () => {
    mundo.pixelVistoEm = AGORA - 8 * 24 * 60 * MIN;
    await postar(EXPRESSO);
    vi.setSystemTime(AGORA + 1 * MIN);
    await postar({ ...DO_TEMA, eventId: "begin_checkout_vid-1_2" });

    expect(noMeta()).toEqual(["begin_checkout_vid-1_2"]);
    expect(linha(idDoCheckoutExpresso("vid-1", AGORA))).toMatchObject({
      status: "enviado",
      sent_at: null,
      response: { enviado: false, substituido_por: "tema" },
    });
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_vid-1_2"]);
  });

  it("marca fora da lista nao fura a supressao", async () => {
    for (const origem of ["Expresso", "qualquer", "", 1]) {
      expect(await postar({ ...DO_TEMA, origem })).toMatchObject({
        ignorado: "checkout coberto pelo Web Pixel",
      });
    }
    expect(mundo.eventos).toHaveLength(0);
  });

  it("a marca e a lista de itens so valem no begin_checkout do tema", async () => {
    // Em outro evento a marca nao muda o id, e a lista nao anexa content_ids.
    await postar({
      evento: "add_to_cart",
      eventId: "add_to_cart_vid-1_5",
      visitorId: "vid-1",
      origem: "expresso",
      produto: { variante: "11" },
      produtos: [{ variante: "91" }, { variante: "92" }],
    });
    expect(mundo.eventos.map((l) => l.event_id)).toEqual(["add_to_cart_vid-1_5"]);
    expect(mundo.eventos[0].payload).toMatchObject({ custom_data: { content_ids: ["11"] } });
    expect(mundo.eventos[0].next_attempt_at).toBe(new Date(AGORA).toISOString());
    // No pixel tambem nao: o id continua o do checkout, e sai na hora.
    await postar({ ...DO_PIXEL, origem: "expresso" });
    expect(mundo.eventos.map((l) => l.event_id)).toContain("begin_checkout_ck_T1");
    expect(noMeta()).toContain("begin_checkout_ck_T1");
  });

  it("sem o expresso antes, o checkout_started do pixel conta normalmente", async () => {
    const r = await postar(DO_PIXEL);
    expect(r).toMatchObject({ ok: true });
    expect(r).not.toHaveProperty("ignorado");
    expect(noMeta()).toEqual(["begin_checkout_ck_T1"]);
  });

  // ---- sem clientId: o _xc_vid que o pixel le do cookie --------------------

  it("pixel com clientId zerado cancela o expresso pelo _xc_vid", async () => {
    // Sem consentimento: o tema clicou sem clientId e o pixel recebe o zerado.
    const VID = "mg1abc0.k2j3h4x9";
    await postar({ ...EXPRESSO, visitorId: VID, clientId: null });
    expect(linha(xp(VID))).toMatchObject({ status: "pendente", shopify_client_id: null });

    vi.setSystemTime(AGORA + 2 * MIN);
    const corpo = await beaconDoPixel({ clientId: ZERADO, token: "T7", cookies: { _xc_vid: VID } });
    // O pixel anula o zerado e vira o checkout; o cookie e a unica ponte.
    expect(corpo).toMatchObject({ clientId: null, visitorId: "T7", vidDoTema: VID });
    expect(await postar(corpo)).not.toHaveProperty("ignorado");

    expect(linha(xp(VID))).toMatchObject({
      status: "enviado",
      sent_at: null,
      response: { enviado: false, substituido_por: "pixel" },
    });
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T7"]);
  });

  it("sem o cookie, ou com vidDoTema fora do formato, nada cancela -- e o buraco que o _xc_vid fecha", async () => {
    const VID = "mg1abc0.k2j3h4x9";
    await postar({ ...EXPRESSO, visitorId: VID, clientId: null });
    vi.setSystemTime(AGORA + 2 * MIN);
    const semCookie = await beaconDoPixel({ clientId: ZERADO, token: "T7", cookies: {} });
    expect(semCookie).not.toHaveProperty("vidDoTema");
    await postar(semCookie);
    // O pixel le, mas so passa adiante o formato do snippet.
    const lixo = await beaconDoPixel({ clientId: ZERADO, token: "T8", cookies: { _xc_vid: `${VID}; x=1` } });
    expect(lixo).not.toHaveProperty("vidDoTema");
    // E o coletor confere de novo: pixel antigo ou POST forjado.
    const invalidos = [VID.toUpperCase(), `${VID}.x`, `${"a".repeat(40)}.${"b".repeat(40)}`, 7];
    for (const [i, vidDoTema] of invalidos.entries()) {
      const token = `TX${i}`;
      await postar({ ...DO_PIXEL, clientId: null, visitorId: token, checkoutToken: token, vidDoTema });
    }
    // So do pixel: o tema ja manda o visitante como visitorId.
    await postar({ ...DO_TEMA, eventId: "begin_checkout_x_1", visitorId: "outro.vid", vidDoTema: VID });

    expect(linha(xp(VID)).status).toBe("pendente");
  });

  // ---- janela sem clientId no corpo -----------------------------------------

  it("clique sem clientId: a janela resolve o clientId pela identidade do tema", async () => {
    // O comprador foi ao checkout normal (linha do pixel com visitor_id =
    // clientId), voltou e tocou no Apple Pay numa pagina em que o trekkie
    // ainda nao tinha carregado.
    mundo.identidades.push({ store_id: STORE, visitor_id: "vid-5", shopify_client_id: "cli-5" });
    await postar({ ...DO_PIXEL, visitorId: "cli-5", clientId: "cli-5", checkoutToken: "T5" });
    vi.setSystemTime(AGORA + 3 * MIN);
    expect(await postar({ ...EXPRESSO, visitorId: "vid-5", clientId: null })).toMatchObject({
      ignorado: "checkout ja iniciado nos ultimos 30 min",
    });
    expect(mundo.eventos.map((l) => l.event_id)).toEqual(["begin_checkout_ck_T5"]);
  });

  it("grava o clientId resolvido na linha, e o pixel cancela por ele", async () => {
    mundo.identidades.push({ store_id: STORE, visitor_id: "vid-6", shopify_client_id: "cli-6" });
    await postar({ ...EXPRESSO, visitorId: "vid-6", clientId: null });
    expect(linha(xp("vid-6")).shopify_client_id).toBe("cli-6");

    // cli-6 nao tem identidade por clientId no mock: so a coluna acha.
    vi.setSystemTime(AGORA + 1 * MIN);
    await postar({ ...DO_PIXEL, visitorId: "cli-6", clientId: "cli-6", checkoutToken: "T6" });
    expect(linha(xp("vid-6"))).toMatchObject({ status: "enviado", sent_at: null });
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T6"]);
  });

  // ---- corrida: escreve primeiro, confere depois ----------------------------

  it("corrida: o pixel inteiro entre a janela e o INSERT do expresso -- o expresso se fecha", async () => {
    // O expresso ja passou pela janela (nada do pixel ainda); o pixel grava e
    // cancela antes de a linha do expresso existir.
    mundo.antesDeEnfileirar = async (eventId) => {
      if (!eventId.startsWith("begin_checkout_xp_")) return;
      mundo.antesDeEnfileirar = null;
      await postar(DO_PIXEL);
    };
    const r = await postar(EXPRESSO);
    expect(r.destinos).toEqual({ "meta:dest-met": "cancelado: checkout ja iniciado" });
    expect(linha(xp("vid-1"))).toMatchObject({
      status: "enviado",
      sent_at: null,
      response: { enviado: false, substituido_por: "pixel" },
    });
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T1"]);
  });

  it("corrida: o expresso inteiro entre a janela do pixel e o INSERT dele -- o pixel cancela depois de gravar", async () => {
    // O pixel chega primeiro, mas o INSERT dele demora: o expresso entra,
    // confere, nao ve nada e fica pendente. Cancelar ANTES de gravar (como era)
    // nao achava o expresso, e saiam os dois.
    mundo.antesDeEnfileirar = async (eventId) => {
      if (eventId !== "begin_checkout_ck_T1") return;
      mundo.antesDeEnfileirar = null;
      await postar(EXPRESSO);
      expect(linha(xp("vid-1")).status).toBe("pendente");
    };
    await postar(DO_PIXEL);
    expect(linha(xp("vid-1"))).toMatchObject({ status: "enviado", sent_at: null });
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T1"]);
  });

  it("begin_checkout do pixel que termina duplicado nao cancela a reserva", async () => {
    // Checkout T1 aberto ha 40 min (fora da janela); o comprador toca no Shop
    // Pay agora, e o checkout T1 recarrega: o mesmo id, nada sai.
    vi.setSystemTime(AGORA - 40 * MIN);
    await postar(DO_PIXEL);
    vi.setSystemTime(AGORA);
    await postar(EXPRESSO);
    vi.setSystemTime(AGORA + 1 * MIN);
    expect((await postar(DO_PIXEL)).destinos).toEqual({ "meta:dest-met": "duplicado" });

    expect(linha(xp("vid-1")).status).toBe("pendente");
    await drenar(AGORA + 6 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T1", xp("vid-1")]);
  });

  // ---- o drain nao manda nem ressuscita o cancelado --------------------------

  it("cancelado entre a leitura do cron e o envio nao sai", async () => {
    await postar(EXPRESSO);
    // O drain leu a linha pendente; o pixel chega antes de ela ser entregue.
    mundo.aoLerPendentes = () => postar(DO_PIXEL).then(() => undefined);
    expect(await drenar(AGORA + 5 * MIN)).toMatchObject({ pegos: 1, enviados: 0 });
    expect(noMeta()).toEqual(["begin_checkout_ck_T1"]);
    expect(linha(xp("vid-1"))).toMatchObject({
      status: "enviado",
      sent_at: null,
      response: { enviado: false, substituido_por: "pixel" },
    });
  });

  it("erro retentavel do Meta nao devolve a pendente a linha cancelada durante a chamada", async () => {
    await postar(EXPRESSO);
    mundo.duranteMeta = () => postar(DO_PIXEL).then(() => undefined);
    mundo.respostaMeta = { ok: false, erro: "limite de taxa", podeTentarDeNovo: true };
    await drenar(AGORA + 5 * MIN);
    expect(linha(xp("vid-1"))).toMatchObject({
      status: "enviado",
      sent_at: null,
      attempts: 0,
      response: { enviado: false, substituido_por: "pixel" },
    });

    // Antes, a falha a punha de volta em 'pendente' e a rodada seguinte mandava.
    mundo.respostaMeta = null;
    await drenar(AGORA + 10 * MIN);
    expect(noMeta()).toEqual(["begin_checkout_ck_T1"]);
  });

  it("sucesso do Meta nao grava por cima do cancelamento feito durante a chamada", async () => {
    await postar(EXPRESSO);
    mundo.duranteMeta = () => postar(DO_PIXEL).then(() => undefined);
    await drenar(AGORA + 5 * MIN);
    expect(linha(xp("vid-1"))).toMatchObject({
      status: "enviado",
      sent_at: null,
      response: { enviado: false, substituido_por: "pixel" },
    });
  });
});
