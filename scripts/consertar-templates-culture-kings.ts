/**
 * Conserta as paginas de colecao e de produto da vitrine Culture Kings.
 *
 * As duas herdaram da blockstore.cl secoes que apontam para o vazio:
 * "COMPRA POR CATEGORÍA" listando mujer/hombre/ninos, e "Lo último en Block"
 * puxando abas de colecoes que nao existem aqui. Numa loja para a Australia
 * isso e texto em espanhol sobre um bloco que nao renderiza nada.
 *
 * O conserto e cirurgico: so as secoes quebradas mudam, o resto do template
 * (galeria, comprar, recomendacoes) fica como esta.
 *
 * Uso:  npx tsx scripts/consertar-templates-culture-kings.ts [--aplicar]
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL, shopifyRestGet } from "../src/lib/shopify/client";
import { writeFileSync } from "fs";

config({ path: ".env.local" });

const VITRINE = "vvq0qq-ih.myshopify.com";
const APLICAR = process.argv.includes("--aplicar");

const ESTILOS = ["low-tops", "mid-tops", "high-tops", "slip-ons"];
const MARCAS_ABAS = ["nike", "jordan", "adidas", "asics"];

type Secao = { type: string; settings?: Record<string, unknown>; blocks?: Record<string, unknown>; block_order?: string[] };
type Template = { sections: Record<string, Secao>; order: string[] };

/** Devolve quantas secoes foram tocadas. */
function consertar(t: Template): string[] {
  const mudou: string[] = [];
  for (const [id, s] of Object.entries(t.sections)) {
    if (s.type === "collection-list" && s.settings) {
      s.settings.heading = "Shop by style";
      s.settings.collection_list = ESTILOS;
      s.settings.columns_desktop = 4;
      mudou.push(`${id} (collection-list -> estilos)`);
    }
    // Bloco herdado da loja chilena: "ZAPATILLAS URBANAS EN CHILE", com a
    // lista de marcas dela e faixa de tamanho que nao e a nossa.
    if (s.type === "rich-text" && s.blocks) {
      const blob = JSON.stringify(s.blocks);
      if (/ya conoces|EN CHILE|tallas del/i.test(blob)) {
        s.blocks = {
          titulo: { type: "heading", settings: { text: "AUTHENTIC SNEAKERS, SHIPPED AUSTRALIA-WIDE", size: "h4" } },
          texto: {
            type: "text",
            settings: {
              text:
                "<p>Nike, Jordan, adidas, ASICS, Converse, Puma, Crocs, Timberland, Reebok and Hey Dude — genuine pairs only, in AU men's sizing 7 to 14.</p>" +
                "<p>Packed within 1–2 business days and delivered anywhere in Australia. 30 days to return anything you change your mind about.</p>",
            },
          },
        };
        s.block_order = ["titulo", "texto"];
        mudou.push(`${id} (rich-text -> copy da Australia)`);
      }
    }
    if (s.type === "collection-tabs" && s.settings) {
      s.settings.heading = "More from the shelf";
      s.blocks = Object.fromEntries(
        MARCAS_ABAS.map((h) => [
          `b_${h}`,
          { type: "collection", settings: { collection: h, enable_promotion: false, overlay_opacity: 70 } },
        ])
      );
      s.block_order = MARCAS_ABAS.map((h) => `b_${h}`);
      mudou.push(`${id} (collection-tabs -> marcas reais)`);
    }
  }
  return mudou;
}

(async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const { data: loja } = await admin
    .from("stores").select("shop_domain, client_id, client_secret, access_token")
    .eq("shop_domain", VITRINE).single();
  const creds = {
    shopDomain: loja!.shop_domain, clientId: loja!.client_id,
    clientSecret: loja!.client_secret, accessToken: loja!.access_token,
  };

  const temas = await shopifyGraphQL(creds, `{ themes(first:5){ nodes { id role } } }`);
  const idTema = (temas.themes.nodes as { id: string; role: string }[])
    .find((t) => t.role === "MAIN")!.id.split("/").pop();

  const tokenRes = await fetch(`https://${creds.shopDomain}/admin/oauth/access_token`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: creds.clientId, client_secret: creds.clientSecret, grant_type: "client_credentials" }),
  });
  const { access_token } = (await tokenRes.json()) as { access_token: string };

  for (const chave of ["templates/collection.json", "templates/product.json"]) {
    const r = await shopifyRestGet<{ asset: { value: string } }>(
      creds, `themes/${idTema}/assets.json?asset[key]=${encodeURIComponent(chave)}`
    );
    const nome = chave.split("/").pop()!.replace(".json", "");
    writeFileSync(`scripts/backup-${nome}-${Date.now()}.json`, r.asset.value);

    const t = JSON.parse(r.asset.value) as Template;
    const mudou = consertar(t);
    console.log(`\n${chave}: ${mudou.length ? mudou.join(", ") : "nada a fazer"}`);
    if (!mudou.length || !APLICAR) continue;

    const put = await fetch(`https://${creds.shopDomain}/admin/api/2024-10/themes/${idTema}/assets.json`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": access_token },
      body: JSON.stringify({ asset: { key: chave, value: JSON.stringify(t, null, 2) } }),
    });
    console.log("   PUT ->", put.status, put.ok ? "ok" : (await put.text()).slice(0, 200));
  }
  if (!APLICAR) console.log("\n--- ensaio. Rode com --aplicar. ---");
})();
