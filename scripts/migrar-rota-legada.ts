import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Migra uma rota do formato antigo para o de multiplos destinos.
 *
 * Antes da migration 025 o destino de uma rota morava na propria rota:
 * target_store_id, sku_map e variant_map eram colunas de
 * routed_checkout_configs. Depois dela cada destino virou uma linha em
 * routed_checkout_targets, com o proprio mapa -- e e isso que permite uma
 * vitrine apontar para varias lojas de checkout com rodizio.
 *
 * O backfill de 025 converteu o que existia naquele dia. Rota criada depois
 * por um caminho antigo continua legada: funciona, porque o codigo tem
 * fallback para as colunas da rota, mas nao entra em rodizio e nao tem mapa
 * proprio.
 *
 * A migracao e aditiva: cria a linha de destino copiando os mapas e NAO apaga
 * as colunas antigas. Se algo der errado, basta remover a linha e o fallback
 * volta a valer.
 *
 * Uso:  npx tsx scripts/migrar-rota-legada.ts <routeId> [--aplicar]
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const routeId = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  if (!routeId) {
    console.error("uso: npx tsx scripts/migrar-rota-legada.ts <routeId> [--aplicar]");
    process.exit(1);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: rota, error } = await admin
    .from("routed_checkout_configs")
    .select("id, name, target_store_id, sku_map, variant_map, settings, last_healed_at")
    .eq("id", routeId)
    .single();
  if (error || !rota) throw new Error(`rota ${routeId} nao encontrada`);

  const { data: existentes } = await admin
    .from("routed_checkout_targets")
    .select("id, target_store_id")
    .eq("route_id", routeId);

  console.log(`rota: ${rota.name}`);
  console.log(`  destino legado: ${rota.target_store_id ?? "(nenhum)"}`);
  console.log(`  sku_map: ${Object.keys(rota.sku_map || {}).length} entradas`);
  console.log(`  variant_map: ${Object.keys(rota.variant_map || {}).length} entradas`);
  console.log(`  linhas de destino ja existentes: ${existentes?.length ?? 0}`);

  if (!rota.target_store_id) {
    console.log("\nnada a migrar: a rota nao tem destino legado.");
    return;
  }
  if (existentes?.some((t) => t.target_store_id === rota.target_store_id)) {
    console.log("\nnada a migrar: esse destino ja tem linha propria.");
    return;
  }
  if (Object.keys(rota.sku_map || {}).length === 0) {
    console.log("\nAVISO: sku_map vazio. Migrar assim deixaria a rota sem mapa.");
    if (!aplicar) return;
  }

  if (!aplicar) {
    console.log("\n(simulacao — rode com --aplicar para criar a linha de destino)");
    return;
  }

  const { data: criado, error: erroInsert } = await admin
    .from("routed_checkout_targets")
    .insert({
      route_id: rota.id,
      target_store_id: rota.target_store_id,
      weight: 1,
      enabled: true,
      sku_map: rota.sku_map,
      variant_map: rota.variant_map,
      settings: rota.settings,
      position: 0,
      last_healed_at: rota.last_healed_at,
    })
    .select("id")
    .single();
  if (erroInsert) throw new Error(erroInsert.message);

  console.log(`\nlinha de destino criada: ${criado.id}`);
  console.log(
    "As colunas antigas da rota ficam como estao -- servem de rede se for preciso voltar atras."
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
