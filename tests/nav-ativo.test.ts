import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { hrefAtivo } from "../src/components/layout/nav-ativo";
import {
  ATALHOS_G,
  BARRA_CELULAR,
  ITENS,
  SECOES_CONFIGURACOES,
  contextoDaRota,
  gruposNav,
  itemAcesoNoMenu,
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
 * O menu focado: Lucro, Rastreamento e Configuracoes, com Assinatura (e o saldo
 * de creditos) no pe. Alertas mora no sino; Custos, Lojas, Integracoes e os
 * modulos moram em Configuracoes. Toda tela continua com item proprio em
 * ITENS: a busca (Ctrl K) e os atalhos "g + letra" ainda a acham.
 */
describe("itemAtivo (todas as telas)", () => {
  it("cada tela acende o proprio item", () => {
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
    expect(itemAtivo("/configuracoes")).toBe("configuracoes");
  });

  it("telas antigas acendem o item que vai recebe-las", () => {
    expect(itemAtivo("/clone/shopify/bulk")).toBe("importar");
    expect(itemAtivo("/bulk")).toBe("importar");
    expect(itemAtivo("/multi-site")).toBe("importar");
    expect(itemAtivo("/clone/routed-checkout/map")).toBe("rotas");
    expect(itemAtivo("/overview")).toBe("visaoRota");
    expect(itemAtivo("/sales")).toBe("vendasRota");
    expect(itemAtivo("/financeiro/anuncios")).toBe("integracoes");
    expect(itemAtivo("/integracoes/meta")).toBe("integracoes");
    // O Claude mora em Integracoes -> Avancado; /claude redireciona para la.
    expect(itemAtivo("/claude")).toBe("claude");
    expect(itemAtivo("/integracoes/avancado")).toBe("claude");
  });

  it("rota fora do app nao acende nada", () => {
    expect(itemAtivo("/qualquer-coisa")).toBeNull();
    expect(itemAtivo("/clonex")).toBeNull();
    expect(itemAtivo("/configuracoesx")).toBeNull();
  });
});

describe("gruposNav (menu focado)", () => {
  const ids = (temRota: boolean) => gruposNav(temRota).flatMap((g) => g.itens.map((i) => i.id));

  it("menu completo: Financeiro, Rastreamento, Operacoes e Sistema; Roteamento so para quem tem rota", () => {
    expect(gruposNav(false).map((g) => g.id)).toEqual(["lucro", "rastreamento", "operacao", "configuracoes"]);
    expect(ids(false)).toEqual([
      "lucro", "custos", "saude", "eventos", "alertas",
      "lojas", "importar", "atividade", "integracoes", "configuracoes", "assinatura",
    ]);
    expect(gruposNav(true).map((g) => g.id)).toEqual(["lucro", "rastreamento", "operacao", "roteamento", "configuracoes"]);
    const rota = gruposNav(true).find((g) => g.id === "roteamento")!;
    expect(rota.rotulo).toBe("Roteamento");
    expect(rota.itens.map((i) => i.href)).toEqual(["/overview", "/clone/routed-checkout", "/sales"]);
    expect(rota.itens[1].rotulo).toBe("Rotas");
  });

  it("o Lucro abre o menu", () => {
    expect(gruposNav(false)[0].itens[0].href).toBe("/financeiro");
  });

  it("Assinatura continua no menu, com o saldo de creditos, no pe", () => {
    for (const temRota of [false, true]) {
      const pe = gruposNav(temRota).at(-1)!;
      expect(pe.fim).toBe(true);
      const assinatura = pe.itens.find((i) => i.id === "assinatura");
      expect(assinatura?.href).toBe("/billing");
      expect(assinatura?.contador).toBe("creditos");
    }
  });

  it("sem Campanhas (a tela ainda nao existe) e roteamento so com rota", () => {
    for (const temRota of [false, true]) {
      const rotulos = gruposNav(temRota).flatMap((g) => g.itens.map((i) => i.rotulo));
      expect(rotulos).not.toContain("Campanhas");
    }
    expect(ids(false)).not.toContain("rotas");
  });
});

describe("itemAcesoNoMenu (nenhum item acende errado)", () => {
  it("cada item do menu acende so ele mesmo, com e sem rota", () => {
    for (const temRota of [false, true]) {
      const grupos = gruposNav(temRota);
      for (const item of grupos.flatMap((g) => g.itens)) {
        expect(itemAcesoNoMenu(item.href, grupos), item.href).toBe(item.id);
      }
    }
  });

  it("tela fora do menu acende Configuracoes, onde ela mora", () => {
    const grupos = gruposNav(false);
    for (const caminho of ["/integracoes/notificacoes", "/claude", "/setup", "/clone/routed-checkout", "/overview", "/sales"]) {
      const aceso = itemAcesoNoMenu(caminho, grupos);
      expect(["configuracoes", "integracoes"], caminho).toContain(aceso);
    }
  });

  it("Custos nao acende o Lucro, e Eventos nao acende a Saude", () => {
    const grupos = gruposNav(false);
    expect(itemAcesoNoMenu("/financeiro/custos", grupos)).not.toBe("lucro");
    expect(itemAcesoNoMenu("/tracking/eventos", grupos)).toBe("eventos");
    expect(itemAcesoNoMenu("/tracking", grupos)).toBe("saude");
  });

  it("quem tem rota ve a propria rota acesa, nao Configuracoes", () => {
    const grupos = gruposNav(true);
    expect(itemAcesoNoMenu("/clone/routed-checkout/map", grupos)).toBe("rotas");
    expect(itemAcesoNoMenu("/overview", grupos)).toBe("visaoRota");
    expect(itemAcesoNoMenu("/sales", grupos)).toBe("vendasRota");
    expect(itemAcesoNoMenu("/clone", grupos)).toBe("importar");
  });

  it("Alertas acende Alertas; rota fora do app nao acende nada", () => {
    const grupos = gruposNav(false);
    expect(itemAcesoNoMenu("/alertas", grupos)).toBe("alertas");
    expect(itemAcesoNoMenu("/qualquer-coisa", grupos)).toBeNull();
  });
});

describe("barra do celular e atalhos", () => {
  it("Lucro, Rastreamento e Alertas (o Mais abre o resto)", () => {
    expect(BARRA_CELULAR.map((b) => b.rotulo)).toEqual(["Dashboard", "Rastreamento", "Alertas"]);
    expect(BARRA_CELULAR[1].acende).toEqual(["saude", "eventos"]);
  });

  it("atalhos g + letra sem letra repetida e sem o proprio g", () => {
    const teclas = ATALHOS_G.map((a) => a.tecla);
    expect(new Set(teclas).size).toBe(teclas.length);
    expect(teclas).not.toContain("g");
    expect(ATALHOS_G.find((a) => a.tecla === "l")?.item.href).toBe("/financeiro");
  });

  it("nenhum atalho antigo sumiu, mesmo das telas que sairam do menu", () => {
    const destino = Object.fromEntries(ATALHOS_G.map((a) => [a.tecla, a.item.href]));
    expect(destino).toMatchObject({
      l: "/financeiro",
      c: "/financeiro/custos",
      s: "/tracking",
      e: "/tracking/eventos",
      a: "/alertas",
      o: "/stores",
      m: "/clone",
      t: "/activity",
      r: "/clone/routed-checkout",
      i: "/integracoes",
      b: "/billing",
    });
  });
});

describe("indice de /configuracoes", () => {
  const links = SECOES_CONFIGURACOES.flatMap((s) => s.links);
  const hrefs = links.map((l) => l.href);

  it("Contas, Geral e Modulos", () => {
    expect(SECOES_CONFIGURACOES.map((s) => s.titulo)).toEqual(["Contas", "Geral", "Módulos"]);
    const modulos = SECOES_CONFIGURACOES.find((s) => s.id === "modulos")!.links.map((l) => l.rotulo);
    expect(modulos).toEqual(["Roteamento", "Importar", "Atividade", "Claude (MCP)", "Guia de configuração"]);
  });

  it("todo link cai numa tela conhecida, sem repetir", () => {
    expect(new Set(hrefs).size).toBe(hrefs.length);
    for (const href of hrefs) expect(itemAtivo(href), href).not.toBeNull();
    for (const l of links) expect(l.dica.length, l.href).toBeGreaterThan(0);
  });

  it("toda tela que saiu do menu esta no indice (menos Alertas, que esta no sino)", () => {
    const noMenu = new Set(gruposNav(false).flatMap((g) => g.itens.map((i) => i.id)));
    const noIndice = new Set(hrefs.map((h) => itemAtivo(h)));
    // Visao da rota e Vendas por rota abrem pelo grupo Roteamento de quem tem rota.
    const pelaRota = new Set(["visaoRota", "vendasRota"]);
    for (const item of Object.values(ITENS)) {
      if (noMenu.has(item.id) || item.id === "alertas" || pelaRota.has(item.id)) continue;
      expect(noIndice.has(item.id), item.id).toBe(true);
    }
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
    // Vendas e Atividade leem a loja da barra (o periodo de Vendas fica na tela).
    expect(contextoDaRota("/sales").tipo).toBe("loja");
    expect(contextoDaRota("/activity").tipo).toBe("loja");
    // O console de rotas nao le o filtro global: sem barra, para o seletor de
    // loja nao fingir que filtra.
    expect(contextoDaRota("/clone/routed-checkout").tipo).toBe("nenhum");
    expect(contextoDaRota("/stores").tipo).toBe("nenhum");
  });

  it("titulo pelo prefixo mais longo", () => {
    expect(tituloDaRota("/tracking/eventos")).toBe("Eventos ao vivo");
    expect(tituloDaRota("/clone")).toBe("Importar");
    expect(tituloDaRota("/clone/shopify/individual")).toBe("Importar da Shopify");
    // O mesmo nome do item do menu.
    expect(tituloDaRota("/clone/routed-checkout/map")).toBe("Rotas");
    expect(tituloDaRota("/configuracoes")).toBe("Configurações");
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
      // Indice de Configuracoes
      "accounts",
      "general",
      "modules",
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
