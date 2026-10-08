import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// ============================================================================
// O cliente da Admin API nao segue redirect.
//
// `hostDaLoja` aprova so o host INICIAL. Com o `follow` padrao do fetch, um
// dominio publico do usuario respondia 302 para http://169.254.169.254/... e o
// servidor ia atras -- e o corpo do destino voltava na mensagem de erro, que
// /api/shopify/connect devolve na tela.
// ============================================================================

// O DNS nao e o assunto aqui: o host passa como veio.
vi.mock("@/lib/shopify/safe-shop", () => ({
  ShopDomainError: class extends Error {},
  assertShopDomainPublico: async (d: string) => d,
}));

import { ShopifyClientError, shopifyGraphQL, shopifyRestGet } from "@/lib/shopify/client";

const credsDe = (shopDomain: string) => ({
  shopDomain,
  clientId: "cid",
  clientSecret: "sec",
  // Com o token pronto o cliente nao chama /admin/oauth/access_token.
  accessToken: "shpat_x",
});

function fetchFalso(resposta: () => Response) {
  const fn = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => resposta());
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Admin API sem redirect", () => {
  it("todo fetch de client.ts pede redirect: manual", () => {
    const fonte = readFileSync(
      path.resolve(__dirname, "..", "src", "lib", "shopify", "client.ts"),
      "utf8"
    );
    const fetches = fonte.match(/(?<![.\w])fetch\s*\(/g) || [];
    const manuais = fonte.match(/redirect:\s*"manual"/g) || [];
    expect(fetches.length).toBeGreaterThan(0);
    expect(manuais.length).toBe(fetches.length);
  });

  it("302 para o metadata da nuvem: recusa, sem seguir", async () => {
    const fn = fetchFalso(
      () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        })
    );
    const erro = await shopifyGraphQL(credsDe("loja-do-atacante.com"), "{ shop { name } }").catch(
      (e) => e
    );
    expect(erro).toBeInstanceOf(ShopifyClientError);
    expect(erro.code).toBe("INVALID_DOMAIN");
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0][1]?.redirect).toBe("manual");
  });

  it("REST tambem recusa redirect", async () => {
    fetchFalso(() => new Response(null, { status: 301, headers: { location: "http://10.0.0.1/" } }));
    await expect(shopifyRestGet(credsDe("x.myshopify.com"), "shipping_zones.json")).rejects.toMatchObject({
      code: "INVALID_DOMAIN",
    });
  });

  it("corpo de erro de dominio proprio nao volta na mensagem; da Shopify, volta", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchFalso(() => new Response("ami-id SEGREDO-INTERNO", { status: 500 }));
    const deFora = await shopifyGraphQL(credsDe("loja-do-atacante.com"), "{ shop { name } }").catch(
      (e) => e
    );
    expect(deFora.message).not.toContain("SEGREDO");

    fetchFalso(() => new Response("detalhe da shopify", { status: 500 }));
    const daShopify = await shopifyGraphQL(credsDe("x.myshopify.com"), "{ shop { name } }").catch(
      (e) => e
    );
    expect(daShopify.message).toContain("detalhe da shopify");
  });

  it("200 que nao e JSON: erro nosso, sem trecho do corpo", async () => {
    fetchFalso(() => new Response("SEGREDO-INTERNO nao e json", { status: 200 }));
    const erro = await shopifyGraphQL(credsDe("loja-do-atacante.com"), "{ shop { name } }").catch(
      (e) => e
    );
    expect(erro).toBeInstanceOf(ShopifyClientError);
    expect(erro.message).not.toContain("SEGREDO");
  });
});
