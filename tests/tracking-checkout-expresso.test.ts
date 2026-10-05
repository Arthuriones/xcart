import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { idDoCheckoutExpresso } from "../src/lib/tracking/eventos";

// ============================================================================
// O coletor e o checkout EXPRESSO.
//
// Shop Pay, Apple Pay e Google Pay no botao expresso pulam a pagina do
// checkout: o Shop Pay roda em shop.app, a carteira na janela do sistema, e o
// Web Pixel nao roda em nenhum dos dois. Medido na Softnook (04-05/10/2026): de
// 8 compras, as 5 pagas por carteira expressa chegaram sem InitiateCheckout.
//
// O snippet do tema manda o clique com `origem: "expresso"`. O que este arquivo
// trava, rodando o POST de verdade contra um banco de mentira:
//
//   1. com o pixel cobrindo, o begin_checkout comum do tema continua suprimido
//      e o expresso PASSA;
//   2. a marca e lista fechada, e o id e refeito no servidor por balde;
//   3. o expresso que cai no checkout normal nao vira dois: a dedupe do pixel
//      (10 min, mesmo visitante) enxerga a linha dele.
// ============================================================================

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "loja.myshopify.com";
const AGORA = Date.parse("2026-10-05T12:07:00Z");

interface Linha {
  store_id: string;
  destination_id: string;
  event_name: string;
  event_id: string;
  visitor_id: string | null;
  created_at: string;
  payload: Record<string, unknown>;
}

const mundo = vi.hoisted(() => ({
  eventos: [] as Linha[],
  admin: null as unknown,
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));

const META = {
  id: "dest-meta-0001",
  storeId: STORE,
  plataforma: "meta" as const,
  nome: null,
  conta: "123456",
  labels: {},
  testEventCode: null,
  idTemplate: null,
  ativo: true,
  token: "EAAB",
};

vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => [META],
  destinoAceita: () => true,
}));

// A fila de verdade grava em tracking_events com indice unico por
// (store, destino, event_id). Aqui, a mesma regra numa lista.
vi.mock("@/lib/tracking/fila", () => ({
  enfileirar: async (
    _admin: unknown,
    e: {
      storeId: string;
      destinationId: string;
      evento: { event_name: string; event_id: string };
      visitorId: string | null;
      payload: Record<string, unknown>;
    }
  ) => {
    const repetida = mundo.eventos.some(
      (l) =>
        l.store_id === e.storeId &&
        l.destination_id === e.destinationId &&
        l.event_id === e.evento.event_id
    );
    if (repetida) return { id: null, duplicado: true };
    mundo.eventos.push({
      store_id: e.storeId,
      destination_id: e.destinationId,
      event_name: e.evento.event_name,
      event_id: e.evento.event_id,
      visitor_id: e.visitorId,
      created_at: new Date().toISOString(),
      payload: e.payload,
    });
    return { id: `l${mundo.eventos.length}`, duplicado: false };
  },
  entregar: async () => ({ ok: true }),
}));

// O clientId do checkout aponta para o visitante do tema que clicou.
vi.mock("@/lib/tracking/identidade-do-pedido", () => ({
  ehClientIdSentinela: () => false,
  identidadePorCliente: async (_a: unknown, _s: unknown, clientId: string) =>
    clientId === "cli-1" ? { visitorId: "vid-1" } : null,
}));

type Filtro = [string, string, unknown];

