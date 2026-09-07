/**
 * O que a Shopify diz sobre uma loja conectada -- moeda, pais, produtos.
 *
 * Existe porque o registro do xcart e a loja de verdade podem discordar: a
 * ficha da Culture Kings dizia USD enquanto a Shopify estava em CLP. Preco
 * la e numero puro na moeda da loja, entao essa divergencia transforma um
 * tenis de 180 em 180 pesos.
 *
 * Uso:  npx tsx scripts/loja-info.ts [dominio ...]
 * Sem argumento, lista todas as lojas conectadas.
 */
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";
import { shopifyGraphQL } from "../src/lib/shopify/client";

config({ path: ".env.local" });

const dominios = process.argv.slice(2).filter((a) => !a.startsWith("--"));

(async () => {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  let q = admin
    .from("stores")
    .select("name, shop_domain, currency_code, target_language, client_id, client_secret, access_token")
    .order("created_at", { ascending: false });
  if (dominios.length) q = q.in("shop_domain", dominios);

  const { data } = await q;
  for (const loja of data || []) {
    const creds = {
      shopDomain: loja.shop_domain,
      clientId: loja.client_id,
      clientSecret: loja.client_secret,
      accessToken: loja.access_token,
    };
    try {
      const d = await shopifyGraphQL(
        creds,
        `{ shop { currencyCode billingAddress { countryCodeV2 } } productsCount { count } }`
      );
      const shopify = `${d.shop.currencyCode}/${d.shop.billingAddress?.countryCodeV2 ?? "?"}`;
      const divergente = d.shop.currencyCode !== loja.currency_code ? "  <-- DIVERGE" : "";
      console.log(
        `${loja.name}\n  ${loja.shop_domain} | shopify ${shopify} | xcart ${loja.currency_code}/${loja.target_language} | ${d.productsCount?.count} produtos${divergente}`
      );
    } catch (e) {
      console.log(`${loja.name}\n  ${loja.shop_domain} | ERRO: ${(e as Error).message.slice(0, 120)}`);
    }
  }
})();
