import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

/**
 * Tira do ar os produtos que o conserto em massa despejou na NORAH OUTLET.
 *
 * O que aconteceu: a rota "Clone norahoutlet.store -> tdicbr-3u" tem como
 * VITRINE a loja Stepz, que e ela mesma uma dark store. Consertar essa rota
 * copia o catalogo da Stepz para dentro da NORAH OUTLET -- catalogo errado,
 * loja errada. Rodar `consertar-rota.ts --todas` pegou essa rota junto com as
 * boas e criou 42 produtos ACTIVE la dentro antes de ser interrompido.
 *
 * DRAFT em vez de delete: some da vitrine na hora, e da para desfazer se algum
 * dos 42 for legitimo.
 *
 * Uso:  npx tsx scripts/reverter-norah-outlet.ts [--aplicar]
 * Sem --aplicar so lista o que faria.
 */
const APLICAR = process.argv.includes("--aplicar");

/** Inicio da execucao que criou os produtos. Nada anterior a isto e tocado. */
const CORTE = Date.parse("2026-09-09T00:50:00Z");

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();

  const { data, error } = await admin
    .from("stores")
    .select("name, shop_domain, access_token")
    .eq("shop_domain", "tdicbr-3u.myshopify.com")
    .single();
  if (error || !data) throw new Error(`loja nao encontrada: ${error?.message}`);
  const loja = data as { name: string; shop_domain: string; access_token: string };

  async function gql(query: string, variables?: Record<string, unknown>) {
    const r = await fetch(`https://${loja.shop_domain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": loja.access_token,
      },
      body: JSON.stringify({ query, variables }),
    });
    return r.json();
  }

  const lista = (await gql(`{ products(first: 100, sortKey: CREATED_AT, reverse: true) {
    nodes { id title createdAt status variants(first: 1) { nodes { sku } } } } }`)) as {
    data?: {
      products?: {
        nodes: {
          id: string;
          title: string;
          createdAt: string;
          status: string;
          variants: { nodes: { sku: string }[] };
        }[];
      };
    };
  };

  const alvos = (lista.data?.products?.nodes || []).filter(
    (n) => Date.parse(n.createdAt) > CORTE && n.status === "ACTIVE"
  );

  console.log(`${loja.name}: ${alvos.length} produto(s) criado(s) depois do corte.\n`);
  for (const p of alvos) {
    console.log(`  ${p.createdAt}  ${p.variants.nodes[0]?.sku ?? "sem sku"}  ${p.title}`);
  }

  if (!APLICAR) {
    console.log(`\nNada foi alterado. Rode com --aplicar para por os ${alvos.length} em DRAFT.`);
    return;
  }

  let ok = 0;
  for (const p of alvos) {
    const r = (await gql(
      `mutation($input: ProductInput!) { productUpdate(input: $input) {
        product { id status } userErrors { message } } }`,
      { input: { id: p.id, status: "DRAFT" } }
    )) as { data?: { productUpdate?: { userErrors: { message: string }[] } } };
    const erros = r.data?.productUpdate?.userErrors || [];
    if (erros.length) console.log(`  FALHOU ${p.title}: ${erros[0].message}`);
    else ok += 1;
  }
  console.log(`\n${ok} em DRAFT.`);

  // A rota-lixo nao pode voltar a rodar quando o cron for ligado.
  const { error: erroRota } = await admin
    .from("routed_checkout_configs")
    .update({ enabled: false })
    .eq("name", "Clone norahoutlet.store -> tdicbr-3u.myshopify.com")
    .eq("enabled", true);
  console.log(erroRota ? `rota nao pausada: ${erroRota.message}` : "rota-lixo pausada.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
