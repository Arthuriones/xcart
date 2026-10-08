import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// O funil da rota e os carrinhos de 30 dias do console contam pelo indice
// (head: true). Baixar as linhas cortava em 1000 (o max-rows do PostgREST),
// e o fake corta do mesmo jeito: com 1500 carrinhos o numero tem que ser 1500.

vi.mock("server-only", () => ({}));

let banco: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => banco.client }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));

const { lerFunilDaRota } = await import("@/lib/leitura/funil-rota");
const { getRouteGraph } = await import("@/lib/checkout-routes/graph");

const AGORA = Date.parse("2026-10-08T12:00:00Z");
const HORA = 3_600_000;
const ha = (h: number) => new Date(AGORA - h * HORA).toISOString();

type Linha = Record<string, unknown>;

function eventos(n: number, reason: string, horas: (i: number) => number): Linha[] {
  return Array.from({ length: n }, (_, i) => ({ id: `${reason}-${i}`, route_config_id: "rota-1", reason, created_at: ha(horas(i)) }));
}

function cenario(over: { pedidosSettings?: Linha; vitrineSettings?: Linha } = {}) {
  banco = fakeSupabase({
    routed_checkout_configs: [
      {
        id: "rota-1",
        user_id: "u1",
        name: "NORAH -> NORAH OUTLET",
        enabled: true,
        mode: "enterprise_static",
        rotation: null,
        public_token: "tok",
        source_store_id: "vit",
        target_store_id: "chk",
        sku_map: {},
        settings: {
          webhook_vitrine: { em: ha(1), estado: "inscrito", desde: ha(24 * 30) },
          ...over.vitrineSettings,
        },
        created_at: "2026-09-01T00:00:00Z",
      },
    ],
    routed_checkout_targets: [
      {
        id: "t1",
        route_id: "rota-1",
        target_store_id: "chk",
        enabled: true,
        weight: 1,
        position: 0,
        sku_map: {},
        settings: { webhook_pedidos: { em: ha(1), estado: "inscrito", desde: ha(24 * 30) }, ...over.pedidosSettings },
      },
    ],
    stores: [
      { id: "vit", user_id: "u1", name: "NORAH", shop_domain: "r0pxre-p6.myshopify.com", created_at: "1" },
      { id: "chk", user_id: "u1", name: "NORAH OUTLET", shop_domain: "tdicbr-3u.myshopify.com", created_at: "2" },
    ],
    routed_checkout_fallbacks: [
      ...eventos(1500, "routed_ok", (i) => (i % 150) + 1),
      ...eventos(200, "routed_ok", () => 24 * 10),
      ...eventos(14, "cart_checkout_error", () => 5),
      ...eventos(4, "checkout_na_vitrine", () => 3),
      ...eventos(2, "checkout_na_vitrine", () => 24 * 9),
      ...eventos(3000, "loader_ready", () => 2),
    ],
    routed_checkout_orders: [
      ...Array.from({ length: 1200 }, (_, i) => ({ store_id: "chk", order_id: String(i), created_at: ha((i % 100) + 1) })),
      { store_id: "outra", order_id: "x", created_at: ha(1) },
      { store_id: "chk", order_id: "velho", created_at: ha(24 * 8) },
    ],
  });
}

beforeEach(() => cenario());

describe("funil da rota (7 dias)", () => {
  it("conta tudo, sem o corte de 1000 linhas", async () => {
    const f = await lerFunilDaRota("rota-1", AGORA);
    expect(f?.roteados).toBe(1500);
    expect(f?.escapes).toEqual({ tipo: "contando", n: 4, desde: null });
    expect(f?.totalErros).toBe(14);
    expect(f?.pedidos).toMatchObject({ tipo: "contando", n: 1200, conversao: 80 });
  });

  it("loja de checkout sem o aviso: sem contagem de pedidos, com o nome dela", async () => {
    cenario({ pedidosSettings: { webhook_pedidos: { em: ha(1), estado: "sem_permissao", motivo: "falta read_orders" } } });
    const f = await lerFunilDaRota("rota-1", AGORA);
    expect(f?.pedidos).toEqual({ tipo: "sem_aviso", lojas: [{ nome: "NORAH OUTLET", motivo: "falta read_orders" }] });
    expect(f?.roteados).toBe(1500);
  });

  it("aviso de pedidos ligado ha 2 dias: pedidos e carrinhos da mesma janela", async () => {
    cenario({ pedidosSettings: { webhook_pedidos: { em: ha(1), estado: "inscrito", desde: ha(48) } } });
    const f = await lerFunilDaRota("rota-1", AGORA);
    // Pedidos de 1 a 48 h atras (o resto da centena e anterior a inscricao).
    const pedidos = Array.from({ length: 1200 }, (_, i) => (i % 100) + 1).filter((h) => h <= 48).length;
    const carrinhos = Array.from({ length: 1500 }, (_, i) => (i % 150) + 1).filter((h) => h <= 48).length;
    expect(f?.pedidos).toMatchObject({
      tipo: "contando",
      n: pedidos,
      desde: ha(48),
      conversao: Math.round((pedidos / carrinhos) * 1000) / 10,
    });
  });

  it("rota de outro dono: nada", async () => {
    (banco.tabelas.routed_checkout_configs[0] as Linha).user_id = "outro";
    expect(await lerFunilDaRota("rota-1", AGORA)).toBeNull();
  });
});

describe("carrinhos de 30 dias do console", () => {
  it("a contagem passa de 1000", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    try {
      const grafo = await getRouteGraph();
      expect(grafo.routes[0].routedCount30d).toBe(1700);
    } finally {
      vi.useRealTimers();
    }
  });
});
