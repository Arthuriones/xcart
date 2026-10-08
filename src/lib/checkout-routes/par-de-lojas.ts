// ============================================================================
// Quais lojas podem ser loja de checkout de uma rota. Sem rede e sem banco:
// o servidor (connect-by-sku) e a tela (Adicionar loja) usam a mesma regra.
//
// Reclamacao real (NORAH): produtos de outro nicho aparecendo na loja de
// checkout. "Adicionar loja" oferecia TODAS as lojas do usuario -- inclusive a
// vitrine e a loja de checkout de outra rota --, a loja entrava com um unico
// SKU casado, e o conserto despejava nela o catalogo da vitrine errada.
// ============================================================================

/**
 * Fracao minima do catalogo da vitrine que precisa casar para uma loja
 * ENTRAR numa rota que ja existe. Abaixo disso ela nao e copia desta vitrine.
 * (Entre isto e 90% ela entra com peso 0, fora do rodizio ate revisar.)
 */
export const COBERTURA_MINIMA_PARA_ENTRAR = 0.5;

interface RotaResumo {
  id: string;
  source_store_id?: string | null;
  sourceStoreId?: string | null;
}

function vitrineDe(rota: RotaResumo): string {
  return rota.source_store_id || rota.sourceStoreId || "";
}

/** A loja e a vitrine de alguma rota (que nao a `rotaAtual`)? */
export function lojaEhVitrineDeOutraRota(
  storeId: string,
  rotas: readonly RotaResumo[],
  rotaAtual: string | null
): boolean {
  return rotas.some((rota) => rota.id !== rotaAtual && vitrineDe(rota) === storeId);
}

/**
 * Lojas que a tela oferece em "Adicionar loja de checkout": nem a vitrine
 * desta rota, nem uma loja que ja esta nela, nem a vitrine ou a loja de
 * checkout de OUTRA rota. A loja de checkout de outra vitrine tem o catalogo
 * daquela vitrine: o conserto passaria a criar nela os produtos desta.
 */
export function lojasCandidatasACheckout<L extends { id: string }>(
  lojas: readonly L[],
  rotaAtual: { id: string; sourceStoreId: string; targets: readonly { storeId: string }[] },
  rotas: readonly { id: string; sourceStoreId: string; targets: readonly { storeId: string }[] }[]
): L[] {
  const ocupadas = new Set<string>([rotaAtual.sourceStoreId]);
  for (const t of rotaAtual.targets) ocupadas.add(t.storeId);
  for (const rota of rotas) {
    if (rota.id === rotaAtual.id) continue;
    ocupadas.add(rota.sourceStoreId);
    for (const t of rota.targets) ocupadas.add(t.storeId);
  }
  return lojas.filter((loja) => !ocupadas.has(loja.id));
}
