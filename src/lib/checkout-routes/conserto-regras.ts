// ============================================================================
// Regras do conserto que nao dependem de rede: ficam aqui para serem testadas
// sem Shopify nem banco. Quem chama e src/lib/checkout-routes/heal.ts.
// ============================================================================

function idNumerico(valor: string | number | null | undefined): string | null {
  if (valor === undefined || valor === null) return null;
  return String(valor).match(/(\d+)$/)?.[1] || null;
}

// ---------------------------------------------------------------------------
// Par pelo variant_map antigo
// ---------------------------------------------------------------------------

/**
 * Variante da vitrine que nao casou por SKU, mas que o variant_map do destino
 * ja apontava para uma variante que continua viva no checkout.
 *
 * O conserto decidia "falta" so pelo SKU. Mas o loader roteia pelo
 * variant_map primeiro (cart-routing.ts): o comprador continuava indo para a
 * variante certa, e o conserto, sem achar o SKU novo no checkout, CRIAVA o
 * produto de novo -- IA de texto, credito de imagem, duplicata publicada e o
 * antigo orfao. Acontecia quando o SKU da vitrine mudava (app de fornecedor,
 * reimportacao, o proprio carimbo de desduplicacao) e na vitrine sem SKU
 * ligada pelo create-destination, cuja loja de checkout ficou sem SKU: na
 * primeira passada o carimbo "xc-<id>" fazia o catalogo inteiro parecer novo.
 *
 * Devolve o id numerico da variante do checkout a adotar, ou null. Nao adota
 * quando a variante do checkout:
 *  - ja e par de outra variante da vitrine nesta passada (`reivindicadas`);
 *  - carrega um SKU que pertence a OUTRA variante viva da vitrine -- ai o
 *    mapa antigo e que esta errado (o conserto do prefixo "xc" deixou disso).
 */
export function parPeloMapaAntigo(entrada: {
  varianteId: string | number;
  mapaAntigo: Readonly<Record<string, string | number>>;
  /** Variantes vivas do checkout, por id numerico, com o SKU delas. */
  checkoutPorId: ReadonlyMap<string, { sku?: string | null }>;
  reivindicadas: ReadonlySet<string>;
  /** SKUs (minusculos) de todas as variantes da vitrine. */
  skusDaVitrine: ReadonlySet<string>;
}): string | null {
  const numero = idNumerico(entrada.varianteId);
  if (!numero) return null;
  const bruto =
    entrada.mapaAntigo[numero] ??
    entrada.mapaAntigo[`gid://shopify/ProductVariant/${numero}`];
  const alvo = idNumerico(bruto as string | number | undefined);
  if (!alvo) return null;

  const variante = entrada.checkoutPorId.get(alvo);
  if (!variante) return null; // apagada no checkout: ai sim falta
  if (entrada.reivindicadas.has(alvo)) return null;

  const skuDela = (variante.sku || "").trim().toLowerCase();
  if (skuDela && entrada.skusDaVitrine.has(skuDela)) return null;

  return alvo;
}

// ---------------------------------------------------------------------------
// Quando o conserto pode CRIAR produto na loja de checkout
// ---------------------------------------------------------------------------

/**
 * Abaixo disto o par de lojas nao parece o certo: o conserto so mapeia.
 * Uma loja de checkout de outro nicho, ligada a vitrine por engano, casa um
 * punhado de SKUs curtos ("1", "3", "101") e mais nada.
 */
export const COBERTURA_MINIMA_PARA_CRIAR = 0.7;

/** Mais que isto numa passada so com o lojista confirmando. */
export const MAX_PRODUTOS_POR_PASSADA = 20;

export interface DecisaoDeCriacao {
  /** Pode criar produto novo na loja de checkout. */
  criarProdutos: boolean;
  /** Pode acrescentar variante em produto que ja existe la. */
  estenderProdutos: boolean;
  /** Por que nao criou, pronto para a tela. null = nada barrado. */
  motivo: string | null;
}

/**
 * Separa MAPEAR (sempre) de CRIAR (so com o par confirmado).
 *
 * O conserto despejava o catalogo da vitrine em qualquer loja ligada a rota:
 * a NORAH OUTLET ganhou chinelos e tenis de uma rota com a vitrine errada --
 * e ganhou de novo depois de apagar, porque o cron recriava de hora em hora.
 * "Adicionar loja" pendurava a loja com 1 casamento e peso 0, e o peso 0
 * ("fora do rodizio ate revisar") nao impedia o cron de criar tudo.
 *
 * Sem o lojista confirmar, so cria quando a rota e o destino estao ligados,
 * o destino esta no rodizio, a vitrine ja casa bem com ele e a leva e pequena.
 */
export function decidirCriacao(e: {
  /** O lojista pediu para criar (botao de confirmar). */
  confirmado: boolean;
  rotaLigada: boolean;
  destinoLigado: boolean;
  peso: number;
  /** Variantes da vitrine com par no checkout antes de criar qualquer coisa. */
  variantesComPar: number;
  /** Variantes da vitrine com SKU. */
  variantesTotal: number;
  /** Produtos da vitrine sem nenhuma variante no checkout. */
  produtosNovos: number;
}): DecisaoDeCriacao {
  if (e.confirmado) {
    return { criarProdutos: true, estenderProdutos: true, motivo: null };
  }

  const barrado = (motivo: string): DecisaoDeCriacao => ({
    criarProdutos: false,
    estenderProdutos: false,
    motivo,
  });

  if (!e.rotaLigada) return barrado("a rota está pausada");
  if (!e.destinoLigado || e.peso <= 0) {
    return barrado("esta loja de checkout está fora do rodízio");
  }
  if (e.variantesTotal > 0) {
    const cobertura = e.variantesComPar / e.variantesTotal;
    if (cobertura < COBERTURA_MINIMA_PARA_CRIAR) {
      return barrado(
        `só ${Math.floor(cobertura * 100)}% da vitrine tem par nesta loja de checkout; confira se é o par certo de lojas`
      );
    }
  }
  if (e.produtosNovos > MAX_PRODUTOS_POR_PASSADA) {
    return {
      criarProdutos: false,
      estenderProdutos: true,
      motivo: `são ${e.produtosNovos} produtos de uma vez`,
    };
  }
  return { criarProdutos: true, estenderProdutos: true, motivo: null };
}

/** A frase do card quando sobrou produto sem criar. */
export function mensagemDeCriacaoPendente(
  produtos: number,
  variantes: number,
  motivo: string
): string {
  const oQue =
    produtos > 0
      ? produtos === 1
        ? "1 produto da vitrine falta na loja de checkout e não foi criado sozinho"
        : `${produtos} produtos da vitrine faltam na loja de checkout e não foram criados sozinhos`
      : variantes === 1
        ? "1 variante da vitrine falta na loja de checkout e não foi criada sozinha"
        : `${variantes} variantes da vitrine faltam na loja de checkout e não foram criadas sozinhas`;
  return `${oQue} (${motivo}). Confira e confirme em Diagnóstico.`;
}
