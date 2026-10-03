import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  OPCOES_PADRAO,
  PASSOS,
  alternarGrupo,
  categoriasDoCatalogo,
  contar,
  erroNaTela,
  estadoDoGrupo,
  estimarCreditos,
  filtrarCatalogo,
  indexar,
  instrucoesTemEfeito,
  lerLimite,
  mensagemProgresso,
  miniatura,
  montarCorpo,
  montarInstrucoes,
  pareceEndereco,
  pareceLinkDeProduto,
  passoAnterior,
  porcentagem,
  precoNaTela,
  primeiroSku,
  proximoPasso,
  resumoOpcoes,
  resumoResultado,
  situacaoCreditos,
  travaDoPasso,
  travaParaIniciar,
  type Opcoes,
  type ProdutoOrigem,
  type Situacao,
} from "../src/app/(dashboard)/clone/shopify/regras";

const RAIZ = path.resolve(__dirname, "..");
const PASTA = path.join(RAIZ, "src", "app", "(dashboard)", "clone", "shopify");

function produto(p: Partial<ProdutoOrigem> & { handle: string }): ProdutoOrigem {
  return {
    id: 1,
    title: p.handle,
    images: [],
    variants: [{ id: 1, sku: null, price: "10.00" }],
    sourceUrl: "",
    ...p,
  };
}

function situacao(s: Partial<Situacao> = {}): Situacao {
  return {
    passo: "destino",
    escopo: "loja",
    destinoId: "d1",
    origem: "https://loja.com",
    colecaoEscolhida: false,
    catalogo: "lido",
    nCatalogo: 3,
    nMarcados: 2,
    opcoes: { rota: false, vitrineId: "", estoque: "livre", quantidade: "100" },
    ...s,
  };
}

describe("passos", () => {
  it("sao sempre seis, na ordem do brief", () => {
    expect(PASSOS.map((p) => p.rotulo)).toEqual(["Destino", "Escopo", "Origem", "Seleção", "Opções", "Revisão"]);
  });

  it("produto unico pula a Selecao nas duas direcoes", () => {
    expect(proximoPasso("origem", "produto")).toBe("opcoes");
    expect(passoAnterior("opcoes", "produto")).toBe("origem");
    expect(proximoPasso("origem", "loja")).toBe("selecao");
    expect(passoAnterior("opcoes", "colecao")).toBe("selecao");
    expect(proximoPasso("revisao", "loja")).toBeNull();
    expect(passoAnterior("destino", "loja")).toBeNull();
  });
});

