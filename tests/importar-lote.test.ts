import { describe, expect, it } from "vitest";
import {
  MAX_LINKS,
  PADRAO,
  corpoDoLote,
  corpoTentarDeNovo,
  detalheDoJob,
  emAndamento,
  erroDaApi,
  erroLegivel,
  estadoDoJob,
  faltaParaEnviar,
  idNumerico,
  lerLinks,
  linkCurto,
  linkNaShopify,
  lojaInicialDe,
  origemDoJob,
  passoLegivel,
  problemasDoLote,
  progressoDoJob,
  resumoDasOpcoes,
  tetoDeProdutos,
  usaIaDeImagem,
  type JobImportacao,
  type OpcoesLote,
} from "../src/app/(dashboard)/bulk/regras";

// ============================================================================
// Importar em lote (/bulk e /multi-site) e a fila do Importar. O que mais
// importa travar: o corpo do POST e o MESMO que as telas antigas mandavam
// (a API nao mudou), e o "Tentar de novo" repete o link com as opcoes que o
// processador gravou.
// ============================================================================

function job(parcial: Partial<JobImportacao>): JobImportacao {
  return {
    id: "j1",
    store_id: "loja-1",
    status: "pending",
    progress: { source: "https://pt.aliexpress.com/item/1.html" },
    result: null,
    error: null,
    created_at: "2026-10-03T12:00:00.000Z",
    updated_at: "2026-10-03T12:00:00.000Z",
    ...parcial,
  };
}

describe("corpoDoLote: o mesmo corpo das telas antigas", () => {
  it("/bulk com os padroes manda exatamente os campos de antes", () => {
    const corpo = corpoDoLote("links", "loja-1", ["a.com", "b.com"], PADRAO.links);
    expect(corpo).toEqual({
      storeId: "loja-1",
      sources: ["a.com", "b.com"],
      optimize: false,
      neutralizeProducts: false,
      removeExternalReferences: false,
      aiMediaLimit: 1,
      neutralizationInstructions: "",
      applyLogo: false,
      translateVariantOptions: false,
      enrichShopifyTaxonomy: false,
      useAiTaxonomyFallback: true,
      publishToStorefront: true,
      perSourceLimit: 1,
      inventoryMode: "not_tracked",
      inventoryQuantity: 100,
    });
  });

  it("/multi-site manda sourceType generic_site e `neutralize`, sem os campos do /bulk", () => {
    const o: OpcoesLote = { ...PADRAO.sites, limparReferencias: true, fotosComIa: "3", porLink: "20" };
    const corpo = corpoDoLote("sites", "loja-2", ["https://site.com/p"], o);
    expect(corpo).toEqual({
      storeId: "loja-2",
      sources: ["https://site.com/p"],
      sourceType: "generic_site",
      optimize: true,
      neutralize: true,
      aiMediaLimit: 3,
      neutralizationInstructions: "",
      applyLogo: false,
      translateVariantOptions: true,
      enrichShopifyTaxonomy: true,
      useAiTaxonomyFallback: true,
      publishToStorefront: true,
      perSourceLimit: 20,
      inventoryMode: "not_tracked",
      inventoryQuantity: 100,
    });
    expect(corpo).not.toHaveProperty("neutralizeProducts");
    expect(corpo).not.toHaveProperty("removeExternalReferences");
  });

  it("estoque definido vai como numero", () => {
    const o: OpcoesLote = { ...PADRAO.links, estoque: "tracked", quantidade: "7", tirarMarca: true };
    const corpo = corpoDoLote("links", "l", ["x"], o);
    expect(corpo.inventoryMode).toBe("tracked");
    expect(corpo.inventoryQuantity).toBe(7);
    expect(corpo.neutralizeProducts).toBe(true);
  });

  it("os padroes de cada origem sao os de antes", () => {
    expect(PADRAO.links.traduzir).toBe(false);
    expect(PADRAO.sites.traduzir).toBe(true);
    expect(PADRAO.sites.traduzirVariacoes).toBe(true);
    expect(PADRAO.sites.categoria).toBe(true);
    expect(PADRAO.links.categoria).toBe(false);
  });
});

