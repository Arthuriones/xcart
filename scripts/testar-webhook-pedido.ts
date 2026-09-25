/**
 * Manda um `orders/create` ASSINADO para o endpoint de producao.
 *
 * Prova o caminho inteiro sem esperar uma venda de verdade: HMAC, janela de
 * replay, dedupe por entrega, o case novo no switch e a montagem do Purchase.
 *
 * Nao inventa venda no Meta: se a loja nao tiver tracking_configs ligado, o
 * handler responde "rastreamento desligado" e nada sai. Para exercitar o envio
 * de verdade, ligue a loja com test_event_code -- ai o evento cai na aba de
 * teste do Events Manager, nao na producao.
 *
 * Uso:
 *   npx tsx scripts/testar-webhook-pedido.ts <dominio-da-loja>
 *   npx tsx scripts/testar-webhook-pedido.ts gy5pr8-5h.myshopify.com --local
 */
import "dotenv/config";
import { config } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";

config({ path: ".env.local", override: true });

const alvo = process.argv[2];
const local = process.argv.includes("--local");
if (!alvo) {
  console.error("uso: npx tsx scripts/testar-webhook-pedido.ts <dominio> [--local]");
  process.exit(1);
}

/** Pedido no formato que a Shopify manda, com os campos que o Purchase usa. */
function pedidoDeTeste(numero: number) {
  return {
    id: 9_000_000_000 + numero,
    order_number: numero,
    email: "teste+capi@exemplo.com",
    phone: null,
    currency: "JPY",
    total_price: "12800",
    created_at: new Date().toISOString(),
    browser_ip: "203.0.113.9",
    landing_site: "/products/teste?fbclid=TESTE123",
    customer: {
      id: 77001,
      email: "teste+capi@exemplo.com",
      phone: "090-1234-5678",
      first_name: "Yuki",
      last_name: "Tanaka",
    },
    billing_address: {
      first_name: "Yuki",
      last_name: "Tanaka",
      city: "Tokyo",
      province: "Tokyo",
      zip: "150-0001",
      country_code: "JP",
    },
    client_details: { user_agent: "Mozilla/5.0 (iPhone)", browser_ip: "203.0.113.9" },
    // O que o snippet do tema grava (fase 2). Aqui simulado.
    note_attributes: [
      { name: "_fbp", value: "fb.1.1700000000000.111" },
      { name: "fbclid", value: "TESTE123" },
    ],
    line_items: [{ product_id: 1, variant_id: 11, quantity: 2, price: "6400" }],
  };
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { getPublicAppUrl } = await import("../src/lib/public-url");
  const admin = createAdminClient();

  const { data } = await admin
    .from("stores")
    .select("id, name, shop_domain, client_secret")
    .eq("shop_domain", alvo)
    .maybeSingle();

  if (!data?.client_secret) {
    console.error(`loja ${alvo} nao encontrada ou sem client_secret`);
    process.exit(1);
  }

  const base = local ? "http://localhost:3000" : getPublicAppUrl();
  const url = `${base}/api/shopify/webhooks`;
  const numero = Math.floor(Math.random() * 100000);
  const corpo = JSON.stringify(pedidoDeTeste(numero));

  // A HMAC e sobre os BYTES do corpo, na ordem em que vao pela rede.
  const hmac = createHmac("sha256", data.client_secret).update(corpo, "utf8").digest("base64");
  const webhookId = randomUUID();

  const cabecalhos = {
    "Content-Type": "application/json",
    "X-Shopify-Topic": "orders/create",
    "X-Shopify-Shop-Domain": data.shop_domain,
    "X-Shopify-Hmac-Sha256": hmac,
    "X-Shopify-Webhook-Id": webhookId,
    "X-Shopify-Triggered-At": new Date().toISOString(),
    "X-Shopify-API-Version": "2026-07",
  };

  console.log(`loja: ${data.name} (${data.shop_domain})`);
  console.log(`alvo: ${url}`);
  console.log(`pedido de teste: ${9_000_000_000 + numero}\n`);

  const r = await fetch(url, { method: "POST", headers: cabecalhos, body: corpo });
  console.log(`1a entrega  -> HTTP ${r.status}  ${(await r.text()).slice(0, 220)}`);

  // Mesmo webhook_id de novo: tem que cair na trava de idempotencia, nao
  // gerar uma segunda conversao.
  const r2 = await fetch(url, { method: "POST", headers: cabecalhos, body: corpo });
  console.log(`reentrega   -> HTTP ${r2.status}  ${(await r2.text()).slice(0, 220)}`);

  // Assinatura errada tem que ser recusada com 401.
  const r3 = await fetch(url, {
    method: "POST",
    headers: { ...cabecalhos, "X-Shopify-Hmac-Sha256": "invalida", "X-Shopify-Webhook-Id": randomUUID() },
    body: corpo,
  });
  console.log(`hmac errada -> HTTP ${r3.status}  ${(await r3.text()).slice(0, 120)}`);

  const { data: fila } = await admin
    .from("tracking_events")
    .select("event_id, status, attempts, last_error, created_at")
    .eq("store_id", data.id)
    .order("created_at", { ascending: false })
    .limit(3);
  console.log("\nfila de rastreamento:");
  for (const e of fila || []) {
    console.log(`  ${e.event_id}  ${e.status}  tentativas=${e.attempts}  ${e.last_error || ""}`);
  }
  if (!fila?.length) {
    console.log("  (vazia -- esperado enquanto a loja nao tiver tracking_configs ligado)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
