import { config } from "dotenv";
config({ path: ".env.local" });

/**
 * Deixa UMA rota ligada por vitrine.
 *
 * O modelo e "uma vitrine, varias lojas de checkout": as lojas extras entram
 * como destino, nao como rota nova. Com duas rotas ligadas na mesma vitrine
 * cada uma ganha seu public_token e o tema carrega UM so -- as outras viram
 * configuracao fantasma. O lojista mexe na rota errada, nada acontece, e a
 * tela nao tem como explicar.
 *
 * O POST /api/checkout-routes agora recusa criar a segunda (409), mas isso nao
 * limpa o que ja existia. Este script limpa.
 *
 * DESLIGA, nao apaga. enabled=false e reversivel e o mapa de SKU fica intacto;
 * apagar destruiria trabalho de outro usuario sem volta. O motivo e o comando
 * para reverter ficam gravados em settings.disabled_*.
 *
 * Qual fica: a que tem mais SKU mapeado. Empate resolve pela mais antiga --
 * duplicata costuma ser clique repetido, entao a primeira e a intencional.
 *
 * Uso:  npx tsx scripts/limpar-rotas-duplicadas.ts [--aplicar]
 */
import { createClient } from "@supabase/supabase-js";

const APLICAR = process.argv.includes("--aplicar");

function contarSkus(mapa: unknown): number {
  return mapa && typeof mapa === "object" ? Object.keys(mapa).length : 0;
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: rotas } = await admin
    .from("routed_checkout_configs")
    .select("id, name, user_id, source_store_id, enabled, sku_map, created_at")
    .eq("enabled", true)
    .order("created_at");

  const porVitrine = new Map<string, typeof rotas>();
  for (const rota of rotas || []) {
    const lista = porVitrine.get(rota.source_store_id) || [];
    lista.push(rota);
    porVitrine.set(rota.source_store_id, lista);
  }

  const duplicadas = [...porVitrine.entries()].filter(([, r]) => (r?.length ?? 0) > 1);
  if (duplicadas.length === 0) {
    console.log("nenhuma vitrine com mais de uma rota ligada.");
    return;
  }

  for (const [vitrineId, lista] of duplicadas) {
    const { data: loja } = await admin
      .from("stores")
      .select("shop_domain")
      .eq("id", vitrineId)
      .single();

    // Mais SKU ganha; empate fica com a mais antiga.
    const ordenadas = [...(lista || [])].sort((a, b) => {
      const d = contarSkus(b.sku_map) - contarSkus(a.sku_map);
      return d !== 0 ? d : a.created_at.localeCompare(b.created_at);
    });
    const [fica, ...saem] = ordenadas;

    console.log(`\n${loja?.shop_domain}: ${lista?.length} rotas ligadas`);
    console.log(`  fica  ${fica.id} (${contarSkus(fica.sku_map)} SKUs, ${fica.created_at.slice(0, 10)})`);
    for (const rota of saem) {
      console.log(`  sai   ${rota.id} (${contarSkus(rota.sku_map)} SKUs, ${rota.created_at.slice(0, 10)})`);
      if (!APLICAR) continue;

      const { data: atual } = await admin
        .from("routed_checkout_configs")
        .select("settings")
        .eq("id", rota.id)
        .single();

      await admin
        .from("routed_checkout_configs")
        .update({
          enabled: false,
          settings: {
            ...((atual?.settings as Record<string, unknown>) || {}),
            disabled_by: "limpeza de rotas duplicadas",
            disabled_at: new Date().toISOString(),
            disabled_reason:
              "vitrine tinha mais de uma rota ligada; so uma pode valer (o tema carrega um token)",
            reenable_hint: `update routed_checkout_configs set enabled=true where id='${rota.id}';`,
          },
        })
        .eq("id", rota.id);
    }
  }

  if (!APLICAR) console.log("\n(simulacao — rode com --aplicar para desligar)");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
