import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import { horaNoFuso } from "@/components/layout/contexto";
import { quandoFoi } from "@/lib/leitura/lojas-estado";

// ============================================================================
// Importar em lote (/bulk e /multi-site) e a fila do Importar (/clone): as
// regras sem React e sem rede. O corpo do POST, como cada importacao aparece
// (estado, passo, progresso, link do produto, erro em portugues) e o
// "Tentar de novo". Puro para o vitest travar: tests/importar-lote.test.ts.
//
// Os corpos sao os MESMOS que as telas antigas mandavam para
// /api/jobs/bulk-import. A API nao mudou; quem le cada campo e
// src/lib/jobs/bulk-import-processor.ts.
// ============================================================================

/** links = /bulk (AliExpress, Shopify e links soltos) · sites = /multi-site. */
export type Origem = "links" | "sites";

export const MAX_LINKS = 20;

export const FUSO_FILA = FUSO_RELATORIO_PADRAO;

// ---------------------------------------------------------------------------
// O lote: opcoes da tela -> corpo do POST
// ---------------------------------------------------------------------------

export type ModoEstoque = "not_tracked" | "tracked";

/** O formulario. Os nomes sao os da tela; o corpo traduz para os da API. */
export interface OpcoesLote {
  /** publishToStorefront */
  publicar: boolean;
  /** optimize: titulo e descricao no idioma da loja. */
  traduzir: boolean;
  /** translateVariantOptions */
  traduzirVariacoes: boolean;
  /** enrichShopifyTaxonomy */
  categoria: boolean;
  /** useAiTaxonomyFallback (so vale com `categoria`). */
  categoriaComIa: boolean;
  /** neutralizeProducts: texto generico e fotos sem marca. So em "links". */
  tirarMarca: boolean;
  /**
   * removeExternalReferences em "links"; `neutralize` em "sites", que a API
   * le como a mesma limpeza (mantem a marca do produto, tira fornecedor,
   * marca d'agua e loja de origem).
   */
  limparReferencias: boolean;
  /** applyLogo */
  aplicarLogo: boolean;
  /** neutralizationInstructions */
  instrucoesIa: string;
  /** aiMediaLimit, 1 a 20 */
  fotosComIa: string;
  /** perSourceLimit */
  porLink: string;
  /** inventoryMode */
  estoque: ModoEstoque;
  /** inventoryQuantity */
  quantidade: string;
}

/** Os padroes de cada tela antiga, sem mudar nenhum. */
export const PADRAO: Record<Origem, OpcoesLote> = {
  links: {
    publicar: true,
    traduzir: false,
    traduzirVariacoes: false,
    categoria: false,
    categoriaComIa: true,
    tirarMarca: false,
    limparReferencias: false,
    aplicarLogo: false,
    instrucoesIa: "",
    fotosComIa: "1",
    porLink: "1",
    estoque: "not_tracked",
    quantidade: "100",
  },
  sites: {
    publicar: true,
    traduzir: true,
    traduzirVariacoes: true,
    categoria: true,
    categoriaComIa: true,
    tirarMarca: false,
    limparReferencias: false,
    aplicarLogo: false,
    instrucoesIa: "",
    fotosComIa: "1",
    porLink: "1",
    estoque: "not_tracked",
    quantidade: "100",
  },
};

/** Produtos por link. Outros sites param em 50, como antes (leitura de pagina). */
export const POR_LINK: Record<Origem, readonly number[]> = {
  links: [1, 5, 20, 50, 100, 250],
  sites: [1, 5, 20, 50],
};

/**
 * A loja que ja vem escolhida: a do ?loja= (se for do usuario e tiver acesso)
 * ou a unica com acesso. Com duas ou mais, ninguem escolhe pelo lojista --
 * importar 250 produtos na loja errada da trabalho para desfazer.
 */
