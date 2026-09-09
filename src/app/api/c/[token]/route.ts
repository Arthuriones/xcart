import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { dominioDeDestino } from "@/lib/net/url-guard";

export const runtime = "edge";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!token) return NextResponse.json({ error: "Token inválido." }, { status: 400 });

  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from("routed_checkout_configs")
    .select("sku_map, variant_map, settings, target:target_store_id(shop_domain, target_language)")
    .eq("public_token", token)
    .eq("enabled", true)
    .single();

  if (error || !config) {
    return NextResponse.json({ error: "Rota não encontrada." }, { status: 404 });
  }

  const target = Array.isArray(config.target) ? config.target[0] : config.target;
  const settings = (config.settings || {}) as {
    checkout_domain?: string;
    checkout_country?: string;
    checkout_locale?: string;
  };

  // Valida na LEITURA tambem, nao so na gravacao: linhas gravadas antes desta
  // trava continuam no banco, e este endpoint e publico (CORS *) -- o que sai
  // daqui vira `window.location` no navegador do comprador.
  const domain =
    dominioDeDestino(settings.checkout_domain) ||
    dominioDeDestino(target?.shop_domain) ||
    "";
  let country = settings.checkout_country || "";
  let locale = settings.checkout_locale || "";
  if (!country && target?.target_language) {
    const [, region] = String(target.target_language).split("-");
    country = region ? region.toUpperCase() : "";
    locale = target.target_language;
  }

  const rawSkuMap = (config.sku_map || {}) as Record<string, string | number>;
  const skuMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawSkuMap)) {
    const key = k.trim().toLowerCase();
    if (key) skuMap[key] = String(v);
  }

  const rawVariantMap = (config.variant_map || {}) as Record<string, string | number>;
  const variantMap: Record<string, string> = {};
  for (const [k, v] of Object.entries(rawVariantMap)) {
    if (k) variantMap[k] = String(v);
  }

  return NextResponse.json(
    { domain, skuMap, variantMap, country, locale },
    {
      headers: {
        "Cache-Control": "public, max-age=300, stale-while-revalidate=3600",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
}
