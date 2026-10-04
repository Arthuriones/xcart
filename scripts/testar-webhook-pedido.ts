/**
 * Manda um `orders/create` ASSINADO e FALSO para o webhook do app.
 *
 * Prova o caminho inteiro sem esperar uma venda de verdade: HMAC, janela de
 * replay, dedupe por entrega, o case no switch e a montagem do Purchase.
 *
 * O PEDIDO E FALSO, MAS O PURCHASE QUE ELE GERA SAI DE VERDADE. O handler
 * enfileira uma linha por destino ativo da loja e tenta entregar na hora, e o
 * cron da producao reentrega o que ficar pendente. Entao:
 *
 *   - Google: nada. O Google Ads sai do navegador (tag do Google no Web Pixel
 *     do checkout), e o webhook nao enfileira nada para destino Google.
 *   - Meta: so cai na aba de teste do Events Manager se o destino tiver
 *     test_event_code. Sem ele, e uma compra (fbclid TESTE123) no pixel real.
 *
 * O modelo antigo ("ligue com test_event_code e o evento cai na aba de teste")
 * era de quando so havia Meta. Por isso o script RECUSA rodar quando a loja
 * tem destino Meta ativo sem test_event_code, e diz qual e. Nao ha flag para passar por cima: quem quer testar desliga o
 * destino (ou poe o codigo de teste no Meta) e liga de novo depois.
 *
 * A trava vale para QUALQUER alvo, inclusive localhost: o servidor local le o
 * mesmo .env.local deste script, logo o mesmo banco e os mesmos destinos -- e
 * a linha que ele deixar pendente na fila o cron da producao entrega.
 *
 * Alvo padrao: http://localhost:3000. Producao so com --producao explicito,
 * porque o teste de rotina nao deve bater no app que atende as lojas.
 *
 * Uso:
 *   npm run op -- scripts/testar-webhook-pedido.ts <dominio-da-loja>
 *   npm run op -- scripts/testar-webhook-pedido.ts <dominio-da-loja> --producao
 */
import "dotenv/config";
import { config } from "dotenv";
import { createHmac, randomUUID } from "node:crypto";

config({ path: ".env.local", override: true });

// O dominio e o primeiro argumento que nao e flag: `--producao` antes do
// dominio nao pode virar o nome da loja.
const alvo = process.argv.slice(2).find((a) => !a.startsWith("--"));
const producao = process.argv.includes("--producao");
if (!alvo) {
  console.error("uso: npm run op -- scripts/testar-webhook-pedido.ts <dominio> [--producao]");
  process.exit(1);
}

type DestinoAtivo = {
  plataforma: string;
  nome: string | null;
  conta: string;
  test_event_code: string | null;
};

/**
 * Destinos que receberiam o Purchase falso como compra de verdade. Lista vazia
 * = seguro mandar.
 */
function destinosPerigosos(destinos: DestinoAtivo[]): string[] {
  const motivos: string[] = [];
  for (const d of destinos) {
    const rotulo = `${d.plataforma} ${d.conta}${d.nome ? ` (${d.nome})` : ""}`;
    if (d.plataforma === "google") {
      // O webhook nao manda nada ao Google: a tag do navegador e que dispara.
      continue;
    } else if (d.plataforma === "meta" && !d.test_event_code?.trim()) {
      motivos.push(`${rotulo}: Meta sem test_event_code -- a compra falsa entra no pixel real`);
    } else if (d.plataforma !== "meta") {
      // Plataforma nova que este script ainda nao conhece: na duvida, recusa.
      motivos.push(`${rotulo}: plataforma sem regra de teste neste script`);
    }
  }
  return motivos;
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
      { name: "gclid", value: "TESTE-GCLID-ABC123" },
      { name: "_xc_vid", value: "teste.visitante" },
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

  // Le os destinos ANTES de mandar qualquer coisa. Falha de leitura tambem
  // recusa: sem saber o que esta ligado, nao da para afirmar que e seguro.
  const { data: destinos, error: erroDestinos } = await admin
    .from("tracking_destinations")
    .select("plataforma, nome, conta, test_event_code")
    .eq("store_id", data.id)
    .eq("ativo", true);
  if (erroDestinos) {
    console.error(`nao consegui ler os destinos da loja: ${erroDestinos.message}`);
    console.error("recusado: sem a lista de destinos nao da para garantir que nada sai de verdade.");
    process.exit(1);
  }
  const perigos = destinosPerigosos((destinos || []) as DestinoAtivo[]);
  if (perigos.length > 0) {
    console.error(`recusado: ${data.name} (${data.shop_domain}) mandaria um Purchase FALSO para contas reais:`);
    for (const p of perigos) console.error(`  - ${p}`);
    console.error(
      "\ndesative esses destinos (ou ponha test_event_code no Meta) e rode de novo." +
        "\nvale tambem para localhost: o servidor local usa o mesmo banco, e o cron da producao" +
        "\nentrega o que ele deixar pendente na fila."
    );
    process.exit(1);
  }

  const base = producao ? getPublicAppUrl() : "http://localhost:3000";
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
    .select("event_id, destination, status, attempts, last_error, response, created_at")
    .eq("store_id", data.id)
    .order("created_at", { ascending: false })
    .limit(6);
  console.log("\nfila de rastreamento:");
  for (const e of fila || []) {
    console.log(`  ${e.destination.padEnd(7)} ${e.event_id}  ${e.status}  tentativas=${e.attempts}  ${e.last_error || ""}`);
    const resp = e.response as { url?: string } | null;
    if (resp?.url) console.log(`          ${resp.url}`);
  }
  if (!fila?.length) {
    console.log("  (vazia -- esperado enquanto a loja nao tiver tracking_configs ligado)");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
