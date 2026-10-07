import type { SupabaseClient } from "@supabase/supabase-js";
import type { RouteTarget, RouteTargetSettings } from "@/lib/checkout-routes/rotation";

export const ROUTE_TARGET_SELECT =
  "id, target_store_id, weight, enabled, daily_limit, sku_map, variant_map, settings, position, last_healed_at, store:target_store_id(name, shop_domain, target_language)";

interface RawTargetStore {
  name?: string | null;
  shop_domain?: string | null;
  target_language?: string | null;
}

export interface RawRouteTarget {
  id: string;
  target_store_id: string;
  weight: number | null;
  enabled: boolean | null;
  daily_limit?: number | null;
  sku_map: Record<string, string | number> | null;
  variant_map: Record<string, string | number> | null;
  settings: RouteTargetSettings | null;
  position?: number | null;
  last_healed_at?: string | null;
  store?: RawTargetStore | RawTargetStore[] | null;
}

function firstOf<T>(value: T | T[] | null | undefined): T | undefined {
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export function toRouteTarget(raw: RawRouteTarget): RouteTarget {
  const store = firstOf(raw.store);
  const settings = (raw.settings || {}) as RouteTargetSettings;
  return {
    id: raw.id,
    targetStoreId: raw.target_store_id,
    // Override da rota ganha do dominio da loja: e o caminho para quando o
    // dominio mudou na Shopify e a loja conectada ainda nao foi atualizada.
    domain: (settings.checkout_domain?.trim() || store?.shop_domain || "").trim(),
    storeName: store?.name || undefined,
    weight: Math.max(0, Math.floor(Number(raw.weight ?? 1))),
    enabled: raw.enabled !== false,
    dailyLimit: raw.daily_limit ?? null,
    skuMap: raw.sku_map || {},
    variantMap: raw.variant_map || {},
    settings,
    targetLanguage: store?.target_language ?? null,
  };
}

/**
 * Destinos de uma rota, ja ordenados e com o dominio resolvido.
 *
 * Rota criada antes da migracao 025 tem os destinos backfillados, entao aqui
 * sempre volta pelo menos um. Se voltar vazio (linha de destino apagada a mao,
 * loja de checkout removida), o chamador cai no destino legado da propria rota
 * -- e melhor rotear para o destino antigo do que derrubar o checkout.
 */
export async function loadRouteTargets(
  supabase: SupabaseClient,
  routeId: string,
  options: { onlyEnabled?: boolean } = {}
): Promise<RouteTarget[]> {
  let query = supabase
    .from("routed_checkout_targets")
    .select(ROUTE_TARGET_SELECT)
    .eq("route_id", routeId);

  if (options.onlyEnabled) query = query.eq("enabled", true);

  const { data, error } = await query
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error || !data) return [];
  return (data as unknown as RawRouteTarget[]).map(toRouteTarget);
}

/**
 * Destino legado montado a partir das colunas da propria rota. Rede de
 * seguranca para rota sem nenhuma linha em routed_checkout_targets.
 */
export function legacyTargetFromConfig(config: {
  id: string;
  target_store_id?: string | null;
  sku_map?: Record<string, string | number> | null;
  variant_map?: Record<string, string | number> | null;
  settings?: RouteTargetSettings | null;
  target?: RawTargetStore | RawTargetStore[] | null;
}): RouteTarget | null {
  const store = firstOf(config.target);
  const settings = (config.settings || {}) as RouteTargetSettings;
  const domain = (settings.checkout_domain?.trim() || store?.shop_domain || "").trim();
  if (!domain) return null;
  return {
    id: `legacy:${config.id}`,
    targetStoreId: config.target_store_id || "",
    domain,
    storeName: store?.name || undefined,
    weight: 1,
    enabled: true,
    dailyLimit: null,
    skuMap: config.sku_map || {},
    variantMap: config.variant_map || {},
    settings,
    targetLanguage: store?.target_language ?? null,
  };
}