describe("travas", () => {
  it("destino sem loja trava", () => {
    expect(travaDoPasso(situacao({ destinoId: "" }))).toBe("Escolha a loja de destino.");
  });

  it("origem: vazio, link sem /products/ no produto unico e colecao sem escolha", () => {
    expect(travaDoPasso(situacao({ passo: "origem", origem: " " }))).toMatch(/link da loja/);
    expect(travaDoPasso(situacao({ passo: "origem", escopo: "produto", origem: "https://loja.com" }))).toMatch(
      /\/products\//
    );
    expect(
      travaDoPasso(situacao({ passo: "origem", escopo: "produto", origem: "loja.com/products/camisa" }))
    ).toBeNull();
    expect(travaDoPasso(situacao({ passo: "origem", origem: "nao e link" }))).toMatch(/não parece/);
    expect(travaDoPasso(situacao({ passo: "origem", escopo: "colecao" }))).toMatch(/coleções/);
    expect(travaDoPasso(situacao({ passo: "origem", escopo: "colecao", colecaoEscolhida: true }))).toBeNull();
  });

  // O bug do brief: dava para avancar a Selecao sem ter lido o catalogo.
  it("selecao nao avanca sem o catalogo lido", () => {
    expect(travaDoPasso(situacao({ passo: "selecao", catalogo: "nao_lido" }))).toMatch(/Leia o catálogo/);
    expect(travaDoPasso(situacao({ passo: "selecao", catalogo: "lendo" }))).toMatch(/Aguarde/);
    expect(travaDoPasso(situacao({ passo: "selecao", catalogo: "erro" }))).toMatch(/Leia o catálogo/);
    expect(travaDoPasso(situacao({ passo: "selecao", nCatalogo: 0, nMarcados: 0 }))).toMatch(/não tem produtos/);
    expect(travaDoPasso(situacao({ passo: "selecao", nMarcados: 0 }))).toMatch(/ao menos um/);
    expect(travaDoPasso(situacao({ passo: "selecao" }))).toBeNull();
    // No produto unico a Selecao nao se aplica.
    expect(travaDoPasso(situacao({ passo: "selecao", escopo: "produto", catalogo: "nao_lido" }))).toBeNull();
  });

  it("rota pede a vitrine e ela nao pode ser o destino", () => {
    const op = (o: Partial<Situacao["opcoes"]>) => ({ ...situacao().opcoes, ...o });
    expect(travaDoPasso(situacao({ passo: "opcoes", opcoes: op({ rota: true }) }))).toMatch(/vitrine/);
    expect(travaDoPasso(situacao({ passo: "opcoes", opcoes: op({ rota: true, vitrineId: "d1" }) }))).toMatch(
      /outra loja/
    );
    expect(travaDoPasso(situacao({ passo: "opcoes", opcoes: op({ rota: true, vitrineId: "v1" }) }))).toBeNull();
    expect(travaDoPasso(situacao({ passo: "opcoes", opcoes: op({ estoque: "fixo", quantidade: "" }) }))).toMatch(
      /estoque/
    );
  });

  it("iniciar devolve o primeiro passo que trava", () => {
    expect(travaParaIniciar(situacao({ passo: "revisao" }))).toBeNull();
    expect(travaParaIniciar(situacao({ passo: "revisao", catalogo: "nao_lido" }))?.passo).toBe("selecao");
    expect(travaParaIniciar(situacao({ passo: "revisao", destinoId: "" }))?.passo).toBe("destino");
  });
});

describe("links", () => {
  it("reconhece loja e produto", () => {
    expect(pareceEndereco("https://www.loja.com.br/")).toBe(true);
    expect(pareceEndereco("loja")).toBe(false);
    expect(pareceEndereco("minha loja.com")).toBe(false);
    expect(pareceLinkDeProduto("https://loja.com/products/tenis?variant=1")).toBe(true);
    expect(pareceLinkDeProduto("https://loja.com/collections/tenis")).toBe(false);
  });
});

describe("creditos", () => {
  it("so a IA de imagem gasta: 1 por produto", () => {
    expect(estimarCreditos(40, "manter")).toBe(0);
    expect(estimarCreditos(40, "tirar")).toBe(40);
    expect(estimarCreditos(40, "origem")).toBe(40);
  });

  it("compara com o saldo sem inventar numero", () => {
    expect(situacaoCreditos(0, 5, true).tom).toBe("neutral");
    expect(situacaoCreditos(10, null, true).tom).toBe("warn");
    expect(situacaoCreditos(10, null, true).texto).toMatch(/saldo/);
    expect(situacaoCreditos(10, 10, true).tom).toBe("ok");
    expect(situacaoCreditos(10, 3, true).texto).toBe(
      "Faltam 7 créditos: as fotos além do saldo ficam com a imagem original."
    );
    expect(situacaoCreditos(10, 9, true).texto).toMatch(/^Faltam 1 crédito:/);
    expect(situacaoCreditos(10, 0, false).tom).toBe("info");
  });
});

