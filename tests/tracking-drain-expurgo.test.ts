import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ============================================================================
// O expurgo da fila de rastreamento (purge_tracking) no drain:
//   - roda ANTES do drenarFila, que nao tem prazo (Meta/TikTok lentos
//     estouravam os 120 s e a hora do expurgo se perdia);
//   - so na execucao dos 10 primeiros minutos da hora;
//   - se falhar, a resposta e 500 com o mesmo corpo, para o painel de Cron da
//     Vercel acusar (com 200 a falha persistente era invisivel).
// ============================================================================

const mundo = vi.hoisted(() => ({
  ordem: [] as string[],
  erroRpc: {} as Record<string, string>,
  drenarLanca: false,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc: async (nome: string) => {
      mundo.ordem.push(nome);
      const msg = mundo.erroRpc[nome];
      return { data: null, error: msg ? { message: msg } : null };
    },
  }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }),
}));
vi.mock("@/lib/tracking/fila", () => ({
  drenarFila: async (limite: number) => {
    mundo.ordem.push("drenarFila");
    if (mundo.drenarLanca) throw new Error("Meta fora do ar");
    return { processadas: limite > 0 ? 3 : 0, enviadas: 3, falhas: 0 };
  },
}));
vi.mock("@/lib/checkouts-externos/rastreio", () => ({
  drenarFilaDoCheckout: async () => {
    mundo.ordem.push("drenarFilaDoCheckout");
    return { processadas: 0 };
  },
}));
// O postback da Sphere (086) decide no mesmo cron; o teste dele e o do postback.
vi.mock("@/lib/checkouts-externos/postback-supabase", () => ({ decidirPostbacks: async () => ({ casado: 0 }) }));

async function chamar(minutoUtc: number, cron = true) {
  vi.setSystemTime(new Date(Date.UTC(2026, 9, 27, 15, minutoUtc, 5)));
  const { POST } = await import("../src/app/api/jobs/tracking/drain/route");
  const req = new NextRequest("https://user.xcart.app/api/jobs/tracking/drain", {
    method: "POST",
    headers: cron ? { authorization: "Bearer segredo" } : {},
  });
  const r = await POST(req);
  return { status: r.status, corpo: (await r.json()) as Record<string, unknown> };
}

describe("drain: expurgo da fila", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    process.env.CRON_SECRET = "segredo";
    mundo.ordem.length = 0;
    mundo.erroRpc = {};
    mundo.drenarLanca = false;
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    delete process.env.CRON_SECRET;
  });

  it("na execucao da hora cheia, o expurgo vem antes de drenar a fila", async () => {
    const { status, corpo } = await chamar(0);
    expect(status).toBe(200);
    expect(mundo.ordem).toEqual([
      "purge_tracking",
      "purge_checkout_externo_rastreio",
      "drenarFila",
      "drenarFilaDoCheckout",
    ]);
    expect(corpo).toMatchObject({ ok: true, processadas: 3, expurgo: "ok", expurgoCheckouts: "ok" });
  });

  it("fora dos 10 primeiros minutos, nao expurga e responde como antes", async () => {
    for (const minuto of [10, 20, 30, 40, 50]) {
      mundo.ordem.length = 0;
      const { status, corpo } = await chamar(minuto);
      expect(status, String(minuto)).toBe(200);
      expect(mundo.ordem, String(minuto)).toEqual(["drenarFila", "drenarFilaDoCheckout"]);
      expect(corpo, String(minuto)).toMatchObject({ ok: true, expurgo: null, expurgoCheckouts: null });
    }
  });

  it("purge_tracking falhou: 500 com o mesmo corpo, e a fila drena mesmo assim", async () => {
    mundo.erroRpc.purge_tracking = "canceling statement due to statement timeout";
    const { status, corpo } = await chamar(0);
    expect(status).toBe(500);
    expect(corpo).toMatchObject({
      ok: true,
      processadas: 3,
      expurgo: "falhou: canceling statement due to statement timeout",
      expurgoCheckouts: "ok",
      checkouts: { processadas: 0 },
    });
    expect(mundo.ordem).toContain("drenarFila");
    expect(mundo.ordem).toContain("drenarFilaDoCheckout");
    expect(console.error).toHaveBeenCalled();
  });

  it("so o expurgo do checkout externo falhou: tambem 500", async () => {
    mundo.erroRpc.purge_checkout_externo_rastreio = "permission denied";
    const { status, corpo } = await chamar(0);
    expect(status).toBe(500);
    expect(corpo).toMatchObject({ ok: true, expurgo: "ok", expurgoCheckouts: "falhou: permission denied" });
  });

  it("o expurgo ja rodou quando a fila das lojas lanca", async () => {
    mundo.drenarLanca = true;
    const { status, corpo } = await chamar(0);
    expect(status).toBe(500);
    expect(corpo).toEqual({ error: "Meta fora do ar" });
    expect(mundo.ordem.slice(0, 2)).toEqual(["purge_tracking", "purge_checkout_externo_rastreio"]);
  });

  it("fora do cron, sem sessao: 401 e nada roda", async () => {
    const { status } = await chamar(0, false);
    expect(status).toBe(401);
    expect(mundo.ordem).toEqual([]);
  });
});
