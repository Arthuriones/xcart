import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildCartPermalink } from "../src/lib/shopify/cart-routing";

/**
 * A loja de checkout nao pode saber de onde o comprador veio.
 *
 * O Referer ja e tratado no loader (rel="noreferrer") e no tema
 * (meta same-origin). Este teste cobre o outro vazamento, que e pior porque e
 * permanente: qualquer `attributes[...]` na URL do permalink vira
 * note_attributes no PEDIDO e entra no landing_site. Fica no admin da loja de
 * checkout, em toda venda, para sempre.
 *
 * Ate 2026-09 o servidor mandava `attributes[routed_checkout]=<id da rota>`.
 * Ninguem lia -- a atribuicao vem do targetId no corpo do track-fallback --
 * e o caminho inline do loader nunca mandou, entao os dois caminhos geravam
 * URLs diferentes para o mesmo carrinho.
 */
describe("permalink de checkout nao carrega rastro da vitrine", () => {
  const linhas = [
    { variantId: "44749341851690", quantity: 1 },
    { variantId: "44751775662122", quantity: 2 },
  ];

  it("monta so o caminho do carrinho e o mercado", () => {
    const url = new URL(
      buildCartPermalink("checkout.exemplo.com", linhas, { country: "CL", locale: "es" })
    );
    expect(url.pathname).toBe("/cart/44749341851690:1,44751775662122:2");
    expect([...url.searchParams.keys()].sort()).toEqual(["country", "locale"]);
  });

  it("sem mercado, a URL nao tem query nenhuma", () => {
    const url = new URL(buildCartPermalink("checkout.exemplo.com", linhas));
    expect(url.search).toBe("");
  });

  it("nenhum parametro carrega id de rota, loja ou usuario", () => {
    const url = buildCartPermalink("checkout.exemplo.com", linhas, {
      country: "CL",
      locale: "es",
    });
    // `attributes[` e o que a Shopify persiste no pedido; os outros sao os
    // nomes que ja foram usados e nao podem voltar.
    for (const proibido of ["attributes[", "routed_checkout", "routed_mode", "ref="]) {
      expect(url).not.toContain(proibido);
    }
  });

  /**
   * O servidor e o loader montam a MESMA URL por caminhos diferentes: o loader
   * resolve inline quando o mapa cobre o carrinho, e so cai na API quando nao
   * cobre. Se um dos dois acrescentar parametro, o comprador passa a deixar
   * rastro dependendo da rota que o codigo tomou -- que e o pior tipo de bug,
   * porque some em teste e aparece em producao.
   */
  it("o caminho inline do loader tambem nao acrescenta parametro", () => {
    const loader = readFileSync(
      path.join(process.cwd(), "public", "routed-checkout-loader.js"),
      "utf8"
    );
    expect(loader).not.toContain("attributes[");

    // Os unicos searchParams que o loader pode setar na URL de destino.
    const setados = [...loader.matchAll(/url\.searchParams\.set\(\s*"([^"]+)"/g)].map(
      (m) => m[1]
    );
    expect(setados.sort()).toEqual(["country", "locale"]);
  });
});
