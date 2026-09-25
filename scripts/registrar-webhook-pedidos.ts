/**
 * Inscreve `orders/create` nas lojas que JA estavam instaladas.
 *
 * A inscricao automatica acontece na instalacao (api/shopify/auth). Quem
 * instalou antes do rastreamento existir nunca passa por la de novo -- e sem
 * o webhook nao ha Purchase, porque o pedido e a unica fonte de conversao que
 * nao depende do navegador do comprador.
 *
 * Tambem serve depois que o lojista adiciona `read_orders`: sem esse escopo a
 * Shopify recusa ate a INSCRICAO, entao a primeira tentativa falha e esta e a
 * segunda.
 *
 * Uso:
 *   npx tsx scripts/registrar-webhook-pedidos.ts            (so lista)
 *   npx tsx scripts/registrar-webhook-pedidos.ts --aplicar
 *   npx tsx scripts/registrar-webhook-pedidos.ts --aplicar --loja "Gotoku"
 *
 * ATENCAO ao topo: "dotenv/config" primeiro e o resto dinamico -- import
 * estatico hoista e avalia a cadeia de modulos antes do env carregar.
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

const aplicar = process.argv.includes("--aplicar");
const filtro = (() => {
  const i = process.argv.indexOf("--loja");
  return i >= 0 ? process.argv[i + 1] : null;
})();

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { ensureWebhook, shopifyGraphQL } = await import("../src/lib/shopify/client");
  // getPublicAppUrl ja descarta localhost e cai no host de producao. Montar a
  // URL a mao aqui inscreveria o webhook apontando para a maquina do dev --
  // e a Shopify guarda esse endereco ate alguem perceber.
  const { getPublicAppUrl } = await import("../src/lib/public-url");
  const admin = createAdminClient();

  const callback = `${getPublicAppUrl()}/api/shopify/webhooks`;
  console.log(`endpoint: ${callback}`);
  console.log(aplicar ? "modo: APLICANDO\n" : "modo: so listando (use --aplicar)\n");

  let q = admin
    .from("stores")
    .select("id, name, shop_domain, client_id, client_secret, access_token, uninstalled_at")
    .is("uninstalled_at", null);
  // Casa por nome OU dominio: o nome no nosso banco envelhece quando o
  // lojista renomeia a loja na Shopify (a Gotoku ainda esta cadastrada com o
  // nome antigo).
  if (filtro) q = q.or(`name.ilike.%${filtro}%,shop_domain.ilike.%${filtro}%`);
  const { data: lojas } = await q;

  let ok = 0;
  let semEscopo = 0;
  let falhou = 0;

  for (const loja of lojas || []) {
    const nome = (loja.name || loja.shop_domain).slice(0, 32);
    if (!loja.client_id || !loja.client_secret) {
      console.log(`  ${nome.padEnd(34)} sem credencial`);
      continue;
    }
    const creds = {
      shopDomain: loja.shop_domain,
      clientId: loja.client_id,
      clientSecret: loja.client_secret,
      accessToken: loja.access_token,
    };

    // Sem read_orders nao adianta tentar: a Shopify recusa a inscricao e o
    // lojista precisa mexer no app custom antes.
    let temEscopo = false;
    try {
      const d = await shopifyGraphQL(
        creds,
        `{ currentAppInstallation { accessScopes { handle } } }`
      );
      temEscopo = (d.currentAppInstallation?.accessScopes || []).some(
        (s: { handle: string }) => s.handle === "read_orders"
      );
    } catch (e) {
      console.log(`  ${nome.padEnd(34)} inacessivel (${(e as Error).message.slice(0, 50)})`);
      falhou += 1;
      continue;
    }

    if (!temEscopo) {
      console.log(`  ${nome.padEnd(34)} FALTA read_orders -> pedir ao lojista`);
      semEscopo += 1;
      continue;
    }

    if (!aplicar) {
      console.log(`  ${nome.padEnd(34)} pronta para inscrever`);
      ok += 1;
      continue;
    }

    const r = await ensureWebhook(creds, "ORDERS_CREATE", callback);
    console.log(`  ${nome.padEnd(34)} ${r.ok ? "inscrita" : `FALHOU: ${r.message?.slice(0, 60)}`}`);
    if (r.ok) ok += 1;
    else falhou += 1;
  }

  console.log(
    `\n${ok} ok | ${semEscopo} sem read_orders | ${falhou} com falha`
  );
  if (semEscopo > 0) {
    console.log(
      "\nPara as que faltam escopo: Shopify admin -> Configuracoes -> Apps ->\n" +
        "Desenvolver apps -> o app do xcart -> Configuracao da API Admin ->\n" +
        "marcar read_orders. O token de client credentials pega o escopo novo\n" +
        "na requisicao seguinte, sem reinstalar."
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
