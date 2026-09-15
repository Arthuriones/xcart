/**
 * Diagnostico ponta a ponta da rota de um cliente, para atender suporte.
 *
 * Responde a pergunta que o painel nao responde: "o comprador consegue pagar?".
 * O Admin da Shopify mente sobre isso -- ele devolve availableForSale:true para
 * variante que a vitrine recusa no /cart/add. Por isso o ultimo passo aqui e
 * uma tentativa de compra de verdade, no dominio de verdade.
 *
 * Uso:
 *   npx tsx scripts/conferir-rota-cliente.ts <email> ["trecho do produto"]
 *
 * ATENCAO ao topo: "dotenv/config" precisa ser o PRIMEIRO import e os demais
 * precisam ser dinamicos -- import estatico hoista e avalia a cadeia de
 * modulos antes do env carregar. Mesmo motivo de consertar-rota.ts.
 */
import "dotenv/config";
import { config } from "dotenv";

config({ path: ".env.local", override: true });

const [email, termoProduto] = process.argv.slice(2);
if (!email) {
  console.error('uso: npx tsx scripts/conferir-rota-cliente.ts <email> ["produto"]');
  process.exit(1);
}

interface Cred {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string | null;
}

function ok(b: boolean) {
  return b ? "OK  " : "FALHA";
}

