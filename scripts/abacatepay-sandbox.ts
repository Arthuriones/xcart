/**
 * Teste da AbacatePay em Dev mode, pelas MESMAS funcoes que o app usa
 * (src/lib/billing/abacatepay.ts), sem tocar no banco:
 *   1. os produtos dos planos existem com o preco de plans.ts;
 *   2. Pix avulso: cria, simula o pagamento, confere PAID -> "paid";
 *   3. assinatura: cria o cliente e o checkout de assinatura do plano mais
 *      barato e reencontra o checkout PENDING pelo externalId (o
 *      reaproveitamento do clique duplo). Imprime a URL: pagar la com o cartao
 *      de teste 4242 4242 4242 4242 fecha o fluxo.
 *
 * Uso: npm run op -- scripts/abacatepay-sandbox.ts   (ABACATEPAY_API_KEY = abc_dev_)
 */
import { config } from "dotenv";
import { PLANOS } from "../src/lib/billing/plans";
import {
  checkoutDeAssinatura,
  conferirPix,
  criarCheckoutDeAssinatura,
  criarCliente,
  criarPix,
  produtoDoPlano,
  simularPagamentoPix,
} from "../src/lib/billing/abacatepay";
import { externalIdDaAssinatura, statusDoPix } from "../src/lib/billing/abacatepay-regras";

config({ path: ".env.local" });

const CONTA_TESTE = "00000000-0000-4000-8000-000000000000";

(async () => {
  const chave = process.env.ABACATEPAY_API_KEY || "";
  if (!chave.startsWith("abc_dev_")) {
    console.error("ABACATEPAY_API_KEY do .env.local precisa ser a de Dev mode (abc_dev_).");
    process.exit(1);
  }
  let falhas = 0;
  const ok = (cond: boolean, msg: string) => {
    console.log(`${cond ? "  ok  " : "  FALHOU"} ${msg}`);
    if (!cond) falhas++;
  };

  console.log("1. Produtos");
  const aVenda = PLANOS.filter((p) => p.aVenda);
  for (const plano of aVenda) {
    const produto = await produtoDoPlano(plano.id);
    ok(!!produto && produto.price === plano.precoCentavos, `${plano.id}: ${produto ? `${produto.id} ${produto.price}` : "FALTA"}`);
  }

  console.log("2. Pix avulso");
  const pix = await criarPix({
    valorCentavos: 500,
    descricao: "xcart teste sandbox",
    expiraEmSegundos: 600,
    metadata: { user_id: CONTA_TESTE, kind: "credits" },
  });
  ok(pix.id.startsWith("pix_char_") && !!pix.brCode, `criado ${pix.id}, status ${pix.status}`);
  ok(statusDoPix((await conferirPix(pix.id)).status) === "pending", "antes de pagar: pending");
  await simularPagamentoPix(pix.id);
  const depois = await conferirPix(pix.id);
  ok(statusDoPix(depois.status) === "paid", `depois de simular: ${depois.status}`);

  console.log("3. Checkout de assinatura");
  const plano = aVenda.reduce((a, b) => (a.precoCentavos <= b.precoCentavos ? a : b));
  const produto = await produtoDoPlano(plano.id);
  if (!produto) {
    ok(false, `sem produto do ${plano.id} (rode scripts/abacatepay-produtos.ts --criar)`);
  } else {
    const cliente = await criarCliente(CONTA_TESTE, { email: "teste-sandbox@xcart.app", nome: "Teste Sandbox" });
    ok(cliente.startsWith("cust_"), `cliente ${cliente}`);
    const externalId = externalIdDaAssinatura(CONTA_TESTE, plano.id, Date.now());
    const checkout = await criarCheckoutDeAssinatura({
      produtoId: produto.id,
      clienteId: cliente,
      externalId,
      completionUrl: "https://user.xcart.app/billing?assinatura=ok",
      returnUrl: "https://user.xcart.app/billing",
      metodos: ["CARD"],
      metadata: { user_id: CONTA_TESTE, plano: plano.id },
    });
    ok(checkout.id.startsWith("bill_") && !!checkout.url, `checkout ${checkout.id}`);
    const achado = await checkoutDeAssinatura(externalId);
    ok(achado?.id === checkout.id && String(achado?.status).toUpperCase() === "PENDING", `reencontrado pelo externalId: ${achado?.id ?? "nada"} ${achado?.status ?? ""}`);
    console.log(`     pagar no sandbox: ${checkout.url}`);
  }

  console.log(falhas ? `\n${falhas} falha(s).` : "\nTudo certo.");
  if (falhas) process.exit(1);
})().catch((e) => {
  console.error("ERRO", e instanceof Error ? e.message : e);
  process.exit(1);
});
