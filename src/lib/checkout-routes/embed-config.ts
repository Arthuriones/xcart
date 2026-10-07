import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeRotation, type RouteTarget } from "@/lib/checkout-routes/rotation";
import { legacyTargetFromConfig, loadRouteTargets } from "@/lib/checkout-routes/targets";

export const EMBED_CONFIG_SELECT =
  "id, rotation, sku_map, variant_map, settings, target_store_id, target:target_store_id(name, shop_domain, target_language)";

export interface EmbedTarget {
  id: string | null;
  domain: string;
  weight: number;
  /** Teto de pedidos/dia. Presente, o loader nao sorteia inline: cai na API. */
  dailyLimit?: number;
  skuMap: Record<string, string>;
  variantMap: Record<string, string>;
  country: string;
  locale: string;
}

export interface EmbedConfig {
  rotation: { strategy: "sticky" | "each_checkout" };
  targets: EmbedTarget[];
  // Campos do formato antigo, repetidos do primeiro destino. Tema de lojista
  // que ainda roda a versao anterior do loader le daqui e continua roteando
  // (sem rodizio) ate o script ser atualizado.
  domain: string;
  skuMap: Record<string, string>;
  variantMap: Record<string, string>;
  country: string;
  locale: string;
}

export function toEmbedTarget(target: RouteTarget): EmbedTarget {
  const skuMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(target.skuMap || {})) {
    const lower = key.trim().toLowerCase();
    if (lower) skuMap[lower] = String(value);
  }

  const variantMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(target.variantMap || {})) {
    if (key) variantMap[key] = String(value);
  }

  let country = target.settings.checkout_country || "";
  let locale = target.settings.checkout_locale || "";
  if (!country && target.targetLanguage) {
    const [, region] = String(target.targetLanguage).split("-");
    country = region ? region.toUpperCase() : "";
    locale = String(target.targetLanguage);
  }

  return {
    id: target.id.startsWith("legacy:") ? null : target.id,
    domain: target.domain,
    weight: target.weight,
    ...(target.dailyLimit ? { dailyLimit: target.dailyLimit } : {}),
    skuMap,
    variantMap,
    country,
    locale,
  };
}

interface ConfigRow {
  id: string;
  rotation?: unknown;
  sku_map?: Record<string, string | number> | null;
  variant_map?: Record<string, string | number> | null;
  settings?: Record<string, unknown> | null;
  target_store_id?: string | null;
  target?: unknown;
}

/**
 * O JSON que vai para o tema da vitrine (asset xcart-config.json) e que o
 * loader usa para rotear sem chamar a API.
 *
 * Um lugar so: o embed-config e o update-theme precisam produzir exatamente o
 * mesmo payload. Se divergirem, o lojista ve uma coisa no painel e o tema dele
 * roteia por outra.
 */
export async function buildEmbedConfig(
  supabase: SupabaseClient,
  config: ConfigRow
): Promise<EmbedConfig> {
  let targets = await loadRouteTargets(supabase, config.id, { onlyEnabled: true });
  if (targets.length === 0) {
    const legacy = legacyTargetFromConfig(
      config as Parameters<typeof legacyTargetFromConfig>[0]
    );
    if (legacy) targets = [legacy];
  }

  const embedTargets = targets.filter((t) => t.domain).map(toEmbedTarget);
  const primary = embedTargets[0];

  return {
    rotation: normalizeRotation(config.rotation),
    targets: embedTargets,
    domain: primary?.domain || "",
    skuMap: primary?.skuMap || {},
    variantMap: primary?.variantMap || {},
    country: primary?.country || "",
    locale: primary?.locale || "",
  };
}
