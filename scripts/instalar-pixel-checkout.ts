/**
 * Imprime o codigo do Custom Pixel de uma loja, para colar no admin da Shopify.
 *
 * POR QUE NAO INSTALA SOZINHO
 *
 * Medido: `webPixelCreate` pela Admin API responde "No extension found". A
 * mutation so funciona para app que declara uma Web Pixel Extension e faz
 * deploy pelo Shopify CLI -- mudanca no app, nao chamada de API. O Custom Pixel
 * colado no admin roda no MESMO sandbox e alcanca as mesmas superficies,
 * inclusive o checkout.
 *
 * ONDE COLAR
 *
 *   Shopify admin -> Configuracoes -> Eventos de cliente
 *   -> Adicionar pixel personalizado -> colar -> Salvar -> Conectar
 *
 * DEPOIS DE COLAR
 *
 * Rode com --marcar-ativo. Isso faz o coletor ignorar o `begin_checkout` que
 * vem do TEMA: com o pixel instalado, os dois descrevem a mesma acao e nao tem
 * como compartilhar event_id -- um nasce do clique no botao, o outro do
 * checkout de verdade.
 *
 * Uso:
 *   npm run op -- scripts/instalar-pixel-checkout.ts --loja <dominio>
 *   npm run op -- scripts/instalar-pixel-checkout.ts --loja <dominio> --marcar-ativo
 *   npm run op -- scripts/instalar-pixel-checkout.ts --loja <dominio> --desmarcar
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

function arg(nome: string): string | null {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}

const dominio = arg("loja");
const marcarAtivo = process.argv.includes("--marcar-ativo");
const desmarcar = process.argv.includes("--desmarcar");

if (!dominio) {
  console.error("falta --loja <dominio>");
  process.exit(1);
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { gerarCodigoDoPixel } = await import("../src/lib/tracking/pixel-checkout");
  const { getPublicAppUrl } = await import("../src/lib/public-url");

  const admin = createAdminClient();

  const { data: candidatas } = await admin
    .from("stores")
    .select("id, name, shop_domain, user_id")
    .eq("shop_domain", dominio)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false });

  if (!candidatas?.length) {
    console.error(`loja ${dominio} nao encontrada`);
    process.exit(1);
  }
  if (candidatas.length > 1) {
    console.error(`\n${dominio} esta cadastrada ${candidatas.length} vezes:`);
    for (const c of candidatas) {
      console.error(`  ${c.id}  "${c.name}"  (conta ${String(c.user_id).slice(0, 8)})`);
    }
    console.error("\nResolva a duplicidade antes: o pixel carrega o id da linha.");
    process.exit(1);
  }

  const loja = candidatas[0];

  if (desmarcar || marcarAtivo) {
    const { error } = await admin
      .from("tracking_configs")
      .update({
        web_pixel_ativo: marcarAtivo,
        updated_at: new Date().toISOString(),
      })
      .eq("store_id", loja.id);
    if (error) {
      console.error("falha ao marcar:", error.message);
      process.exit(1);
    }
    console.log(
      marcarAtivo
        ? `\nWeb Pixel marcado como ATIVO em "${loja.name}".\n` +
            "  O coletor passa a ignorar o begin_checkout vindo do tema."
        : `\nWeb Pixel marcado como inativo em "${loja.name}".\n` +
            "  O begin_checkout do tema volta a valer."
    );
    return;
  }

  const codigo = gerarCodigoDoPixel({
    shopDomain: loja.shop_domain,
    storeId: loja.id,
    origemDoApp: getPublicAppUrl(),
  });

  console.log(`\nloja: ${loja.name} (${loja.shop_domain})`);
  console.log(
    "\nShopify admin -> Configuracoes -> Eventos de cliente -> Adicionar pixel\n" +
      "personalizado -> colar o bloco abaixo -> Salvar -> Conectar.\n"
  );
  console.log("-".repeat(78));
  console.log(codigo);
  console.log("-".repeat(78));
  console.log(
    "\nDepois de conectar, rode:\n" +
      `  npm run op -- scripts/instalar-pixel-checkout.ts --loja ${loja.shop_domain} --marcar-ativo`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
