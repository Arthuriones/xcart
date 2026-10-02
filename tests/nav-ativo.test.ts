import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hrefAtivo } from "../src/components/layout/nav-ativo";

/**
 * /tracking e /tracking/eventos estao no mesmo menu. Com o teste antigo
 * ("igual ou comeca com href/"), os dois acendiam em /tracking/eventos.
 */
describe("hrefAtivo", () => {
  const hrefs = [
    "/financeiro",
    "/financeiro/custos",
    "/tracking",
    "/tracking/eventos",
    "/alertas",
    "/clone/shopify",
    "/clone/routed-checkout",
  ];

  it("o mais longo vence: /tracking/eventos nao acende /tracking", () => {
    expect(hrefAtivo("/tracking/eventos", hrefs)).toBe("/tracking/eventos");
  });

  it("a tela pai continua acendendo sozinha", () => {
    expect(hrefAtivo("/tracking", hrefs)).toBe("/tracking");
    expect(hrefAtivo("/financeiro", hrefs)).toBe("/financeiro");
  });

  it("prefixo sem barra nao casa", () => {
    expect(hrefAtivo("/trackingx", hrefs)).toBeNull();
  });

  it("subrota acende o item mais especifico", () => {
    expect(hrefAtivo("/financeiro/custos/x", hrefs)).toBe("/financeiro/custos");
    expect(hrefAtivo("/clone/routed-checkout/map", hrefs)).toBe("/clone/routed-checkout");
  });

  it("rota fora do menu nao acende nada", () => {
    expect(hrefAtivo("/stores", hrefs)).toBeNull();
  });
});

describe("messages/pt.json", () => {
  const bruto = readFileSync(path.join(__dirname, "..", "messages", "pt.json"), "utf8");

  it("continua JSON valido e tem as chaves novas do menu", () => {
    const pt = JSON.parse(bruto) as { nav: Record<string, string> };
    const novas = [
      "finance",
      "profit",
      "costs",
      "adAccounts",
      "trackingGroup",
      "trackingHealth",
      "liveEvents",
      "alerts",
      "routingGroup",
      "routeOverview",
      "salesByRoute",
      "system",
    ];
    for (const chave of novas) {
      expect(typeof pt.nav[chave], chave).toBe("string");
      expect(pt.nav[chave].length, chave).toBeGreaterThan(0);
    }
    // Nenhuma chave antiga sai: telas fora do menu ainda usam.
    for (const antiga of ["overview", "sales", "tracking", "operations", "routing"]) {
      expect(typeof pt.nav[antiga], antiga).toBe("string");
    }
  });
});
