import { NextRequest, NextResponse } from "next/server";
import { safeFetch } from "@/lib/net/safe-url";
import { assertShopDomainPublico } from "@/lib/shopify/safe-shop";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicAppUrl } from "@/lib/public-url";
import { buildEmbedConfig } from "@/lib/checkout-routes/embed-config";

export const runtime = "nodejs";
export const maxDuration = 60;

async function shopifyRest(
  domain: string,
  accessToken: string,
  path: string,
  options: RequestInit = {}
) {
  // Esta rota carrega uma COPIA do cliente Shopify, e a copia nao tinha a
  // trava de dominio que src/lib/shopify/client.ts ganhou. O access token ia
  // no header para o host que estivesse em shop_domain.
  const host = await assertShopDomainPublico(domain);
  const res = await safeFetch(`https://${host}/admin/api/2024-10${path}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": accessToken,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify REST ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function getAccessToken(store: {
  shop_domain: string;
  client_id: string;
  client_secret: string;
  access_token?: string | null;
}): Promise<string> {
  // Always use client_credentials to get a fresh token with current scopes
  const hostToken = await assertShopDomainPublico(store.shop_domain);
  const res = await safeFetch(
    `https://${hostToken}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: store.client_id,
        client_secret: store.client_secret,
      }),
    }
  );
  if (!res.ok) throw new Error("Falha ao obter token de acesso da vitrine.");
  const data = await res.json();
  return data.access_token;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();

  // Load route config
  const { data: config, error: configError } = await admin
    .from("routed_checkout_configs")
    .select(
      "id, public_token, rotation, sku_map, variant_map, settings, source_store_id, target_store_id, target:target_store_id(name, shop_domain, target_language)"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (configError || !config) {
    return NextResponse.json({ error: "Rota não encontrada." }, { status: 404 });
  }

  // Load vitrine (source) store credentials
  const { data: sourceStore, error: storeError } = await admin
    .from("stores")
    .select("shop_domain, client_id, client_secret, access_token")
    .eq("id", config.source_store_id)
    .single();

  if (storeError || !sourceStore) {
    return NextResponse.json({ error: "Vitrine não encontrada." }, { status: 404 });
  }

  // Mesmo payload que o /embed-config devolve: o tema e o painel precisam
  // enxergar exatamente a mesma configuracao.
  const embed = await buildEmbedConfig(admin, config);
  if (embed.targets.length === 0) {
    return NextResponse.json(
      { error: "Esta rota nao tem loja de checkout com dominio configurado." },
      { status: 409 }
    );
  }

  const { skuMap, variantMap } = embed;
  const configPayload = JSON.stringify(embed);
  const appOrigin = getPublicAppUrl(
    process.env.NEXT_PUBLIC_APP_URL || "https://xcart.app"
  );

  try {
    const accessToken = await getAccessToken(sourceStore);
    const vitrineDomain = sourceStore.shop_domain;

    // Find active theme
    const themesData = await shopifyRest(vitrineDomain, accessToken, "/themes.json");
    const themes = (themesData.themes || []) as { id: number; role: string }[];
    const mainTheme = themes.find((t) => t.role === "main");
    if (!mainTheme) {
      return NextResponse.json({ error: "Tema ativo não encontrado na vitrine." }, { status: 404 });
    }

    // Upload xcart-config.json as a theme asset (no 256KB limit, served from Shopify CDN)
    const assetKey = "assets/xcart-config.json";
    const uploadRes = await shopifyRest(vitrineDomain, accessToken, `/themes/${mainTheme.id}/assets.json`, {
      method: "PUT",
      body: JSON.stringify({ asset: { key: assetKey, value: configPayload } }),
    });
    const configCdnUrl: string = uploadRes.asset?.public_url || "";

    // Get theme.liquid
    const assetData = await shopifyRest(
      vitrineDomain,
      accessToken,
      `/themes/${mainTheme.id}/assets.json?asset[key]=layout/theme.liquid`
    );
    const currentContent: string = assetData.asset?.value || "";

    if (!currentContent) {
      return NextResponse.json({ error: "theme.liquid não encontrado ou vazio." }, { status: 404 });
    }

    // Build minimal script tag with data-config-url (small — just a URL, no inline JSON)
    const newScriptTag = `<script\n  src="${appOrigin}/routed-checkout-loader.js"\n  data-token="${config.public_token}"\n  data-config-url="${configCdnUrl}"\n  async>\n</script>`;

    // Replace existing xcart script tag (identified by data-token)
    const scriptRegex = /<script\b[^>]*data-token=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/g;
    const hasExisting = scriptRegex.test(currentContent);

    let newContent: string;
    if (hasExisting) {
      newContent = currentContent.replace(
        /<script\b[^>]*data-token=["'][^"']*["'][^>]*>[\s\S]*?<\/script>/g,
        newScriptTag
      );
    } else {
      newContent = currentContent.replace("</head>", `${newScriptTag}\n</head>`);
    }

    if (newContent !== currentContent) {
      await shopifyRest(vitrineDomain, accessToken, `/themes/${mainTheme.id}/assets.json`, {
        method: "PUT",
        body: JSON.stringify({ asset: { key: "layout/theme.liquid", value: newContent } }),
      });
    }

    // Os numeros do resumo somam TODOS os destinos: com rodizio, contar so o
    // primeiro faria o lojista achar que enviou menos mapa do que enviou.
    const totalSkus = embed.targets.reduce(
      (sum, item) => sum + Object.keys(item.skuMap).length,
      0
    );
    const totalVariants = embed.targets.reduce(
      (sum, item) => sum + Object.keys(item.variantMap).length,
      0
    );
    const lojas =
      embed.targets.length === 1
        ? "1 loja de checkout"
        : `${embed.targets.length} lojas de checkout`;

    return NextResponse.json({
      ok: true,
      updated: true,
      message: `${
        hasExisting ? "Script atualizado" : "Script inserido"
      } + xcart-config.json enviado (${lojas}, ${totalSkus} SKUs, ${totalVariants} variantes).`,
      targetCount: embed.targets.length,
      skuCount: totalSkus,
      variantCount: totalVariants,
      // Mantidos para quem le o retorno esperando o destino principal.
      primarySkuCount: Object.keys(skuMap).length,
      primaryVariantCount: Object.keys(variantMap).length,
      configUrl: configCdnUrl,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao atualizar tema.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
