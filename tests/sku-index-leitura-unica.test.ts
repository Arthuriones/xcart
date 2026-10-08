import { describe, expect, it, vi } from "vitest";

/**
 * O /resolve deixa a leitura do indice de SKU seguir depois da resposta
 * quando ela estoura o orcamento. A nova tentativa do comprador chega com a
 * leitura ainda em andamento: ela tem que esperar ESSA leitura, e nao abrir
 * outra das mesmas paginas do products.json.
 */

const { fetchWithImportProxy } = vi.hoisted(() => ({ fetchWithImportProxy: vi.fn() }));
vi.mock("@/lib/import/proxy-fetch", () => ({ fetchWithImportProxy }));

import { resolveVariantIdsBySku } from "@/lib/shopify/public-store";

function pagina(produtos: unknown[]) {
  return new Response(JSON.stringify({ products: produtos }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const PRODUTO = {
  id: 1,
  title: "Bolsa",
  handle: "bolsa",
  variants: [{ id: 987, sku: "XC-ABC", price: "10.00", option1: "Default Title" }],
  options: [{ name: "Title" }],
  images: [],
};

describe("indice de SKU: uma leitura por dominio", () => {
  it("duas chamadas com o indice frio fazem UMA leitura, e cada pagina tem prazo", async () => {
    let liberar!: () => void;
    const portao = new Promise<void>((r) => {
      liberar = r;
    });
    fetchWithImportProxy.mockImplementation(async (url: string) => {
      await portao;
      return url.includes("page=1") ? pagina([PRODUTO]) : pagina([]);
    });

    const dominio = "leitura-unica.myshopify.com";
    const primeira = resolveVariantIdsBySku(dominio, ["XC-ABC"]);
    const segunda = resolveVariantIdsBySku(dominio, ["xc-abc"]);
    liberar();

    expect(await primeira).toEqual(new Map([["XC-ABC", 987]]));
    expect(await segunda).toEqual(new Map([["xc-abc", 987]]));
    const paginas = fetchWithImportProxy.mock.calls.map((c) => c[0] as string);
    expect(paginas.filter((u) => u.includes("page=1"))).toHaveLength(1);
    for (const chamada of fetchWithImportProxy.mock.calls) {
      expect(chamada[2]?.timeoutMs).toBeGreaterThan(0);
    }

    // Com o indice pronto, a terceira nem vai a rede.
    const antes = fetchWithImportProxy.mock.calls.length;
    expect(await resolveVariantIdsBySku(dominio, ["XC-ABC"])).toEqual(new Map([["XC-ABC", 987]]));
    expect(fetchWithImportProxy.mock.calls.length).toBe(antes);
  });

  it("leitura que falhou nao fica presa: a proxima tenta de novo", async () => {
    fetchWithImportProxy.mockReset();
    fetchWithImportProxy.mockRejectedValueOnce(new Error("proxy caiu"));
    const dominio = "leitura-falhou.myshopify.com";
    expect(await resolveVariantIdsBySku(dominio, ["XC-ABC"])).toEqual(new Map());

    fetchWithImportProxy.mockImplementation(async (url: string) =>
      url.includes("page=1") ? pagina([PRODUTO]) : pagina([])
    );
    expect(await resolveVariantIdsBySku(dominio, ["XC-ABC"])).toEqual(new Map([["XC-ABC", 987]]));
  });
});