export function lojaInicialDe(
  lojas: readonly { id: string; semAcesso: boolean }[],
  pedida: string | null | undefined
): string {
  const comAcesso = lojas.filter((l) => !l.semAcesso);
  if (pedida && comAcesso.some((l) => l.id === pedida)) return pedida;
  return comAcesso.length === 1 ? comAcesso[0].id : "";
}

/** Uma linha por link, sem espaco nem linha vazia. */
export function lerLinks(texto: string): string[] {
  return texto
    .split("\n")
    .map((linha) => linha.trim())
    .filter(Boolean);
}

/** A IA de imagem so roda com uma das duas limpezas ligada. */
export function usaIaDeImagem(o: OpcoesLote, origem: Origem): boolean {
  return o.limparReferencias || (origem === "links" && o.tirarMarca);
}

/**
 * O corpo do POST /api/jobs/bulk-import, campo a campo como as telas antigas
 * mandavam. "sites" leva sourceType generic_site e `neutralize`; "links" leva
 * neutralizeProducts e removeExternalReferences.
 */
export function corpoDoLote(
  origem: Origem,
  lojaId: string,
  links: string[],
  o: OpcoesLote
): Record<string, unknown> {
  const comum = {
    aiMediaLimit: Number(o.fotosComIa || 1),
    neutralizationInstructions: o.instrucoesIa,
    applyLogo: o.aplicarLogo,
    translateVariantOptions: o.traduzirVariacoes,
    enrichShopifyTaxonomy: o.categoria,
    useAiTaxonomyFallback: o.categoriaComIa,
    publishToStorefront: o.publicar,
    perSourceLimit: Number(o.porLink || 1),
    inventoryMode: o.estoque,
    inventoryQuantity: Number(o.quantidade || 0),
  };
  if (origem === "sites") {
    return {
      storeId: lojaId,
      sources: links,
      sourceType: "generic_site",
      optimize: o.traduzir,
      neutralize: o.limparReferencias,
      ...comum,
    };
  }
  return {
    storeId: lojaId,
    sources: links,
    optimize: o.traduzir,
    neutralizeProducts: o.tirarMarca,
    removeExternalReferences: o.limparReferencias,
    ...comum,
  };
}

export type CampoLote = "loja" | "links" | "fotos" | "quantidade";

/** Tudo o que impede o envio, de uma vez, com o texto que vai embaixo do campo. */
export function problemasDoLote(
  origem: Origem,
  lojaId: string,
  links: string[],
  o: OpcoesLote
): Partial<Record<CampoLote, string>> {
  const p: Partial<Record<CampoLote, string>> = {};
  if (!lojaId) p.loja = "Escolha a loja que vai receber os produtos.";
  if (links.length === 0) p.links = "Cole pelo menos um link.";
  else if (links.length > MAX_LINKS) {
    p.links = `São ${links.length} links. O limite é ${MAX_LINKS} por vez.`;
  }
  if (usaIaDeImagem(o, origem)) {
    const n = Number(o.fotosComIa);
    if (!Number.isInteger(n) || n < 1 || n > 20) p.fotos = "Use um número de 1 a 20.";
  }
  if (o.estoque === "tracked") {
    const n = Number(o.quantidade);
    if (o.quantidade.trim() === "" || !Number.isInteger(n) || n < 0) {
      p.quantidade = "Use um número inteiro, zero ou mais.";
    }
  }
  return p;
}

