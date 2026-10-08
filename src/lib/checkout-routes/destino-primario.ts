import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Toda rota nasce com a linha do seu destino em routed_checkout_targets.
//
// POST /api/checkout-routes (modo padrao do assistente, "gerar") e o clone
// gravavam so a rota. Ela rodava pelo destino "legacy:" -- que a tela nao deixa
// pausar, pesar nem tirar, e que o cron do conserto nao enxerga (ele percorre
// as linhas de destino). E quando o lojista usava "Adicionar loja", entrava
// UMA linha, a da loja nova: como o legado so vale com zero linhas, a loja
// original saia do resolve e do tema sem aviso. Se a nova tinha entrado com
// peso 0 (cobertura baixa), ela virava o unico destino e levava 100% do
// trafego.
// ============================================================================

const SETTINGS_DE_DESTINO = ["checkout_domain", "checkout_country", "checkout_locale"] as const;

/** Do settings da rota, so o que vale por destino (dominio e mercado). */
export function settingsDoDestino(
  settingsDaRota: Record<string, unknown> | null | undefined,
  generatedBy: string
): Record<string, unknown> {
  const saida: Record<string, unknown> = { generatedBy };
  for (const chave of SETTINGS_DE_DESTINO) {
    const valor = settingsDaRota?.[chave];
    if (typeof valor === "string" && valor.trim()) saida[chave] = valor;
  }
  return saida;
}

/**
 * Garante que a rota tenha a linha do destino principal (target_store_id),
 * com os mapas e o mercado que a rota ja tinha. Nao faz nada se a rota ja
 * tem QUALQUER linha de destino. Idempotente pelo unique
 * (route_id, target_store_id).
 *
 * Cliente admin: a sessao nao insere destino desde a 064. Quem chama ja
 * conferiu o dono da rota.
 */
export async function garantirDestinoPrimario(
  admin: SupabaseClient,
  routeId: string,
  generatedBy = "rota"
): Promise<{ criado: boolean; erro?: string }> {
  const { count, error: erroContagem } = await admin
    .from("routed_checkout_targets")
    .select("id", { count: "exact", head: true })
    .eq("route_id", routeId);
  if (erroContagem) return { criado: false, erro: erroContagem.message };
  if ((count ?? 0) > 0) return { criado: false };

  const { data: rota, error: erroRota } = await admin
    .from("routed_checkout_configs")
    .select("id, target_store_id, sku_map, variant_map, settings")
    .eq("id", routeId)
    .maybeSingle();
  if (erroRota || !rota) return { criado: false, erro: erroRota?.message || "rota nao encontrada" };
  if (!rota.target_store_id) return { criado: false };

  const { error } = await admin.from("routed_checkout_targets").upsert(
    {
      route_id: rota.id,
      target_store_id: rota.target_store_id,
      weight: 1,
      enabled: true,
      sku_map: rota.sku_map || {},
      variant_map: rota.variant_map || {},
      settings: settingsDoDestino(rota.settings as Record<string, unknown> | null, generatedBy),
      position: 0,
    },
    { onConflict: "route_id,target_store_id", ignoreDuplicates: true }
  );
  if (error) return { criado: false, erro: error.message };
  return { criado: true };
}
