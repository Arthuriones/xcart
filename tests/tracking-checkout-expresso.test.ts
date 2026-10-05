import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  pixelVistoEm: 0,
  admin: null as unknown,
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
      payload: Record<string, unknown>;
      proximaTentativaEm?: Date | null;
      shopifyClientId?: string | null;
    }
  ) => {
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
          } else if (tabela === "tracking_events") {
            const casam = mundo.eventos.filter((l) =>
              filtros.every((f) => passa(l as unknown as Record<string, unknown>, f))
            );
            if (op === "update") {
              for (const l of casam) Object.assign(l, campos);
            } else if (op === "select") {
              r = { data: soContagem ? null : casam.map((l) => ({ ...l })), count: casam.length };
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
});
