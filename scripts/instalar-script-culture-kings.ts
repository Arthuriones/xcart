/**
 * Instala o loader de roteamento no tema da vitrine Culture Kings.
 *
 * Faz o mesmo que o botao "Instalar na vitrine" do painel: sobe o mapa de SKU
 * como asset do tema (fica no CDN da Shopify, sem o limite de 256KB de um
 * script inline) e adiciona a tag do loader no theme.liquid, antes do </head>.
 *
 * Se ja houver uma tag do xcart la, ela e SUBSTITUIDA -- reinstalar nao
 * duplica o script.
 *
 * Uso:  npx tsx scripts/instalar-script-culture-kings.ts [--aplicar]
 */
import { config as dotenv } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, shopifyRestGet } from "../src/lib/shopify/client";
import { buildEmbedConfig } from "../src/lib/checkout-routes/embed-config";
import { getPublicAppUrl } from "../src/lib/public-url";

dotenv({ path: ".env.local" });

const VITRINE = "vvq0qq-ih.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  const { data: loja } = await admin.from("stores")
    .select("id, name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", VITRINE).single();
  if (!loja) throw new Error("vitrine nao encontrada");

  const { data: rota } = await admin.from("routed_checkout_configs")
    .select("*").eq("source_store_id", loja.id).order("created_at", { ascending: false }).limit(1).single();
  if (!rota) throw new Error("nenhuma rota partindo desta vitrine");

  console.log("rota:", rota.name, "|", rota.enabled ? "ATIVA" : "parada");
  console.log("token:", rota.public_token);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const embed = await buildEmbedConfig(admin as any, rota as any);
  const totalSkus = embed.targets.reduce((s, t) => s + Object.keys(t.skuMap).length, 0);
  console.log("destinos no embed:", embed.targets.length, "| SKUs mapeados:", totalSkus);
  embed.targets.forEach((t) => console.log(`   ${t.domain} | peso ${t.weight} | ${Object.keys(t.skuMap).length} SKUs`));

  if (!totalSkus) throw new Error("mapa de SKU vazio -- nao adianta instalar");

  const creds = { shopDomain: loja.shop_domain, clientId: loja.client_id, clientSecret: loja.client_secret, accessToken: loja.access_token };
  const temas = await shopifyGraphQL(creds, `{ themes(first:5){ nodes { id name role } } }`);
  const principal = (temas.themes.nodes as { id: string; name: string; role: string }[]).find((t) => t.role === "MAIN");
  if (!principal) throw new Error("tema principal nao encontrado");
  const idTema = principal.id.split("/").pop();
  console.log("tema:", principal.name);

  const layout = await shopifyRestGet<{ asset: { value: string } }>(
    creds, `themes/${idTema}/assets.json?asset[key]=layout/theme.liquid`
  );
  const atual = layout.asset?.value || "";
  if (!atual) throw new Error("theme.liquid vazio");
  const jaTem = /<script\b[^>]*data-token=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/.test(atual);
  console.log("script ja instalado:", jaTem ? "sim (sera substituido)" : "nao");

  if (!APLICAR) {
    console.log("\n--- ensaio. Rode com --aplicar. ---");
    return;
  }

  const tokenRes = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const put = (body: unknown) =>
    fetch(`https://${creds.shopDomain}/admin/api/2024-10/themes/${idTema}/assets.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
      body: JSON.stringify(body),
    });

  // O mapa vai como asset e nao inline: 1728 SKUs estouram o limite de um
  // script no theme.liquid, e assim ele ainda ganha cache de CDN.
  const up = await put({ asset: { key: "assets/xcart-config.json", value: JSON.stringify(embed) } });
  const upJson = (await up.json()) as { asset?: { public_url?: string } };
  const urlConfig = upJson.asset?.public_url || "";
  console.log("config no CDN:", urlConfig ? "ok" : "FALHOU");

  const origem = getPublicAppUrl(process.env.NEXT_PUBLIC_APP_URL || "https://xcart.app");
  const tag = `<script\n  src="${origem}/routed-checkout-loader.js"\n  data-token="${rota.public_token}"\n  data-config-url="${urlConfig}"\n  async>\n</script>`;

  const novo = jaTem
    ? atual.replace(/<script\b[^>]*data-token=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/g, tag)
    : atual.replace("</head>", `${tag}\n</head>`);

  if (novo === atual) { console.log("nada mudou no theme.liquid"); return; }
  const r = await put({ asset: { key: "layout/theme.liquid", value: novo } });
  console.log("theme.liquid ->", r.status, r.ok ? "instalado" : (await r.text()).slice(0, 200));
})();