async function main() {
  const { createAdminClient } = await import("../src/lib/supabase/admin");
  const { shopifyGraphQL } = await import("../src/lib/shopify/client");
  const admin = createAdminClient();

  // --- usuario --------------------------------------------------------------
  const { data: lista } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const user = (lista?.users || []).find(
    (u) => (u.email || "").toLowerCase() === email.toLowerCase()
  );
  if (!user) {
    console.error(`usuario ${email} nao encontrado`);
    process.exit(1);
  }
  console.log(`usuario: ${user.email}  (${user.id})`);

  const { data: lojas } = await admin
    .from("stores")
    .select("id, name, shop_domain, client_id, client_secret, access_token, uninstalled_at")
    .eq("user_id", user.id);
  const porId = new Map((lojas || []).map((l) => [l.id, l]));
  console.log(`lojas: ${(lojas || []).length}`);

  const { data: rotas } = await admin
    .from("routed_checkout_configs")
    .select("id, name, enabled, mode, source_store_id, target_store_id, sku_map, settings, last_healed_at")
    .eq("user_id", user.id);

  if (!rotas?.length) {
    console.log("\nnenhuma rota cadastrada.");
    return;
  }

  const { data: destinos } = await admin
    .from("routed_checkout_targets")
    .select("route_id, target_store_id, enabled, weight, sku_map")
    .in("route_id", rotas.map((r) => r.id));

  const cred = (l: NonNullable<typeof lojas>[number]): Cred => ({
    shopDomain: l.shop_domain,
    clientId: l.client_id,
    clientSecret: l.client_secret,
    accessToken: l.access_token,
  });

  for (const rota of rotas) {
    const vit = porId.get(rota.source_store_id);
    console.log("\n" + "=".repeat(78));
    console.log(`ROTA  ${rota.name || rota.id}   ${rota.enabled ? "[LIGADA]" : "[pausada]"}`);
    // O id sai aqui para dar de comer ao consertar-rota.ts sem ter que
    // garimpar no banco.
    console.log(`  id: ${rota.id}`);
    console.log(`  vitrine: ${vit?.name} (${vit?.shop_domain})`);

    const meus = (destinos || []).filter((d) => d.route_id === rota.id);
    const alvos = meus.length
      ? meus.map((d) => ({ loja: porId.get(d.target_store_id), enabled: d.enabled, mapa: d.sku_map }))
      : [{ loja: porId.get(rota.target_store_id), enabled: true, mapa: rota.sku_map }];

    // --- a vitrine tem o loader no tema? -----------------------------------
    if (vit?.client_id) {
      try {
        const t = await shopifyGraphQL(cred(vit), `{ themes(first:20){nodes{id name role}} }`);
        const main = t.themes.nodes.find((x: { role: string }) => x.role === "MAIN");
        const f = await shopifyGraphQL(
          cred(vit),
          `query($id:ID!,$n:[String!]){ theme(id:$id){ files(filenames:$n, first:5){ nodes{
             body{ ... on OnlineStoreThemeFileBodyText{ content } } } } } }`,
          { id: main.id, n: ["layout/theme.liquid"] }
        );
        const liquid: string = f.theme.files.nodes[0]?.body?.content || "";
        const temLoader = /routed-checkout-loader|data-token/.test(liquid);
        const temMapa = /data-config-url/.test(liquid);
        console.log(`  ${ok(temLoader)} loader no theme.liquid`);
        console.log(`  ${ok(temMapa)} mapa publicado no tema (data-config-url)`);
        if (!temLoader) {
          console.log("        -> sem o loader a vitrine nunca roteia: o comprador paga NA VITRINE.");
        }
      } catch (e) {
        console.log(`  FALHA ler tema da vitrine: ${(e as Error).message.slice(0, 90)}`);
      }
    }

    for (const alvo of alvos) {
      const pay = alvo.loja;
      const mapa = (alvo.mapa || {}) as Record<string, unknown>;
      console.log(`\n  -> destino: ${pay?.name} (${pay?.shop_domain})  ${alvo.enabled ? "" : "[destino desligado]"}`);
      console.log(`     SKUs no mapa: ${Object.keys(mapa).length}`);
      if (pay?.uninstalled_at) {
        console.log("     FALHA app desinstalado nesta loja (token morto).");
        continue;
      }
      if (!pay?.client_id) {
        console.log("     FALHA sem credencial.");
        continue;
      }

      // dominio que o comprador realmente acessa
      let dominio = pay.shop_domain;
      try {
        const d = await shopifyGraphQL(cred(pay), `{ shop { primaryDomain { host } } }`);
        dominio = d.shop.primaryDomain.host || dominio;
      } catch { /* segue com o myshopify */ }
      console.log(`     dominio de checkout: ${dominio}`);

      // --- cobertura: e o numero que diz se o cliente perde venda -----------
      //
      // SKU da vitrine que nao esta no mapa nao roteia. O comprador que levar
      // esse item ao carrinho paga NA VITRINE -- silenciosamente, sem erro em
      // lugar nenhum. Por isso a cobertura vem antes de qualquer outra coisa.
      if (vit?.client_id) {
        try {
          const skus = new Set<string>();
          let semSkuTotal = 0;
          let cur: string | null = null;
          for (let pag = 0; pag < 40; pag += 1) {
            const d = await shopifyGraphQL(
              cred(vit),
              `query($c:String){ products(first:100, after:$c, query:"status:active"){
                 nodes{ variants(first:100){ nodes{ sku } } }
                 pageInfo{ hasNextPage endCursor } } }`,
              { c: cur }
            );
            for (const p of d.products.nodes) {
              for (const v of p.variants.nodes) {
                if (v.sku) skus.add(v.sku);
                else semSkuTotal += 1;
              }
            }
            if (!d.products.pageInfo.hasNextPage) break;
            cur = d.products.pageInfo.endCursor;
          }
          const dentro = [...skus].filter((s) => s in mapa).length;
          const pct = skus.size ? Math.round((dentro / skus.size) * 100) : 0;
          console.log(`     ${ok(pct === 100 && semSkuTotal === 0)} cobertura: ${dentro}/${skus.size} SKUs mapeados (${pct}%)`);
          if (semSkuTotal) {
            console.log(`        ${semSkuTotal} variantes SEM SKU na vitrine -- essas nunca roteiam.`);
          }
          if (pct < 100) {
            const fora = [...skus].filter((s) => !(s in mapa));
            console.log(`        ${fora.length} SKUs fora do mapa: ${fora.slice(0, 5).join(", ")}${fora.length > 5 ? " ..." : ""}`);
            console.log("        -> comprador que levar esses ao carrinho paga NA VITRINE.");
          }
        } catch (e) {
          console.log(`     FALHA medir cobertura: ${(e as Error).message.slice(0, 90)}`);
        }
      }

      if (!termoProduto) continue;

      // --- o produto do ticket ---------------------------------------------
      console.log(`\n     produto: "${termoProduto}"`);
      let variantes: { id: string; sku: string | null; title: string; legacyResourceId: string }[] = [];
      try {
        const q = await shopifyGraphQL(
          vit ? cred(vit) : cred(pay),
          `query($q:String!){ products(first:5, query:$q){ nodes{ title handle
             variants(first:60){ nodes{ id legacyResourceId sku title } } } } }`,
          { q: `title:*${termoProduto}*` }
        );
        const achado = q.products.nodes[0];
        if (!achado) {
          console.log("     FALHA produto NAO existe na vitrine com esse nome.");
          continue;
        }
        console.log(`     na vitrine: ${achado.title} (${achado.variants.nodes.length} variantes)`);
        variantes = achado.variants.nodes;
      } catch (e) {
        console.log(`     FALHA buscar na vitrine: ${(e as Error).message.slice(0, 90)}`);
        continue;
      }

      const semSku = variantes.filter((v) => !v.sku);
      console.log(`     ${ok(semSku.length === 0)} todas as variantes tem SKU (${variantes.length - semSku.length}/${variantes.length})`);

      const foraDoMapa = variantes.filter((v) => v.sku && !(v.sku in mapa));
      console.log(`     ${ok(foraDoMapa.length === 0)} todas mapeadas para o destino (${variantes.length - semSku.length - foraDoMapa.length}/${variantes.length - semSku.length})`);
      if (foraDoMapa.length) {
        console.log(`        faltando: ${foraDoMapa.slice(0, 5).map((v) => v.sku).join(", ")}${foraDoMapa.length > 5 ? " ..." : ""}`);
      }

      // --- teste de compra de verdade ---------------------------------------
      const comSku = variantes.find((v) => v.sku && v.sku in mapa) || variantes.find((v) => v.sku);
      if (!comSku?.sku) {
        console.log("     (sem SKU utilizavel para testar compra)");
        continue;
      }
      let variantDestino: string | null = null;
      try {
        const r = await shopifyGraphQL(
          cred(pay),
          `query($q:String!){ productVariants(first:1, query:$q){ nodes{ legacyResourceId sku
             inventoryPolicy availableForSale inventoryItem{ tracked } } } }`,
          { q: `sku:${comSku.sku}` }
        );
        const v = r.productVariants.nodes[0];
        if (!v) {
          console.log(`     FALHA SKU ${comSku.sku} NAO existe na loja de checkout.`);
          continue;
        }
        variantDestino = v.legacyResourceId;
        console.log(
          `     admin diz: availableForSale=${v.availableForSale} policy=${v.inventoryPolicy} tracked=${v.inventoryItem.tracked}`
        );
      } catch (e) {
        console.log(`     FALHA buscar SKU no destino: ${(e as Error).message.slice(0, 90)}`);
        continue;
      }

      // O unico teste que vale: o Admin responde "disponivel" para variante
      // que a vitrine recusa no carrinho.
      try {
        const corpo = new URLSearchParams({ id: String(variantDestino), quantity: "1" });
        const res = await fetch(`https://${dominio}/cart/add.js`, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "X-Requested-With": "XMLHttpRequest",
            "User-Agent": "Mozilla/5.0",
          },
          body: corpo,
        });
        if (res.ok) {
          console.log(`     ${ok(true)} COMPRA FUNCIONA (${comSku.sku} no checkout)`);
        } else {
          const txt = await res.text();
          let msg = txt.slice(0, 110);
          try { msg = (JSON.parse(txt).message || msg).slice(0, 110); } catch {}
          console.log(`     FALHA COMPRA BLOQUEADA (${res.status}) ${msg}`);
        }
      } catch (e) {
        console.log(`     FALHA nao consegui testar a compra: ${(e as Error).message.slice(0, 90)}`);
      }
    }

    // --- telemetria -----------------------------------------------------------
    const { data: eventos } = await admin
      .from("routed_checkout_fallbacks")
      .select("reason, detail, created_at")
      .eq("route_config_id", rota.id)
      .order("created_at", { ascending: false })
      .limit(200);
    const cont = new Map<string, number>();
    for (const e of eventos || []) cont.set(e.reason, (cont.get(e.reason) || 0) + 1);
    console.log(
      `\n  telemetria (ultimos ${(eventos || []).length} eventos): ` +
        ([...cont.entries()].map(([k, v]) => `${k}=${v}`).join("  ") || "nenhum")
    );
    const ultimo = (eventos || [])[0];
    if (ultimo) console.log(`  ultimo: ${ultimo.reason} ${(ultimo.detail || "").slice(0, 70)} (${ultimo.created_at.slice(0, 16)})`);
    // A data importa: `last_heal` guarda a ultima execucao, e aviso de produto
    // que ja foi apagado da vitrine fica preso ali parecendo problema atual.
    const heal = (rota.settings as { last_heal?: { ok?: boolean; message?: string; at?: string } })?.last_heal;
    if (heal) {
      console.log(
        `  ultimo conserto: ${heal.ok ? "ok" : "COM AVISO"} em ${String(heal.at || "?").slice(0, 16)}` +
          ` (rodou em ${String(rota.last_healed_at || "?").slice(0, 16)})`
      );
      if (heal.message) console.log(`    ${heal.message.slice(0, 120)}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