describe("lista da selecao", () => {
  const catalogo = [
    produto({ id: 3, handle: "camisa-azul", title: "Camisa azul", variants: [{ id: 1, sku: "CAM-1", price: "50.00" }], collectionHandles: ["camisas"] }),
    produto({ id: 1, handle: "bone", title: "Boné", variants: [{ id: 2, sku: null, price: "0" }], collectionHandles: ["acessorios"] }),
    produto({ id: 2, handle: "tenis", title: "Tênis", variants: [{ id: 3, sku: "TN-9", price: "120.5" }, { id: 4, sku: "TN-10", price: "99.9" }], collectionHandles: ["calcados", "camisas"] }),
  ];
  const indice = indexar(catalogo);

  it("busca por nome, endereco e SKU", () => {
    expect(filtrarCatalogo(indice, "AZUL", [], "origem").map((p) => p.handle)).toEqual(["camisa-azul"]);
    expect(filtrarCatalogo(indice, "tn-10", [], "origem").map((p) => p.handle)).toEqual(["tenis"]);
    expect(filtrarCatalogo(indice, "bone", [], "origem").map((p) => p.handle)).toEqual(["bone"]);
  });

  it("filtra por categoria e ordena; sem preco vai para o fim", () => {
    expect(filtrarCatalogo(indice, "", ["camisas"], "origem").map((p) => p.handle)).toEqual(["camisa-azul", "tenis"]);
    expect(filtrarCatalogo(indice, "", [], "preco_menor").map((p) => p.handle)).toEqual(["camisa-azul", "tenis", "bone"]);
    expect(filtrarCatalogo(indice, "", [], "preco_maior").map((p) => p.handle)).toEqual(["tenis", "camisa-azul", "bone"]);
    expect(filtrarCatalogo(indice, "", [], "recentes").map((p) => p.handle)).toEqual(["camisa-azul", "tenis", "bone"]);
    expect(filtrarCatalogo(indice, "", [], "titulo_az").map((p) => p.handle)).toEqual(["bone", "camisa-azul", "tenis"]);
  });

  it("categorias com contagem e titulo da colecao", () => {
    expect(categoriasDoCatalogo(catalogo, [{ handle: "camisas", title: "Camisas" }])).toEqual([
      { handle: "camisas", titulo: "Camisas", n: 2 },
      { handle: "acessorios", titulo: "acessorios", n: 1 },
      { handle: "calcados", titulo: "calcados", n: 1 },
    ]);
  });

  it("preco na tela: virgula, menor preco e traco quando nao ha", () => {
    expect(precoNaTela(catalogo[2])).toBe("99,90");
    expect(precoNaTela(catalogo[1])).toBe("—");
    expect(primeiroSku(catalogo[1])).toBeNull();
    expect(primeiroSku(catalogo[2])).toBe("TN-9");
  });

  it("caixa do grupo: marcada, parcial e vazia; alterna so os visiveis", () => {
    expect(estadoDoGrupo(["a", "b"], new Set(["a", "b", "z"]))).toBe(true);
    expect(estadoDoGrupo(["a", "b"], new Set(["a"]))).toBe("mixed");
    expect(estadoDoGrupo(["a", "b"], new Set())).toBe(false);
    expect(estadoDoGrupo([], new Set(["a"]))).toBe(false);
    expect(alternarGrupo(["z"], ["a", "b"], true)).toEqual(["z", "a", "b"]);
    expect(alternarGrupo(["z", "a", "b"], ["a", "b"], false)).toEqual(["z"]);
  });

  it("miniatura pede 96 px a CDN da Shopify e deixa o resto como veio", () => {
    expect(miniatura("//cdn.shopify.com/s/files/a.jpg?v=1")).toBe("https://cdn.shopify.com/s/files/a.jpg?v=1&width=96");
    expect(miniatura("https://loja.com/cdn/shop/files/a.jpg")).toBe("https://loja.com/cdn/shop/files/a.jpg?width=96");
    expect(miniatura("https://img.outro.com/a.jpg")).toBe("https://img.outro.com/a.jpg");
    expect(miniatura("javascript:alert(1)")).toBeNull();
    expect(miniatura("")).toBeNull();
  });
});

