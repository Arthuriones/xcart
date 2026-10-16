import { beforeEach, describe, expect, it, vi } from "vitest";
import { mapearOrigem, type NoPedidoShopify } from "../src/lib/financeiro/mapear-pedido";

// ============================================================================
// O sync de pedidos grava a origem (071) de carona -- e NUNCA para por ela:
//   - loja que recusa a jornada do cliente: o sync segue sem a origem;
//   - sem a tabela (071 por aplicar): a foto financeira sai igual;
//   - a passada unica dos 60 dias anda por rodadas e carimba o fim.
// ============================================================================

const mundo = vi.hoisted(() => ({
  negarJornada: false,
  semTabela: false,
  consultas: [] as string[],
  finOrders: [] as Record<string, unknown>[],
  origens: [] as Record<string, unknown>[],
  estado: [] as Record<string, unknown>[],
  paginas: [] as unknown[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/shopify/client", () => ({
  shopifyGraphQL: async (_c: unknown, query: string) => {
    mundo.consultas.push(query.includes("FinOrigens") ? "origens" : query.includes("customerJourneySummary") ? "com" : "sem");
    if (mundo.negarJornada && query.includes("customerJourneySummary")) {
      throw new Error(
        'Shopify GraphQL error: [{"message":"Access denied for customerJourneySummary field.","extensions":{"code":"ACCESS_DENIED"}}]'
      );
    }
    return mundo.paginas.shift();
  },
}));

const STORE = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const LOJA = {
  id: STORE,
  user_id: USER,
  shop_domain: "kphigm-76.myshopify.com",
  client_id: "c",
  client_secret: "s",
  access_token: "t",
};
const CAMP = "120252293723770706";
const AGORA = new Date();
const criado = (h: number) => new Date(AGORA.getTime() - h * 36e5).toISOString();

function no(id: number, extra: Partial<NoPedidoShopify> = {}): NoPedidoShopify {
  return {
    id: `gid://shopify/Order/${id}`,
    name: `#${id}`,
    createdAt: criado(2),
    processedAt: criado(2),
    updatedAt: criado(1),
    test: false,
    sourceName: "web",
    currencyCode: "USD",
    totalPriceSet: { shopMoney: { amount: "50.00" } },
    lineItems: { nodes: [] },
    customAttributes: [{ key: "Email", value: "ana@exemplo.com" }],
    customerJourneySummary: {
      ready: true,
      lastVisit: {
        occurredAt: criado(3),
        landingPage: "https://softnook.shop/products/blanket?fbclid=x",
        utmParameters: { source: "fb", medium: "paid", campaign: CAMP, content: "120252293729160706", term: "120252293728570706" },
      },
    },
    ...extra,
  };
}

function pagina(nos: NoPedidoShopify[]) {
  return { shop: { ianaTimezone: "America/Chicago", currencyCode: "USD" }, orders: { pageInfo: { hasNextPage: false }, nodes: nos } };
}

function adminFalso() {
  return {
    from(tabela: string) {
      let op = "select";
      let valor: unknown = null;
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        eq: () => b,
        in: () => b,
        upsert: (v: unknown) => ((op = "upsert"), (valor = v), b),
        update: (v: unknown) => ((op = "update"), (valor = v), b),
        then: (ok: (r: unknown) => unknown) => {
          const data: unknown = [];
          let error: { code?: string; message: string } | null = null;
          if (tabela === "fin_order_origem" && mundo.semTabela) {
            error = { code: "PGRST205", message: "Could not find the table 'public.fin_order_origem' in the schema cache" };
          } else if (tabela === "fin_orders" && op === "upsert") {
            mundo.finOrders.push(...(valor as Record<string, unknown>[]));
          } else if (tabela === "fin_order_origem" && op === "upsert") {
            mundo.origens.push(...(valor as Record<string, unknown>[]));
          } else if (tabela === "fin_sync_state" && op === "update") {
            mundo.estado.push(valor as Record<string, unknown>);
          }
          return Promise.resolve({ data, error }).then(ok);
        },
      });
      return b;
    },
  };
}

beforeEach(() => {
  mundo.negarJornada = false;
  mundo.semTabela = false;
  mundo.consultas.length = 0;
  mundo.finOrders.length = 0;
  mundo.origens.length = 0;
  mundo.estado.length = 0;
  mundo.paginas.length = 0;
});

