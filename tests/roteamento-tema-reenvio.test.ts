import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// O reenvio automatico do xcart-config.json ao tema da vitrine, com a Shopify
// e o banco falsos: o que ele escreve, quando NAO escreve, e o que guarda.
// ============================================================================

const shopify = vi.hoisted(() => ({
  themeLiquid: "",
  asset: null as string | null,
  chamadas: [] as { metodo: string; caminho: string; corpo?: string }[],
  falhar: false,
}));

vi.mock("@/lib/shopify/safe-shop", () => ({ assertShopDomainPublico: async (d: string) => d }));
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: async (url: string, init: RequestInit = {}) => {
    const caminho = url.replace(/^https:\/\/[^/]+/, "");
    const metodo = init.method || "GET";
    shopify.chamadas.push({ metodo, caminho, corpo: init.body as string | undefined });
    const json = (corpo: unknown, status = 200) =>
      ({ ok: status < 400, status, json: async () => corpo, text: async () => JSON.stringify(corpo) }) as Response;
    if (shopify.falhar) return json({ errors: "Forbidden" }, 403);
    if (caminho.endsWith("/oauth/access_token")) return json({ access_token: "tok" });
    if (caminho.endsWith("/themes.json")) return json({ themes: [{ id: 4, role: "unpublished" }, { id: 7, role: "main" }] });
    if (metodo === "GET" && caminho.includes("layout/theme.liquid")) return json({ asset: { value: shopify.themeLiquid } });
    if (metodo === "GET" && caminho.includes("xcart-config.json")) return json({ asset: { value: shopify.asset } });
    if (metodo === "PUT") {
      const { asset } = JSON.parse(init.body as string) as { asset: { key: string; value: string } };
      if (asset.key === "layout/theme.liquid") shopify.themeLiquid = asset.value;
      else shopify.asset = asset.value;
      return json({ asset: { key: asset.key } });
    }
    return json({}, 404);
  },
}));

const EMBED = {
  rotation: { strategy: "sticky" as const },
  targets: [{ id: "t1", domain: "c.myshopify.com", weight: 1, skuMap: { a: "1" }, variantMap: {}, country: "", locale: "" }],
  domain: "c.myshopify.com",
  skuMap: { a: "1" },
  variantMap: {},
  country: "",
  locale: "",
};
vi.mock("@/lib/checkout-routes/embed-config", () => ({ buildEmbedConfig: async () => EMBED }));

import { publicarConfigNoTema, sincronizarTemaDaRota } from "@/lib/checkout-routes/tema-vitrine";
import { hashDoConfig, URL_DO_CONFIG_LIQUID } from "@/lib/checkout-routes/tema-script";

const ORIGEM = process.env.NEXT_PUBLIC_APP_URL || "https://user.xcart.app";
const rota: Record<string, unknown> = {};

function adminFalso(): SupabaseClient {
  return {
    from: (tabela: string) => {
      let patch: Record<string, unknown> | null = null;
      const api = {
        select: () => api,
        eq: () => api,
        update: (p: Record<string, unknown>) => {
          patch = p;
          return api;
        },
        maybeSingle: async () => ({
          data:
            tabela === "stores"
              ? { shop_domain: "vitrine.myshopify.com", client_id: "a", client_secret: "b" }
              : rota,
          error: null,
        }),
        then: (ok: (v: unknown) => unknown) => {
          if (patch) Object.assign(rota, patch);
          return Promise.resolve({ data: null, error: null }).then(ok);
        },
      };
      return api;
    },
  } as unknown as SupabaseClient;
}

function scriptLiteral(token: string) {
  return `<script\n  src="${ORIGEM}/routed-checkout-loader.js"\n  data-token="${token}"\n  data-config-url="https://norah.com/cdn/shop/t/4/assets/xcart-config.json?v=1788812460"\n  async>\n</script>`;
}

beforeEach(() => {
  for (const k of Object.keys(rota)) delete rota[k];
  Object.assign(rota, {
    id: "rota",
    user_id: "u1",
    enabled: true,
    public_token: "tok-rota",
    settings: {},
    source_store_id: "vitrine",
  });
  shopify.themeLiquid = `<head>\n${scriptLiteral("tok-rota")}\n</head>`;
  shopify.asset = null;
  shopify.chamadas = [];
  shopify.falhar = false;
});

const puts = () => shopify.chamadas.filter((c) => c.metodo === "PUT");
const sync = () => (rota.settings as { theme_sync?: { hash?: string; estado: string } }).theme_sync;

describe("reenvio automatico", () => {
  it("tema com o script desta rota no t/4: grava o asset no tema publicado e passa a URL para o Liquid", async () => {
    const r = await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(r.estado).toBe("atualizado");
    expect(puts().map((c) => c.caminho)).toEqual(["/admin/api/2024-10/themes/7/assets.json", "/admin/api/2024-10/themes/7/assets.json"]);
    expect(JSON.parse(shopify.asset as string)).toEqual(EMBED);
    expect(shopify.themeLiquid).toContain(URL_DO_CONFIG_LIQUID);
    expect(sync()).toMatchObject({ hash: hashDoConfig(EMBED), estado: "atualizado" });
  });

  it("mesmo config de novo: nao chama a Shopify", async () => {
    await sincronizarTemaDaRota(adminFalso(), "rota");
    shopify.chamadas = [];
    const r = await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(r.estado).toBe("em_dia");
    expect(shopify.chamadas).toHaveLength(0);
  });

  it("rota pausada: o asset vai sem destino", async () => {
    rota.enabled = false;
    await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(JSON.parse(shopify.asset as string).targets).toEqual([]);
  });

  it("tema com o script de OUTRA rota: nao escreve nada", async () => {
    shopify.themeLiquid = `<head>\n${scriptLiteral("tok-outra")}\n</head>`;
    const r = await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(r.estado).toBe("script_de_outra_rota");
    expect(puts()).toHaveLength(0);
  });

  it("Shopify recusa: registra a falha com o hash e nao insiste a cada conserto", async () => {
    shopify.falhar = true;
    const r = await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(r.estado).toBe("falhou");
    expect(sync()).toMatchObject({ hash: hashDoConfig(EMBED), estado: "falhou" });
    shopify.chamadas = [];
    const de_novo = await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(de_novo.estado).toBe("falhou");
    expect(shopify.chamadas).toHaveLength(0);
  });

  it("revalidacao diaria com o asset igual: le e nao escreve", async () => {
    await sincronizarTemaDaRota(adminFalso(), "rota");
    // Um dia depois.
    (rota.settings as { theme_sync: { at: string } }).theme_sync.at = new Date(Date.now() - 25 * 3_600_000).toISOString();
    shopify.chamadas = [];
    const r = await sincronizarTemaDaRota(adminFalso(), "rota");
    expect(r.estado).toBe("atualizado");
    expect(puts()).toHaveLength(0);
  });
});

describe("botao Instalar", () => {
  it("escreve sempre (ignora o hash) e instala onde nao ha script", async () => {
    shopify.themeLiquid = "<head>\n</head>";
    const r = await publicarConfigNoTema(adminFalso(), "rota", { instalar: true, forcar: true, userId: "u1" });
    expect(r.estado).toBe("instalado");
    expect(r.troca).toBe("inserido");
    expect(shopify.themeLiquid).toContain('data-token="tok-rota"');
  });
});