describe("corpo da API", () => {
  // Os campos que a tela antiga mandava para /api/shopify/clone. A API nao
  // mudou: o corpo novo precisa ter exatamente estes.
  const CAMPOS_DE_ANTES = [
    "source",
    "action",
    "importMode",
    "sourceStoreId",
    "targetStoreId",
    "limit",
    "inventoryMode",
    "inventoryQuantity",
    "publishToStorefront",
    "translateProducts",
    "translateVariantOptions",
    "neutralizeProducts",
    "removeExternalReferences",
    "imageNeutralizeMode",
    "aiMediaLimit",
    "genericizeText",
    "neutralizationInstructions",
    "customPrompt",
    "applyLogoToImages",
    "duplicatePolicy",
    "createRoutingConfig",
    "collectionHandle",
  ].sort();

  const base = {
    origem: "https://loja.com",
    acao: "preview" as const,
    escopo: "loja" as const,
    destinoId: "d1",
    vitrineId: "v1",
    limite: "250",
    opcoes: OPCOES_PADRAO,
    colecaoHandle: null,
  };

  it("tem os mesmos campos da tela antiga", () => {
    expect(Object.keys(montarCorpo(base)).sort()).toEqual(CAMPOS_DE_ANTES);
  });

  it("padrao igual ao de antes", () => {
    expect(montarCorpo(base)).toEqual({
      source: "https://loja.com",
      action: "preview",
      importMode: "bulk",
      sourceStoreId: "v1",
      targetStoreId: "d1",
      limit: 250,
      inventoryMode: "not_tracked",
      inventoryQuantity: 100,
      publishToStorefront: true,
      translateProducts: false,
      translateVariantOptions: false,
      neutralizeProducts: false,
      removeExternalReferences: false,
      imageNeutralizeMode: "queue",
      aiMediaLimit: 1,
      genericizeText: true,
      neutralizationInstructions: "",
      customPrompt: "",
      applyLogoToImages: false,
      duplicatePolicy: "skip",
      createRoutingConfig: false,
      collectionHandle: undefined,
    });
  });

  it("marcas, escopo e colecao viram os campos certos", () => {
    const o: Opcoes = { ...OPCOES_PADRAO, marcas: "tirar", instrucoesMarcas: "manter o escudo", logo: true };
    const c = montarCorpo({ ...base, escopo: "colecao", colecaoHandle: "tenis", opcoes: o, acao: "apply" });
    expect(c.neutralizeProducts).toBe(true);
    expect(c.removeExternalReferences).toBe(false);
    expect(c.neutralizationInstructions).toBe("manter o escudo");
    // Com troca de marca a API nao poe logo: nao promete o que nao faz.
    expect(c.applyLogoToImages).toBe(false);
    expect(c.collectionHandle).toBe("tenis");
    expect(montarCorpo({ ...base, escopo: "produto" }).importMode).toBe("single");
    expect(montarCorpo({ ...base, opcoes: { ...OPCOES_PADRAO, marcas: "origem" } }).removeExternalReferences).toBe(true);
    expect(montarCorpo({ ...base, opcoes: { ...OPCOES_PADRAO, logo: true } }).applyLogoToImages).toBe(true);
    expect(montarCorpo({ ...base, opcoes: { ...OPCOES_PADRAO, estoque: "fixo", quantidade: "7" } })).toMatchObject({
      inventoryMode: "tracked",
      inventoryQuantity: 7,
    });
  });

  it("teto de leitura entre 1 e 5000, padrao 250", () => {
    expect(lerLimite("")).toBe(250);
    expect(lerLimite("0")).toBe(1);
    expect(lerLimite("99999")).toBe(5000);
    expect(lerLimite("abc")).toBe(250);
  });

  it("instrucoes no formato que a IA ja recebia", () => {
    expect(montarInstrucoes({ imagens: " fundo branco ", textos: "", gerais: "sem garantia" })).toBe(
      "IMAGENS:\nfundo branco\n\nINSTRUCOES GERAIS:\nsem garantia"
    );
    expect(montarInstrucoes({ imagens: "", textos: "", gerais: "" })).toBe("");
    expect(instrucoesTemEfeito({ traduzir: false, marcas: "manter" })).toBe(false);
    expect(instrucoesTemEfeito({ traduzir: true, marcas: "manter" })).toBe(true);
  });
});

