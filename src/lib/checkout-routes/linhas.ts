import type { CheckoutRouteLine } from "@/lib/shopify/cart-routing";

/**
 * Normalizacao das linhas de carrinho que chegam de fora.
 *
 * Mora em modulo proprio para poder ser testada: /api/checkout-routes/resolve
 * e o unico chamador hoje, mas o valor aqui e a lista de casos que ela recusa,
 * e isso so vale se estiver coberto.
 *
 * Por que existe: o endpoint e PUBLICO -- sem sessao, CORS *, e o token que
 * ele pede fica no HTML da vitrine. As linhas entravam por cast
 * (`body.lines as CheckoutRouteLine[]`), sem teto nem validacao de elemento.
 * Um corpo com 100 mil linhas fazia o servidor varrer todas e, para cada SKU
 * nao resolvido, paginar o products.json INTEIRO da loja de checkout.
 */

/** Teto de linhas por carrinho. Carrinho real nao chega perto. */
export const MAX_LINHAS = 100;

/** SKU da Shopify cabe folgado nisto. */
export const MAX_SKU = 120;

/** Quantidade por linha; a Shopify tambem nao aceita carrinho absurdo. */
export const MAX_QUANTIDADE = 1000;

function idDeVariante(valor: unknown): string | undefined {
  if (typeof valor === "string" || typeof valor === "number") {
    const texto = String(valor).slice(0, 64);
    return texto || undefined;
  }
  return undefined;
}

/** Nunca lanca: entrada torta vira lista vazia. */
export function normalizarLinhas(entrada: unknown): CheckoutRouteLine[] {
  if (!Array.isArray(entrada)) return [];

  return entrada
    .slice(0, MAX_LINHAS)
    .map((linha): CheckoutRouteLine => {
      const l = (linha ?? {}) as Record<string, unknown>;
      const quantidade = Number(l.quantity);
      return {
        sku: typeof l.sku === "string" ? l.sku.slice(0, MAX_SKU) || undefined : undefined,
        sourceVariantId: idDeVariante(l.sourceVariantId),
        targetVariantId: idDeVariante(l.targetVariantId),
        // A quantidade entra no permalink do carrinho: inteiro positivo, com
        // teto. NaN virava a string "NaN" dentro da URL.
        quantity:
          Number.isFinite(quantidade) && quantidade > 0
            ? Math.min(Math.floor(quantidade), MAX_QUANTIDADE)
            : 1,
      };
    })
    .filter((l) => Boolean(l.sku || l.sourceVariantId || l.targetVariantId));
}
