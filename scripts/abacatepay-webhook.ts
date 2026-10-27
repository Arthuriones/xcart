/**
 * O webhook da AbacatePay que o xcart escuta: confere e, com --criar, cria pela
 * API -- o secret sai do ABACATEPAY_WEBHOOK_SECRET do .env.local (o mesmo da
 * Vercel) e nunca passa por tela nem por log.
 *
 * Endpoint: https://user.xcart.app/api/billing/abacatepay/webhook (a
 * AbacatePay acrescenta o ?webhookSecret= sozinha). O webhook de Dev mode e o
 * de producao sao separados; so o de PRODUCAO aponta para la -- o deploy le a
 * API com a chave de producao, e um evento de sandbox relido nela daria 500 e
 * 18 h de reenvio. Por isso, sem --producao, so com --endpoint.
 *
 * Uso:
 *   npm run op -- scripts/abacatepay-webhook.ts --producao            # confere
 *   npm run op -- scripts/abacatepay-webhook.ts --producao --criar    # cria
 * A chave precisa de WEBHOOK:CREATE e WEBHOOK:READ.
 */
import { config } from "dotenv";
import { criarWebhook, listarWebhooks } from "../src/lib/billing/abacatepay";

config({ path: ".env.local" });

const producao = process.argv.includes("--producao");
const criar = process.argv.includes("--criar");
const iEndpoint = process.argv.indexOf("--endpoint");
const endpointArg = iEndpoint > 0 ? process.argv[iEndpoint + 1] : null;

// Os eventos que o webhook trata (src/app/api/billing/abacatepay/webhook).
const EVENTOS = [
  "transparent.completed",
  "transparent.refunded",
  "transparent.disputed",
  "subscription.completed",
  "subscription.renewed",
  "subscription.cancelled",
];

(async () => {
  if (producao) process.env.ABACATEPAY_API_KEY = process.env.ABACATEPAY_API_KEY_PROD || "";
  const chave = process.env.ABACATEPAY_API_KEY || "";
  if (!chave) {
    console.error(`${producao ? "ABACATEPAY_API_KEY_PROD" : "ABACATEPAY_API_KEY"} nao esta no .env.local.`);
    process.exit(1);
  }
  if (producao !== chave.startsWith("abc_prod_")) {
    console.error(producao ? "A chave de producao nao comeca com abc_prod_." : "Sem --producao, use a chave abc_dev_.");
    process.exit(1);
  }
  const endpoint = endpointArg || (producao ? "https://user.xcart.app/api/billing/abacatepay/webhook" : null);
  if (!endpoint) {
    console.error("Webhook de Dev mode so com --endpoint <url> (nunca o de producao).");
    process.exit(1);
  }
  const segredo = process.env.ABACATEPAY_WEBHOOK_SECRET || "";
  if (segredo.length < 32) {
    console.error("ABACATEPAY_WEBHOOK_SECRET ausente ou curto no .env.local.");
    process.exit(1);
  }

  console.log(`Ambiente: ${producao ? "PRODUCAO" : "Dev mode"} -> ${endpoint}`);
  const existentes = (await listarWebhooks()).filter((w) => w.endpoint.split("?")[0] === endpoint);
  for (const w of existentes) {
    const faltam = EVENTOS.filter((e) => !w.events.includes(e));
    console.log(`  ${w.id} "${w.name}" ${w.events.length} eventos${faltam.length ? `  <-- FALTAM: ${faltam.join(", ")}` : ""}`);
  }
  if (existentes.length) {
    if (existentes.some((w) => EVENTOS.every((e) => w.events.includes(e)))) return;
    process.exit(1);
  }
  if (!criar) {
    console.log("  nenhum webhook para este endpoint (rode com --criar)");
    process.exit(1);
  }
  const novo = await criarWebhook({ nome: "xcart cobranca", endpoint, segredo, eventos: EVENTOS });
  console.log(`  criado ${novo.id} com ${novo.events?.length ?? EVENTOS.length} eventos`);
})().catch((e) => {
  console.error("ERRO", e instanceof Error ? e.message : e);
  process.exit(1);
});
