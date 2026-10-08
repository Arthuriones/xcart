// ============================================================================
// A linha que o connect-by-sku grava para a loja de checkout que entra na rota.
//
// O upsert (route_id, target_store_id) e o mesmo para loja nova e para loja
// que JA estava na rota (casar de novo depois de reconectar, re-adicionar).
// Ele gravava `settings: { generatedBy }` e `weight: 1` por cima: casar de
// novo apagava o pais/moeda e o dominio do checkout que o lojista escolheu e
// devolvia o peso para 1 (a divisao 70/30 virava 50/50 sem aviso).
//
// Agora a loja que ja estava mantem settings (so o mapa e a cobertura sao
// refeitos) e peso. A unica coisa que ainda zera o peso e a cobertura ruim
// (`seguro` falso): a tela avisa "entrou com 0%" e e o que impede mandar
// comprador para uma loja que perdeu metade do catalogo.
// ============================================================================

export interface DestinoQueJaEstava {
  weight?: number | null;
  settings?: Record<string, unknown> | null;
}

export function linhaDoDestinoConectado(entrada: {
  routeId: string;
  targetStoreId: string;
  seguro: boolean;
  skuMap: Record<string, unknown>;
  variantMap: Record<string, unknown>;
  position: number;
  existente?: DestinoQueJaEstava | null;
}) {
  const anterior =
    entrada.existente?.settings && typeof entrada.existente.settings === "object"
      ? entrada.existente.settings
      : {};
  const pesoAnterior = entrada.existente
    ? Math.max(0, Math.floor(Number(entrada.existente.weight ?? 1)))
    : 1;
  return {
    route_id: entrada.routeId,
    target_store_id: entrada.targetStoreId,
    weight: entrada.seguro ? (Number.isFinite(pesoAnterior) ? pesoAnterior : 1) : 0,
    enabled: true,
    sku_map: entrada.skuMap,
    variant_map: entrada.variantMap,
    settings: {
      ...anterior,
      generatedBy: typeof anterior.generatedBy === "string" ? anterior.generatedBy : "connect_by_sku",
    },
    position: entrada.position,
  };
}
