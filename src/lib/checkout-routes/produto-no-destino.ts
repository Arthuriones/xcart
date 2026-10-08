// ============================================================================
// Em qual produto da loja de checkout entram as variantes que faltam.
//
// O produto da vitrine ja existe no checkout quando ALGUMA variante IRMA (do
// mesmo produto da vitrine) ja casou por SKU: as que faltam entram no produto
// dela. Nenhuma irma casou = o produto nao existe la e tem que ser criado.
//
// O palpite antigo era pelo PREFIXO do SKU ("ABC-PRETO-38" -> "ABC") contra
// qualquer SKU ja mapeado. Mas o SKU que o proprio xcart carimba e
// "xc-<aleatorio>": prefixo "xc" em TODO produto. Toda variante nova ia parar
// no primeiro produto "xc-" do mapa. Medido na NORAH OUTLET (09/2026): uma
// "Arque Small Leather Shoulder Bag" com 17 variantes de 5 bolsas diferentes,
// e o comprador da LV Pochette Felicie caindo nela no checkout.
// ============================================================================

export interface VarianteDoDestino {
  variantId: string;
  productId: string;
}

/**
 * `achar` diz qual variante do checkout ja e par de uma variante da vitrine.
 * Um Map por SKU serve para o caso simples; o conserto passa uma funcao que
 * tambem enxerga o par adotado pelo variant_map (SKU trocado na vitrine).
 */
export function produtoNoDestino<
  T extends VarianteDoDestino,
  V extends { sku?: string | null } = { sku?: string | null },
>(
  variantesDaVitrine: readonly V[],
  achar: ReadonlyMap<string, T> | ((variante: V) => T | null | undefined)
): T | null {
  for (const irma of variantesDaVitrine) {
    let achada: T | null | undefined;
    if (typeof achar === "function") {
      achada = achar(irma);
    } else {
      const sku = (irma.sku || "").trim().toLowerCase();
      if (!sku) continue;
      achada = achar.get(sku);
    }
    if (achada) return achada;
  }
  return null;
}
