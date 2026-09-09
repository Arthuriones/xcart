/**
 * Roda o conserto das rotas fora da tela -- o mesmo healRoute do botao
 * "Corrigir" e do cron de hora em hora.
 *
 * Serve para depois de uma importacao grande, ou quando o cron nao esta
 * rodando e as rotas ficaram para tras. `--com-imagens` liga a neutralizacao
 * de imagem, que gasta 1 credito por imagem; sem a flag o produto entra na
 * loja de checkout com o texto neutralizado e a foto original.
 *
 * Uso:
 *   npx tsx scripts/consertar-rota.ts <routeId> [--com-imagens]
 *   npx tsx scripts/consertar-rota.ts --todas [--com-imagens]
 *
 * ATENCAO ao topo deste arquivo: "dotenv/config" precisa ser o PRIMEIRO
 * import e os demais precisam ser dinamicos. `import` hoista -- um
 * `import { healRoute }` estatico avaliaria a cadeia inteira de modulos ANTES
 * do env carregar, e quem le process.env no topo nasceria sem chave. Foi assim
 * que 64 produtos entraram na dark store com o nome da marca.
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

const comImagens = process.argv.includes("--com-imagens");
const todas = process.argv.includes("--todas");
const alvo = process.argv.slice(2).find((a) => !a.startsWith("--"));

if (!todas && !alvo) {
  console.error(
    "uso: npx tsx scripts/consertar-rota.ts <routeId>|--todas [--com-imagens]"
  );
  process.exit(1);
}

async function main() {
  const { healRoute } = await import("../src/lib/checkout-routes/heal");

  let ids: { id: string; name: string }[];

  if (todas) {
    const { createAdminClient } = await import("../src/lib/supabase/admin");
    const admin = createAdminClient();
    // So rota ligada: rota pausada nao recebe comprador, consertar so gastaria
    // chamada de API das duas lojas.
    const { data, error } = await admin
      .from("routed_checkout_configs")
      .select("id, name, enabled")
      .eq("enabled", true)
      .order("last_healed_at", { ascending: true, nullsFirst: true });
    if (error) throw error;
    ids = (data || []) as { id: string; name: string }[];
  } else {
    ids = [{ id: alvo as string, name: alvo as string }];
  }

  console.log(`${ids.length} rota(s) para conferir.\n`);

  let ok = 0;
  let falhou = 0;

  for (const [i, rota] of ids.entries()) {
    const prefixo = `[${i + 1}/${ids.length}] ${rota.name}`;
    try {
      const r = await healRoute({ routeId: rota.id, neutralizeImages: comImagens });
      ok += 1;
      console.log(
        `${prefixo}\n  ok=${r.ok}${r.noop ? " (nada a fazer)" : ""} ` +
          `criados=${r.createdProductCount} variantes=${r.createdVariantCount} ` +
          `mapeados=${r.finalMappedCount} imagens=${r.imageQueueCount}` +
          (r.warnings.length ? `\n  avisos: ${r.warnings.slice(0, 3).join(" | ")}` : "")
      );
    } catch (e) {
      falhou += 1;
      // Uma loja desinstalada nao pode parar a fila: as outras ainda precisam
      // do conserto.
      console.log(`${prefixo}\n  FALHOU: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`\n${ok} conferida(s), ${falhou} com falha.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
