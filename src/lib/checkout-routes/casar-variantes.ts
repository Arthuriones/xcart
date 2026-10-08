// ============================================================================
// Casamento produto a produto do create-destination (modo "gerar" do
// assistente), sem rede: testado em tests/roteamento-casar-variantes.test.ts.
//
// O defeito que isto fecha: duas bolsas diferentes da vitrine, neutralizadas
// para o mesmo titulo generico ("Small Leather Shoulder Bag"), ganham o mesmo
// handle. A segunda achava o produto da primeira pelo handle e o tratava como
// "ja existe"; as variantes casavam pela POSICAO quando a opcao nao batia, e o
// SKU da bolsa B era gravado por cima do SKU das variantes da bolsa A. Dali em
// diante o conserto confiava no SKU igual e confirmava o par errado para
// sempre -- o comprador da bolsa B pagava pela bolsa A.
// ============================================================================

export interface VarianteParaCasar {
  id: string;
  sku?: string | null;
  selectedOptions?: { name: string; value: string }[] | null;
}

export interface ProdutoParaCasar {
  handle?: string;
  variants?: { nodes?: VarianteParaCasar[] } | null;
}

function variantesDe(produto: ProdutoParaCasar | null | undefined): VarianteParaCasar[] {
  return produto?.variants?.nodes || [];
}

function skuDe(variante: VarianteParaCasar): string {
  return (variante.sku || "").trim();
}

export function assinaturaDaVariante(variante: VarianteParaCasar): string {
  return (variante.selectedOptions || [])
    .map((option) => option.value)
    .filter(Boolean)
    .join(" / ")
    .toLowerCase();
}

/**
 * O produto achado no checkout e mesmo o desta variante da vitrine?
 *
 * - Alguma variante dele tem um SKU da vitrine: sim, o SKU prova.
 * - Ele tem SKU, e nenhum e da vitrine: nao. E outro produto que caiu no
 *   mesmo handle.
 * - Ele nao tem SKU nenhum: so se o handle procurado e o da propria vitrine
 *   (copia sem IA). Handle tirado de titulo neutralizado/traduzido nao prova
 *   nada -- a IA da o mesmo titulo generico para produtos diferentes.
 */
export function ehOMesmoProduto(
  origem: ProdutoParaCasar,
  existente: ProdutoParaCasar,
  opcoes: { handleConfiavel: boolean }
): boolean {
  const skusDaOrigem = new Set(
    variantesDe(origem)
      .map((v) => skuDe(v).toLowerCase())
      .filter(Boolean)
  );
  const skusDele = variantesDe(existente)
    .map((v) => skuDe(v).toLowerCase())
    .filter(Boolean);
  if (skusDele.some((sku) => skusDaOrigem.has(sku))) return true;
  if (skusDele.length > 0) return false;
  return opcoes.handleConfiavel;
}

export interface CasamentoDoProduto {
  skuMap: Record<string, string>;
  variantMap: Record<string, string>;
  /**
   * SKUs da vitrine a gravar no checkout: SO em variante de la que esta SEM
   * SKU. Variante com SKU diferente nao e reescrita -- pode ser par de outra
   * variante, de outra rota.
   */
  preencherSku: { variantId: string; sku: string }[];
}

/**
 * Pares variante da vitrine -> variante do checkout dentro de UM produto.
 *
 * Ordem: SKU igual; depois a mesma combinacao de opcoes; e a posicao so com
 * `porPosicao` -- o produto que acabou de ser criado a partir desta mesma
 * lista de variantes, com o mesmo numero delas (opcao traduzida muda a
 * assinatura, mas a ordem e a da entrada). Num produto que JA existia, a
 * posicao nao prova nada: variante sem par fica sem par, e o conserto cria.
 * Nunca duas variantes da vitrine na mesma variante do checkout.
 */
export function casarVariantesDoProduto(
  origem: ProdutoParaCasar,
  destino: ProdutoParaCasar | null | undefined,
  opcoes: { porPosicao: boolean }
): CasamentoDoProduto {
  const daOrigem = variantesDe(origem);
  const doDestino = variantesDe(destino);
  const usadas = new Set<string>();

  const porSku = new Map<string, VarianteParaCasar>();
  const porAssinatura = new Map<string, VarianteParaCasar>();
  for (const v of doDestino) {
    const sku = skuDe(v).toLowerCase();
    if (sku && !porSku.has(sku)) porSku.set(sku, v);
    const assinatura = assinaturaDaVariante(v);
    if (!porAssinatura.has(assinatura)) porAssinatura.set(assinatura, v);
  }
  const posicaoValida = opcoes.porPosicao && doDestino.length === daOrigem.length;

  const resultado: CasamentoDoProduto = { skuMap: {}, variantMap: {}, preencherSku: [] };

  daOrigem.forEach((variante, indice) => {
    const sku = skuDe(variante);
    // Variante do checkout com OUTRO SKU nao serve: ela e o par de outra
    // variante (desta ou de outra vitrine). Sem SKU, ou com o mesmo, serve.
    const serve = (c: VarianteParaCasar | undefined): c is VarianteParaCasar => {
      if (!c || usadas.has(c.id)) return false;
      const skuDele = skuDe(c).toLowerCase();
      return !skuDele || skuDele === sku.toLowerCase();
    };
    const alvo = [
      sku ? porSku.get(sku.toLowerCase()) : undefined,
      porAssinatura.get(assinaturaDaVariante(variante)),
      posicaoValida ? doDestino[indice] : undefined,
    ].find(serve);
    if (!alvo) return;
    const skuDoAlvo = skuDe(alvo);

    usadas.add(alvo.id);
    resultado.variantMap[variante.id] = alvo.id;
    if (sku) {
      resultado.skuMap[sku] = alvo.id;
      if (!skuDoAlvo) resultado.preencherSku.push({ variantId: alvo.id, sku });
    }
  });

  return resultado;
}
