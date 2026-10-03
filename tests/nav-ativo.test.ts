import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hrefAtivo } from "../src/components/layout/nav-ativo";
import {
  ATALHOS_G,
  contextoDaRota,
  gruposNav,
  itemAtivo,
  tituloDaRota,
} from "../src/components/layout/navegacao";

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

/**
 * O menu do redesign (6 grupos) junta telas antigas em itens novos: /bulk e
 * /multi-site acendem Importar, Contas de anuncio e Claude acendem
 * Integracoes. Visao da rota e Vendas por rota tem item proprio ate virarem
 * abas do detalhe da rota. Um item aceso por vez, sempre.
 */
describe("itemAtivo (menu de 6 grupos)", () => {
  it("cada tela do menu acende o proprio item", () => {
    expect(itemAtivo("/financeiro")).toBe("lucro");
    expect(itemAtivo("/financeiro/custos")).toBe("custos");
    expect(itemAtivo("/tracking")).toBe("saude");
    expect(itemAtivo("/tracking/eventos")).toBe("eventos");
    expect(itemAtivo("/alertas")).toBe("alertas");
    expect(itemAtivo("/stores")).toBe("lojas");
    expect(itemAtivo("/clone")).toBe("importar");
    expect(itemAtivo("/activity")).toBe("atividade");
    expect(itemAtivo("/clone/routed-checkout")).toBe("rotas");
    expect(itemAtivo("/billing")).toBe("assinatura");
    expect(itemAtivo("/setup")).toBe("guia");
  });

  it("telas antigas acendem o item que vai recebe-las", () => {
    expect(itemAtivo("/clone/shopify/bulk")).toBe("importar");
    expect(itemAtivo("/bulk")).toBe("importar");
    expect(itemAtivo("/multi-site")).toBe("importar");
    expect(itemAtivo("/clone/routed-checkout/map")).toBe("rotas");
    expect(itemAtivo("/overview")).toBe("visaoRota");
    expect(itemAtivo("/sales")).toBe("vendasRota");
    expect(itemAtivo("/financeiro/anuncios")).toBe("integracoes");
    expect(itemAtivo("/claude")).toBe("integracoes");
  });

  it("rota fora do menu nao acende nada", () => {
    expect(itemAtivo("/qualquer-coisa")).toBeNull();
    expect(itemAtivo("/clonex")).toBeNull();
  });

  it("os seis grupos, com Roteamento recolhido para quem nao tem rota", () => {
    const sem = gruposNav(false);
    expect(sem.map((g) => g.id)).toEqual([
      "lucro",
      "rastreamento",
      "alertas",
      "operacao",
      "roteamento",
      "configuracoes",
    ]);
    const rotaSem = sem.find((g) => g.id === "roteamento")!.itens;
    expect(rotaSem).toHaveLength(1);
    expect(rotaSem[0].rotulo).toBe("Ativar roteamento");
    expect(rotaSem[0].href).toBe("/clone/routed-checkout");
    const rotaCom = gruposNav(true).find((g) => g.id === "roteamento")!.itens;
    expect(rotaCom.map((i) => i.href)).toEqual(["/overview", "/clone/routed-checkout", "/sales"]);
    expect(rotaCom[1].rotulo).toBe("Rotas");
  });

  it("atalhos g + letra sem letra repetida e sem o proprio g", () => {
    const teclas = ATALHOS_G.map((a) => a.tecla);
    expect(new Set(teclas).size).toBe(teclas.length);
    expect(teclas).not.toContain("g");
    expect(ATALHOS_G.find((a) => a.tecla === "l")?.item.href).toBe("/financeiro");
  });
});

describe("contexto e titulo do topo", () => {
  it("so a tela que le o filtro global ganha a barra", () => {
    expect(contextoDaRota("/financeiro").tipo).toBe("completo");
    expect(contextoDaRota("/financeiro/custos").tipo).toBe("loja");
    expect(contextoDaRota("/financeiro/anuncios").tipo).toBe("nenhum");
    expect(contextoDaRota("/tracking/eventos").tipo).toBe("loja");
    expect(contextoDaRota("/alertas").tipo).toBe("loja");
    // Saude dos pixels le a loja da barra; a janela de 7 dias e fixa.
    expect(contextoDaRota("/tracking")).toEqual({
      tipo: "fixo",
      texto: "Últimos 7 dias · período fixo desta tela",
    });
    // Vendas ainda tem filtro proprio: sem barra.
    expect(contextoDaRota("/sales").tipo).toBe("nenhum");
    expect(contextoDaRota("/stores").tipo).toBe("nenhum");
  });

  it("titulo pelo prefixo mais longo", () => {
    expect(tituloDaRota("/tracking/eventos")).toBe("Eventos ao vivo");
    expect(tituloDaRota("/clone/shopify/individual")).toBe("Importar");
    expect(tituloDaRota("/clone/routed-checkout/map")).toBe("Roteamento");
    expect(tituloDaRota("/nao-existe")).toBe("xcart");
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
      // Menu do redesign
      "operation",
      "settings",
      "stores",
      "import",
      "routes",
      "enableRouting",
      "integrations",
      "setupGuide",
      "more",
      "skipToContent",
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
