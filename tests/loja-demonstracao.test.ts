import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase } from "./_fake-supabase";

// ============================================================================
// Loja de demonstracao (migration 074, src/lib/demonstracao.ts): uma loja com
// dados gravados pelo script, sem Shopify, Meta ou Google por tras. O que
// trava aqui:
//   - a marca e lida com e sem a 074 (coluna ausente = nenhuma loja marcada);
//   - os alertas nao abrem nada para ela (nem com o sync "com erro");
//   - o diagnostico do Rastreamento e o script no tema do Guia respondem pelo
//     banco, sem nenhuma chamada a Shopify;
//   - os nomes de produto de Custos saem do catalogo dela, sem Shopify.
// A loja comum continua indo a Shopify como antes.
// ============================================================================

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  shopify: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/shopify/client", () => ({
  shopifyGraphQL: async (creds: { shopDomain: string }) => {
    mundo.shopify.push(creds.shopDomain);
    throw new Error("Shopify fora do ar no teste");
  },
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => mundo.admin }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => ({ id: "u1" }) }));
vi.mock("@/lib/stores/authorize", () => {
  class NaoAutorizado extends Error {
    status: 401 | 404;
    constructor(m: string, s: 401 | 404) {
      super(m);
      this.status = s;
    }
  }
  return {
    NaoAutorizado,
    exigirLojaDoUsuario: async (id: string) => ({
      id,
      user_id: "u1",
      shop_domain: id === DEMO ? "demo-01.myshopify.com" : "real-01.myshopify.com",
      client_id: "c",
      client_secret: "s",
      access_token: null,
    }),
    credenciaisDe: (l: { shop_domain: string }) => ({ shopDomain: l.shop_domain, clientId: "c", clientSecret: "s" }),
  };
});

const DEMO = "11111111-1111-4111-8111-111111111111";
const REAL = "22222222-2222-4222-8222-222222222222";
const AGORA = Date.parse("2026-10-19T18:00:00Z");
const HORA = 3_600_000;

const lojas = () => [
  { id: DEMO, user_id: "u1", name: "Demo", shop_domain: "demo-01.myshopify.com", client_id: "c", client_secret: "s", access_token: null, uninstalled_at: null, demonstracao: true },
  { id: REAL, user_id: "u1", name: "Real", shop_domain: "real-01.myshopify.com", client_id: "c", client_secret: "s", access_token: null, uninstalled_at: null, demonstracao: false },
];

beforeEach(() => {
  mundo.shopify.length = 0;
});

