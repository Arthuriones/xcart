/**
 * Deixa a loja de CHECKOUT apresentavel, sem marca nenhuma.
 *
 * Ela e a dark store: e onde o pagamento acontece, e nao pode ter nada que
 * ligue de volta a vitrine -- nem "Culture Kings", nem Nike, Jordan, adidas.
 * Os titulos dos produtos ja sairam neutralizados. Faltava o resto da loja,
 * que estava no estado de fabrica: uma colecao, uma politica, menu padrao e o
 * texto "Browse our latest products" que a Shopify deixa de exemplo.
 *
 * Uma loja crua desse jeito nao e so feia -- ela cobra caro na conversao.
 * O comprador chega nela vindo da vitrine, no momento de pagar, e uma loja
 * sem politica, sem menu e com texto de exemplo parece golpe.
 *
 * O que este script NAO faz: mexer na estrutura da home. O tema e o Horizon e
 * o padrao dele (hero + lista de produtos) ja e limpo e sem marca. Reescrever
 * aquele JSON aninhado so criaria risco sem ganho.
 *
 * Uso:  npx tsx scripts/arrumar-checkout-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  createMenu,
  createPages,
  shopifyGraphQL,
  shopifyRestGet,
  syncProductCollections,
  updateMenu,
  updateStorePolicies,
} from "../src/lib/shopify/client";
import { writeFileSync, mkdirSync } from "fs";

config({ path: ".env.local" });

const CHECKOUT = "imftvs-gc.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

/** So descricao de formato. Nada que identifique marca. */
const CATEGORIAS: { tipo: string; handle: string; title: string; desc: string }[] = [
  { tipo: "Lows", handle: "low-tops", title: "Low Tops", desc: "Everyday low-cut styles that sit below the ankle." },
  { tipo: "Mids", handle: "mid-tops", title: "Mid Tops", desc: "Mid-cut styles that sit at the ankle." },
  { tipo: "Hi-top", handle: "high-tops", title: "High Tops", desc: "High-cut styles that sit above the ankle." },
  { tipo: "Slip-on", handle: "slip-ons", title: "Slip-Ons", desc: "Laceless styles, on in seconds." },
];

const p = (t: string) => `<p>${t}</p>`;
const h = (t: string) => `<h2>${t}</h2>`;
const ul = (i: string[]) => `<ul>${i.map((x) => `<li>${x}</li>`).join("")}</ul>`;

const PAGINAS = [
  {
    title: "Shipping & Returns",
    handle: "shipping-returns",
    body: [
      h("Delivery"),
      p("We ship Australia-wide. Orders are packed within 1–2 business days."),
      ul([
        "Metro areas — 3–7 business days",
        "Regional areas — 5–12 business days",
        "NT, TAS and remote postcodes — 7–15 business days",
      ]),
      p("Shipping is free on orders over $150. Below that it's a flat $9.95. A tracking link is emailed at dispatch."),
      h("Returns"),
      p(
        "You have 30 days from delivery to return an item you've changed your mind about, provided it is unworn and in its original packaging. Return postage for change of mind is at your cost."
      ),
      p(
        "If an item arrives faulty, damaged or is not what you ordered, we cover return postage and you choose a replacement or a refund."
      ),
      h("Sizing"),
      p("All sizes are listed in AU men's sizing unless the product title says otherwise. If you're between sizes, go up."),
    ].join(""),
  },
  {
    title: "FAQ",
    handle: "faq",
    body: [
      h("When will my order arrive?"),
      p('1–2 business days to pack, then 3–15 business days in transit depending on your postcode. Detail on the <a href="/pages/shipping-returns">shipping page</a>.'),
      h("Can I return something?"),
      p('Yes — 30 days, unworn, original packaging. See our <a href="/policies/refund-policy">refund policy</a>.'),
      h("What size should I order?"),
      p("Sizes are AU men's unless stated. Between sizes? Go up."),
      h("Do you ship outside Australia?"),
      p("Not at the moment. Australia only."),
      h("How do I contact you?"),
      p('Through the <a href="/pages/contact">contact page</a>. We reply within one business day.'),
    ].join(""),
  },
];

