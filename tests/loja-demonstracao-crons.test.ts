import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// ============================================================================
// Loja de demonstracao (074) nos caminhos que falam com fora:
//   - o sync de pedidos (cron e "Atualizar agora") nunca chama a Shopify por
//     ela nem grava erro; na sessao, so marca a hora da leitura;
//   - o gasto do Meta nunca usa o token inventado dela; na sessao, so marca a
//     hora;
//   - o coletor publico recusa evento para ela (o cron mandaria ao Meta).
// A loja comum segue igual.
// ============================================================================

const mundo = vi.hoisted(() => ({
  banco: null as unknown as { client: never },
  usuario: null as { id: string } | null,
  syncLojas: [] as string[],
  syncContas: [] as string[],
  fila: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.banco.client }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: mundo.usuario } }) } }),
}));
vi.mock("@/lib/financeiro/shopify-pedidos", () => ({
  sincronizarLoja: async (_a: unknown, loja: { shop_domain: string }) => {
    mundo.syncLojas.push(loja.shop_domain);
    return { terminou: true, comOrigem: true };
  },
  recuperarOrigens: async () => undefined,
  faltaRecuperarOrigens: () => false,
}));
vi.mock("@/lib/ads/meta-sync", () => ({
  sincronizarContaMeta: async (_a: unknown, conta: { external_id: string }) => {
    mundo.syncContas.push(conta.external_id);
    return { linhas: 1 };
  },
}));
vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => [],
  destinoAceita: () => true,
}));
vi.mock("@/lib/tracking/fila", () => ({
  enfileirar: async (_a: unknown, e: { evento: { event_name: string } }) => {
    mundo.fila.push(e.evento.event_name);
    return { id: "l1", duplicado: false };
  },
  entregar: async () => ({ ok: true }),
}));
vi.mock("@/lib/tracking/identidade-do-pedido", () => ({
  ehClientIdSentinela: () => false,
  identidadePorCliente: async () => null,
}));

const DEMO = "11111111-1111-4111-8111-111111111111";
const REAL = "22222222-2222-4222-8222-222222222222";
const VELHO = "2026-10-19T10:00:00.000Z";

function montarBanco(): FakeSupabase {
  return fakeSupabase({
    stores: [
      { id: DEMO, user_id: "u1", shop_domain: "demo-01.myshopify.com", client_id: "c", client_secret: "s", access_token: null, uninstalled_at: null, demonstracao: true },
      { id: REAL, user_id: "u1", shop_domain: "real-01.myshopify.com", client_id: "c", client_secret: "s", access_token: null, uninstalled_at: null, demonstracao: false },
    ],
    fin_sync_state: [
      { store_id: DEMO, user_id: "u1", ultimo_sync_em: VELHO, ultimo_sync_ok_em: VELHO, ultimo_erro: null, ultimo_erro_tipo: null, carga_inicial_ok: true, sincronizando_desde: null },
      { store_id: REAL, user_id: "u1", ultimo_sync_em: VELHO, ultimo_sync_ok_em: VELHO, ultimo_erro: null, ultimo_erro_tipo: null, carga_inicial_ok: true, sincronizando_desde: null },
    ],
    ad_accounts: [
      { id: "a-demo", user_id: "u1", store_id: DEMO, plataforma: "meta", external_id: "111111", nome: "Demo", ativo: true, ultimo_sync_em: VELHO, ultimo_sync_ok_em: VELHO, sincronizando_desde: null },
      { id: "a-real", user_id: "u1", store_id: REAL, plataforma: "meta", external_id: "222222", nome: "Real", ativo: true, ultimo_sync_em: VELHO, ultimo_sync_ok_em: VELHO, sincronizando_desde: null },
    ],
    ad_account_secrets: [
      { ad_account_id: "a-demo", meta_access_token: "EAA-inventado" },
      { ad_account_id: "a-real", meta_access_token: "EAA-real" },
    ],
    fin_orders: [],
    tracking_configs: [{ store_id: DEMO, enabled: true, web_pixel_visto_em: null, web_pixel_com_id_em: null }],
  });
}