describe("marca de demonstracao", () => {
  it("ehDemonstracao so com true; linha sem a coluna nao e", async () => {
    const { ehDemonstracao } = await import("@/lib/demonstracao");
    expect(ehDemonstracao({ demonstracao: true })).toBe(true);
    expect(ehDemonstracao({ demonstracao: false })).toBe(false);
    expect(ehDemonstracao({ id: "x" })).toBe(false);
    expect(ehDemonstracao(null)).toBe(false);
  });

  it("sem a 074 (42703) le de novo sem a coluna; outro erro passa adiante", async () => {
    const { comMarcaDeDemonstracao } = await import("@/lib/demonstracao");
    const pedidas: string[] = [];
    const semColuna = await comMarcaDeDemonstracao("id", async (colunas) => {
      pedidas.push(colunas);
      return colunas.includes("demonstracao")
        ? { data: null, error: { code: "42703", message: "column stores.demonstracao does not exist" } }
        : { data: [{ id: "a" }], error: null };
    });
    expect(pedidas).toEqual(["id, demonstracao", "id"]);
    expect(semColuna.data).toEqual([{ id: "a" }]);

    const outro = await comMarcaDeDemonstracao("id", async () => ({ data: null, error: { code: "57014", message: "timeout" } }));
    expect(outro.error?.code).toBe("57014");
  });

  it("lojasDeDemonstracao: so as marcadas; sem a 074, nenhuma; erro de banco lanca", async () => {
    const { lojasDeDemonstracao } = await import("@/lib/demonstracao");
    const banco = fakeSupabase({ stores: lojas() });
    expect([...(await lojasDeDemonstracao(banco.client, [DEMO, REAL]))]).toEqual([DEMO]);
    expect((await lojasDeDemonstracao(banco.client, [])).size).toBe(0);

    const sem074 = fakeSupabase({ stores: lojas() }, () => ({ code: "42703", message: "column does not exist" }));
    expect((await lojasDeDemonstracao(sem074.client, [DEMO])).size).toBe(0);

    const fora = fakeSupabase({ stores: lojas() }, () => ({ code: "08006", message: "connection failure" }));
    await expect(lojasDeDemonstracao(fora.client, [DEMO])).rejects.toThrow(/connection failure/);
  });

  it("pedidosEsperadosDoBanco: a regra do webhook, a carencia e o teto da Shopify", async () => {
    const { pedidosEsperadosDoBanco, MAX_PEDIDOS_DIAGNOSTICO } = await import("@/lib/demonstracao");
    const em = (minAtras: number) => new Date(AGORA - minAtras * 60_000).toISOString();
    const r = pedidosEsperadosDoBanco(
      [
        { shopify_order_id: "3", criado_em: em(30), tipo: "venda", origem: "web", total_bruto: 50 },
        { shopify_order_id: "1", criado_em: em(90), tipo: "venda", origem: "web", total_bruto: 80 },
        { shopify_order_id: "2", criado_em: em(60), tipo: "reenvio", origem: "shopify_draft_order", total_bruto: 0 },
        { shopify_order_id: "4", criado_em: em(5), tipo: "venda", origem: "web", total_bruto: 70 },
      ],
      AGORA,
      10 * 60_000
    );
    expect(r.ids).toEqual(["1", "3"]);
    expect(r.criadoEm["1"]).toBe(em(90));

    const muitos = Array.from({ length: MAX_PEDIDOS_DIAGNOSTICO + 50 }, (_, i) => ({
      shopify_order_id: String(i),
      criado_em: em(2000 - i),
      tipo: "venda",
      origem: "web",
      total_bruto: 10,
    }));
    expect(pedidosEsperadosDoBanco(muitos, AGORA, 0).ids.length).toBe(MAX_PEDIDOS_DIAGNOSTICO);
  });
});

describe("alertas", () => {
  it("loja de demonstracao nao abre alerta, nem com o sync e a conta com erro", async () => {
    const { coletarCondicoesDetalhado } = await import("@/lib/alertas/avaliar");
    const velho = new Date(AGORA - 5 * HORA).toISOString();
    const banco = fakeSupabase({
      stores: lojas(),
      fin_sync_state: [
        { store_id: DEMO, user_id: "u1", fuso: "America/New_York", ultimo_erro: "Token invalido", ultimo_sync_ok_em: velho, updated_at: velho, carga_inicial_ok: true },
        { store_id: REAL, user_id: "u1", fuso: "America/New_York", ultimo_erro: "Token invalido", ultimo_sync_ok_em: velho, updated_at: velho, carga_inicial_ok: true },
      ],
      ad_accounts: [
        { id: "a-demo", user_id: "u1", store_id: DEMO, plataforma: "meta", external_id: "111111", nome: "Demo", fuso: null, ativo: true, ultimo_sync_ok_em: velho, ultimo_erro: "Token do Meta recusado", created_at: velho },
        { id: "a-real", user_id: "u1", store_id: REAL, plataforma: "meta", external_id: "222222", nome: "Real", fuso: null, ativo: true, ultimo_sync_ok_em: velho, ultimo_erro: "Token do Meta recusado", created_at: velho },
      ],
      tracking_configs: [
        { store_id: DEMO, enabled: true },
        { store_id: REAL, enabled: true },
      ],
      tracking_destinations: [
        { store_id: DEMO, plataforma: "meta", ativo: true },
        { store_id: REAL, plataforma: "meta", ativo: true },
      ],
      // Demo: fila "parada" e o ultimo evento ha 30 h; a real so o ultimo evento ha 30 h.
      tracking_events: [
        { store_id: DEMO, destination: "meta", destination_id: "d1", event_name: "view_item", status: "pendente", next_attempt_at: velho, created_at: new Date(AGORA - 30 * HORA).toISOString(), visitor_id: "v" },
        { store_id: REAL, destination: "meta", destination_id: "d2", event_name: "view_item", status: "enviado", next_attempt_at: velho, created_at: new Date(AGORA - 30 * HORA).toISOString(), visitor_id: "w" },
      ],
    });
    const coleta = await coletarCondicoesDetalhado(banco.client, new Date(AGORA));
    const daDemo = coleta.condicoes.filter((c) => c.store_id === DEMO);
    const daReal = coleta.condicoes.filter((c) => c.store_id === REAL);
    expect(daDemo).toEqual([]);
    expect(daReal.map((c) => c.regra).sort()).toEqual(["ads_sync_atrasado", "pedidos_sync_erro", "rastreamento_parado"]);
    expect(coleta.lojas.has(DEMO)).toBe(false);
  });
});