describe("mapearOrigem (sync)", () => {
  it("pedido com jornada: a linha com os ids, sem nada da nota", () => {
    const l = mapearOrigem(no(42), { storeId: STORE, userId: USER });
    expect(l).toMatchObject({ store_id: STORE, user_id: USER, shopify_order_id: "42", fonte: "jornada", campanha_id: CAMP });
    expect(JSON.stringify(l)).not.toContain("ana@exemplo.com");
  });

  it("teste, PDV, draft e valor zero: sem origem (a regra do webhook)", () => {
    const ctx = { storeId: STORE, userId: USER };
    expect(mapearOrigem(no(1, { test: true }), ctx)).toBeNull();
    expect(mapearOrigem(no(2, { sourceName: "pos" }), ctx)).toBeNull();
    expect(mapearOrigem(no(3, { sourceName: "shopify_draft_order" }), ctx)).toBeNull();
    expect(mapearOrigem(no(4, { totalPriceSet: { shopMoney: { amount: "0.00" } } }), ctx)).toBeNull();
  });
});

describe("sincronizarLoja com a origem de carona", () => {
  it("grava a foto e a origem do pedido", async () => {
    const { sincronizarLoja } = await import("../src/lib/financeiro/shopify-pedidos");
    mundo.paginas.push(pagina([no(42)]));
    const r = await sincronizarLoja(adminFalso() as never, LOJA, null);
    expect(r).toMatchObject({ pedidos: 1, terminou: true, comOrigem: true });
    expect(mundo.consultas).toEqual(["com"]);
    expect(mundo.finOrders).toHaveLength(1);
    expect(mundo.origens).toEqual([expect.objectContaining({ shopify_order_id: "42", campanha_id: CAMP })]);
  });

  it("loja que recusa a jornada: o sync segue sem a origem", async () => {
    const { sincronizarLoja } = await import("../src/lib/financeiro/shopify-pedidos");
    mundo.negarJornada = true;
    mundo.paginas.push(pagina([no(42)]));
    const r = await sincronizarLoja(adminFalso() as never, LOJA, null);
    expect(r).toMatchObject({ pedidos: 1, comOrigem: false });
    expect(mundo.consultas).toEqual(["com", "sem"]);
    expect(mundo.finOrders).toHaveLength(1);
    expect(mundo.origens).toHaveLength(0);
  });

  it("sem a 071: a foto financeira sai igual", async () => {
    const { sincronizarLoja } = await import("../src/lib/financeiro/shopify-pedidos");
    mundo.semTabela = true;
    mundo.paginas.push(pagina([no(42)]));
    const r = await sincronizarLoja(adminFalso() as never, LOJA, null);
    expect(r).toMatchObject({ pedidos: 1, comOrigem: false });
    expect(mundo.finOrders).toHaveLength(1);
  });
});

describe("recuperacao dos 60 dias", () => {
  const estado = (extra: Record<string, unknown> = {}) =>
    ({ store_id: STORE, user_id: USER, origem_backfill_em: null, origem_backfill_ate: null, ...extra }) as never;

  it("le os pedidos criados, grava a origem, anda e carimba o fim", async () => {
    const { recuperarOrigens } = await import("../src/lib/financeiro/shopify-pedidos");
    mundo.paginas.push({ orders: { pageInfo: { hasNextPage: false }, nodes: [no(42), no(41, { createdAt: criado(30) })] } });
    const r = await recuperarOrigens(adminFalso() as never, LOJA, estado());
    expect(r).toEqual({ pedidos: 2, terminou: true });
    expect(mundo.consultas).toEqual(["origens"]);
    expect(mundo.origens.map((o) => o.shopify_order_id).sort()).toEqual(["41", "42"]);
    expect(mundo.estado[0]).toEqual({ origem_backfill_ate: criado(30) });
    expect(mundo.estado[1]).toHaveProperty("origem_backfill_em");
  });

  it("loja que recusa a jornada: encerra, em vez de tentar a cada 15 min", async () => {
    const { recuperarOrigens } = await import("../src/lib/financeiro/shopify-pedidos");
    mundo.negarJornada = true;
    expect(await recuperarOrigens(adminFalso() as never, LOJA, estado())).toBeNull();
    expect(mundo.estado).toEqual([{ origem_backfill_em: expect.any(String) }]);
  });

  it("ja feita, ou sem a 071 (sem a coluna): nao roda", async () => {
    const { recuperarOrigens } = await import("../src/lib/financeiro/shopify-pedidos");
    expect(await recuperarOrigens(adminFalso() as never, LOJA, estado({ origem_backfill_em: criado(1) }))).toBeNull();
    expect(await recuperarOrigens(adminFalso() as never, LOJA, { store_id: STORE } as never)).toBeNull();
    expect(mundo.consultas).toEqual([]);
  });
});
