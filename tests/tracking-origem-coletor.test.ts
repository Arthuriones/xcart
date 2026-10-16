import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// O coletor guarda as UTMs do clique na identidade do visitante (071).
//
// E por ela que o pedido sem atributo e sem jornada (app de COD, "Comprar
// agora") acha a campanha, pela mesma cascata do Purchase. O que trava aqui:
//   - a UTM do snippet vai com a hora do clique (`utm.em`);
//   - snippet antigo (sem `utm`): sai da URL da pagina, com a hora de agora;
//   - evento sem UTM NAO apaga a UTM guardada (os click ids vao com null, ela
//     nao vai);
//   - sem a coluna (071 por aplicar), a identidade e gravada sem ela;
//   - so chaves conhecidas, sem "@".
// ============================================================================

const STORE = "5b83aaa9-a937-4b71-8625-b2f3d0f8ad01";
const SHOP = "loja.myshopify.com";
const AGORA = Date.parse("2026-10-08T12:00:00Z");

const mundo = vi.hoisted(() => ({
  admin: null as unknown,
  /** Visitante ja existe: o update acha a linha. */
  existe: true,
  /** A coluna utm ainda nao existe. */
  semColunaUtm: false,
  escritas: [] as { op: string; campos: Record<string, unknown> }[],
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => mundo.admin }));
vi.mock("@/lib/tracking/destinos", () => ({
  destinosDaLoja: async () => [],
  destinoAceita: () => true,
}));
vi.mock("@/lib/tracking/fila", () => ({
  enfileirar: async () => ({ id: "l1", duplicado: false }),
  entregar: async () => ({ ok: true }),
}));
vi.mock("@/lib/tracking/identidade-do-pedido", () => ({
  ehClientIdSentinela: () => false,
  identidadePorCliente: async () => null,
}));

function bancoFalso() {
  mundo.admin = {
    from(tabela: string) {
      let op = "select";
      let campos: Record<string, unknown> = {};
      const b: Record<string, unknown> = {};
      Object.assign(b, {
        select: () => b,
        update: (c: Record<string, unknown>) => ((op = "update"), (campos = c), b),
        upsert: (c: Record<string, unknown>) => ((op = "upsert"), (campos = c), b),
        insert: (c: Record<string, unknown>) => ((op = "insert"), (campos = c), b),
        eq: () => b,
        not: () => b,
        is: () => b,
        in: () => b,
        gte: () => b,
        like: () => b,
        limit: () => b,
        maybeSingle: () => b,
        then: (ok: (v: unknown) => unknown) => {
          let data: unknown = null;
          let error: { message: string } | null = null;
          if (tabela === "stores") data = [{ id: STORE }];
          else if (tabela === "tracking_configs" && op === "select") {
            data = [{ store_id: STORE, enabled: true, web_pixel_visto_em: null, web_pixel_com_id_em: null }];
          } else if (tabela === "tracking_identities" && (op === "update" || op === "upsert")) {
            if (mundo.semColunaUtm && "utm" in campos) {
              error = { message: "Could not find the 'utm' column of 'tracking_identities' in the schema cache" };
            } else {
              mundo.escritas.push({ op, campos });
              data = op === "update" && mundo.existe ? [{ id: "i1" }] : [];
            }
          }
          return Promise.resolve({ data, count: 0, error }).then(ok);
        },
      });
      return b;
    },
  };
}

async function postar(corpo: Record<string, unknown>) {
  const { POST } = await import("../src/app/api/tracking/collect/route");
  const { NextRequest } = await import("next/server");
  const r = await POST(
    new NextRequest("https://user.xcart.app/api/tracking/collect", {
      method: "POST",
      body: JSON.stringify({ shop: SHOP, storeId: STORE, clientId: "cli-1", ...corpo }),
      headers: { "content-type": "text/plain;charset=UTF-8", "x-forwarded-for": "203.0.113.50" },
    })
  );
  return (await r.json()) as Record<string, unknown>;
}

const IDENTIDADE = { evento: "identidade", eventId: "identidade_vid-1", visitorId: "vid-1" };
const EVENTO = { evento: "view_item", eventId: "view_item_vid-1_1", visitorId: "vid-1" };

describe("coletor: UTMs do clique na identidade", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    mundo.existe = true;
    mundo.semColunaUtm = false;
    mundo.escritas.length = 0;
    bancoFalso();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("o aviso de identidade grava a UTM do snippet com a hora do clique", async () => {
    const em = AGORA - 2 * 864e5;
    const r = await postar({
      ...IDENTIDADE,
      fbclid: "IwAR1",
      utm: { utm_source: "fb", utm_campaign: "120200000000000001", utm_term: "120200000000000002", em },
    });
    expect(r).toMatchObject({ ok: true, identidade: "gravada" });
    expect(mundo.escritas[0].campos).toMatchObject({
      fbclid: "IwAR1",
      utm: { source: "fb", campaign: "120200000000000001", term: "120200000000000002" },
      utm_em: new Date(em).toISOString(),
    });
  });

  it("snippet antigo sem `utm`: tira da URL da pagina, com a hora de agora", async () => {
    await postar({
      ...EVENTO,
      pageUrl: "https://loja.shop/products/x?fbclid=F&utm_medium=paid&utm_source=ig&utm_campaign=120200000000000001",
    });
    expect(mundo.escritas[0].campos).toMatchObject({
      utm: { source: "ig", medium: "paid", campaign: "120200000000000001" },
      utm_em: new Date(AGORA).toISOString(),
    });
  });

  it("evento sem UTM nao apaga a guardada: a coluna nem vai na escrita", async () => {
    await postar({ ...EVENTO, pageUrl: "https://loja.shop/cart" });
    expect(mundo.escritas).toHaveLength(1);
    expect(mundo.escritas[0].campos).not.toHaveProperty("utm");
    expect(mundo.escritas[0].campos).not.toHaveProperty("utm_em");
  });

  it("UTM velha (fora dos 7 dias), com e-mail ou com chave estranha nao entra", async () => {
    await postar({ ...IDENTIDADE, utm: { utm_source: "fb", em: AGORA - 8 * 864e5 } });
    await postar({ ...IDENTIDADE, utm: { utm_term: "ana@exemplo.com", email: "ana@exemplo.com" } });
    for (const e of mundo.escritas) expect(e.campos).not.toHaveProperty("utm");
    expect(JSON.stringify(mundo.escritas)).not.toContain("ana@exemplo.com");
  });

  it("sem a coluna (071 por aplicar): a identidade sai sem a UTM, com o clique", async () => {
    mundo.semColunaUtm = true;
    const r = await postar({ ...IDENTIDADE, gclid: "Cj0", utm: { utm_source: "google", em: AGORA } });
    expect(r).toMatchObject({ ok: true, identidade: "gravada" });
    expect(mundo.escritas).toHaveLength(1);
    expect(mundo.escritas[0].campos).toMatchObject({ gclid: "Cj0" });
    expect(mundo.escritas[0].campos).not.toHaveProperty("utm");
  });

  it("visitante novo: a UTM vai no upsert da linha nova", async () => {
    mundo.existe = false;
    await postar({ ...IDENTIDADE, utm: { utm_source: "tiktok", utm_campaign: "1800000000000001", em: AGORA } });
    const upsert = mundo.escritas.find((e) => e.op === "upsert");
    expect(upsert?.campos).toMatchObject({ visitor_id: "vid-1", utm: { source: "tiktok", campaign: "1800000000000001" } });
  });
});
