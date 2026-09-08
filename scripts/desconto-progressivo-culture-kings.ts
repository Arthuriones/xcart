/**
 * Desconto progressivo por quantidade: 2 pares -5%, 3 pares -10%, 4+ pares -15%.
 *
 * O tema JA trazia a barra pronta (snippets/descuento-progresivo.liquid), com
 * esses mesmos tramos, renderizada no carrinho e na gaveta. Faltavam duas
 * coisas: o texto estava em espanhol e -- o que importa -- NAO existia
 * desconto nenhum cadastrado. A barra prometia e nada era descontado.
 *
 * Os descontos automaticos entram nas DUAS lojas, e isso nao e redundancia:
 *
 *   vitrine  -> o total do carrinho aparece ja rebaixado enquanto o comprador
 *               navega. A barra le cart.cart_level_discount_applications, ou
 *               seja, o desconto REAL, entao sem isso ela mostraria "Ya
 *               ahorras" zerado.
 *   checkout -> e onde o pagamento acontece. Sem o desconto aqui, o comprador
 *               ve 15% na vitrine e paga cheio. Pior que nao oferecer nada.
 *
 * Uso:  npx tsx scripts/desconto-progressivo-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, shopifyRestGet } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const LOJAS = ["vvq0qq-ih.myshopify.com", "imftvs-gc.myshopify.com"];
const APLICAR = process.argv.includes("--aplicar");

const TRAMOS = [
  { qtd: 2, pct: 5 },
  { qtd: 3, pct: 10 },
  { qtd: 4, pct: 15 },
];

/** Texto visivel da barra, do espanhol para o ingles australiano. */
const TRADUCOES: [string, string][] = [
  ["&#161;M&aacute;ximo descuento desbloqueado!", "Maximum discount unlocked!"],
  [
    "Agrega {{ faltan }}\n        {%- if faltan == 1 %} producto m&aacute;s{% else %} productos m&aacute;s{% endif %}\n        y ahorra {{ pct_siguiente }}%",
    "Add {{ faltan }}\n        {%- if faltan == 1 %} more pair{% else %} more pairs{% endif %}\n        and save {{ pct_siguiente }}%",
  ],
  ["Ya ahorras {{ ahorro | money }}", "You're saving {{ ahorro | money }}"],
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function credenciais(admin: any, dominio: string) {
  const { data } = await admin.from("stores")
    .select("name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", dominio).single();
  const d = data as unknown as { name: string; shop_domain: string; client_id: string; client_secret: string; access_token: string | null };
  return { nome: d.name, creds: { shopDomain: d.shop_domain, clientId: d.client_id, clientSecret: d.client_secret, accessToken: d.access_token } };
}

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  for (const dominio of LOJAS) {
    const { nome, creds } = await credenciais(admin, dominio);
    console.log(`\n===== ${nome} (${dominio}) =====`);

    const atuais = await shopifyGraphQL(creds, `{
      discountNodes(first:50){ nodes { id discount { ... on DiscountAutomaticBasic { title } } } }
    }`);
    const existentes = new Set(
      (atuais.discountNodes.nodes as { discount: { title?: string } }[])
        .map((n) => n.discount?.title).filter(Boolean) as string[]
    );
    console.log("descontos hoje:", existentes.size ? [...existentes].join(", ") : "nenhum");

    for (const t of TRAMOS) {
      const titulo = `Buy ${t.qtd}+ pairs — ${t.pct}% off`;
      if (existentes.has(titulo)) { console.log(`   ${titulo}: ja existe`); continue; }
      if (!APLICAR) { console.log(`   criaria: ${titulo}`); continue; }

      const r = await shopifyGraphQL(creds, `mutation($d:DiscountAutomaticBasicInput!){
        discountAutomaticBasicCreate(automaticBasicDiscount:$d){
          automaticDiscountNode { id }
          userErrors { field message }
        }
      }`, {
        d: {
          title: titulo,
          startsAt: new Date().toISOString(),
          // Sem data de fim: e regra permanente da loja, nao campanha.
          minimumRequirement: { quantity: { greaterThanOrEqualToQuantity: String(t.qtd) } },
          customerGets: {
            value: { percentage: t.pct / 100 },
            items: { all: true },
          },
          combinesWith: { orderDiscounts: false, productDiscounts: false, shippingDiscounts: true },
        },
      });
      const erros = r.discountAutomaticBasicCreate?.userErrors || [];
      console.log(`   ${titulo}: ${erros.length ? "ERRO " + erros.map((e: {message:string})=>e.message).join(" | ") : "criado"}`);
    }
  }

  // ------------------------------------------------- texto da barra (vitrine)
  const { creds } = await credenciais(admin, LOJAS[0]);
  const t = await shopifyGraphQL(creds, `{ themes(first:5){ nodes { id role } } }`);
  const idTema = (t.themes.nodes as { id: string; role: string }[]).find((x) => x.role === "MAIN")!.id.split("/").pop();
  const chave = "snippets/descuento-progresivo.liquid";
  const r = await shopifyRestGet<{ asset: { value: string } }>(creds, `themes/${idTema}/assets.json?asset[key]=${encodeURIComponent(chave)}`);
  let liquid = r.asset.value;

  let trocas = 0;
  for (const [de, para] of TRADUCOES) {
    if (liquid.includes(de)) { liquid = liquid.replace(de, para); trocas += 1; }
  }
  console.log(`\nbarra do carrinho: ${trocas} de ${TRADUCOES.length} textos traduzidos`);
  if (trocas < TRADUCOES.length) console.log("   (algum trecho nao bateu — confira o snippet)");

  if (!APLICAR) { console.log("\n--- ensaio. Rode com --aplicar. ---"); return; }
  if (trocas === 0) { console.log("nada a gravar no tema."); return; }

  const tok = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
  }).then((x) => x.json() as Promise<{ access_token: string }>);

  const put = await fetch(`https://${creds.shopDomain}/admin/api/2024-10/themes/${idTema}/assets.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": tok.access_token },
    body: JSON.stringify({ asset: { key: chave, value: liquid } }),
  });
  console.log("snippet ->", put.status, put.ok ? "traduzido" : (await put.text()).slice(0, 200));
})();
