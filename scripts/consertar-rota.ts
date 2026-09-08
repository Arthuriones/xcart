/**
 * Roda o conserto de uma rota fora da tela -- o mesmo healRoute do botao
 * "Corrigir" e do cron de hora em hora.
 *
 * Serve para depois de uma importacao grande, quando esperar o cron ou clicar
 * na tela nao faz sentido. `--com-imagens` liga a neutralizacao de imagem, que
 * gasta 1 credito por imagem; sem a flag o produto entra na loja de checkout
 * com o texto neutralizado e a foto original.
 *
 * Uso:  npx tsx scripts/consertar-rota.ts <routeId> [--com-imagens]
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { healRoute } from "../src/lib/checkout-routes/heal";

const routeId = process.argv[2];
if (!routeId) {
  console.error("uso: npx tsx scripts/consertar-rota.ts <routeId> [--com-imagens]");
  process.exit(1);
}

healRoute({ routeId, neutralizeImages: process.argv.includes("--com-imagens") })
  .then((r) => {
    console.log(`ok=${r.ok}${r.noop ? " (nada a fazer)" : ""}`);
    console.log(`produtos criados no checkout: ${r.createdProductCount}`);
    console.log(`variantes criadas: ${r.createdVariantCount}`);
    console.log(`SKUs mapeados no fim: ${r.finalMappedCount}`);
    console.log(`imagens na fila de neutralizacao: ${r.imageQueueCount}`);
    if (r.warnings.length) {
      console.log(`avisos (${r.warnings.length}):`);
      r.warnings.slice(0, 10).forEach((w) => console.log(`  ${w}`));
    }
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