describe("validacao do lote", () => {
  it("le uma linha por link, sem vazias", () => {
    expect(lerLinks("  a.com \n\n b.com\n   \n")).toEqual(["a.com", "b.com"]);
  });

  it("aponta tudo de uma vez", () => {
    const o: OpcoesLote = { ...PADRAO.links, limparReferencias: true, fotosComIa: "30", estoque: "tracked", quantidade: "" };
    const p = problemasDoLote("links", "", [], o);
    expect(Object.keys(p).sort()).toEqual(["fotos", "links", "loja", "quantidade"]);
    expect(faltaParaEnviar(p, 0)).toBe(
      "Falta escolher a loja, colar os links, corrigir as fotos refeitas por produto e corrigir a quantidade em estoque."
    );
  });

  it("mais de 20 links e problema, com a contagem", () => {
    const links = Array.from({ length: MAX_LINKS + 1 }, (_, i) => `l${i}.com`);
    const p = problemasDoLote("links", "loja", links, PADRAO.links);
    expect(p.links).toContain("21");
    expect(faltaParaEnviar(p, links.length)).toBe("Falta deixar no máximo 20 links.");
  });

  it("fotos so contam com a IA de imagem ligada", () => {
    const o: OpcoesLote = { ...PADRAO.links, fotosComIa: "0" };
    expect(problemasDoLote("links", "l", ["a"], o)).toEqual({});
    expect(usaIaDeImagem({ ...o, tirarMarca: true }, "links")).toBe(true);
    // Em "sites" nao existe "tirar a marca": so a limpeza liga a IA.
    expect(usaIaDeImagem({ ...o, tirarMarca: true }, "sites")).toBe(false);
  });

  it("lote valido nao tem pendencia", () => {
    expect(faltaParaEnviar(problemasDoLote("links", "l", ["a"], PADRAO.links), 1)).toBeNull();
  });

  it("teto de produtos e o resumo das opcoes", () => {
    expect(tetoDeProdutos(3, "20")).toBe(60);
    expect(tetoDeProdutos(2, "")).toBe(2);
    expect(resumoDasOpcoes("sites", PADRAO.sites)).toEqual([
      "Publicar na loja",
      "Traduzir",
      "Traduzir variações",
      "Categoria (com IA)",
    ]);
  });
});

describe("loja ja escolhida", () => {
  const lojas = [
    { id: "a", semAcesso: false },
    { id: "b", semAcesso: false },
    { id: "c", semAcesso: true },
  ];
  it("vale a da URL quando e do usuario e tem acesso", () => {
    expect(lojaInicialDe(lojas, "b")).toBe("b");
    expect(lojaInicialDe(lojas, "c")).toBe("");
    expect(lojaInicialDe(lojas, "zzz")).toBe("");
  });
  it("com uma so com acesso, ela; com varias, ninguem escolhe pelo lojista", () => {
    expect(lojaInicialDe([{ id: "a", semAcesso: false }, { id: "c", semAcesso: true }], null)).toBe("a");
    expect(lojaInicialDe(lojas, null)).toBe("");
  });
});

