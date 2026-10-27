/**
 * Os produtos da AbacatePay que a assinatura usa: um por plano a venda, com
 * `externalId` = id do plano (roteamento, completo, ilimitado_v2), preco de
 * src/lib/billing/plans.ts e cycle MONTHLY.
 *
 * O /api/billing/subscribe acha o produto pelo externalId e RECUSA assinar se o
 * preco la nao for o de plans.ts -- este script e o que cria e confere.
 *
 * A AbacatePay nao tem rota para editar produto: preco novo pede produto novo
 * (outro externalId), e o plano em plans.ts aponta para ele.
 *
 * O ambiente vem da chave: ABACATEPAY_API_KEY de Dev mode (abc_dev_) cria os
 * produtos de teste; a de producao (abc_prod_), os de verdade. A chave precisa
 * das permissoes PRODUCT:CREATE e PRODUCT:READ.
 *
 * Uso:
 *   npm run op -- scripts/abacatepay-produtos.ts            # so confere
 *   npm run op -- scripts/abacatepay-produtos.ts --criar    # cria o que falta
 */
import { config } from "dotenv";
import { PLANOS } from "../src/lib/billing/plans";
import { criarProduto, produtoDoPlano } from "../src/lib/billing/abacatepay";

config({ path: ".env.local" });

const criar = process.argv.includes("--criar");

(async () => {
  const chave = process.env.ABACATEPAY_API_KEY || "";
  if (!chave) {
    console.error("ABACATEPAY_API_KEY nao esta no .env.local.");
    process.exit(1);
  }
  console.log(`Ambiente: ${chave.startsWith("abc_prod_") ? "PRODUCAO" : chave.startsWith("abc_dev_") ? "Dev mode" : "?"}`);

  let problemas = 0;
  for (const plano of PLANOS.filter((p) => p.aVenda)) {
    const atual = await produtoDoPlano(plano.id);
    if (!atual) {
      if (!criar) {
        console.log(`  ${plano.id}: FALTA (rode com --criar)`);
        problemas++;
        continue;
      }
      const novo = await criarProduto({
        externalId: plano.id,
        nome: `xcart ${plano.nome}`,
        precoCentavos: plano.precoCentavos,
        ciclo: "MONTHLY",
        descricao: `Assinatura mensal do plano ${plano.nome} do xcart.`,
      });
      console.log(`  ${plano.id}: criado ${novo.id} (${novo.price} centavos)`);
      continue;
    }
    const certo = atual.price === plano.precoCentavos && (!atual.cycle || atual.cycle === "MONTHLY");
    if (!certo) problemas++;
    console.log(
      `  ${plano.id}: ${atual.id} ${atual.price} centavos, ${atual.cycle ?? "sem ciclo"}${
        certo ? "" : `  <-- DIFERENTE de plans.ts (${plano.precoCentavos}, MONTHLY)`
      }`
    );
  }
  if (problemas) process.exit(1);
})().catch((e) => {
  console.error("ERRO", e instanceof Error ? e.message : e);
  process.exit(1);
});
