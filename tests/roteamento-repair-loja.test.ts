import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ============================================================================
// "Criar N produtos" vale para UMA loja de checkout. Antes o repair passava a
// confirmacao a todas as lojas ligadas da rota: o lojista via a pendencia da
// loja certa e o clique despejava a vitrine tambem na loja de peso 0 que
// entrou por "Adicionar loja" com 55% de cobertura -- a reclamacao 4 da NORAH.
// ============================================================================

const banco = vi.hoisted(() => ({
  alvos: [] as { id: string }[],
  erro: null as { message: string } | null,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: () => {
      const api = {
        select: () => api,
        eq: () => api,
        order: () => api,
        then: (ok: (v: unknown) => unknown) =>
          Promise.resolve({ data: banco.erro ? null : banco.alvos, error: banco.erro }).then(ok),
      };
      return api;
    },
  }),
}));

const chamadas = vi.hoisted(() => [] as { targetId?: string; criarFaltantes?: boolean }[]);
vi.mock("@/lib/checkout-routes/heal", () => ({
  healRoute: async (input: { targetId?: string; criarFaltantes?: boolean }) => {
    chamadas.push({ targetId: input.targetId, criarFaltantes: input.criarFaltantes });
    return {
      ok: true,
      routeId: "rota",
      targetId: input.targetId ?? null,
      targetStoreName: input.targetId ? `Loja ${input.targetId}` : null,
      stampedSkuCount: 0,
      dedupedSkuCount: 0,
      fixedWrongCount: 0,
      extendedCount: 0,
      adoptedVariantCount: 0,
      removedPairCount: 0,
      mixedBlockedVariantCount: 0,
      createdProductCount: 0,
      createdVariantCount: 0,
      imageQueueCount: 0,
      finalMappedCount: 0,
      coveragePercent: 100,
      pendingProductCount: 0,
      pendingVariantCount: 0,
      creationBlockedReason: null,
      warnings: [],
      noop: true,
    };
  },
  HealBusyError: class extends Error {},
  HealRouteError: class extends Error {
    status = 500;
  },
}));

const { POST } = await import("@/app/api/checkout-routes/repair/route");

const req = (corpo: unknown) =>
  new NextRequest("http://localhost/api/checkout-routes/repair", {
    method: "POST",
    body: JSON.stringify(corpo),
  });

beforeEach(() => {
  banco.alvos = [{ id: "a" }, { id: "b" }];
  banco.erro = null;
  chamadas.length = 0;
});

describe("repair: a confirmacao de criar vale para a loja confirmada", () => {
  it("Corrigir sem confirmar: todas as lojas ligadas, todas com a trava", async () => {
    const r = await POST(req({ id: "rota" }));
    expect(r.status).toBe(200);
    expect(chamadas).toEqual([
      { targetId: "a", criarFaltantes: false },
      { targetId: "b", criarFaltantes: false },
    ]);
  });

  it("confirmou a loja b: so ela roda, e so ela cria", async () => {
    const r = await POST(req({ id: "rota", targetId: "b", criarFaltantes: true }));
    expect(r.status).toBe(200);
    expect(chamadas).toEqual([{ targetId: "b", criarFaltantes: true }]);
    const corpo = await r.json();
    expect(corpo.targets.map((t: { targetId: string }) => t.targetId)).toEqual(["b"]);
  });

  it("confirmar sem dizer a loja, numa rota com duas: recusa", async () => {
    const r = await POST(req({ id: "rota", criarFaltantes: true }));
    expect(r.status).toBe(400);
    expect(chamadas).toHaveLength(0);
  });

  it("rota de uma loja so (assistente): confirma sem targetId", async () => {
    banco.alvos = [{ id: "a" }];
    const r = await POST(req({ id: "rota", criarFaltantes: true }));
    expect(r.status).toBe(200);
    expect(chamadas).toEqual([{ targetId: "a", criarFaltantes: true }]);
  });

  it("loja que nao e desta rota (ou esta pausada): 404", async () => {
    const r = await POST(req({ id: "rota", targetId: "z", criarFaltantes: true }));
    expect(r.status).toBe(404);
    expect(chamadas).toHaveLength(0);
  });

  it("erro do banco ao ler as lojas: 503, nao cai no destino legado", async () => {
    banco.erro = { message: "timeout" };
    const r = await POST(req({ id: "rota" }));
    expect(r.status).toBe(503);
    expect(chamadas).toHaveLength(0);
  });
});
