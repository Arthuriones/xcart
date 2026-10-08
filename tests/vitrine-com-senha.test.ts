import { beforeEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Vitrine com senha: o products.json nao abre. A Shopify responde 401 ou manda
// para /password (HTML). Antes isso estourava no res.json() com "Unexpected
// token <" e o conserto falhava calado (Distrito Zapas: 208 de 208 variantes
// sem SKU, porque o carimbo nunca via a vitrine).
// ============================================================================

const resposta = vi.hoisted(() => ({ valor: null as unknown as () => Response }));
vi.mock("@/lib/import/proxy-fetch", () => ({
  fetchWithImportProxy: async () => resposta.valor(),
}));

import { fetchPublicShopifyProducts, LojaComSenhaError } from "@/lib/shopify/public-store";

function comUrl(r: Response, url: string): Response {
  Object.defineProperty(r, "url", { value: url });
  return r;
}

beforeEach(() => {
  resposta.valor = () => new Response(JSON.stringify({ products: [] }), { headers: { "content-type": "application/json" } });
});

describe("products.json de vitrine com senha", () => {
  it("401: LojaComSenhaError", async () => {
    resposta.valor = () => new Response("", { status: 401 });
    await expect(fetchPublicShopifyProducts("zapas.myshopify.com")).rejects.toBeInstanceOf(LojaComSenhaError);
  });

  it("redirecionado para /password (HTML 200): LojaComSenhaError", async () => {
    resposta.valor = () =>
      comUrl(
        new Response("<html>senha</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
        "https://zapas.myshopify.com/password"
      );
    const erro = await fetchPublicShopifyProducts("zapas.myshopify.com").catch((e) => e);
    expect(erro).toBeInstanceOf(LojaComSenhaError);
    expect(erro.dominio).toBe("zapas.myshopify.com");
  });

  it("loja aberta: le normalmente", async () => {
    resposta.valor = () =>
      new Response(
        JSON.stringify({
          products: [
            {
              id: 1,
              title: "Tenis",
              handle: "tenis",
              body_html: "",
              vendor: "X",
              product_type: "",
              tags: [],
              options: [{ name: "Cor" }],
              images: [],
              variants: [{ id: 10, title: "Preto", sku: "t", price: "1.00", option1: "Preto" }],
            },
          ],
        }),
        { headers: { "content-type": "application/json" } }
      );
    const r = await fetchPublicShopifyProducts("aberta.myshopify.com", { limit: 1 });
    expect(r.products).toHaveLength(1);
  });

  it("outro erro (500) continua o erro de sempre, nao vira senha", async () => {
    resposta.valor = () => new Response("", { status: 500 });
    const erro = await fetchPublicShopifyProducts("zapas.myshopify.com").catch((e) => e);
    expect(erro).not.toBeInstanceOf(LojaComSenhaError);
    expect(String(erro.message)).toContain("(500)");
  });
});
