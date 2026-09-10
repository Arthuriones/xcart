import { NextRequest, NextResponse } from "next/server";
import { normalizarLinhas } from "@/lib/checkout-routes/linhas";
import {
  buildCartPermalink,
  marketParamsFromLanguage,
  type CheckoutRouteLine,
} from "@/lib/shopify/cart-routing";
import { resolveVariantIdsBySku } from "@/lib/shopify/public-store";
import {
  computeCoverage,
  normalizeRotation,
  pickTarget,
  type RouteTarget,
} from "@/lib/checkout-routes/rotation";
import {
  legacyTargetFromConfig,
  loadRouteTargets,
} from "@/lib/checkout-routes/targets";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const token = typeof body.token === "string" ? body.token : "";
  // As linhas vem do navegador e este endpoint e publico. A normalizacao (com
  // teto de tamanho, de SKU e de quantidade) mora em lib/checkout-routes/linhas
  // para ficar testada -- ver tests/resolve-input.test.ts.
  const lines = normalizarLinhas(body.lines);
  // Chave do comprador para o rodizio sticky. Vem do navegador dele; se nao
  // vier, o sorteio e aleatorio (nao da para prender o comprador sem chave).
  const rotationKey =
    typeof body.rotationKey === "string" ? body.rotationKey.slice(0, 64) : "";

  if (!token || lines.length === 0) {
    return NextResponse.json(
      { error: "token e lines sao obrigatorios." },
      { status: 400, headers: corsHeaders }
    );
  }

  try {
    const supabase = createAdminClient();
    const { data: config, error } = await supabase
      .from("routed_checkout_configs")
      .select(
        "id, name, enabled, mode, rotation, sku_map, variant_map, settings, target_store_id, target:target_store_id(name, shop_domain, target_language)"
      )
      .eq("public_token", token)
      .eq("enabled", true)
      .single();

    if (error || !config) {
      return NextResponse.json(
        { error: "Checkout roteado nao encontrado." },
        { status: 404, headers: corsHeaders }
      );
    }

    // Destinos do rodizio. Rota sem linha de destino (apagada a mao) cai no
    // destino legado da propria rota em vez de derrubar o checkout.
    let targets = await loadRouteTargets(supabase, config.id, { onlyEnabled: true });
    if (targets.length === 0) {
      const legacy = legacyTargetFromConfig(config);
      if (legacy) targets = [legacy];
    }
    if (targets.length === 0) {
      return NextResponse.json(
        { error: "Rota sem loja de checkout configurada." },
        { status: 409, headers: corsHeaders }
      );
    }

    const { strategy } = normalizeRotation(config.rotation);

    // Fallback por SKU no products.json publico: cobre variante que ainda nao
    // entrou no mapa. Roda ANTES do sorteio, senao um destino com o mapa
    // desatualizado pareceria ter cobertura pior do que realmente tem e o
    // rodizio o excluiria por um motivo que nao existe.
    const enriched = await Promise.all(
      targets.map(async (target) => hydrateTargetBySku(target, lines))
    );

    const pick = pickTarget(enriched, lines, { rotationKey, strategy });

    if (!pick) {
      return NextResponse.json(
        {
          error: "Nenhum item pode ser roteado para o checkout.",
          coverage: summarize(computeCoverage(enriched, lines)),
        },
        { status: 422, headers: corsHeaders }
      );
    }

    const { chosen } = pick;
    const target = chosen.target;

    const resolvedLines = chosen.resolved
      .filter((line) => line.variantId)
      .map((line) => ({
        variantId: line.variantId as string,
        quantity: line.quantity,
      }));

    const market = target.settings.checkout_country
      ? {
          country: target.settings.checkout_country,
          locale: target.settings.checkout_locale,
        }
      : marketParamsFromLanguage(target.targetLanguage);

    const redirectUrl = buildCartPermalink(
      target.domain,
      resolvedLines,
      {
        routed_checkout: config.id,
        routed_mode: config.mode,
      },
      market
    );

    return NextResponse.json(
      {
        redirectUrl,
        mode: config.mode,
        routedLines: resolvedLines.length,
        unroutedLines: chosen.totalCount - resolvedLines.length,
        // Qual destino levou o carrinho, para o track-fallback e o painel
        // conseguirem apontar a loja de checkout exata.
        targetId: target.id.startsWith("legacy:") ? null : target.id,
        targetStoreId: target.targetStoreId || null,
        targetDomain: target.domain,
        rotation: { strategy, candidates: pick.eligible.length, reason: pick.reason },
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Falha ao resolver checkout.";
    return NextResponse.json(
      { error: message },
      { status: 500, headers: corsHeaders }
    );
  }
}

/**
 * Completa o sku_map do destino, em memoria, com o que der para resolver no
 * products.json publico dele. Nao grava nada -- quem consolida o mapa e o
 * heal; aqui e so para o carrinho da vez nao perder item.
 */
async function hydrateTargetBySku(
  target: RouteTarget,
  lines: CheckoutRouteLine[]
): Promise<RouteTarget> {
  const [coverage] = computeCoverage([target], lines);
  const missing = coverage.resolved
    .filter((line) => !line.variantId && line.sku)
    .map((line) => line.sku);

  if (missing.length === 0 || !target.domain) return target;

  try {
    const bySku = await resolveVariantIdsBySku(target.domain, missing);
    if (bySku.size === 0) return target;
    const skuMap = { ...target.skuMap };
    for (const [sku, variantId] of bySku.entries()) {
      skuMap[String(sku).trim().toLowerCase()] = String(variantId);
    }
    return { ...target, skuMap };
  } catch {
    // Loja fora do ar ou products.json bloqueado: segue com o mapa que tem.
    return target;
  }
}

function summarize(coverage: ReturnType<typeof computeCoverage>) {
  return coverage.map((entry) => ({
    targetId: entry.target.id,
    domain: entry.target.domain,
    resolved: entry.resolvedCount,
    total: entry.totalCount,
  }));
}
