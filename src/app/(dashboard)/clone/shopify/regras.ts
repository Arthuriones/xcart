// ============================================================================
// Regras do assistente "Importar de uma loja Shopify", sem React e sem rede:
// os passos, o que trava cada um, a estimativa de creditos, a lista da
// Selecao, o corpo enviado a API e as frases de erro. Puro para o vitest
// travar (tests/importar-shopify.test.ts).
//
// A API (/api/shopify/clone) NAO mudou: montarCorpo devolve exatamente os
// campos que a tela antiga mandava, com os mesmos nomes.
// ============================================================================

// ---------------------------------------------------------------- tipos

export type Escopo = "produto" | "colecao" | "loja";
export type Marcas = "manter" | "tirar" | "origem";
export type Ordem = "origem" | "recentes" | "titulo_az" | "titulo_za" | "preco_menor" | "preco_maior";

export interface ProdutoOrigem {
  id: number;
  title: string;
  handle: string;
  images: { src: string }[];
  variants: { id: number; sku: string | null; price: string }[];
  sourceUrl: string;
  collectionHandles?: string[];
}

export interface ColecaoOrigem {
  id: number;
  title: string;
  handle: string;
  image?: string | null;
  productsUrl: string;
  productsCount?: number | null;
}

export interface ProdutoTransformado {
  source: { title: string; handle: string; images: { src: string }[] };
  transformed: {
    title: string;
    descriptionHtml: string;
    tags: string[];
    images: { src: string; altText?: string | null }[];
    variants: { price?: string; compareAtPrice?: string; options?: string[] }[];
  };
  neutralized: boolean;
  logoAppliedCount: number;
  warnings: string[];
}

export interface Opcoes {
  /** Publicar na loja ao criar; desligado = rascunho. */
  publicar: boolean;
  /** Titulo e descricao no idioma da loja de destino (IA de texto). */
  traduzir: boolean;
  /** Cores e tamanhos para portugues. */
  traduzirVariacoes: boolean;
  /** O que fazer com marcas: manter, tirar todas, ou manter a marca e tirar a origem. */
  marcas: Marcas;
  /** Com "tirar": troca o nome do produto por um generico. */
  nomeGenerico: boolean;
  /** Com troca de marca: o que a IA deve preservar ou tirar. */
  instrucoesMarcas: string;
  /** Instrucoes livres para a IA (texto e imagem), em partes. */
  instrucoesIa: PartesInstrucoes;
  /** Logo da loja nas imagens (so quando as marcas ficam como estao). */
  logo: boolean;
  estoque: "livre" | "fixo";
  quantidade: string;
  duplicados: "pular" | "criar";
  /** Gravar a rota vitrine -> destino com o mapa de SKU no fim. */
  rota: boolean;
  vitrineId: string;
}

export const OPCOES_PADRAO: Opcoes = {
  publicar: true,
  traduzir: false,
  traduzirVariacoes: false,
  // Desligado por padrao: importar serve para CLONAR (ex.: montar uma loja
  // igual a outra). Tirar marca e uma escolha, nao o padrao.
  marcas: "manter",
  nomeGenerico: true,
  instrucoesMarcas: "",
  instrucoesIa: { imagens: "", textos: "", gerais: "" },
  logo: false,
  estoque: "livre",
  quantidade: "100",
  duplicados: "pular",
  rota: false,
  vitrineId: "",
};

// ---------------------------------------------------------------- passos

export const PASSOS = [
  { id: "destino", rotulo: "Destino" },
  { id: "escopo", rotulo: "Escopo" },
  { id: "origem", rotulo: "Origem" },
  { id: "selecao", rotulo: "Seleção" },
  { id: "opcoes", rotulo: "Opções" },
  { id: "revisao", rotulo: "Revisão" },
] as const;

export type IdPasso = (typeof PASSOS)[number]["id"];