const POLITICAS = [
  {
    type: "refund",
    body: [
      h("Change of mind"),
      p(
        "You have 30 days from delivery to return an item you've changed your mind about. It must be unworn, in original condition and returned in its original packaging. Return postage for change of mind is at your cost. Refunds are issued to the original payment method within 5–10 business days of us receiving the return."
      ),
      h("Faulty, damaged or incorrect items"),
      p(
        "Our goods come with guarantees that cannot be excluded under the <strong>Australian Consumer Law</strong>. You are entitled to a replacement or refund for a major failure, and to compensation for any other reasonably foreseeable loss or damage. You are also entitled to have the goods repaired or replaced if they fail to be of acceptable quality and the failure does not amount to a major failure."
      ),
      p("If that applies, contact us with your order number and photos. We cover return postage and you choose a replacement or a refund."),
      h("What we can't accept"),
      ul([
        "Items worn outdoors or showing wear on the sole",
        "Returns without the original packaging",
        "Returns started more than 30 days after delivery",
      ]),
      h("Your rights"),
      p("This policy sits on top of your rights under the Australian Consumer Law. It does not replace or limit them."),
    ].join(""),
  },
  {
    type: "shipping",
    body: [
      p("We ship Australia-wide."),
      h("Processing and delivery"),
      p("Orders are packed within 1–2 business days. Estimated transit after dispatch:"),
      ul([
        "Metro areas — 3–7 business days",
        "Regional areas — 5–12 business days",
        "NT, TAS and remote postcodes — 7–15 business days",
      ]),
      p("These are carrier estimates, not guarantees."),
      h("Cost"),
      p("Free on orders over $150. A flat $9.95 below that."),
      h("Tracking"),
      p("A tracking link is emailed as soon as your order is dispatched."),
      h("Incorrect addresses"),
      p("If a parcel is returned because the address was incorrect or undeliverable, we'll re-send it once return postage is covered."),
    ].join(""),
  },
  {
    type: "terms_of_service",
    body: [
      h("About these terms"),
      p("By browsing or buying from this store you agree to these terms."),
      h("Pricing"),
      p(
        "All prices are in <strong>Australian dollars (AUD)</strong> and include GST where applicable. We work to keep pricing and availability accurate. If an item is listed at the wrong price or becomes unavailable after you order, we'll contact you and offer a full refund."
      ),
      h("Orders"),
      p(
        "An order is an offer to buy. We may decline or cancel an order — for example if stock has run out, if payment cannot be verified, or if we suspect fraud. If we cancel after payment, you receive a full refund."
      ),
      h("Product images"),
      p("Images are provided by our suppliers. Slight colour variation between a screen and the physical item is normal."),
      h("Your rights under Australian law"),
      p(
        "Nothing in these terms excludes, restricts or modifies any guarantee, right or remedy you have under the <strong>Australian Consumer Law</strong> that cannot lawfully be excluded."
      ),
      h("Liability"),
      p(
        "To the extent permitted by law, our liability for any claim relating to a product is limited to replacing it or refunding what you paid for it."
      ),
    ].join(""),
  },
];

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: loja } = await admin
    .from("stores").select("name, shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", CHECKOUT).single();
  const creds = {
    shopDomain: loja!.shop_domain, clientId: loja!.client_id,
    clientSecret: loja!.client_secret, accessToken: loja!.access_token,
  };
  console.log("loja:", loja!.name);

  // -------------------------------------------------------- 1. colecoes
  const produtos: { id: string; productType: string }[] = [];
  let cursor: string | null = null;
  for (;;) {
    const d: { products: { pageInfo: { hasNextPage: boolean; endCursor: string }; nodes: { id: string; productType: string }[] } } =
      await shopifyGraphQL(creds, `query($c:String){ products(first:250, after:$c){ pageInfo{ hasNextPage endCursor } nodes { id productType } } }`, { c: cursor });
    produtos.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }

  const colecoes: { handle: string; title: string; bodyHtml: string; sortOrder: string }[] = [];
  const atribuicoes: { collectionHandle: string; productIds: string[] }[] = [];
  for (const c of CATEGORIAS) {
    const ids = produtos.filter((x) => x.productType === c.tipo).map((x) => x.id);
    if (!ids.length) continue;
    colecoes.push({ handle: c.handle, title: c.title, bodyHtml: p(c.desc), sortOrder: "BEST_SELLING" });
    atribuicoes.push({ collectionHandle: c.handle, productIds: ids });
  }
  colecoes.push({ handle: "all-footwear", title: "All Footwear", bodyHtml: p("Every style we carry."), sortOrder: "BEST_SELLING" });
  atribuicoes.push({ collectionHandle: "all-footwear", productIds: produtos.map((x) => x.id) });

  console.log(`\nprodutos: ${produtos.length}`);
  atribuicoes.forEach((a) => console.log(`   ${a.collectionHandle}: ${a.productIds.length}`));
  console.log("paginas:", PAGINAS.map((x) => x.title).join(", "));
  console.log("politicas:", POLITICAS.map((x) => x.type).join(", "));

  if (!APLICAR) { console.log("\n--- ensaio. Rode com --aplicar. ---"); return; }

  await syncProductCollections(creds, { collections: colecoes, assignments: atribuicoes });
  console.log("\ncolecoes ok");

  const existentes = await shopifyGraphQL(creds, `{ pages(first:30){ nodes { handle } } }`);
  const jaTem = new Set((existentes.pages.nodes as { handle: string }[]).map((x) => x.handle));
  const criar = PAGINAS.filter((x) => !jaTem.has(x.handle));
  if (criar.length) {
    await createPages(creds, criar.map((x) => ({ title: x.title, body: x.body, handle: x.handle })));
    console.log("paginas criadas:", criar.map((x) => x.handle).join(", "));
  } else console.log("paginas ja existiam");

  await updateStorePolicies(creds, POLITICAS);
  console.log("politicas ok");

  // -------------------------------------------------------- 2. navegacao
  const ids = await shopifyGraphQL(creds, `{
    collections(first:30){ nodes { id handle } }
    pages(first:30){ nodes { id handle } }
    shop { shopPolicies { id type } }
    menus(first:10){ nodes { id handle } }
  }`);
  const idCol = (x: string) => (ids.collections.nodes as { id: string; handle: string }[]).find((c) => c.handle === x)?.id;
  const idPag = (x: string) => (ids.pages.nodes as { id: string; handle: string }[]).find((c) => c.handle === x)?.id;
  const idPol = (x: string) => (ids.shop.shopPolicies as { id: string; type: string }[]).find((c) => c.type === x)?.id;
  const idMenu = (x: string) => (ids.menus.nodes as { id: string; handle: string }[]).find((c) => c.handle === x)?.id;

  const col = (hd: string, t: string) => { const i = idCol(hd); return i ? [{ title: t, type: "COLLECTION", resourceId: i }] : []; };
  const pag = (hd: string, t: string) => { const i = idPag(hd); return i ? [{ title: t, type: "PAGE", resourceId: i }] : []; };
  const pol = (tp: string, t: string) => { const i = idPol(tp); return i ? [{ title: t, type: "SHOP_POLICY", resourceId: i }] : []; };

  const principal = idMenu("main-menu");
  if (principal) {
    await updateMenu(creds, { id: principal, title: "Main menu", handle: "main-menu", items: [
      { title: "Home", url: "/", type: "FRONTPAGE" },
      ...col("all-footwear", "Shop All"),
      ...CATEGORIAS.flatMap((c) => col(c.handle, c.title)),
      ...pag("shipping-returns", "Shipping & Returns"),
    ] });
    console.log("main-menu ok");
  }
  const rodape = idMenu("footer");
  if (rodape) {
    await updateMenu(creds, { id: rodape, title: "Footer menu", handle: "footer", items: [
      ...pag("faq", "FAQ"),
      ...pag("shipping-returns", "Shipping & Returns"),
      ...pag("contact", "Contact"),
      ...pol("REFUND_POLICY", "Refund Policy"),
      ...pol("SHIPPING_POLICY", "Shipping Policy"),
      ...pol("PRIVACY_POLICY", "Privacy Policy"),
      ...pol("TERMS_OF_SERVICE", "Terms of Service"),
    ] });
    console.log("footer ok");
  }
  if (!idMenu("shop")) {
    await createMenu(creds, { title: "Shop", handle: "shop", items: [
      ...col("all-footwear", "All Footwear"),
      ...CATEGORIAS.flatMap((c) => col(c.handle, c.title)),
    ] });
    console.log("menu shop criado");
  }

  // ------------------------------------------------ 3. texto do heroi
  const temas = await shopifyGraphQL(creds, `{ themes(first:5){ nodes { id role } } }`);
  const idTema = (temas.themes.nodes as { id: string; role: string }[]).find((t) => t.role === "MAIN")!.id.split("/").pop();
  const r = await shopifyRestGet<{ asset: { value: string } }>(creds, `themes/${idTema}/assets.json?asset[key]=templates/index.json`);
  mkdirSync("scripts/backup-tema-checkout", { recursive: true });
  writeFileSync("scripts/backup-tema-checkout/index.json", r.asset.value);

  // "Browse our latest products" e o texto de exemplo que a Shopify deixa.
  //
  // A troca e feita sobre o JSON como TEXTO, nao sobre o objeto: o Horizon
  // aninha blocos varios niveis e reserializar o arquivo inteiro mudaria
  // formatacao em lugares que nao preciso tocar. Repare que a barra vem
  // escapada no arquivo (`<\/p>`), entao o padrao tem que buscar isso.
  const antes = r.asset.value;
  const depois = antes.replace(
    /<p>Browse our latest products<\\?\/p>/g,
    "<p>Footwear, shipped Australia-wide<\\/p>"
  );
  if (depois === antes) { console.log("heroi: texto de exemplo nao encontrado, nada mudou"); return; }

  const tok = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
  }).then((x) => x.json() as Promise<{ access_token: string }>);
  const put = await fetch(`https://${creds.shopDomain}/admin/api/2024-10/themes/${idTema}/assets.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": tok.access_token },
    body: JSON.stringify({ asset: { key: "templates/index.json", value: depois } }),
  });
  console.log("heroi ->", put.status, put.ok ? "ok" : (await put.text()).slice(0, 160));
})();