describe("diagnostico do Rastreamento", () => {
  it("demonstracao responde pelo banco, sem Shopify; a loja comum continua indo la", async () => {
    const em = (horasAtras: number) => new Date(Date.now() - horasAtras * HORA).toISOString();
    mundo.admin = fakeSupabase({
      stores: lojas(),
      fin_orders: [
        { store_id: DEMO, shopify_order_id: "900", criado_em: em(30), tipo: "venda", origem: "web", total_bruto: 89.9 },
        { store_id: DEMO, shopify_order_id: "901", criado_em: em(2), tipo: "venda", origem: "web", total_bruto: 59.95 },
        { store_id: DEMO, shopify_order_id: "902", criado_em: em(3), tipo: "reenvio", origem: "shopify_draft_order", total_bruto: 0 },
        { store_id: DEMO, shopify_order_id: "903", criado_em: em(24 * 9), tipo: "venda", origem: "web", total_bruto: 40 },
      ],
      tracking_destinations: [{ id: "g1", store_id: DEMO, plataforma: "google", ativo: true }],
    }).client;
    const { diagnosticar } = await import("@/lib/tracking/diagnostico");
    const r = await diagnosticar([DEMO, REAL]);

    const demo = r.get(DEMO)!;
    expect(demo.pedidoIds).toEqual(["900", "901"]);
    expect(demo.pedidos7d).toBe(2);
    expect(demo).toMatchObject({ temWebhook: true, temSnippet: true, snippetComId: true, temRemarketing: true, problema: null });
    // So a loja comum perguntou a Shopify.
    expect(new Set(mundo.shopify)).toEqual(new Set(["real-01.myshopify.com"]));
    expect(r.get(REAL)?.problema).toBe("failed");
  });

  it("Guia: o script no tema da loja de demonstracao conta como instalado, sem Shopify", async () => {
    mundo.admin = fakeSupabase({ stores: lojas() }).client;
    const { scriptNoTemaDaLoja } = await import("@/lib/leitura/guia-configuracao");
    expect(await scriptNoTemaDaLoja(DEMO)).toBe(true);
    expect(mundo.shopify).toEqual([]);
    expect(await scriptNoTemaDaLoja(REAL)).toBe(null);
    expect(mundo.shopify).toEqual(["real-01.myshopify.com"]);
  });
});

describe("Custos: nome e foto do produto", () => {
  async function pedir(loja: string, skus: string[]) {
    const { GET } = await import("../src/app/api/leitura/custos/produtos/route");
    const { NextRequest } = await import("next/server");
    const q = new URLSearchParams([["loja", loja], ...skus.map((s) => ["sku", s] as [string, string])]);
    const r = await GET(new NextRequest(`https://user.xcart.app/api/leitura/custos/produtos?${q}`));
    return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
  }

  it("loja de demonstracao responde pelo catalogo dela; a comum pergunta a Shopify", async () => {
    mundo.admin = fakeSupabase({
      stores: lojas(),
      demonstracao_catalogo: [
        { store_id: DEMO, sku: "QM-CTR-STD", nome: "Contour Pillow", variante: "Standard", imagem: null },
        { store_id: DEMO, sku: "QM-MASK", nome: "Silk Sleep Mask", variante: null, imagem: "https://cdn.exemplo/x.jpg" },
      ],
    }).client;

    const demo = await pedir(DEMO, ["QM-CTR-STD", "QM-MASK", "OUTRO"]);
    expect(demo.status).toBe(200);
    expect(demo.corpo.produtos).toEqual({
      "QM-CTR-STD": { nome: "Contour Pillow", variante: "Standard", imagem: null },
      "QM-MASK": { nome: "Silk Sleep Mask", variante: null, imagem: "https://cdn.exemplo/x.jpg" },
    });
    expect(mundo.shopify).toEqual([]);

    const real = await pedir(REAL, ["SKU-1"]);
    expect(real.status).toBe(502);
    expect(mundo.shopify).toEqual(["real-01.myshopify.com"]);
  });
});
