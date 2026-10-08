import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeSupabase, type FakeSupabase } from "./_fake-supabase";

// O track-fallback e publico e o token esta no HTML da vitrine. So grava os
// motivos que o loader manda: o "checkout_na_vitrine" (que abre o alerta
// critico de escape e conta no funil) so o webhook da Shopify grava.

let banco: FakeSupabase;
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => banco.client }));

const { POST } = await import("@/app/api/checkout-routes/track-fallback/route");

const ROTA = "33333333-3333-4333-8333-333333333333";

function enviar(corpo: Record<string, unknown>) {
  return POST(
    new NextRequest("https://user.xcart.app/api/checkout-routes/track-fallback", {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: JSON.stringify({ token: "tok-publico", pageUrl: "https://vitrine.com/cart", ...corpo }),
    })
  );
}

beforeEach(() => {
  banco = fakeSupabase({
    routed_checkout_configs: [{ id: ROTA, public_token: "tok-publico" }],
    routed_checkout_fallbacks: [],
  });
});

describe("track-fallback", () => {
  it("grava o que o loader manda", async () => {
    const r = await enviar({ reason: "routed_ok", detail: "2 itens -> x.myshopify.com" });
    expect(await r.json()).toEqual({ ok: true });
    expect(banco.tabelas.routed_checkout_fallbacks).toHaveLength(1);
    expect(banco.tabelas.routed_checkout_fallbacks[0]).toMatchObject({ route_config_id: ROTA, reason: "routed_ok" });
  });

  it("recusa o escape forjado e motivo inventado", async () => {
    for (const reason of ["checkout_na_vitrine", "qualquer_coisa", undefined]) {
      const r = await enviar({ reason, detail: "1 item: X x1" });
      expect(await r.json()).toEqual({ ok: false });
    }
    expect(banco.tabelas.routed_checkout_fallbacks).toHaveLength(0);
  });
});
