/**
 * Lista os webhooks inscritos numa loja. So le, nao muda nada.
 *
 * Existe porque `registrar-webhook-pedidos.ts` sem `--aplicar` diz "pronta para
 * inscrever" -- que e o rotulo do ensaio, e nao uma resposta sobre o que JA
 * existe. A diferenca importa: sem `orders/create` inscrito, pedido de verdade
 * nao gera conversao nenhuma, e o teste com payload fabricado
 * (testar-webhook-pedido.ts) passa do mesmo jeito porque ele nao usa a Shopify.
 * Ou seja, da para ter fila com "enviado" e nenhum pedido real sendo rastreado.
 *
 * Uso -- por `npm run op`, nao por `npx tsx` direto (ver CLAUDE.md):
 *   npm run op -- scripts/conferir-webhooks.ts <dominio.myshopify.com>
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

const dominio = process.argv[2];

if (!dominio) {
  console.error("uso: npm run op -- scripts/conferir-webhooks.ts <dominio.myshopify.com>");
  process.exit(1);
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { shopifyGraphQL } = await import("../src/lib/shopify/client");
  const admin = createAdminClient();

  const { data: loja } = await admin
    .from("stores")
    .select("id, name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", dominio)
    .maybeSingle();

  if (!loja) {
    console.error(`loja ${dominio} nao encontrada`);
    process.exit(1);
  }
  if (!loja.client_id || !loja.client_secret) {
    console.error(`loja ${dominio} sem credencial do app`);
    process.exit(1);
  }

  // shopifyGraphQL nao e generico: o tipo vem na asserção do resultado.
  interface No {
    id: string;
    topic: string;
    endpoint?: { callbackUrl?: string };
  }

  const bruto = await shopifyGraphQL(
    {
      shopDomain: loja.shop_domain,
      clientId: loja.client_id,
      clientSecret: loja.client_secret,
      accessToken: loja.access_token,
    },
    `{
      webhookSubscriptions(first: 50) {
        nodes {
          id
          topic
          endpoint { ... on WebhookHttpEndpoint { callbackUrl } }
        }
      }
    }`
  );

  const r = bruto as { webhookSubscriptions?: { nodes?: No[] } } | null;
  const nos: No[] = r?.webhookSubscriptions?.nodes || [];
  console.log(`${loja.name || loja.shop_domain} (${loja.shop_domain})`);
  console.log(`${nos.length} webhook(s):`);
  for (const n of nos) {
    console.log(`  ${n.topic.padEnd(24)} ${n.endpoint?.callbackUrl || "(nao-http)"}`);
  }

  if (!nos.some((n) => n.topic === "ORDERS_CREATE")) {
    console.log(
      "\n>>> ORDERS_CREATE NAO ESTA INSCRITO.\n" +
        "    Pedido real nao gera conversao. Consertar com:\n" +
        `    npm run op -- scripts/registrar-webhook-pedidos.ts --aplicar --loja "${loja.name}"`
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
