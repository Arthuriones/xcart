/**
 * Instala o capturador de click id no tema da vitrine.
 *
 * Sem ele o `gclid` morre na primeira navegacao: o clique chega com
 * ?gclid=... na URL, mas o PEDIDO nasce no checkout da Shopify, que e outro
 * dominio -- o tema nao roda la e o cookie da loja nao existe. O snippet
 * copia o click id para um cart attribute, que viaja com o carrinho ate o
 * pedido e aparece no webhook.
 *
 * Sem isso, toda conversao server-side chega ao Google sem atribuicao.
 *
 * Uso:
 *   npx tsx scripts/instalar-snippet-click.ts <dominio>            (so mostra)
 *   npx tsx scripts/instalar-snippet-click.ts <dominio> --aplicar
 *   npx tsx scripts/instalar-snippet-click.ts <dominio> --remover
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

const dominio = process.argv[2];
const aplicar = process.argv.includes("--aplicar");
const remover = process.argv.includes("--remover");

if (!dominio || dominio.startsWith("--")) {
  console.error("uso: npx tsx scripts/instalar-snippet-click.ts <dominio> [--aplicar|--remover]");
  process.exit(1);
}

/** Marca propria, para achar e trocar sem depender do conteudo. */
const MARCA = "xcart-click";
const RE_TAG = /<script\b[^>]*data-xcart-click[^>]*>\s*<\/script>\s*/g;

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { shopifyGraphQL } = await import("../src/lib/shopify/client");
  const { getPublicAppUrl } = await import("../src/lib/public-url");
  const admin = createAdminClient();

  const { data: loja } = await admin
    .from("stores")
    .select("id, name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", dominio)
    .maybeSingle();

  if (!loja?.client_id) {
    console.error(`loja ${dominio} nao encontrada ou sem credencial`);
    process.exit(1);
  }
  const creds = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };

  const temas = await shopifyGraphQL(creds, `{ themes(first:20){nodes{id name role}} }`);
  const principal = temas.themes.nodes.find((t: { role: string }) => t.role === "MAIN");
  if (!principal) {
    console.error("tema principal nao encontrado");
    process.exit(1);
  }
  console.log(`loja: ${loja.name} | tema: ${principal.name}`);

  const arquivo = await shopifyGraphQL(
    creds,
    `query($id:ID!,$n:[String!]){ theme(id:$id){ files(filenames:$n, first:5){ nodes{
       body{ ... on OnlineStoreThemeFileBodyText{ content } } } } } }`,
    { id: principal.id, n: ["layout/theme.liquid"] }
  );
  const atual: string = arquivo.theme.files.nodes[0]?.body?.content || "";
  if (!atual) {
    console.error("theme.liquid vazio ou inacessivel");
    process.exit(1);
  }

  const jaTem = RE_TAG.test(atual);
  RE_TAG.lastIndex = 0;
  console.log(`  snippet ja instalado: ${jaTem ? "sim" : "nao"}`);

  let novo: string;
  if (remover) {
    novo = atual.replace(RE_TAG, "");
  } else {
    // `defer` e nao `async`: precisa do window.Shopify.routes.root, que o tema
    // define no head. Com async pode correr antes e montar a URL do carrinho
    // errada em loja com Markets por sub-caminho (/ja, /en).
    const tag =
      `<script src="${getPublicAppUrl()}/${MARCA}.js" data-xcart-click defer></script>`;
    novo = jaTem ? atual.replace(RE_TAG, tag) : atual.replace("</head>", `  ${tag}\n</head>`);
  }

  if (novo === atual) {
    console.log("  nada a mudar.");
    return;
  }

  if (!aplicar && !remover) {
    console.log("\n  (modo leitura -- use --aplicar para gravar)");
    const linha = novo.split("\n").findIndex((l) => l.includes("data-xcart-click"));
    console.log(`  entraria na linha ${linha + 1} do theme.liquid:`);
    console.log("    " + novo.split("\n")[linha].trim());
    return;
  }

  const r = await shopifyGraphQL(
    creds,
    `mutation($id:ID!,$f:[OnlineStoreThemeFilesUpsertFileInput!]!){
       themeFilesUpsert(themeId:$id, files:$f){ userErrors{filename message} } }`,
    {
      id: principal.id,
      f: [{ filename: "layout/theme.liquid", body: { type: "TEXT", value: novo } }],
    }
  );
  const erros = r.themeFilesUpsert?.userErrors || [];
  if (erros.length) {
    console.error("  falhou:", erros);
    process.exit(1);
  }
  console.log(remover ? "  snippet REMOVIDO." : "  snippet instalado.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