/** Banco de mentira: so o que o coletor consulta neste caminho. */
function bancoFalso() {
  const admin = {
    from(tabela: string) {
      const filtros: Filtro[] = [];
      let op = "select";
      const b: Record<string, unknown> = {};
      const anota = (tipo: string) => (col: string, v: unknown) => {
        filtros.push([tipo, col, v]);
        return b;
      };
      Object.assign(b, {
        select: () => b,
        update: () => {
          op = "update";
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
        not: anota("not"),
        order: () => b,
        limit: () => b,
        then: (ok: (v: unknown) => unknown, erro: (e: unknown) => unknown) => {
          let r: { data: unknown; count?: number } = { data: null };
          if (tabela === "stores") r = { data: [{ id: STORE }] };
          else if (tabela === "tracking_configs" && op === "select") {
            r = {
              data: [
                {
                  store_id: STORE,
                  enabled: true,
                  // Pixel visto ha 10 min: cobrindo o checkout, sem recarimbar.
                  web_pixel_visto_em: new Date(AGORA - 10 * 60e3).toISOString(),
                  web_pixel_com_id_em: new Date(AGORA - 10 * 60e3).toISOString(),
                  teto_atingido_em: null,
                },
              ],
            };
          } else if (tabela === "tracking_identities" && op === "update") {
            r = { data: [{ id: "i1" }] };
          } else if (tabela === "tracking_events" && op === "select") {
            const casam = mundo.eventos.filter((l) =>
              filtros.every(([tipo, col, v]) => {
                const atual = (l as unknown as Record<string, unknown>)[col];
                if (tipo === "eq") return atual === v;
                if (tipo === "gte") return String(atual) >= String(v);
                if (tipo === "not") return atual !== null && atual !== undefined;
                return true;
              })
            );
            r = { data: null, count: casam.length };
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

const DO_TEMA = {
  evento: "begin_checkout",
  eventId: "begin_checkout_vid-1_1",
  visitorId: "vid-1",
  pageUrl: "https://loja.test/products/camisa",
};

const DO_PIXEL = {
  evento: "begin_checkout",
  fonte: "pixel",
  eventId: "begin_checkout_e1",
  visitorId: "cli-1",
  clientId: "cli-1",
  checkoutToken: "T1",
};

describe("coletor: checkout expresso", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    mundo.eventos.length = 0;
    bancoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("pixel cobrindo: o begin_checkout comum segue suprimido, o expresso passa", async () => {
    expect(await postar(DO_TEMA)).toMatchObject({ ignorado: "checkout coberto pelo Web Pixel" });
    expect(mundo.eventos).toHaveLength(0);

    const r = await postar({
      ...DO_TEMA,
      eventId: "begin_checkout_xp_vid-1_999",
      origem: "expresso",
      produtos: [{ variante: "11", produto: "7", sku: "S" }, { variante: "12" }],
    });
    expect(r).toMatchObject({ ok: true });
    expect(mundo.eventos).toHaveLength(1);
    const linha = mundo.eventos[0];
    expect(linha).toMatchObject({ event_name: "begin_checkout", visitor_id: "vid-1" });
    // O id e o do servidor, por balde -- nao o que o navegador mandou.
    expect(linha.event_id).toBe(idDoCheckoutExpresso("vid-1", AGORA));
    expect(linha.payload).toMatchObject({
      event_name: "InitiateCheckout",
      event_id: idDoCheckoutExpresso("vid-1", AGORA),
      custom_data: { content_type: "product", content_ids: ["11", "12"] },
    });
    // Valor nunca vem do navegador.
    expect(JSON.stringify(linha.payload)).not.toMatch(/"value"|"currency"/);
  });

  it("marca fora da lista nao fura a supressao", async () => {
    for (const origem of ["Expresso", "qualquer", "", 1]) {
      expect(await postar({ ...DO_TEMA, origem })).toMatchObject({
        ignorado: "checkout coberto pelo Web Pixel",
      });
    }
    expect(mundo.eventos).toHaveLength(0);
  });

  it("a marca so vale no begin_checkout do tema", async () => {
    // Em outro evento a marca nao muda o id.
    await postar({ evento: "add_to_cart", eventId: "add_to_cart_vid-1_5", visitorId: "vid-1", origem: "expresso" });
    expect(mundo.eventos.map((l) => l.event_id)).toEqual(["add_to_cart_vid-1_5"]);
    // No pixel tambem nao: o id continua o do checkout.
    await postar({ ...DO_PIXEL, origem: "expresso" });
    expect(mundo.eventos.map((l) => l.event_id)).toContain("begin_checkout_ck_T1");
  });

  it("cliques no mesmo balde viram uma linha, mesmo com id diferente no corpo", async () => {
    await postar({ ...DO_TEMA, eventId: "begin_checkout_xp_vid-1_1", origem: "expresso" });
    vi.setSystemTime(AGORA + 20 * 60e3); // mesmo balde (12:00-12:30)
    const r = await postar({ ...DO_TEMA, eventId: "outro-id-qualquer", origem: "expresso" });
    expect(r.destinos).toEqual({ "meta:dest-met": "duplicado" });
    expect(mundo.eventos).toHaveLength(1);
  });

  it("expresso que cai no checkout normal nao conta dois: a dedupe do pixel enxerga ele", async () => {
    await postar({ ...DO_TEMA, origem: "expresso" });
    vi.setSystemTime(AGORA + 2 * 60e3);
    expect(await postar(DO_PIXEL)).toMatchObject({ ignorado: "checkout ja contado pelo tema" });
    expect(mundo.eventos).toHaveLength(1);
  });

  it("sem o expresso antes, o checkout_started do pixel conta normalmente", async () => {
    const r = await postar(DO_PIXEL);
    expect(r).toMatchObject({ ok: true });
    expect(r).not.toHaveProperty("ignorado");
    expect(mundo.eventos.map((l) => l.event_id)).toEqual(["begin_checkout_ck_T1"]);
  });
});
