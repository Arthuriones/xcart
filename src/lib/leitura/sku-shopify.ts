// ============================================================================
// Nome e foto do produto por SKU (funcao #34 do brief), regras puras.
//
// O pedido sincronizado guarda so o SKU -- nem nome nem foto. A tela pergunta
// a Shopify pelas variantes com esses SKUs, com a credencial que a loja ja
// tem. Nada e gravado: e so leitura, para a linha da tabela deixar de ser um
// codigo solto ("CIL-001" nao diz nada).
//
// Puro (sem server-only) para o vitest travar: quem chama a Shopify e
// src/app/api/leitura/custos/produtos/route.ts.
// ============================================================================

/** SKUs por pergunta: a busca vai na URL e no filtro da Shopify. */
export const MAX_SKUS_POR_BUSCA = 25;
/** SKU maior que isso nao entra na busca (URL longa demais); a linha fica so com o SKU. */
export const MAX_TAMANHO_SKU = 120;

export interface ProdutoDoSku {
  nome: string;
  /** "Preto / 12 mm". null quando o produto tem variante unica. */
  variante: string | null;
  /** Miniatura (CDN da Shopify, https). null = sem foto. */
  imagem: string | null;
}

/** Os SKUs de um pedido de leitura: sem vazio, sem repetido, sem os longos, no maximo 25. */
export function skusDoPedido(crus: readonly string[]): string[] {
  const unicos = [...new Set(crus.map((s) => s.trim()).filter((s) => s && s.length <= MAX_TAMANHO_SKU))];
  return unicos.slice(0, MAX_SKUS_POR_BUSCA);
}

/** Filtro da Shopify: sku:"A" OR sku:"B", com aspas e barra escapadas dentro do valor. */
export function buscaPorSku(skus: readonly string[]): string {
  return skus.map((s) => `sku:"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`).join(" OR ");
}

export interface NoVariante {
  sku?: string | null;
  title?: string | null;
  image?: { url?: string | null } | null;
  product?: { title?: string | null; featuredImage?: { url?: string | null } | null } | null;
}

function urlSegura(url: string | null | undefined): string | null {
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

/**
 * Variantes que a Shopify devolveu -> produto por SKU pedido. A busca dela nao
 * e exata (ignora caixa, acha por pedaco): so vale a variante cujo SKU, sem
 * espaco nas pontas, e IGUAL ao pedido -- a mesma chave do calculo
 * (chaveSku). Dois produtos com o mesmo SKU: vale o primeiro. SKU nao achado
 * fica de fora (a tela mostra so o codigo).
 */
export function produtosDosSkus(nos: readonly NoVariante[], pedidos: readonly string[]): Record<string, ProdutoDoSku> {
  const quer = new Set(pedidos);
  const saida: Record<string, ProdutoDoSku> = {};
  for (const n of nos) {
    const sku = (n.sku ?? "").trim();
    if (!quer.has(sku) || saida[sku]) continue;
    const nome = (n.product?.title ?? "").trim();
    if (!nome) continue;
    const variante = (n.title ?? "").trim();
    saida[sku] = {
      nome,
      variante: variante && variante !== "Default Title" ? variante : null,
      imagem: urlSegura(n.image?.url) ?? urlSegura(n.product?.featuredImage?.url),
    };
  }
  return saida;
}
