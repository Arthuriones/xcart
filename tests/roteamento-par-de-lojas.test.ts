import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COBERTURA_MINIMA_PARA_ENTRAR,
  lojaEhVitrineDeOutraRota,
  lojasCandidatasACheckout,
} from "@/lib/checkout-routes/par-de-lojas";
import { garantirDestinoPrimario, settingsDoDestino } from "@/lib/checkout-routes/destino-primario";

// ============================================================================
// Reclamacao 4 da NORAH: produtos de outro nicho na loja de checkout. A loja
// errada entrava na rota pelo "Adicionar loja" (que oferecia toda loja do
// usuario, ate vitrine de outra rota) com um unico SKU casado.
//
// E a rota criada pelo assistente nascia sem linha de destino: o primeiro
// "Adicionar loja" tirava a loja original da rota sem aviso.
// ============================================================================

const rotas = [
  { id: "r1", sourceStoreId: "vitrine-bolsas", targets: [{ storeId: "checkout-bolsas" }] },
  { id: "r2", sourceStoreId: "vitrine-tenis", targets: [{ storeId: "checkout-tenis" }] },
];
const lojas = ["vitrine-bolsas", "checkout-bolsas", "vitrine-tenis", "checkout-tenis", "nova"].map((id) => ({ id }));

describe("quem pode ser loja de checkout", () => {
  it("Adicionar loja nao oferece vitrine nem checkout de outra rota", () => {
    expect(lojasCandidatasACheckout(lojas, rotas[0], rotas).map((l) => l.id)).toEqual(["nova"]);
  });

  it("servidor recusa vitrine de outra rota", () => {
    const doBanco = [
      { id: "r1", source_store_id: "vitrine-bolsas" },
      { id: "r2", source_store_id: "vitrine-tenis" },
    ];
    expect(lojaEhVitrineDeOutraRota("vitrine-tenis", doBanco, "r1")).toBe(true);
    expect(lojaEhVitrineDeOutraRota("checkout-tenis", doBanco, "r1")).toBe(false);
    expect(lojaEhVitrineDeOutraRota("nova", doBanco, null)).toBe(false);
  });

  it("piso para entrar numa rota: metade do catalogo, nao 1 casamento", () => {
    expect(COBERTURA_MINIMA_PARA_ENTRAR).toBeGreaterThanOrEqual(0.5);
  });
});

// ---------------------------------------------------------------------------

function adminFalso(estado: { linhas: number; rota: Record<string, unknown> | null }) {
  const upserts: { linha: Record<string, unknown>; opcoes: unknown }[] = [];
  const admin = {
    from: (tabela: string) => {
      const api = {
        select: (_c?: string, opcoes?: { head?: boolean }) => {
          if (opcoes?.head) {
            return { eq: async () => ({ count: estado.linhas, error: null }) };
          }
          return api;
        },
        eq: () => api,
        maybeSingle: async () => ({ data: tabela === "routed_checkout_configs" ? estado.rota : null, error: null }),
        upsert: async (linha: Record<string, unknown>, opcoes: unknown) => {
          upserts.push({ linha, opcoes });
          return { error: null };
        },
      };
      return api;
    },
  } as unknown as SupabaseClient;
  return { admin, upserts };
}

describe("rota nasce com a linha do destino", () => {
  const rota = {
    id: "rota",
    target_store_id: "checkout",
    sku_map: { a: "1" },
    variant_map: { "9": "1" },
    settings: { generatedBy: "connect_wizard", checkout_country: "US", last_heal: { ok: true } },
  };

  it("rota sem linha ganha a do target_store_id, com mapa e mercado", async () => {
    const { admin, upserts } = adminFalso({ linhas: 0, rota });
    expect(await garantirDestinoPrimario(admin, "rota", "connect_wizard")).toEqual({ criado: true });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].linha).toEqual({
      route_id: "rota",
      target_store_id: "checkout",
      weight: 1,
      enabled: true,
      sku_map: { a: "1" },
      variant_map: { "9": "1" },
      settings: { generatedBy: "connect_wizard", checkout_country: "US" },
      position: 0,
    });
    expect(upserts[0].opcoes).toEqual({ onConflict: "route_id,target_store_id", ignoreDuplicates: true });
  });

  it("rota que ja tem linha: nao mexe", async () => {
    const { admin, upserts } = adminFalso({ linhas: 2, rota });
    expect(await garantirDestinoPrimario(admin, "rota")).toEqual({ criado: false });
    expect(upserts).toHaveLength(0);
  });

  it("do settings da rota so vai dominio e mercado", () => {
    expect(settingsDoDestino({ checkout_domain: "x.com", last_heal: {}, theme_sync: {} }, "rota")).toEqual({
      generatedBy: "rota",
      checkout_domain: "x.com",
    });
  });
});
