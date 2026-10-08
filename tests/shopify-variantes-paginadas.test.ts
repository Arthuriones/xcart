import { afterEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// Produto com mais de 50 variantes na Admin API.
//
// A consulta de produtos traz 50 variantes por produto. Na rota Yarden Store
// -> pauments o produto do checkout nasceu com 50 de 66 e 16 variantes da
// vitrine ficaram sem par. O teto da Shopify e 2048 por produto desde
// 15/10/2025, e lista em argumento aceita no maximo 250 itens por chamada.
// ============================================================================

vi.mock("@/lib/shopify/safe-shop", () => ({
  ShopDomainError: class extends Error {},
  assertShopDomainPublico: async (d: string) => d,
}));

import {
  addProductVariants,
  completarVariantes,
  emLotes,
  MAX_VARIANTES_POR_PRODUTO,
} from "@/lib/shopify/client";
import { verificarLoja } from "@/lib/shopify/store-health";

const creds = { shopDomain: "loja.myshopify.com", clientId: "c", clientSecret: "s", accessToken: "shpat_x" };

type Corpo = { query: string; variables?: Record<string, unknown> };

function fetchFalso(responder: (corpo: Corpo, url: string) => Response) {
  const fn = vi.fn(async (url: string, init?: RequestInit) =>
    responder(init?.body ? (JSON.parse(String(init.body)) as Corpo) : { query: "" }, url)
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

const variantes = (de: number, ate: number) =>
  Array.from({ length: ate - de }, (_, i) => ({ id: `gid://shopify/ProductVariant/${de + i}`, sku: `s${de + i}` }));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("completarVariantes", () => {
  it("le de 250 em 250 o que veio depois da 50a, no produto certo", async () => {
    const fn = fetchFalso(({ variables }) => {
      if (variables?.after === "c50") {
        return json({ data: { product: { variants: { nodes: variantes(50, 300), pageInfo: { hasNextPage: true, endCursor: "c300" } } } } });
      }
      return json({ data: { product: { variants: { nodes: variantes(300, 316), pageInfo: { hasNextPage: false, endCursor: null } } } } });
    });
    const produto = {
      id: "gid://shopify/Product/1",
      variants: { nodes: variantes(0, 50) as unknown[], pageInfo: { hasNextPage: true, endCursor: "c50" } },
    };

    await completarVariantes(creds, [produto]);

    expect(produto.variants.nodes).toHaveLength(316);
    expect(produto.variants.pageInfo).toEqual({ hasNextPage: false, endCursor: null });
    expect(fn).toHaveBeenCalledTimes(2);
    const primeiro = JSON.parse(String(fn.mock.calls[0][1]?.body)) as Corpo;
    expect(primeiro.variables).toEqual({ id: "gid://shopify/Product/1", after: "c50" });
    expect(primeiro.query).toContain("variants(first: 250, after: $after)");
  });

  it("produto que veio inteiro: nenhuma chamada", async () => {
    const fn = fetchFalso(() => json({ data: {} }));
    await completarVariantes(creds, [
      { id: "gid://shopify/Product/2", variants: { nodes: variantes(0, 3), pageInfo: { hasNextPage: false, endCursor: null } } },
      { id: "gid://shopify/Product/3", variants: { nodes: variantes(0, 3) } },
    ]);
    expect(fn).not.toHaveBeenCalled();
  });

  it("para no teto de 2048 mesmo se a Shopify disser que ha mais", async () => {
    let n = 50;
    fetchFalso(() => {
      const pagina = variantes(n, n + 250);
      n += 250;
      return json({ data: { product: { variants: { nodes: pagina, pageInfo: { hasNextPage: true, endCursor: `c${n}` } } } } });
    });
    const produto = { id: "gid://shopify/Product/4", variants: { nodes: variantes(0, 50) as unknown[], pageInfo: { hasNextPage: true, endCursor: "c50" } } };
    await completarVariantes(creds, [produto]);
    expect(produto.variants.nodes.length).toBeGreaterThanOrEqual(MAX_VARIANTES_POR_PRODUTO);
    expect(produto.variants.nodes.length).toBeLessThan(MAX_VARIANTES_POR_PRODUTO + 250);
  });
});

describe("criar variantes em lotes de 250", () => {
  it("emLotes corta sem perder nem reordenar", () => {
    const lotes = emLotes(Array.from({ length: 501 }, (_, i) => i));
    expect(lotes.map((l) => l.length)).toEqual([250, 250, 1]);
    expect(lotes.flat()[500]).toBe(500);
  });

  it("addProductVariants com 300: duas chamadas, resultado na ordem pedida", async () => {
    let base = 0;
    const fn = fetchFalso(({ variables }) => {
      const lote = (variables?.variants as unknown[]) || [];
      const criadas = lote.map((_, i) => ({ id: `gid://shopify/ProductVariant/${base + i}`, sku: null }));
      base += lote.length;
      return json({ data: { productVariantsBulkCreate: { productVariants: criadas, userErrors: [] } } });
    });
    const pedido = Array.from({ length: 300 }, (_, i) => ({ price: "10.00", sku: `s${i}`, optionValues: [`cor-${i}`] }));

    const criadas = await addProductVariants(creds, "gid://shopify/Product/1", ["Cor"], pedido);

    expect(fn).toHaveBeenCalledTimes(2);
    const tamanhos = fn.mock.calls.map((c) => ((JSON.parse(String(c[1]?.body)) as Corpo).variables?.variants as unknown[]).length);
    expect(tamanhos).toEqual([250, 50]);
    expect(criadas).toHaveLength(300);
    expect(criadas[299].id).toBe("gid://shopify/ProductVariant/299");
  });
});

describe("saude da loja: o motivo pelo codigo do erro, e o nome e a moeda", () => {
  it("credencial revogada (sem 401 no texto) vira sem_acesso, nao erro generico", async () => {
    fetchFalso(() => new Response("invalid_client", { status: 400 }));
    const r = await verificarLoja({ ...creds, accessToken: null, clientId: "revogado" });
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe("sem_acesso");
  });

  it("402 da Admin API: congelada", async () => {
    fetchFalso(() => new Response("", { status: 402 }));
    const r = await verificarLoja(creds);
    expect(r.motivo).toBe("congelada");
  });

  it("loja no ar: devolve o nome atual e a moeda", async () => {
    fetchFalso(() => json({ data: { shop: { name: "Checkout Neutro", currencyCode: "BRL" } } }));
    const r = await verificarLoja(creds);
    expect(r).toMatchObject({ ok: true, nome: "Checkout Neutro", moeda: "BRL" });
  });
});