/** "Falta escolher a loja e colar os links." -- o resumo ao lado do botao. */
export function faltaParaEnviar(p: Partial<Record<CampoLote, string>>, nLinks: number): string | null {
  const itens: string[] = [];
  if (p.loja) itens.push("escolher a loja");
  if (p.links) itens.push(nLinks === 0 ? "colar os links" : `deixar no máximo ${MAX_LINKS} links`);
  if (p.fotos) itens.push("corrigir as fotos refeitas por produto");
  if (p.quantidade) itens.push("corrigir a quantidade em estoque");
  if (itens.length === 0) return null;
  const lista = itens.length === 1 ? itens[0] : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`;
  return `Falta ${lista}.`;
}

/** As opcoes ligadas, em palavras curtas, para o resumo ao lado do botao. */
export function resumoDasOpcoes(origem: Origem, o: OpcoesLote): string[] {
  const s: string[] = [];
  s.push(o.publicar ? "Publicar na loja" : "Sem publicar");
  if (o.traduzir) s.push("Traduzir");
  if (o.traduzirVariacoes) s.push("Traduzir variações");
  if (o.categoria) s.push(o.categoriaComIa ? "Categoria (com IA)" : "Categoria");
  if (origem === "links" && o.tirarMarca) s.push("Tirar marcas");
  if (o.limparReferencias) s.push("Limpar referências");
  if (o.aplicarLogo) s.push("Logo da loja nas imagens");
  if (o.estoque === "tracked") s.push(`Estoque: ${o.quantidade || 0}`);
  return s;
}

/** "Até 60 produtos": o teto do lote (link de produto traz um so). */
export function tetoDeProdutos(nLinks: number, porLink: string): number {
  const n = Math.max(1, Number(porLink) || 1);
  return nLinks * n;
}

export function plural(n: number, um: string, varios: string): string {
  return `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
}

// ---------------------------------------------------------------------------
// A fila: como cada importacao aparece
// ---------------------------------------------------------------------------