async function chamar(rota: "pedidos" | "meta", doCron: boolean) {
  const { NextRequest } = await import("next/server");
  const url = rota === "pedidos" ? "https://user.xcart.app/api/jobs/financeiro/pedidos" : "https://user.xcart.app/api/jobs/ads/meta";
  const req = new NextRequest(url, { method: "POST", headers: doCron ? { authorization: "Bearer segredo" } : {} });
  const mod =
    rota === "pedidos"
      ? await import("../src/app/api/jobs/financeiro/pedidos/route")
      : await import("../src/app/api/jobs/ads/meta/route");
  const r = await mod.POST(req);
  return (await r.json()) as { ok: boolean; processadas: number; puladas: number; erros: string[] };
}

describe("crons e botoes de sincronizar", () => {
  let banco: FakeSupabase;
  beforeEach(() => {
    process.env.CRON_SECRET = "segredo";
    banco = montarBanco();
    mundo.banco = banco as unknown as { client: never };
    mundo.usuario = { id: "u1" };
    mundo.syncLojas.length = 0;
    mundo.syncContas.length = 0;
  });
  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("cron de pedidos: so a loja comum vai a Shopify; a de demonstracao fica intocada", async () => {
    const r = await chamar("pedidos", true);
    expect(mundo.syncLojas).toEqual(["real-01.myshopify.com"]);
    expect(r).toMatchObject({ ok: true, processadas: 1, erros: [] });
    const demo = banco.tabelas.fin_sync_state.find((s) => s.store_id === DEMO)!;
    expect(demo).toMatchObject({ ultimo_sync_em: VELHO, ultimo_erro: null, sincronizando_desde: null });
  });

  it("Atualizar agora: a de demonstracao conta como lida e so ganha a hora, sem Shopify", async () => {
    const r = await chamar("pedidos", false);
    expect(mundo.syncLojas).toEqual(["real-01.myshopify.com"]);
    expect(r).toMatchObject({ ok: true, processadas: 2, erros: [] });
    const demo = banco.tabelas.fin_sync_state.find((s) => s.store_id === DEMO)!;
    expect(demo.ultimo_sync_ok_em).not.toBe(VELHO);
    expect(demo.ultimo_erro).toBeNull();
  });

  it("cron do Meta: o token inventado nunca sai; a conta comum sincroniza", async () => {
    const r = await chamar("meta", true);
    expect(mundo.syncContas).toEqual(["222222"]);
    expect(r).toMatchObject({ ok: true, processadas: 1, erros: [] });
    const demo = banco.tabelas.ad_accounts.find((c) => c.id === "a-demo")!;
    expect(demo).toMatchObject({ ultimo_sync_em: VELHO, sincronizando_desde: null });
    expect(demo.ultimo_erro ?? null).toBeNull();
  });

  it("Atualizar agora do Meta: a conta de demonstracao so ganha a hora", async () => {
    const r = await chamar("meta", false);
    expect(mundo.syncContas).toEqual(["222222"]);
    expect(r).toMatchObject({ ok: true, processadas: 2, erros: [] });
    const demo = banco.tabelas.ad_accounts.find((c) => c.id === "a-demo")!;
    expect(demo.ultimo_sync_ok_em).not.toBe(VELHO);
    expect(demo.ultimo_erro ?? null).toBeNull();
  });
});

describe("coletor publico", () => {
  beforeEach(() => {
    mundo.banco = montarBanco() as unknown as { client: never };
    mundo.fila.length = 0;
  });

  it("evento para a loja de demonstracao e recusado e nada entra na fila", async () => {
    const { POST } = await import("../src/app/api/tracking/collect/route");
    const { NextRequest } = await import("next/server");
    const r = await POST(
      new NextRequest("https://user.xcart.app/api/tracking/collect", {
        method: "POST",
        body: JSON.stringify({
          shop: "demo-01.myshopify.com",
          storeId: DEMO,
          evento: "add_to_cart",
          eventId: "add_to_cart_vid-1_1760000000000",
          visitorId: "vid-1",
        }),
        headers: { "content-type": "text/plain;charset=UTF-8", "user-agent": "Mozilla/5.0", "x-forwarded-for": "203.0.113.50" },
      })
    );
    expect(await r.json()).toMatchObject({ ok: false, motivo: "loja desconhecida" });
    expect(mundo.fila).toEqual([]);
  });
});
