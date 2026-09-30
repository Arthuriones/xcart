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
/** Liga tambem a tag de remarketing do Google, usando o AW da configuracao. */
const comRemarketing = process.argv.includes("--remarketing");
const remover = process.argv.includes("--remover");

if (!dominio || dominio.startsWith("--")) {
  console.error("uso: npx tsx scripts/instalar-snippet-click.ts <dominio> [--aplicar|--remover]");
  process.exit(1);
}

/** Marca propria, para achar e trocar sem depender do conteudo. */
const MARCA = "xcart-click";
const RE_TAG = /<script\b[^>]*data-xcart-click[^>]*>\s*<\/script>\s*/g;

/** O AW-XXXXXXXXX ja configurado em tracking_configs. */
async function idDeRemarketing(
  admin: { from: (t: string) => any },
  storeId: string
): Promise<string | null> {
  const { data } = await admin
    .from("tracking_configs")
    .select("google_conversion_id")
    .eq("store_id", storeId)
    .maybeSingle();
  const aw = (data?.google_conversion_id || "").trim();
  if (!aw) {
    console.error(
      [
        "--remarketing pedido, mas a loja nao tem ID de conversao configurado.",
        "Configure com: npm run op -- scripts/configurar-tracking.ts \\",
        "  --loja <dominio> --aw AW-XXXXXXXXX --rotulo <rotulo>",
      ].join("\n")
    );
    process.exit(1);
  }
  return aw;
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { shopifyGraphQL } = await import("../src/lib/shopify/client");
  const { getPublicAppUrl } = await import("../src/lib/public-url");
  const admin = createAdminClient();

  // Todas as linhas ativas, nao maybeSingle(): o MESMO shop_domain pode estar
  // cadastrado por mais de uma conta xcart, cada uma com o seu app da Shopify --
  // ha 4 casos assim em producao. maybeSingle() ERRA nesses, e o script morria
  // dizendo "loja nao encontrada" numa loja que existe.
  const { data: candidatas } = await admin
    .from("stores")
    .select("id, name, shop_domain, user_id, client_id, client_secret, access_token")
    .eq("shop_domain", dominio)
    .is("uninstalled_at", null)
    .order("created_at", { ascending: false });

  if (!candidatas?.length) {
    console.error(`loja ${dominio} nao encontrada`);
    process.exit(1);
  }

  const escolhidoPorArg = (() => {
    const i = process.argv.indexOf("--store");
    return i >= 0 ? process.argv[i + 1] : null;
  })();

  if (candidatas.length > 1 && !escolhidoPorArg) {
    console.error(`\n${dominio} esta cadastrada ${candidatas.length} vezes:`);
    for (const c of candidatas) {
      console.error(
        `  --store ${c.id}   "${c.name}"  (conta ${String(c.user_id).slice(0, 8)})`
      );
    }
    console.error(
      [
        "",
        "Escolha uma com --store <id>. O id vai dentro da tag no tema, e e ele",
        "que o coletor usa para saber de QUAL conta e o evento -- chutar aqui",
        "mandaria conversao para a conta de anuncios errada.",
      ].join("\n")
    );
    process.exit(1);
  }

  const loja = escolhidoPorArg
    ? candidatas.find((c) => c.id === escolhidoPorArg)
    : candidatas[0];

  if (!loja) {
    console.error(`--store ${escolhidoPorArg} nao e uma das linhas de ${dominio}`);
    process.exit(1);
  }
  if (!loja.client_id) {
    console.error(`loja ${dominio} sem credencial do app`);
    process.exit(1);
  }
  console.log(`  linha: "${loja.name}" (${loja.id})`);
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
    // `data-xcart-store` carrega a LINHA de loja, nao so o dominio.
    //
    // Sem isso o coletor recebe apenas `Shopify.shop` e tem que adivinhar entre
    // as contas que cadastraram o mesmo dominio -- e adivinhar errado manda a
    // conversao para a conta de anuncios de outra pessoa. O id nao e segredo:
    // com ele da para postar evento desta loja, exatamente o que o dominio ja
    // permitia.
    // `data-xcart-remarketing` liga a tag do Google no NAVEGADOR.
    //
    // Remarketing nao da para fazer do servidor: quem monta o publico e o
    // Google, a partir de um cookie que ele so grava quando o navegador fala com
    // ele. O nosso ping de conversao sai do servidor -- nao ha navegador do
    // outro lado para entrar em lista.
    //
    // Vale repetir porque e o erro caro: o snippet NAO dispara conversao pelo
    // gtag. Se disparasse, a venda contaria duas vezes (navegador + servidor) e
    // o Google nao deduplica entre os dois caminhos.
    const remarketing = comRemarketing ? await idDeRemarketing(admin, loja.id) : null;

    const tag =
      `<script src="${getPublicAppUrl()}/${MARCA}.js" data-xcart-click` +
      ` data-xcart-store="${loja.id}"` +
      (remarketing ? ` data-xcart-remarketing="${remarketing}"` : "") +
      ` defer></script>`;
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
