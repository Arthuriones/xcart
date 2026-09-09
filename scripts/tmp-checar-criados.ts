import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const admin = createAdminClient();
  const { data } = await admin
    .from("stores")
    .select("name, shop_domain, access_token")
    .eq("shop_domain", "tdicbr-3u.myshopify.com")
    .single();
  const loja = data as { name: string; shop_domain: string; access_token: string };

  const r = await fetch(`https://${loja.shop_domain}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": loja.access_token },
    body: JSON.stringify({
      query: `{ products(first: 60, sortKey: CREATED_AT, reverse: true) {
        nodes { id title createdAt status vendor
          variants(first: 1) { nodes { sku } } } } }`,
    }),
  });
  const j = (await r.json()) as {
    data?: { products?: { nodes: { id: string; title: string; createdAt: string; status: string; vendor: string; variants: { nodes: { sku: string }[] } }[] } };
  };
  const corte = Date.parse("2026-09-09T00:50:00Z");
  const novos = (j.data?.products?.nodes || []).filter((n) => Date.parse(n.createdAt) > corte);
  console.log(`criados depois de 00:50Z: ${novos.length}`);
  const porStatus: Record<string, number> = {};
  for (const n of novos) porStatus[n.status] = (porStatus[n.status] || 0) + 1;
  console.log("status:", porStatus);
  console.log("skus:", novos.map((n) => n.variants.nodes[0]?.sku).slice(0, 8).join(", "));
  console.log("ids:");
  for (const n of novos) console.log(n.id);
}
main().catch((e) => { console.error(e); process.exit(1); });
