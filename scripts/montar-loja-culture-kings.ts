/**
 * Monta a vitrine Culture Kings: colecoes, paginas, politicas e navegacao.
 *
 * A loja tinha 228 tenis e nenhuma colecao -- ou seja, catalogo sem vitrine.
 * Sem colecao nao ha menu, nao ha filtro por marca e o comprador cai numa
 * lista unica de 228 itens.
 *
 * As colecoes saem do proprio catalogo: dez por marca e quatro por cano
 * (Lows, Mids, Hi-top, Slip-on), montadas lendo os produtos que ja estao la.
 *
 * As politicas sao escritas para a AUSTRALIA e citam o Australian Consumer
 * Law. Isso NAO e detalhe: o padrao do resto do sistema fala em CDC e LGPD,
 * que nao valem nada em Melbourne. A politica de privacidade fica como esta
 * -- a que a Shopify gera sozinha e mais completa que qualquer versao minha.
 *
 * Uso:  npx tsx scripts/montar-loja-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import {
  createPages,
  syncProductCollections,
  updateMenu,
  updateStorePolicies,
  shopifyGraphQL,
  type ShopifyCredentials,
} from "../src/lib/shopify/client";

config({ path: ".env.local" });

const VITRINE = "vvq0qq-ih.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

const MARCAS: Record<string, string> = {
  Nike: "nike",
  JORDAN: "jordan",
  ADIDAS: "adidas",
  PUMA: "puma",
  ASICS: "asics",
  CONVERSE: "converse",
  REEBOK: "reebok",
  CROCS: "crocs",
  TIMBERLAND: "timberland",
  "Hey Dude": "hey-dude",
};

const CANOS: Record<string, { handle: string; title: string; desc: string }> = {
  Lows: {
    handle: "low-tops",
    title: "Low Tops",
    desc: "Everyday silhouettes that sit below the ankle. The easiest sneaker to build a fit around.",
  },
  Mids: {
    handle: "mid-tops",
    title: "Mid Tops",
    desc: "Sits at the ankle. More support than a low, less bulk than a high.",
  },
  "Hi-top": {
    handle: "high-tops",
    title: "High Tops",
    desc: "Over the ankle. Court heritage, basketball roots, and the loudest way to finish a fit.",
  },
  "Slip-on": {
    handle: "slip-ons",
    title: "Slip-Ons",
    desc: "No laces, no fuss. On in seconds and built for the weekend.",
  },
};

const p = (texto: string) => `<p>${texto}</p>`;
const h = (texto: string) => `<h2>${texto}</h2>`;
const ul = (itens: string[]) => `<ul>${itens.map((i) => `<li>${i}</li>`).join("")}</ul>`;

// ------------------------------------------------------------------ paginas

const PAGINAS = [
  {
    title: "About Us",
    handle: "about-us",
    body: [
      p("We're a sneaker store built on one simple idea: the shoes you actually want, without the hunt."),
      p(
        "Every pair we list is a genuine, brand-authentic product — Nike, Jordan, adidas, Puma, ASICS, Converse, Reebok, Crocs, Timberland and Hey Dude. We don't do replicas and we don't do house-brand filler dressed up as a drop."
      ),
      h("How we pick"),
      p(
        "We carry silhouettes that people are actually wearing right now, across low tops, mid tops, high tops and slip-ons. If a shoe doesn't earn its place, it doesn't go on the shelf."
      ),
      h("Sizing"),
      p(
        'All sizes on this site are listed in <strong>AU men\'s sizing</strong> unless the product title says otherwise. Our <a href="/pages/size-guide">size guide</a> has the conversions.'
      ),
      h("Questions"),
      p(
        'Anything at all — fit, stock, delivery, an order that\'s gone quiet — reach us through the <a href="/pages/contact">contact page</a> and a human will get back to you.'
      ),
    ].join(""),
  },
  {
    title: "Size Guide",
    handle: "size-guide",
    body: [
      p(
        "Sizes on this store are <strong>AU men's</strong> unless the product title says Women's or Kids'. AU men's sizing matches US men's sizing on almost every brand we carry."
      ),
      h("Men's conversion"),
      `<table><thead><tr><th>AU / US Men's</th><th>UK</th><th>EU</th><th>CM</th></tr></thead><tbody>${[
        ["7", "6", "40", "25.0"],
        ["8", "7", "41", "26.0"],
        ["9", "8", "42.5", "27.0"],
        ["10", "9", "44", "28.0"],
        ["11", "10", "45", "29.0"],
        ["12", "11", "46", "30.0"],
        ["13", "12", "47.5", "31.0"],
        ["14", "13", "48.5", "32.0"],
      ]
        .map((l) => `<tr>${l.map((c) => `<td>${c}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
      h("Women's conversion"),
      p("Women's AU sizing runs about 1.5 sizes above men's. A women's AU 8 is roughly a men's AU 6.5."),
      h("Fit notes by brand"),
      ul([
        "<strong>Nike & Jordan</strong> — true to size on most models. Air Force 1 and Dunk run about half a size large.",
        "<strong>adidas</strong> — true to size. Sambas and Gazelles are narrow; go up half a size if you have a wide foot.",
        "<strong>Converse</strong> — Chuck Taylors run about half a size large. Size down.",
        "<strong>ASICS</strong> — true to size, generally a roomier toe box.",
        "<strong>Puma & Reebok</strong> — true to size.",
        "<strong>Crocs</strong> — sized in AU men's; roomy by design.",
        "<strong>Timberland</strong> — runs about half a size large.",
      ]),
      p("Between sizes? Go up. A slightly roomy sneaker beats a tight one every time."),
    ].join(""),
  },
  {
    title: "Shipping & Delivery",
    handle: "shipping-delivery",
    body: [
      h("Where we ship"),
      p("We ship Australia-wide, to every state and territory, including PO boxes and parcel lockers."),
      h("Processing"),
      p(
        "Orders are picked and packed within 1–2 business days. Orders placed on weekends or public holidays start processing the next business day."
      ),
      h("Delivery times"),
      p("Once dispatched, estimated transit times are:"),
      ul([
        "Metro Sydney, Melbourne, Brisbane, Adelaide, Perth — 3–7 business days",
        "Regional areas — 5–12 business days",
        "NT, TAS and remote postcodes — 7–15 business days",
      ]),
      p(
        "These are estimates from the carrier, not guarantees. Peak periods and weather events can add time."
      ),
      h("Tracking"),
      p(
        "You'll get a tracking link by email as soon as your order is dispatched. If tracking hasn't updated for a few days, that's normal while a parcel is in transit — get in touch if it stalls for more than a week."
      ),
      h("Shipping cost"),
      p("Shipping is calculated at checkout based on your delivery address."),
      h("Wrong address"),
      p(
        "Check your address before you pay. If a parcel is returned because the address was wrong or nobody could receive it, we'll re-send it once you cover the return postage."
      ),
    ].join(""),
  },
  {
    title: "FAQ",
    handle: "faq",
    body: [
      h("Are the sneakers authentic?"),
      p(
        "Yes. Every pair is a genuine branded product. We don't sell replicas, and we don't relabel anything as our own."
      ),
      h("How long will my order take?"),
      p(
        '1–2 business days to pack, then 3–15 business days in transit depending on where you are. Full breakdown on the <a href="/pages/shipping-delivery">shipping page</a>.'
      ),
      h("What size should I get?"),
      p(
        'Sizes are AU men\'s unless stated. The <a href="/pages/size-guide">size guide</a> has conversions and per-brand fit notes. If you\'re between sizes, go up.'
      ),
      h("Can I change or cancel my order?"),
      p(
        "If it hasn't been dispatched, yes — contact us as soon as you can. Once it's with the carrier we can't recall it, but you can still return it."
      ),
      h("Can I return something?"),
      p(
        'Yes. 30 days, unworn, in the original box. Full detail in our <a href="/policies/refund-policy">refund policy</a>.'
      ),
      h("Do you ship outside Australia?"),
      p("Not right now. Australia only."),
      h("How do I get in touch?"),
      p('Through the <a href="/pages/contact">contact page</a>. We answer within one business day.'),
    ].join(""),
  },
];

// ----------------------------------------------------------------- politicas

const POLITICAS = [
  {
    type: "refund",
    body: [
      h("Change of mind"),
      p(
        "You have 30 days from delivery to return a pair you've changed your mind about. To be accepted, the sneakers must be unworn, in original condition, and returned in their original box with all tags attached. Return postage for change of mind is at your cost."
      ),
      p("Once we receive and check the return, your refund goes back to the original payment method within 5–10 business days."),
      h("Faulty, damaged or wrong item"),
      p(
        "Our goods come with guarantees that cannot be excluded under the <strong>Australian Consumer Law</strong>. You are entitled to a replacement or refund for a major failure, and to compensation for any other reasonably foreseeable loss or damage. You are also entitled to have the goods repaired or replaced if they fail to be of acceptable quality and the failure does not amount to a major failure."
      ),
      p(
        "If something arrives faulty, damaged or simply isn't what you ordered, contact us with your order number and photos. We cover return postage in those cases and you choose a replacement or a refund."
      ),
      h("What we can't accept"),
      ul([
        "Sneakers that have been worn outdoors or show wear on the sole",
        "Returns without the original box, or with a box used as the shipping carton",
        "Returns started more than 30 days after delivery",
      ]),
      h("How to start a return"),
      p(
        'Contact us through the <a href="/pages/contact">contact page</a> with your order number and what you\'d like to do. We\'ll send return instructions — please don\'t post anything back before you hear from us.'
      ),
      h("Nothing here limits your rights"),
      p(
        "This policy sits on top of your rights under the Australian Consumer Law. It does not replace or limit them."
      ),
    ].join(""),
  },
  {
    type: "shipping",
    body: [
      p("We ship Australia-wide."),
      h("Processing and transit"),
      p("Orders are packed within 1–2 business days. After dispatch, estimated transit times are:"),
      ul([
        "Metro areas — 3–7 business days",
        "Regional areas — 5–12 business days",
        "NT, TAS and remote postcodes — 7–15 business days",
      ]),
      p("Transit times are carrier estimates, not guarantees."),
      h("Tracking"),
      p("A tracking link is emailed at dispatch."),
      h("Costs"),
      p("Shipping is calculated at checkout from your delivery address."),
      h("Incorrect addresses"),
      p(
        "If a parcel is returned to us because the delivery address was incorrect or undeliverable, we'll re-send once return postage is covered."
      ),
      h("Delays outside our control"),
      p(
        "Weather events, carrier disruption and peak periods can extend delivery. We'll help you chase a parcel that's stuck, but we can't control carrier timing."
      ),
    ].join(""),
  },
  {
    type: "terms_of_service",
    body: [
      h("About these terms"),
      p(
        "By browsing or buying from this store you agree to these terms. Please read them. If you don't agree with them, don't use the site."
      ),
      h("Products and pricing"),
      p(
        "All prices are in <strong>Australian dollars (AUD)</strong> and include GST where applicable. We do our best to keep pricing and stock accurate, but errors happen. If a product is listed at the wrong price or is unavailable after you order, we'll contact you and offer a full refund."
      ),
      p(
        "Product images are supplied by the brand or the manufacturer. Slight variation in colour between a screen and the physical product is normal."
      ),
      h("Orders"),
      p(
        "An order is an offer to buy. We may decline or cancel an order — for example if stock has run out, if we can't verify payment, or if we suspect fraud. If we cancel after payment, you get a full refund."
      ),
      h("Brands and trade marks"),
      p(
        "All brand names, logos and trade marks belong to their respective owners. We sell genuine branded products; we are not affiliated with, endorsed by, or an official distributor for any of those brands."
      ),
      h("Your account"),
      p(
        "If you create an account, you're responsible for keeping your login details secure and for activity that happens under your account."
      ),
      h("Your rights under Australian law"),
      p(
        "Nothing in these terms excludes, restricts or modifies any guarantee, right or remedy you have under the <strong>Australian Consumer Law</strong> that cannot lawfully be excluded."
      ),
      h("Liability"),
      p(
        "To the extent permitted by law, our liability for any claim relating to a product is limited to replacing the product or refunding what you paid for it."
      ),
      h("Changes"),
      p("We may update these terms. The version published on this page at the time of your order is the one that applies."),
    ].join(""),
  },
];

// -------------------------------------------------------------------- rotina

interface ProdutoLoja {
  id: string;
  vendor: string;
  productType: string;
  title: string;
}

async function lerProdutos(creds: ShopifyCredentials): Promise<ProdutoLoja[]> {
  const todos: ProdutoLoja[] = [];
  let cursor: string | null = null;
  for (;;) {
    const d: {
      products: {
        pageInfo: { hasNextPage: boolean; endCursor: string };
        nodes: ProdutoLoja[];
      };
    } = await shopifyGraphQL(
      creds,
      `query($cursor:String){ products(first:250, after:$cursor){ pageInfo{ hasNextPage endCursor } nodes { id vendor productType title } } }`,
      { cursor }
    );
    todos.push(...d.products.nodes);
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }
  return todos;
}

(async () => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
  const { data: loja } = await admin
    .from("stores")
    .select("shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", VITRINE)
    .single();
  if (!loja) throw new Error("loja nao encontrada");
  const creds: ShopifyCredentials = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };

  const produtos = await lerProdutos(creds);
  console.log(`produtos na loja: ${produtos.length}`);

  const colecoes: { handle: string; title: string; bodyHtml: string; sortOrder: string }[] = [];
  const atribuicoes: { collectionHandle: string; productIds: string[] }[] = [];

  for (const [vendor, handle] of Object.entries(MARCAS)) {
    const ids = produtos.filter((p) => p.vendor === vendor).map((p) => p.id);
    if (!ids.length) continue;
    const nome = vendor === "Hey Dude" ? "Hey Dude" : vendor[0] + vendor.slice(1).toLowerCase();
    colecoes.push({
      handle,
      title: nome,
      bodyHtml: `<p>Every ${nome} pair we carry, in stock and ready to ship Australia-wide.</p>`,
      sortOrder: "BEST_SELLING",
    });
    atribuicoes.push({ collectionHandle: handle, productIds: ids });
  }

  for (const [tipo, def] of Object.entries(CANOS)) {
    const ids = produtos.filter((p) => p.productType === tipo).map((p) => p.id);
    if (!ids.length) continue;
    colecoes.push({
      handle: def.handle,
      title: def.title,
      bodyHtml: `<p>${def.desc}</p>`,
      sortOrder: "BEST_SELLING",
    });
    atribuicoes.push({ collectionHandle: def.handle, productIds: ids });
  }

  colecoes.push({
    handle: "all-sneakers",
    title: "All Sneakers",
    bodyHtml: "<p>The full range — every brand, every silhouette we carry.</p>",
    sortOrder: "BEST_SELLING",
  });
  atribuicoes.push({ collectionHandle: "all-sneakers", productIds: produtos.map((p) => p.id) });

  console.log(`\ncolecoes a criar: ${colecoes.length}`);
  atribuicoes.forEach((a) =>
    console.log(`   ${a.collectionHandle}: ${a.productIds.length} produtos`)
  );
  console.log(`paginas: ${PAGINAS.map((x) => x.title).join(", ")}`);
  console.log(`politicas: ${POLITICAS.map((x) => x.type).join(", ")}`);

  if (!APLICAR) {
    console.log("\n--- ensaio. Rode com --aplicar para gravar. ---");
    return;
  }

  console.log("\ncriando colecoes…");
  await syncProductCollections(creds, { collections: colecoes, assignments: atribuicoes });
  console.log("   ok");

  console.log("criando paginas…");
  const criadas = await createPages(
    creds,
    PAGINAS.map((x) => ({ title: x.title, body: x.body, handle: x.handle }))
  );
  console.log("   ok:", criadas.map((x) => x.handle).join(", "));

  console.log("gravando politicas…");
  await updateStorePolicies(creds, POLITICAS);
  console.log("   ok");

  console.log("montando a navegacao…");

  // Item de menu na Shopify aponta por ID, nao por caminho: sem o gid o item
  // volta como "collection not found".
  const gids = await shopifyGraphQL(
    creds,
    `{
      menus(first:10){ nodes { id handle } }
      collections(first:50){ nodes { id handle } }
      pages(first:50){ nodes { id handle } }
      shop { shopPolicies { id type } } 
    }`
  );
  const idMenu = (handle: string) =>
    (gids.menus.nodes as { id: string; handle: string }[]).find((m) => m.handle === handle)?.id;
  const idColecao = (handle: string) =>
    (gids.collections.nodes as { id: string; handle: string }[]).find((c) => c.handle === handle)?.id;
  const idPagina = (handle: string) =>
    (gids.pages.nodes as { id: string; handle: string }[]).find((p) => p.handle === handle)?.id;
  const idPolitica = (tipo: string) =>
    (gids.shop.shopPolicies as { id: string; type: string }[]).find((p) => p.type === tipo)?.id;

  const colecao = (handle: string, title: string) => {
    const id = idColecao(handle);
    return id ? [{ title, type: "COLLECTION", resourceId: id }] : [];
  };
  const pagina = (handle: string, title: string) => {
    const id = idPagina(handle);
    return id ? [{ title, type: "PAGE", resourceId: id }] : [];
  };
  const politica = (tipo: string, title: string) => {
    const id = idPolitica(tipo);
    return id ? [{ title, type: "SHOP_POLICY", resourceId: id }] : [];
  };

  const marcasMenu = colecoes
    .filter((c) => Object.values(MARCAS).includes(c.handle))
    .flatMap((c) => colecao(c.handle, c.title));
  const canosMenu = Object.values(CANOS).flatMap((d) => colecao(d.handle, d.title));

  const principal = idMenu("main-menu");
  if (principal) {
    await updateMenu(creds, {
      id: principal,
      title: "Main menu",
      handle: "main-menu",
      items: [
        { title: "Home", url: "/", type: "FRONTPAGE" },
        ...colecao("all-sneakers", "Shop All"),
        ...colecao("all-sneakers", "Brands").map((i) => ({ ...i, items: marcasMenu })),
        ...colecao("all-sneakers", "Styles").map((i) => ({ ...i, items: canosMenu })),
        ...pagina("size-guide", "Size Guide"),
        ...pagina("about-us", "About"),
      ],
    });
    console.log("   main-menu ok");
  }

  const rodape = idMenu("footer");
  if (rodape) {
    await updateMenu(creds, {
      id: rodape,
      title: "Footer menu",
      handle: "footer",
      items: [
        ...pagina("faq", "FAQ"),
        ...pagina("shipping-delivery", "Shipping & Delivery"),
        ...pagina("size-guide", "Size Guide"),
        ...pagina("contact", "Contact"),
        ...politica("REFUND_POLICY", "Refund Policy"),
        ...politica("SHIPPING_POLICY", "Shipping Policy"),
        ...politica("PRIVACY_POLICY", "Privacy Policy"),
        ...politica("TERMS_OF_SERVICE", "Terms of Service"),
      ],
    });
    console.log("   footer ok");
  }

  console.log("\npronto.");
})();