describe("a fila", () => {
  it("estado em portugues pelo mapa da fundacao", () => {
    expect(estadoDoJob("pending")).toBe("naFila");
    expect(estadoDoJob("processing")).toBe("rodando");
    expect(estadoDoJob("completed")).toBe("concluida");
    expect(estadoDoJob("failed")).toBe("falhou");
    expect(estadoDoJob("qualquer")).toBe("naFila");
    expect(emAndamento({ status: "processing" })).toBe(true);
    expect(emAndamento({ status: "failed" })).toBe(false);
  });

  it("passo do processador vira frase com acento", () => {
    expect(passoLegivel("Importando origem")).toBe("Lendo o link");
    expect(passoLegivel("Retirando referencias externas e publicando")).toBe("Limpando referências e publicando");
    expect(passoLegivel("algo novo")).toBeNull();
  });

  it("progresso so enquanto roda e com total", () => {
    expect(progressoDoJob(job({ status: "processing", progress: { current: 3, total: 10 } }))).toEqual({
      atual: 3,
      total: 10,
    });
    expect(progressoDoJob(job({ status: "completed", progress: { total: 10 } }))).toBeNull();
    expect(progressoDoJob(job({ status: "processing", progress: { step: "Carregando loja" } }))).toBeNull();
    expect(progressoDoJob(job({ status: "processing", progress: { current: 99, total: 5 } }))?.atual).toBe(5);
  });

  it("detalhe por estado", () => {
    expect(detalheDoJob(job({}))).toBe("Esperando a vez na fila");
    expect(
      detalheDoJob(
        job({ status: "processing", progress: { step: "Publicando", current: 2, total: 5, product: { title: "Camiseta" } } })
      )
    ).toBe("Publicando: 2 de 5 · Camiseta");
    expect(detalheDoJob(job({ status: "completed", result: { products: [] } }))).toBe(
      "Nenhum produto foi criado a partir deste link."
    );
    expect(
      detalheDoJob(
        job({ status: "completed", result: { products: [{ title: "Bolsa", shopifyProductId: "gid://shopify/Product/9" }] } })
      )
    ).toBe("1 produto criado: Bolsa");
    expect(detalheDoJob(job({ status: "failed", error: "Loja de destino nao encontrada." }))).toBe(
      "A loja de destino não foi encontrada. Ela pode ter sido removida."
    );
  });

  it("link para a Shopify: o produto, a lista ou nada", () => {
    const um = job({ status: "completed", result: { products: [{ shopifyProductId: "gid://shopify/Product/123" }] } });
    const dois = job({
      status: "completed",
      result: {
        products: [{ shopifyProductId: "gid://shopify/Product/1" }, { shopifyProductId: "gid://shopify/Product/2" }],
      },
    });
    expect(linkNaShopify("loja.myshopify.com", um)).toBe("https://loja.myshopify.com/admin/products/123");
    expect(linkNaShopify("loja.myshopify.com", dois)).toBe("https://loja.myshopify.com/admin/products");
    expect(linkNaShopify("evil.com/x", um)).toBeNull();
    expect(linkNaShopify("loja.myshopify.com", job({ status: "completed" }))).toBeNull();
    expect(idNumerico("gid://shopify/ProductVariant/1")).toBeNull();
  });

  it("origem: o que a importacao achou vence o pedido", () => {
    expect(origemDoJob(job({ progress: { sourceType: "auto" }, result: { sourceType: "aliexpress" } }))).toBe("AliExpress");
    expect(origemDoJob(job({ progress: { sourceType: "generic_site" } }))).toBe("Outro site");
    expect(origemDoJob(job({ progress: { sourceType: "auto" } }))).toBeNull();
  });

  it("link curto", () => {
    expect(linkCurto("https://www.loja.com/products/x/")).toBe("loja.com/products/x");
    expect(linkCurto("")).toBe("Link sem endereço");
  });

  it("erro cru vira portugues, sem nome de fornecedor", () => {
    expect(erroLegivel("Bright Data request failed (502)")).not.toMatch(/bright/i);
    expect(erroLegivel("Nao foi possivel ler a pagina (403).")).toBe(
      "O site de origem não abriu a página. Confira o link."
    );
    expect(erroLegivel("algo estranho")).toBe("A importação deste link falhou.");
    expect(erroDaApi(401, "Unauthorized")).toBe("Sua sessão expirou. Entre de novo.");
    expect(erroDaApi(400, "Maximo de 20 origens por lote.")).toBe("No máximo 20 links por vez.");
    expect(erroDaApi(0, null)).toMatch(/conexão/);
  });
});

describe("Tentar de novo", () => {
  it("repete o link com as opcoes gravadas pelo POST", () => {
    const corpo = corpoTentarDeNovo(
      job({
        status: "failed",
        progress: {
          source: "https://site.com/p",
          sourceType: "generic_site",
          optimize: true,
          neutralize: false,
          removeExternalReferences: true,
          aiMediaLimit: 2,
          genericizeText: true,
          neutralizationInstructions: "manter o escudo",
          customPrompt: "",
          applyLogo: true,
          translateVariantOptions: true,
          enrichShopifyTaxonomy: true,
          useAiTaxonomyFallback: true,
          publishToStorefront: false,
          perSourceLimit: 5,
          inventoryMode: "tracked",
          inventoryQuantity: 9,
          step: "Falhou",
        },
      })
    );
    expect(corpo).toEqual({
      storeId: "loja-1",
      sources: ["https://site.com/p"],
      sourceType: "generic_site",
      optimize: true,
      neutralizeProducts: false,
      removeExternalReferences: true,
      aiMediaLimit: 2,
      genericizeText: true,
      neutralizationInstructions: "manter o escudo",
      customPrompt: "",
      applyLogo: true,
      translateVariantOptions: true,
      enrichShopifyTaxonomy: true,
      useAiTaxonomyFallback: true,
      publishToStorefront: false,
      perSourceLimit: 5,
      inventoryMode: "tracked",
      inventoryQuantity: 9,
    });
  });

  it("sem link gravado nao ha o que repetir", () => {
    expect(corpoTentarDeNovo(job({ progress: {} }))).toBeNull();
    expect(corpoTentarDeNovo(job({ progress: null }))).toBeNull();
  });

  it("job antigo sem opcoes cai nos padroes da API", () => {
    const corpo = corpoTentarDeNovo(job({ progress: { source: "a.com" } }));
    expect(corpo).toMatchObject({
      sourceType: "auto",
      publishToStorefront: true,
      genericizeText: true,
      aiMediaLimit: 1,
      perSourceLimit: 1,
      inventoryMode: "not_tracked",
    });
  });
});
