/**
 * Passa o que sobrou da loja chilena para ingles australiano.
 *
 * O tema ja roda em locales/en.default -- "Your cart is currently empty",
 * "Start Shopping" e companhia sempre estiveram em ingles. O que estava em
 * espanhol era o conteudo escrito a mao, que a copia do tema trouxe junto:
 *
 *   barra de anuncio  "LLEGASTE AL SITIO OFICIAL DE BLOCKSTORE"
 *                     "CAMBIOS Y DEVOLUCIONES GRATIS"
 *   rodape            colunas "Tienda / Ayuda / Políticas"
 *                     "Suscríbete y recibe 10% de descuento…"
 *                     "Todos los derechos reservados."
 *
 * O nome do CONCORRENTE no topo de toda pagina era o pior deles.
 *
 * As colunas do rodape tambem apontavam para menus "tienda", "ayuda" e
 * "politicas" que nao existem nesta loja -- por isso apareciam so os titulos,
 * sem link nenhum embaixo. O script cria os tres menus de verdade e religa.
 *
 * Uso:  npx tsx scripts/traduzir-loja-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, shopifyRestGet, createMenu, updateMenu } from "../src/lib/shopify/client";
import { writeFileSync } from "fs";

config({ path: ".env.local" });

const VITRINE = "vvq0qq-ih.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

const ANUNCIOS = [
  "AUTHENTIC SNEAKERS — NIKE, JORDAN, ADIDAS & MORE",
  "FREE SHIPPING ON ORDERS OVER $150",
  "30-DAY RETURNS AUSTRALIA-WIDE",
];

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: loja } = await admin.from("stores")
    .select("shop_domain, client_id, client_secret, access_token").eq("shop_domain", VITRINE).single();
  const creds = {
    shopDomain: loja!.shop_domain, clientId: loja!.client_id,
    clientSecret: loja!.client_secret, accessToken: loja!.access_token,
  };

  const temas = await shopifyGraphQL(creds, `{ themes(first:5){ nodes { id role name } } }`);
  const idTema = (temas.themes.nodes as { id: string; role: string }[])
    .find((t) => t.role === "MAIN")!.id.split("/").pop();

  const dados = await shopifyGraphQL(creds, `{
    collections(first:50){ nodes { id handle } }
    pages(first:30){ nodes { id handle } }
    shop { shopPolicies { id type } }
    menus(first:20){ nodes { id handle } }
  }`);
  const idCol = (h: string) => (dados.collections.nodes as { id: string; handle: string }[]).find((c) => c.handle === h)?.id;
  const idPag = (h: string) => (dados.pages.nodes as { id: string; handle: string }[]).find((p) => p.handle === h)?.id;
  const idPol = (t: string) => (dados.shop.shopPolicies as { id: string; type: string }[]).find((p) => p.type === t)?.id;
  const menuExistente = (h: string) => (dados.menus.nodes as { id: string; handle: string }[]).find((m) => m.handle === h)?.id;

  const col = (h: string, title: string) => { const id = idCol(h); return id ? [{ title, type: "COLLECTION", resourceId: id }] : []; };
  const pag = (h: string, title: string) => { const id = idPag(h); return id ? [{ title, type: "PAGE", resourceId: id }] : []; };
  const pol = (t: string, title: string) => { const id = idPol(t); return id ? [{ title, type: "SHOP_POLICY", resourceId: id }] : []; };

  const MENUS = [
    { handle: "shop", title: "Shop", items: [
      ...col("all-sneakers", "All Sneakers"), ...col("nike", "Nike"), ...col("jordan", "Jordan"),
      ...col("adidas", "Adidas"), ...col("low-tops", "Low Tops"), ...col("high-tops", "High Tops"),
    ] },
    { handle: "help", title: "Help", items: [
      ...pag("faq", "FAQ"), ...pag("shipping-delivery", "Shipping & Delivery"),
      ...pag("size-guide", "Size Guide"), ...pag("contact", "Contact"), ...pag("about-us", "About Us"),
    ] },
    { handle: "legal", title: "Legal", items: [
      ...pol("REFUND_POLICY", "Refund Policy"), ...pol("SHIPPING_POLICY", "Shipping Policy"),
      ...pol("PRIVACY_POLICY", "Privacy Policy"), ...pol("TERMS_OF_SERVICE", "Terms of Service"),
    ] },
  ];

  console.log("menus a garantir:");
  MENUS.forEach((m) => console.log(`   ${m.handle}: ${m.items.length} itens`));

  if (!APLICAR) { console.log("\n--- ensaio. Rode com --aplicar. ---"); return; }

  for (const m of MENUS) {
    if (!m.items.length) { console.log(`   ${m.handle}: sem itens, pulado`); continue; }
    const existente = menuExistente(m.handle);
    if (existente) await updateMenu(creds, { id: existente, title: m.title, handle: m.handle, items: m.items });
    else await createMenu(creds, { title: m.title, handle: m.handle, items: m.items });
    console.log(`   ${m.handle}: ${existente ? "atualizado" : "criado"}`);
  }

  const tokenRes = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };
  const put = (key: string, value: string) =>
    fetch(`https://${creds.shopDomain}/admin/api/2024-10/themes/${idTema}/assets.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
      body: JSON.stringify({ asset: { key, value } }),
    });

  // ---------------------------------------------------------- rodape
  const fr = await shopifyRestGet<{ asset: { value: string } }>(creds, `themes/${idTema}/assets.json?asset[key]=sections/footer-group.json`);
  writeFileSync(`scripts/backup-tema-culture-kings/footer-group.json`, fr.asset.value);
  const rodape = JSON.parse(fr.asset.value);
  for (const s of Object.values(rodape.sections) as { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings?: Record<string, unknown> }> }[]) {
    if (s.type !== "footer") continue;
    if (s.settings) s.settings.copyright_text = "All rights reserved.";
    const porTipo = Object.values(s.blocks || {});
    const menus = porTipo.filter((b) => b.type === "menu");
    ["shop", "help", "legal"].forEach((h, i) => {
      const b = menus[i];
      if (!b?.settings) return;
      b.settings.title = MENUS[i].title;
      b.settings.menu = h;
    });
    for (const b of porTipo) {
      if (b.type === "signup" && b.settings) {
        b.settings.title = "NEWSLETTER";
        b.settings.text = "<p>Sign up and get 10% off your first order.</p>";
      }
    }
  }
  console.log("rodape ->", (await put("sections/footer-group.json", JSON.stringify(rodape, null, 2))).status);

  // ------------------------------------------------------- cabecalho
  const hr = await shopifyRestGet<{ asset: { value: string } }>(creds, `themes/${idTema}/assets.json?asset[key]=sections/header-group.json`);
  writeFileSync(`scripts/backup-tema-culture-kings/header-group.json`, hr.asset.value);
  const cab = JSON.parse(hr.asset.value);
  for (const s of Object.values(cab.sections) as { type: string; settings?: Record<string, unknown>; blocks?: Record<string, { type: string; settings?: Record<string, unknown> }>; block_order?: string[] }[]) {
    if (s.type === "announcement-bar") {
      s.blocks = Object.fromEntries(ANUNCIOS.map((t, i) => [`t${i + 1}`, { type: "text", settings: { icon: "none", text: t, link: "" } }]));
      s.block_order = ANUNCIOS.map((_, i) => `t${i + 1}`);
    }
    if (s.type === "header" && s.settings) {
      // O logo apontava para um arquivo que nunca foi copiado para ca. Sem
      // referencia quebrada o tema cai no nome da loja, que ao menos aparece.
      delete s.settings.logo;
    }
  }
  console.log("cabecalho ->", (await put("sections/header-group.json", JSON.stringify(cab, null, 2))).status);
})();
