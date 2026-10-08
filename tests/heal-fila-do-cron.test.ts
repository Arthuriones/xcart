import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ============================================================================
// A fila do cron de conserto (/api/jobs/routes/heal).
//
// Ela lia os destinos ligados e tirava a rota desligada DEPOIS, com o limite
// ja aplicado. Destino de rota pausada nunca e consertado, entao o
// last_healed_at dele nao anda e ele ficava na cabeca da fila para sempre,
// ocupando as vagas. E loja fora do ar (pausada pela Shopify, sem app, vitrine
// com senha) gastava passada toda hora.
// ============================================================================

type Linha = Record<string, unknown>;
const db = vi.hoisted(() => ({ tabelas: {} as Record<string, Record<string, unknown>[]>, escritas: [] as unknown[] }));

function consulta(tabela: string) {
  const filtros: ((l: Linha) => boolean)[] = [];
  let patch: Linha | null = null;
  let limite: number | undefined;
  async function executar() {
    const linhas = (db.tabelas[tabela] || []).filter((l) => filtros.every((f) => f(l)));
    if (patch) {
      for (const l of linhas) Object.assign(l, patch);
      db.escritas.push({ tabela, patch });
      return { data: linhas, error: null };
    }
    return { data: limite ? linhas.slice(0, limite) : linhas, error: null };
  }
  const api = {
    select: () => api,
    eq: (c: string, v: unknown) => {
      filtros.push((l) => l[c] === v);
      return api;
    },
    in: (c: string, vs: unknown[]) => {
      filtros.push((l) => vs.includes(l[c]));
      return api;
    },
    order: () => api,
    limit: (n: number) => {
      limite = n;
      return api;
    },
    update: (p: Linha) => {
      patch = p;
      return api;
    },
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => executar().then(ok, erro),
  };
  return api;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (t: string) => consulta(t),
    rpc: async () => ({ data: 0, error: null }),
  }),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));

const heal = vi.hoisted(() => ({
  chamados: [] as string[],
  falharCom: {} as Record<string, unknown>,
}));
vi.mock("@/lib/checkout-routes/heal", () => {
  class HealRouteError extends Error {
    status: number;
    foraDoAr?: { motivo: string; lado: string; proximaTentativa: string };
    constructor(m: string, status = 500, fora?: { motivo: string; lado: string; proximaTentativa: string }) {
      super(m);
      this.status = status;
      if (fora) this.foraDoAr = fora;
    }
  }
  return {
    HealRouteError,
    HealBusyError: class extends Error {},
    healRoute: async (input: { targetId: string }) => {
      heal.chamados.push(input.targetId);
      const erro = heal.falharCom[input.targetId];
      if (erro) throw erro;
      return { noop: true };
    },
  };
});

process.env.CRON_SECRET = "segredo";
const { GET } = await import("@/app/api/jobs/routes/heal/route");
const { HealRouteError } = await import("@/lib/checkout-routes/heal");

const chamarCron = () =>
  GET(
    new NextRequest("http://localhost/api/jobs/routes/heal", {
      headers: { authorization: "Bearer segredo" },
    })
  );

const futuro = new Date(Date.now() + 6 * 3_600_000).toISOString();

beforeEach(() => {
  heal.chamados.length = 0;
  heal.falharCom = {};
  db.escritas.length = 0;
  db.tabelas = {
    routed_checkout_configs: [
      { id: "ligada", name: "Ligada", user_id: "u1", enabled: true },
      { id: "pausada", name: "Pausada", user_id: "u1", enabled: false },
    ],
    // Na ordem da fila (last_healed_at, nulo primeiro): os 20 da rota pausada
    // na frente, como em producao.
    routed_checkout_targets: [
      ...Array.from({ length: 20 }, (_, i) => ({
        id: `parada-${i}`,
        route_id: "pausada",
        enabled: true,
        last_healed_at: null,
        settings: {},
      })),
      {
        id: "esperando",
        route_id: "ligada",
        enabled: true,
        last_healed_at: null,
        settings: { last_heal: { ok: false, motivo: "loja_pausada", lado: "checkout", proximaTentativa: futuro } },
      },
      { id: "a", route_id: "ligada", enabled: true, last_healed_at: "2026-10-08T01:00:00Z", settings: {} },
      { id: "b", route_id: "ligada", enabled: true, last_healed_at: "2026-10-08T02:00:00Z", settings: {} },
      { id: "desligado", route_id: "ligada", enabled: false, last_healed_at: null, settings: {} },
    ],
  };
});

describe("fila do cron de conserto", () => {
  it("destino de rota pausada nao ocupa a fila; loja fora do ar espera a hora dela", async () => {
    const r = await chamarCron();
    expect(r.status).toBe(200);
    expect(heal.chamados).toEqual(["a", "b"]);
    const corpo = await r.json();
    expect(corpo.waiting).toBe(1);
  });

  it("espera vencida: entra de novo", async () => {
    const esperando = db.tabelas.routed_checkout_targets.find((t) => t.id === "esperando") as Linha;
    esperando.settings = { last_heal: { proximaTentativa: "2026-01-01T00:00:00.000Z" } };
    await chamarCron();
    expect(heal.chamados).toEqual(["esperando", "a", "b"]);
  });

  it("loja fora do ar no meio da passada: o resultado diz o motivo e a fila anda", async () => {
    heal.falharCom.a = new HealRouteError("pausada", 409, {
      motivo: "loja_pausada",
      lado: "checkout",
      proximaTentativa: futuro,
    });
    const r = await chamarCron();
    const corpo = await r.json();
    expect(heal.chamados).toEqual(["a", "b"]);
    expect(corpo.results[0]).toMatchObject({ targetId: "a", foraDoAr: "loja_pausada", lado: "checkout" });
    // A tentativa conta: o destino vai para o fim da fila.
    const a = db.tabelas.routed_checkout_targets.find((t) => t.id === "a") as Linha;
    expect(a.last_healed_at).not.toBe("2026-10-08T01:00:00Z");
  });

  it("sem rota ligada: nada a consertar, sem erro", async () => {
    db.tabelas.routed_checkout_configs = [{ id: "pausada", name: "P", user_id: "u1", enabled: false }];
    const r = await chamarCron();
    expect(r.status).toBe(200);
    expect(heal.chamados).toEqual([]);
  });
});