/** Linha de background_jobs como GET /api/jobs/bulk-import devolve. */
export interface JobImportacao {
  id: string;
  store_id: string;
  status: string;
  progress: ProgressoJob | null;
  result: ResultadoJob | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProgressoJob {
  source?: string;
  sourceType?: string;
  step?: string;
  current?: number;
  total?: number;
  product?: { title?: string } | null;
  optimize?: boolean;
  neutralize?: boolean;
  removeExternalReferences?: boolean;
  aiMediaLimit?: number;
  genericizeText?: boolean;
  neutralizationInstructions?: string;
  customPrompt?: string;
  applyLogo?: boolean;
  translateVariantOptions?: boolean;
  enrichShopifyTaxonomy?: boolean;
  useAiTaxonomyFallback?: boolean;
  publishToStorefront?: boolean;
  perSourceLimit?: number;
  inventoryMode?: string;
  inventoryQuantity?: number;
}

export interface ResultadoJob {
  sourceType?: string;
  products?: { title?: string | null; shopifyProductId?: string | null }[];
}

/** As chaves batem com STATUS.job da fundacao (status-badge.tsx). */
export type EstadoJob = "naFila" | "rodando" | "concluida" | "falhou";

export function estadoDoJob(status: string): EstadoJob {
  if (status === "processing") return "rodando";
  if (status === "completed") return "concluida";
  if (status === "failed") return "falhou";
  return "naFila";
}

/** Ainda vai mudar sozinha: a fila precisa continuar olhando. */
export function emAndamento(job: Pick<JobImportacao, "status">): boolean {
  return job.status === "pending" || job.status === "processing";
}

/** O link colado, sem https:// nem www., para caber na linha. */
export function linkCurto(fonte: string | undefined | null): string {
  const s = String(fonte || "").trim();
  if (!s) return "Link sem endereço";
  return s.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

const ROTULO_ORIGEM: Record<string, string> = {
  aliexpress: "AliExpress",
  shopify_public: "Loja Shopify",
  generic_site: "Outro site",
};

/** De onde veio, quando se sabe: o que a importacao achou vale mais que o pedido. */
export function origemDoJob(job: Pick<JobImportacao, "progress" | "result">): string | null {
  const tipo = job.result?.sourceType || job.progress?.sourceType;
  return (tipo && ROTULO_ORIGEM[tipo]) || null;
}

/**
 * O passo gravado pelo processador vem sem acento e com nome de dentro
 * ("Importando origem"). Aqui vira a frase que o lojista le.
 */
const PASSOS: [RegExp, string][] = [
  [/^aguardando/i, "Esperando a vez na fila"],
  [/^carregando loja/i, "Abrindo a loja de destino"],
  [/^importando origem/i, "Lendo o link"],
  [/^neutralizando/i, "Tirando a marca e publicando"],
  [/^retirando refer/i, "Limpando referências e publicando"],
  [/^aplicando logo/i, "Aplicando o logo e publicando"],
  [/^traduzindo/i, "Traduzindo e publicando"],
  [/^publicando/i, "Publicando"],
];

export function passoLegivel(passo: string | undefined | null): string | null {
  const s = String(passo || "").trim();
  if (!s) return null;
  for (const [re, texto] of PASSOS) if (re.test(s)) return texto;
  return null;
}

/** Barra de progresso: so enquanto roda e quando ja se sabe o total. */
export function progressoDoJob(
  job: Pick<JobImportacao, "status" | "progress">
): { atual: number; total: number } | null {
  if (job.status !== "processing") return null;
  const total = Number(job.progress?.total);
  if (!Number.isFinite(total) || total <= 0) return null;
  const atual = Math.min(Math.max(Number(job.progress?.current) || 0, 0), total);
  return { atual, total };
}

/** "123" de "gid://shopify/Product/123"; null se nao for um id de produto. */
export function idNumerico(gid: string | null | undefined): string | null {
  const m = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(String(gid || ""));
  return m ? m[1] : null;
}

/** Produtos que a importacao criou na loja (com id da Shopify). */
export function produtosCriados(job: Pick<JobImportacao, "result">): { titulo: string; id: string }[] {
  return (job.result?.products ?? []).flatMap((p) => {
    const id = idNumerico(p?.shopifyProductId);
    return id ? [{ titulo: String(p?.title || "Produto sem título"), id }] : [];
  });
}

const RE_DOMINIO_SHOPIFY = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i;

/**
 * Para onde o "Ver na Shopify" leva: o produto, quando e um so; a lista de
 * produtos da loja, quando sao varios. Dominio fora do formato myshopify nao
 * vira link (o endereco vai para o navegador do lojista).
 */
export function linkNaShopify(dominio: string | null | undefined, job: Pick<JobImportacao, "result">): string | null {
  const d = String(dominio || "").trim().toLowerCase();
  if (!RE_DOMINIO_SHOPIFY.test(d)) return null;
  const criados = produtosCriados(job);
  if (criados.length === 0) return null;
  if (criados.length === 1) return `https://${d}/admin/products/${criados[0].id}`;
  return `https://${d}/admin/products`;
}

/**
 * Erro gravado pelo processador -> frase em portugues com o que fazer. O
 * texto cru fica recolhido para o suporte (pode trazer nome de fornecedor).
 */
const ERROS: [RegExp, string][] = [
  [/loja de destino/i, "A loja de destino não foi encontrada. Ela pode ter sido removida."],
  [
    /invalid_credentials|client id ou client secret|invalid api key|invalid_client|app_not_installed|n[aã]o est[aá] instalado/i,
    "A loja de destino recusou o acesso. Reconecte a loja em Lojas.",
  ],
  [/timeout|timed out|etimedout|aborted|demorou/i, "O site de origem demorou demais para responder."],
  [/bright ?data|proxy/i, "O site de origem não respondeu agora. Tente de novo em alguns minutos."],
  [/n[aã]o retornou uma p[aá]gina html/i, "Esse link não leva a uma página de produto."],
  [/n[aã]o foi poss[ií]vel ler a p[aá]gina/i, "O site de origem não abriu a página. Confira o link."],
  [
    /url inv[aá]lida|informe uma url|dom[ií]nio shopify v[aá]lido|url de produto shopify v[aá]lida|deve ser do aliexpress/i,
    "O link não é válido. Cole o endereço completo, começando com https://.",
  ],
  [/produto p[uú]blico da shopify|dados incompletos/i, "A loja de origem não mostra esse produto publicamente."],
  [/extrair as imagens/i, "Não conseguimos pegar as fotos do produto."],
];

export function erroLegivel(erro: string | null | undefined): string {
  const s = String(erro || "");
  for (const [re, texto] of ERROS) if (re.test(s)) return texto;
  return "A importação deste link falhou.";
}

/**
 * "Tentar de novo": o mesmo link, na mesma loja, com as mesmas opcoes. Tudo
 * sai do que o POST gravou em progress, entao o corpo e o de um lote de um
 * link so -- nenhum endpoint novo. Sem link gravado, nao ha o que repetir.
 */
export function corpoTentarDeNovo(
  job: Pick<JobImportacao, "store_id" | "progress">
): Record<string, unknown> | null {
  const p = job.progress ?? {};
  const fonte = String(p.source || "").trim();
  if (!fonte || !job.store_id) return null;
  return {
    storeId: job.store_id,
    sources: [fonte],
    sourceType: p.sourceType || "auto",
    optimize: p.optimize === true,
    neutralizeProducts: p.neutralize === true,
    removeExternalReferences: p.removeExternalReferences === true,
    aiMediaLimit: Number(p.aiMediaLimit) || 1,
    genericizeText: p.genericizeText !== false,
    neutralizationInstructions: String(p.neutralizationInstructions || ""),
    customPrompt: String(p.customPrompt || ""),
    applyLogo: p.applyLogo === true,
    translateVariantOptions: p.translateVariantOptions === true,
    enrichShopifyTaxonomy: p.enrichShopifyTaxonomy === true,
    useAiTaxonomyFallback: p.useAiTaxonomyFallback === true,
    publishToStorefront: p.publishToStorefront !== false,
    perSourceLimit: Number(p.perSourceLimit) || 1,
    inventoryMode: p.inventoryMode === "tracked" ? "tracked" : "not_tracked",
    inventoryQuantity: Number(p.inventoryQuantity) || 0,
  };
}

/**
 * A frase embaixo do link, por estado. Concluida sem produto e um caso de
 * verdade (pagina sem produto legivel): diz isso, nao "0 criados".
 */
export function detalheDoJob(job: JobImportacao): string {
  const estado = estadoDoJob(job.status);
  if (estado === "falhou") return erroLegivel(job.error);
  if (estado === "concluida") {
    const n = produtosCriados(job).length;
    if (n === 0) return "Nenhum produto foi criado a partir deste link.";
    if (n === 1) return `1 produto criado: ${produtosCriados(job)[0].titulo}`;
    return `${plural(n, "produto criado", "produtos criados")}`;
  }
  if (estado === "naFila") return "Esperando a vez na fila";
  const passo = passoLegivel(job.progress?.step) ?? "Importando";
  const prog = progressoDoJob(job);
  const titulo = job.progress?.product?.title;
  const partes = [prog ? `${passo}: ${prog.atual} de ${prog.total}` : passo];
  if (titulo) partes.push(String(titulo));
  return partes.join(" · ");
}

/** Quando entrou na fila: "hoje, 14:32", "ontem, 09:10", "28/09, 18:00". */
export function quandoEntrou(iso: string, agoraMs: number): string {
  return quandoFoi(iso, new Date(agoraMs), FUSO_FILA) ?? "—";
}

/** "Atualizado às 14:32". */
export function atualizadoAs(ms: number): string {
  return `Atualizado às ${horaNoFuso(ms, FUSO_FILA)}`;
}

/**
 * Resposta de erro da API em portugues. A API devolve "Unauthorized" em
 * ingles e mensagens sem acento; nada disso vai cru para a tela.
 */
export function erroDaApi(status: number, mensagem: string | null | undefined): string {
  const m = String(mensagem || "");
  if (status === 0) return "Sem conexão com o servidor. Confira a internet e tente de novo.";
  if (status === 401) return "Sua sessão expirou. Entre de novo.";
  if (status === 404 || /loja de destino/i.test(m)) return "A loja de destino não foi encontrada.";
  if (/m[aá]ximo de 20/i.test(m)) return `No máximo ${MAX_LINKS} links por vez.`;
  if (status === 400) return "Escolha a loja e cole pelo menos um link.";
  return "O servidor não respondeu como esperado. Tente de novo.";
}