describe("textos", () => {
  it("contagem sem (s)", () => {
    expect(contar(1, "produto", "produtos")).toBe("1 produto");
    expect(contar(1200, "produto", "produtos")).toBe("1.200 produtos");
  });

  it("resumo das opcoes da revisao", () => {
    const r = resumoOpcoes({ ...OPCOES_PADRAO, rota: true, logo: true, marcas: "tirar" }, "Vitrine X");
    expect(r).toContain("Tirar marcas e usar nome genérico");
    expect(r).toContain("Rota a partir de Vitrine X");
    expect(r).not.toContain("Logo da loja nas imagens");
  });

  it("erros da API viram frase de gente, com o cru guardado", () => {
    expect(erroNaTela(401, "Unauthorized", "ler").texto).toMatch(/sessão expirou/);
    const plano = erroNaTela(402, "Você já usou...", "importar", "subscribe_required");
    expect(plano.plano).toBe(true);
    expect(erroNaTela(0, null, "ler").texto).toMatch(/conexão caiu/);
    expect(erroNaTela(500, "Nao foi possivel ler produtos publicos da loja (404).", "ler").texto).toMatch(
      /catálogo público/
    );
    expect(erroNaTela(500, "Nao foi possivel ler produtos publicos da loja (404).", "ler").detalhe).toMatch(/404/);
    expect(erroNaTela(400, "Informe uma URL de produto Shopify valida.", "importar").texto).toMatch(/\/products\//);
    expect(erroNaTela(500, "boom", "importar").texto).toMatch(/já criados continuam/);
  });

  it("progresso e resultado", () => {
    expect(mensagemProgresso("importando", 15, 230)).toBe("15 de 230 produtos");
    expect(mensagemProgresso("importando", 0, 0)).toBe("Começando…");
    expect(porcentagem(1, 3)).toBe(33);
    expect(porcentagem(5, 0)).toBe(0);
    expect(resumoResultado({ fase: "concluida", criados: 10, pulados: 0, falhas: 0, loja: "Lash" })).toMatchObject({
      tom: "ok",
      frase: "10 produtos criados em Lash.",
    });
    expect(resumoResultado({ fase: "concluida", criados: 1, pulados: 2, falhas: 1, loja: "Lash" })).toMatchObject({
      tom: "warn",
      frase: "1 produto criado em Lash, 2 já existiam e 1 falhou.",
    });
    expect(resumoResultado({ fase: "concluida", criados: 0, pulados: 0, falhas: 3, loja: "L" }).tom).toBe("err");
    expect(resumoResultado({ fase: "interrompida", criados: 2, pulados: 0, falhas: 0, loja: "L" }).tom).toBe("neutral");
  });
});

describe("regras de tela da area", () => {
  const arquivos = readdirSync(PASTA, { recursive: true })
    .map(String)
    .filter((f) => /\.(tsx?|ts)$/.test(f));

  it("nada de confirm nativo, select ou checkbox cru, tamanho solto, var() solto nem plural com (s)", () => {
    expect(arquivos.length).toBeGreaterThan(5);
    for (const f of arquivos) {
      const fonte = readFileSync(path.join(PASTA, f), "utf8");
      expect(fonte, f).not.toMatch(/window\.confirm|\bconfirm\(/);
      expect(fonte, f).not.toMatch(/<select\b|type="checkbox"/);
      expect(fonte, f).not.toMatch(/text-\[\d/);
      expect(fonte, f).not.toMatch(/\[var\(--/);
      expect(fonte, f).not.toMatch(/\w\(s\)/);
      expect(fonte, f).not.toMatch(/\b(border|outline)-solid\b/);
      expect(fonte, f).not.toMatch(/focus-visible:outline-none/);
      expect(fonte, f).not.toMatch(/style=\{\{[^}]*(color|background)/);
    }
  });
});