/**
 * O numero de passos nao muda com o escopo: no produto unico a Selecao
 * continua na trilha, marcada como "nao se aplica", e o assistente pula.
 */
export function passoSeAplica(passo: IdPasso, escopo: Escopo): boolean {
  return passo !== "selecao" || escopo !== "produto";
}

export function indiceDoPasso(passo: IdPasso): number {
  return PASSOS.findIndex((p) => p.id === passo);
}

export function proximoPasso(atual: IdPasso, escopo: Escopo): IdPasso | null {
  for (let i = indiceDoPasso(atual) + 1; i < PASSOS.length; i++) {
    if (passoSeAplica(PASSOS[i].id, escopo)) return PASSOS[i].id;
  }
  return null;
}

export function passoAnterior(atual: IdPasso, escopo: Escopo): IdPasso | null {
  for (let i = indiceDoPasso(atual) - 1; i >= 0; i--) {
    if (passoSeAplica(PASSOS[i].id, escopo)) return PASSOS[i].id;
  }
  return null;
}

/** O endereco tem cara de loja: um host com ponto, sem espaco. */
export function pareceEndereco(valor: string): boolean {
  const limpo = valor.trim().replace(/^https?:\/\//i, "");
  const host = limpo.split(/[/?#]/)[0];
  return /^[^\s.]+(\.[^\s.]+)+$/.test(host);
}

/** Link de produto da Shopify: tem /products/<algo> no caminho. */
export function pareceLinkDeProduto(valor: string): boolean {
  return pareceEndereco(valor) && /\/products\/[^/?#\s]+/i.test(valor);
}

/** O dominio do link, para mostrar ("loja.com"). */
export function dominioDoLink(valor: string): string {
  return valor
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
}

export type EstadoCatalogo = "nao_lido" | "lendo" | "erro" | "lido";

export interface Situacao {
  passo: IdPasso;
  escopo: Escopo;
  destinoId: string;
  origem: string;
  /** Escopo colecao: ja escolheu uma. */
  colecaoEscolhida: boolean;
  catalogo: EstadoCatalogo;
  nCatalogo: number;
  nMarcados: number;
  opcoes: Pick<Opcoes, "rota" | "vitrineId" | "estoque" | "quantidade">;
}

/** Quantidade de estoque valida: inteiro, zero ou mais. */
export function quantidadeValida(valor: string): boolean {
  return /^\d{1,7}$/.test(valor.trim());
}

/**
 * O que impede o "Continuar" neste passo, numa frase que diz o que fazer.
 * null = pode seguir.
 */
export function travaDoPasso(s: Situacao, passo: IdPasso = s.passo): string | null {
  switch (passo) {
    case "destino":
      return s.destinoId ? null : "Escolha a loja de destino.";
    case "escopo":
      return null;
    case "origem":
      if (!s.origem.trim()) {
        return s.escopo === "produto" ? "Cole o link do produto." : "Cole o link da loja de origem.";
      }
      if (s.escopo === "produto" && !pareceLinkDeProduto(s.origem)) {
        return "O link precisa ser de um produto, com /products/ no endereço.";
      }
      if (!pareceEndereco(s.origem)) return "Esse link não parece o endereço de uma loja.";
      if (s.escopo === "colecao" && !s.colecaoEscolhida) return "Leia as coleções e escolha uma.";
      return null;
    case "selecao":
      if (!passoSeAplica("selecao", s.escopo)) return null;
      if (s.catalogo === "lendo") return "Aguarde a leitura do catálogo.";
      if (s.catalogo !== "lido") return "Leia o catálogo da origem para escolher os produtos.";
      if (s.nCatalogo === 0) return "A origem não tem produtos para importar.";
      if (s.nMarcados === 0) return "Selecione ao menos um produto.";
      return null;
    case "opcoes":
      if (s.opcoes.estoque === "fixo" && !quantidadeValida(s.opcoes.quantidade)) {
        return "Informe o estoque inicial, um número inteiro.";
      }
      if (s.opcoes.rota && !s.opcoes.vitrineId) return "Escolha a loja vitrine da rota.";
      if (s.opcoes.rota && s.opcoes.vitrineId === s.destinoId) {
        return "A vitrine precisa ser outra loja, não a de destino.";
      }
      return null;
    case "revisao":
      return null;
  }
}

/** Para iniciar: o primeiro passo que ainda trava, e o motivo. */
export function travaParaIniciar(s: Situacao): { passo: IdPasso; motivo: string } | null {
  for (const p of PASSOS) {
    const motivo = travaDoPasso(s, p.id);
    if (motivo) return { passo: p.id, motivo };
  }
  return null;
}

// ---------------------------------------------------------------- creditos

/**
 * Credito so e gasto pela IA de imagem: com "tirar marcas" ou "tirar a
 * origem", a foto principal de cada produto CRIADO vai para a fila e custa 1
 * credito (lib/jobs/image-neutralize-processor). Texto e traducao nao
 * descontam. Duplicado pulado nao vai para a fila -- dai o "ate".
 */
export function estimarCreditos(nProdutos: number, marcas: Marcas): number {
  return marcas === "manter" ? 0 : Math.max(0, nProdutos);
}

export interface SituacaoCreditos {
  tom: "ok" | "warn" | "info" | "neutral";
  texto: string;
}

export function situacaoCreditos(
  estimativa: number,
  saldo: number | null,
  cobrando: boolean
): SituacaoCreditos {
  if (estimativa === 0) {
    return { tom: "neutral", texto: "Sem custo em créditos: nenhuma imagem será refeita com IA." };
  }
  if (!cobrando) {
    return { tom: "info", texto: "Hoje a IA de imagem não desconta créditos da sua conta." };
  }
  if (saldo === null) {
    return { tom: "warn", texto: "Não deu para ler o seu saldo agora. Confira em Assinatura." };
  }
  if (saldo >= estimativa) {
    return { tom: "ok", texto: "Seu saldo cobre esta importação." };
  }
  const falta = estimativa - saldo;
  return {
    tom: "warn",
    texto: `Faltam ${inteiro(falta)} ${falta === 1 ? "crédito" : "créditos"}: as fotos além do saldo ficam com a imagem original.`,
  };
}

// ---------------------------------------------------------------- numeros

const FORMATO_INTEIRO = new Intl.NumberFormat("pt-BR");
const FORMATO_PRECO = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function inteiro(n: number): string {
  return FORMATO_INTEIRO.format(n);
}

/** "1 produto" / "12 produtos". Sem "(s)". */
export function contar(n: number, singular: string, plural: string): string {
  return `${inteiro(n)} ${n === 1 ? singular : plural}`;
}

/** Menor preco valido das variantes; null quando nenhuma tem preco. */
export function precoMinimo(produto: Pick<ProdutoOrigem, "variants">): number | null {
  let menor: number | null = null;
  for (const v of produto.variants || []) {
    const n = Number.parseFloat(v.price);
    if (Number.isFinite(n) && n > 0 && (menor === null || n < menor)) menor = n;
  }
  return menor;
}

/**
 * Preco para a lista: "129,90", ou "—" quando nao ha preco (antes saia
 * "0.00"). A vitrine publica da Shopify nao diz a moeda; a tela avisa que
 * o valor esta na moeda da origem.
 */
export function precoNaTela(produto: Pick<ProdutoOrigem, "variants">): string {
  const p = precoMinimo(produto);
  return p === null ? "—" : FORMATO_PRECO.format(p);
}

/**
 * Miniatura leve: a CDN da Shopify redimensiona pelo parametro width, entao a
 * lista baixa 96 px em vez da foto inteira. Outro servidor: a URL como veio.
 */
export function miniatura(src: string | undefined | null, largura = 96): string | null {
  if (!src) return null;
  const absoluta = src.startsWith("//") ? `https:${src}` : src;
  let url: URL;
  try {
    url = new URL(absoluta);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  const daShopify = url.hostname === "cdn.shopify.com" || url.pathname.startsWith("/cdn/shop/");
  if (daShopify) url.searchParams.set("width", String(largura));
  return url.toString();
}

/** O primeiro SKU preenchido, para a linha da lista. */
export function primeiroSku(produto: Pick<ProdutoOrigem, "variants">): string | null {
  for (const v of produto.variants || []) {
    const sku = v.sku?.trim();
    if (sku) return sku;
  }
  return null;
}

// ---------------------------------------------------------------- selecao

export interface ItemIndice {
  produto: ProdutoOrigem;
  /** titulo + endereco + SKUs, em minusculas, montado uma vez por leitura. */
  texto: string;
}

export function indexar(catalogo: ProdutoOrigem[]): ItemIndice[] {
  return catalogo.map((produto) => ({
    produto,
    texto: [produto.title, produto.handle, ...(produto.variants || []).map((v) => v.sku || "")]
      .join(" ")
      .toLowerCase(),
  }));
}

/** Busca + categorias + ordenacao, numa passada so. */
export function filtrarCatalogo(
  indice: ItemIndice[],
  termo: string,
  categorias: string[],
  ordem: Ordem
): ProdutoOrigem[] {
  const busca = termo.trim().toLowerCase();
  const cats = categorias.length > 0 ? new Set(categorias) : null;
  const lista: ProdutoOrigem[] = [];
  for (const item of indice) {
    if (cats && !(item.produto.collectionHandles || []).some((h) => cats.has(h))) continue;
    if (busca && !item.texto.includes(busca)) continue;
    lista.push(item.produto);
  }
  if (ordem === "origem") return lista;
  const preco = (p: ProdutoOrigem) => precoMinimo(p) ?? Number.POSITIVE_INFINITY;
  return lista.toSorted((a, b) => {
    switch (ordem) {
      case "titulo_az":
        return a.title.localeCompare(b.title, "pt-BR");
      case "titulo_za":
        return b.title.localeCompare(a.title, "pt-BR");
      case "preco_menor":
        return preco(a) - preco(b);
      case "preco_maior": {
        // Sem preco vai para o fim nas duas direcoes.
        const pa = precoMinimo(a) ?? Number.NEGATIVE_INFINITY;
        const pb = precoMinimo(b) ?? Number.NEGATIVE_INFINITY;
        return pb - pa;
      }
      case "recentes":
        return (b.id || 0) - (a.id || 0);
      default:
        return 0;
    }
  });
}

export const ROTULO_ORDEM: Record<Ordem, string> = {
  origem: "Ordem da origem",
  recentes: "Mais recentes",
  titulo_az: "Nome, de A a Z",
  titulo_za: "Nome, de Z a A",
  preco_menor: "Menor preço",
  preco_maior: "Maior preço",
};

/** Categorias presentes no catalogo lido, das maiores para as menores. */
export function categoriasDoCatalogo(
  catalogo: ProdutoOrigem[],
  colecoes: Pick<ColecaoOrigem, "handle" | "title">[]
): { handle: string; titulo: string; n: number }[] {
  const contagem = new Map<string, number>();
  for (const p of catalogo) {
    for (const h of p.collectionHandles || []) contagem.set(h, (contagem.get(h) || 0) + 1);
  }
  const titulo = new Map(colecoes.map((c) => [c.handle, c.title]));
  return [...contagem.entries()]
    .map(([handle, n]) => ({ handle, titulo: titulo.get(handle) || handle, n }))
    .sort((a, b) => b.n - a.n || a.titulo.localeCompare(b.titulo, "pt-BR"));
}

/** Estado da caixa "todos da lista": marcada, desmarcada ou parcial. */
export function estadoDoGrupo(visiveis: string[], marcados: Set<string>): boolean | "mixed" {
  if (visiveis.length === 0) return false;
  let n = 0;
  for (const h of visiveis) if (marcados.has(h)) n++;
  return n === 0 ? false : n === visiveis.length ? true : "mixed";
}

/** Marca ou desmarca so os da lista filtrada, sem mexer nos escondidos. */
export function alternarGrupo(marcados: string[], visiveis: string[], marcar: boolean): string[] {
  if (marcar) return [...new Set([...marcados, ...visiveis])];
  const fora = new Set(visiveis);
  return marcados.filter((h) => !fora.has(h));
}

// ---------------------------------------------------------------- corpo

export const LIMITE_PADRAO = 250;
export const LIMITE_MAXIMO = 5000;
export const TAMANHO_LOTE = 5;

/** "Ler ate N produtos": 1 a 5000, padrao 250 (o mesmo da tela antiga). */
export function lerLimite(valor: string): number {
  const n = Number(valor || LIMITE_PADRAO);
  if (!Number.isFinite(n)) return LIMITE_PADRAO;
  return Math.min(Math.max(Math.floor(n), 1), LIMITE_MAXIMO);
}

function lerQuantidade(valor: string): number {
  const n = Number(valor || 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

export interface EntradaCorpo {
  origem: string;
  acao: "preview" | "apply";
  escopo: Escopo;
  destinoId: string;
  /** A vitrine da rota; sem rota, a primeira loja (como a tela antiga mandava). */
  vitrineId: string;
  limite: string;
  opcoes: Opcoes;
  colecaoHandle: string | null;
}

/**
 * O corpo de /api/shopify/clone, com os MESMOS campos da tela antiga.
 * "Midias com IA por produto" saiu da tela: com a imagem indo para a fila (o
 * unico modo desta tela), a API so troca a foto principal e ignora o numero.
 * O campo segue com o valor de antes (1).
 */
export function montarCorpo(e: EntradaCorpo): Record<string, unknown> {
  const o = e.opcoes;
  const trocaMarca = o.marcas !== "manter";
  return {
    source: e.origem,
    action: e.acao,
    importMode: e.escopo === "produto" ? "single" : "bulk",
    sourceStoreId: e.vitrineId,
    targetStoreId: e.destinoId,
    limit: lerLimite(e.limite),
    inventoryMode: o.estoque === "fixo" ? "tracked" : "not_tracked",
    inventoryQuantity: lerQuantidade(o.quantidade),
    publishToStorefront: o.publicar,
    translateProducts: o.traduzir,
    translateVariantOptions: o.traduzirVariacoes,
    neutralizeProducts: o.marcas === "tirar",
    removeExternalReferences: o.marcas === "origem",
    // Imagem sempre em segundo plano: gerar durante a importacao estoura o
    // tempo e a maioria das imagens falha.
    imageNeutralizeMode: "queue",
    aiMediaLimit: 1,
    genericizeText: o.nomeGenerico,
    // A API usa estas instrucoes nos dois modos de troca de marca.
    neutralizationInstructions: trocaMarca ? o.instrucoesMarcas : "",
    customPrompt: montarInstrucoes(o.instrucoesIa),
    // Com troca de marca a foto principal e refeita pela IA e a API nao poe
    // logo (modo fila): mandar true seria prometer o que nao acontece.
    applyLogoToImages: o.logo && !trocaMarca,
    duplicatePolicy: o.duplicados === "criar" ? "create" : "skip",
    createRoutingConfig: o.rota,
    collectionHandle: e.escopo === "colecao" ? (e.colecaoHandle ?? undefined) : undefined,
  };
}

// ---------------------------------------------------------------- instrucoes

/**
 * Instrucoes livres para a IA, em partes. O campo "Precos e oferta" da tela
 * antiga saiu: a IA so reescreve nome, descricao, tags e SEO -- preco nunca
 * muda pela instrucao, e o campo prometia o contrario.
 */
export interface PartesInstrucoes {
  imagens: string;
  textos: string;
  gerais: string;
}

// Os titulos vao para a IA, nao para a tela: sao os mesmos de antes.
const CABECALHOS: [keyof PartesInstrucoes, string][] = [
  ["imagens", "IMAGENS"],
  ["textos", "DESCRICOES E COPY"],
  ["gerais", "INSTRUCOES GERAIS"],
];

/** As partes viram um texto so, no formato que a IA ja recebia. */
export function montarInstrucoes(partes: PartesInstrucoes): string {
  return CABECALHOS.map(([chave, titulo]) => [titulo, partes[chave].trim()] as const)
    .filter(([, corpo]) => corpo.length > 0)
    .map(([titulo, corpo]) => `${titulo}:\n${corpo}`)
    .join("\n\n");
}

/**
 * As instrucoes so chegam a IA quando ha IA rodando: traducao (nome e
 * descricao) ou troca de marca (texto e foto). Fora disso, nao fazem nada.
 */
export function instrucoesTemEfeito(o: Pick<Opcoes, "traduzir" | "marcas">): boolean {
  return o.traduzir || o.marcas !== "manter";
}

// ---------------------------------------------------------------- revisao

/** As escolhas, em frases curtas, para a Revisao. */
export function resumoOpcoes(o: Opcoes, nomeVitrine: string | null): string[] {
  const linhas = [o.publicar ? "Publicar ao criar" : "Criar como rascunho"];
  if (o.traduzir) linhas.push("Traduzir nome e descrição");
  if (o.traduzirVariacoes) linhas.push("Traduzir cores e tamanhos");
  if (o.marcas === "tirar") linhas.push(o.nomeGenerico ? "Tirar marcas e usar nome genérico" : "Tirar marcas");
  if (o.marcas === "origem") linhas.push("Manter a marca, tirar a origem");
  if (montarInstrucoes(o.instrucoesIa)) linhas.push("Instruções para a IA");
  if (o.logo && o.marcas === "manter") linhas.push("Logo da loja nas imagens");
  linhas.push(o.estoque === "fixo" ? `Estoque inicial: ${o.quantidade.trim()}` : "Sem controle de estoque");
  linhas.push(o.duplicados === "pular" ? "Pular o que já existe" : "Criar mesmo se já existir");
  if (o.rota) linhas.push(nomeVitrine ? `Rota a partir de ${nomeVitrine}` : "Preparar rota");
  return linhas;
}

export function tirarHtml(valor: string): string {
  return valor.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------- erros

export interface ErroNaTela {
  texto: string;
  /** O texto cru da API, recolhido em "Detalhes para o suporte". */
  detalhe: string | null;
  /** 402: acabou a importacao gratuita -- a acao leva a Assinatura. */
  plano: boolean;
}

/**
 * A frase que o lojista le. A API devolve erro sem acento, as vezes em ingles
 * ("Unauthorized"); aqui vira o que aconteceu e o que fazer.
 */
export function erroNaTela(
  status: number,
  erroApi: string | null | undefined,
  contexto: "ler" | "colecoes" | "previa" | "importar",
  codigo?: string | null
): ErroNaTela {
  const cru = (erroApi || "").trim();
  const detalhe = cru || (status ? `HTTP ${status}` : null);
  const base = { detalhe, plano: false };

  if (status === 0) {
    return {
      ...base,
      texto: "A conexão caiu antes de a resposta chegar. Confira a internet e tente de novo.",
    };
  }
  if (status === 401) {
    return { ...base, texto: "Sua sessão expirou. Entre de novo para continuar." };
  }
  if (status === 402 || codigo === "subscribe_required") {
    return {
      ...base,
      plano: true,
      texto: "Você já usou a importação gratuita. Assine para importar em outras lojas.",
    };
  }
  if (/url de produto/i.test(cru)) {
    return { ...base, texto: "Esse link não é de um produto. Cole o endereço que tem /products/ no meio." };
  }
  if (/dominio shopify valido|informe a loja/i.test(cru)) {
    return { ...base, texto: "Esse link não parece de uma loja. Cole o endereço completo, como https://loja.com." };
  }
  if (/nao foi possivel ler|dados incompletos/i.test(cru)) {
    return {
      ...base,
      texto:
        "Não conseguimos ler o catálogo público dessa loja. Ela pode estar fechada, com senha ou não ser Shopify.",
    };
  }
  if (/nenhum produto encontrado/i.test(cru)) {
    return { ...base, texto: "Nenhum produto encontrado nessa origem." };
  }
  if (/loja de destino nao encontrada/i.test(cru)) {
    return { ...base, texto: "A loja de destino não foi encontrada. Ela pode ter sido removida do xcart." };
  }
  const padrao: Record<typeof contexto, string> = {
    ler: "Não deu para ler a origem agora. Tente de novo em instantes.",
    colecoes: "Não deu para ler as coleções agora. Tente de novo em instantes.",
    previa: "Não deu para gerar a prévia agora. Tente de novo em instantes.",
    importar: "A importação parou por um erro. Os produtos já criados continuam na loja.",
  };
  return { ...base, texto: padrao[contexto] };
}

// ---------------------------------------------------------------- execucao

export type FaseExecucao = "preparando" | "importando" | "rota" | "concluida" | "interrompida" | "erro";

export function emAndamento(fase: FaseExecucao): boolean {
  return fase === "preparando" || fase === "importando" || fase === "rota";
}

/** A linha que diz o que esta acontecendo agora. */
export function mensagemProgresso(fase: FaseExecucao, atual: number, total: number): string {
  if (fase === "preparando") return "Lendo o produto na origem…";
  if (fase === "rota") return "Gravando a rota com o mapa de SKU…";
  if (total <= 0) return "Começando…";
  return `${inteiro(Math.min(atual, total))} de ${contar(total, "produto", "produtos")}`;
}

/** 0 a 100, para a barra. */
export function porcentagem(atual: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((atual / total) * 100)));
}

export interface ResumoResultado {
  titulo: string;
  tom: "ok" | "warn" | "err" | "neutral";
  selo: string;
  frase: string;
}

/** O cartao do fim: um titulo, um selo e uma frase com os numeros. */
export function resumoResultado(r: {
  fase: FaseExecucao;
  criados: number;
  pulados: number;
  falhas: number;
  loja: string;
}): ResumoResultado {
  const partes = [
    `${contar(r.criados, "produto criado", "produtos criados")} em ${r.loja}`,
    r.pulados > 0 ? `${inteiro(r.pulados)} já ${r.pulados === 1 ? "existia" : "existiam"}` : null,
    r.falhas > 0 ? `${inteiro(r.falhas)} ${r.falhas === 1 ? "falhou" : "falharam"}` : null,
  ].filter(Boolean) as string[];
  const frase =
    partes.length === 1 ? `${partes[0]}.` : `${partes.slice(0, -1).join(", ")} e ${partes[partes.length - 1]}.`;

  if (r.fase === "interrompida") {
    return { titulo: "Importação interrompida", tom: "neutral", selo: "Interrompida", frase };
  }
  if (r.fase === "erro") {
    return { titulo: "A importação parou", tom: "err", selo: "Falhou", frase };
  }
  if (r.criados === 0 && r.pulados === 0 && r.falhas > 0) {
    return { titulo: "Nenhum produto foi importado", tom: "err", selo: "Falhou", frase };
  }
  if (r.falhas > 0) {
    return { titulo: "Importação concluída com falhas", tom: "warn", selo: "Com falhas", frase };
  }
  return { titulo: "Importação concluída", tom: "ok", selo: "Concluída", frase };
}
