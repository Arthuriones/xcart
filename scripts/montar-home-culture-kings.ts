/**
 * Reescreve a home da vitrine Culture Kings.
 *
 * O tema veio copiado da blockstore.cl e a home apontava para tudo que nao
 * existe nesta loja:
 *
 *   - dois slideshows referenciando arquivos que nunca foram copiados
 *     (imgi_214_slider_desk_4.jpg e companhia) -- o banner em branco
 *   - colecoes "adidas-originals", "vans", "new-balance", "mujer", "hombre",
 *     "ninos", nenhuma delas aqui
 *   - reels apontando para handles de produto da loja chilena
 *   - dois blocos de liquid puxando CSS de //www.blockstore.cl/cdn/...
 *   - todo o texto em espanhol, numa loja para a Australia
 *
 * O que entra no lugar usa SO o que a loja tem de verdade: as 15 colecoes e
 * as fotos dos 228 produtos. Nao inventei banner: sem arte, um slideshow
 * vazio e pior do que nao ter slideshow, entao a home abre pelas categorias,
 * que tem imagem propria.
 *
 * Uso:  npx tsx scripts/montar-home-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, shopifyRestGet } from "../src/lib/shopify/client";
import { writeFileSync } from "fs";

config({ path: ".env.local" });

const VITRINE = "vvq0qq-ih.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

const HOME = {
  sections: {
    styles: {
      type: "collection-list",
      settings: {
        heading: "Shop by style",
        heading_left: true,
        description: "",
        full_width: true,
        collection_list: ["low-tops", "mid-tops", "high-tops", "slip-ons"],
        image_ratio: "square",
        layout: "grid",
        style: "style2",
        columns_desktop: 4,
        columns_mobile: "1",
        show_progress_bar: true,
        mobile_swipe: true,
        overlay_color: "#000000",
        overlay_opacity: 0,
        disable_top_spacing: true,
        disable_bottom_spacing: true,
      },
    },
    spacer_1: {
      type: "spacer",
      settings: {
        spacer_mobile: 25,
        spacer_desktop: 60,
        border_separator: false,
        border_separator_full: false,
      },
    },
    marquee_top: {
      type: "scrolling-text",
      settings: {
        height: "height-auto",
        full_width: true,
        direction: "left",
        speed: "20s",
        font_family: "body",
        text_size: 24,
        text_uppercase: true,
        color_bg: "#000000",
        color_text: "#ffffff",
        overlay_color: "#ffffff",
        overlay_opacity: 0,
        disable_top_spacing: true,
        disable_bottom_spacing: true,
      },
      blocks: {
        t1: {
          type: "text",
          settings: {
            text: "100% authentic · Free returns within 30 days · Ships Australia-wide",
            link: "",
            outline_text: false,
          },
        },
      },
      block_order: ["t1"],
    },
    tabs_brands: {
      type: "collection-tabs",
      settings: {
        heading: "Shop the brands",
        heading_left: true,
        description: "",
        full_width: true,
        product_limit: 8,
        columns_desktop: 4,
        show_view_all: true,
        show_progress_bar: true,
        disable_top_spacing: false,
        disable_bottom_spacing: true,
      },
      blocks: {
        b_nike: { type: "collection", settings: { collection: "nike", enable_promotion: false, overlay_opacity: 70 } },
        b_jordan: { type: "collection", settings: { collection: "jordan", enable_promotion: false, overlay_opacity: 70 } },
        b_adidas: { type: "collection", settings: { collection: "adidas", enable_promotion: false, overlay_opacity: 70 } },
        b_asics: { type: "collection", settings: { collection: "asics", enable_promotion: false, overlay_opacity: 70 } },
      },
      block_order: ["b_nike", "b_jordan", "b_adidas", "b_asics"],
    },
    featured_nike: {
      type: "featured-collection",
      settings: {
        heading: "Nike",
        heading_left: true,
        description: "<p>From Air Force 1s to the running archive — the widest range in the store.</p>",
        full_width: true,
        collection: "nike",
        display_type: "grid",
        product_limit: 8,
        columns_desktop: 4,
        show_view_all: true,
        mobile_swipe: false,
        show_progress_bar: true,
        disable_top_spacing: false,
        disable_bottom_spacing: true,
      },
    },
    featured_jordan: {
      type: "featured-collection",
      settings: {
        heading: "Jordan",
        heading_left: true,
        description: "<p>Retros and the models that keep selling out.</p>",
        full_width: true,
        collection: "jordan",
        display_type: "grid",
        product_limit: 8,
        columns_desktop: 4,
        show_view_all: true,
        mobile_swipe: false,
        show_progress_bar: true,
        disable_top_spacing: false,
        disable_bottom_spacing: true,
      },
    },
    separator: {
      type: "spacer",
      settings: {
        spacer_mobile: 20,
        spacer_desktop: 55,
        border_separator: true,
        border_separator_full: true,
      },
    },
    brands_grid: {
      type: "collection-list",
      settings: {
        heading: "All brands",
        heading_left: true,
        description: "",
        full_width: true,
        collection_list: [
          "nike",
          "jordan",
          "adidas",
          "asics",
          "converse",
          "puma",
          "crocs",
          "timberland",
          "reebok",
          "hey-dude",
        ],
        image_ratio: "square",
        layout: "grid",
        style: "style2",
        columns_desktop: 5,
        columns_mobile: "2",
        show_progress_bar: true,
        mobile_swipe: true,
        overlay_color: "#000000",
        overlay_opacity: 0,
        disable_top_spacing: false,
        disable_bottom_spacing: true,
      },
    },
    featured_new: {
      type: "featured-collection",
      settings: {
        heading: "Just landed",
        heading_left: true,
        description: "<p>The newest pairs to hit the shelf.</p>",
        full_width: true,
        collection: "all-sneakers",
        display_type: "grid",
        product_limit: 8,
        columns_desktop: 4,
        show_view_all: true,
        mobile_swipe: false,
        show_progress_bar: true,
        disable_top_spacing: false,
        disable_bottom_spacing: true,
      },
    },
    marquee_bottom: {
      type: "scrolling-text",
      settings: {
        height: "height-auto",
        full_width: true,
        direction: "right",
        speed: "18s",
        font_family: "body",
        text_size: 24,
        text_uppercase: true,
        color_bg: "#000000",
        color_text: "#ffffff",
        overlay_color: "#ffffff",
        overlay_opacity: 0,
        disable_top_spacing: false,
        disable_bottom_spacing: true,
      },
      blocks: {
        t1: {
          type: "text",
          settings: { text: "Nike · Jordan · adidas · ASICS · Converse · Puma · Crocs · Timberland · Reebok", link: "", outline_text: false },
        },
      },
      block_order: ["t1"],
    },
  },
  order: [
    "styles",
    "spacer_1",
    "marquee_top",
    "tabs_brands",
    "featured_nike",
    "featured_jordan",
    "separator",
    "brands_grid",
    "featured_new",
    "marquee_bottom",
  ],
};

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
  const creds = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };

  const temas = await shopifyGraphQL(creds, `{ themes(first:5){ nodes { id role name } } }`);
  const principal = (temas.themes.nodes as { id: string; role: string; name: string }[]).find(
    (t) => t.role === "MAIN"
  );
  if (!principal) throw new Error("sem tema principal");
  const idTema = principal.id.split("/").pop();
  console.log("tema:", principal.name, idTema);

  // Copia de seguranca antes de sobrescrever: a home atual e a unica versao
  // que existe desse arquivo.
  const atual = await shopifyRestGet<{ asset: { value: string } }>(
    creds,
    `themes/${idTema}/assets.json?asset[key]=templates/index.json`
  );
  const backup = `scripts/backup-home-${Date.now()}.json`;
  writeFileSync(backup, atual.asset.value);
  console.log("backup:", backup);

  const antes = JSON.parse(atual.asset.value);
  console.log("secoes antes:", antes.order.length, "| depois:", HOME.order.length);

  if (!APLICAR) {
    console.log("\n--- ensaio. Rode com --aplicar para gravar. ---");
    console.log("nova ordem:", HOME.order.join(" > "));
    return;
  }

  const tokenRes = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: creds.clientId,
      client_secret: creds.clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  const r = await fetch(`https://${creds.shopDomain}/admin/api/2024-10/themes/${idTema}/assets.json`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
    body: JSON.stringify({
      asset: { key: "templates/index.json", value: JSON.stringify(HOME, null, 2) },
    }),
  });
  console.log("PUT templates/index.json ->", r.status);
  if (!r.ok) console.log((await r.text()).slice(0, 400));
  else console.log("home reescrita.");
})();
