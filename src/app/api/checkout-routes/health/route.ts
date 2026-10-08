import { NextRequest, NextResponse, after as depoisDaResposta } from "next/server";
import {
  completarVariantes,
  getProducts,
  shopifyRestGet,
  type ShopifyCredentials,
} from "@/lib/shopify/client";
import { verificarParDaRota } from "@/lib/shopify/store-health";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { conferirWebhooks } from "@/lib/checkout-routes/sensores";
import { marketProfileFor } from "@/lib/gemini/market-profile";
import { lerAjusteDeMercado } from "@/lib/checkout-routes/mercado";

interface ShippingZone {
  name?: string;
  countries?: { code?: string }[];
  price_based_shipping_rates?: unknown[];
  weight_based_shipping_rates?: unknown[];
  carrier_shipping_rate_providers?: unknown[];
}

/**
 * Verifica se a loja de checkout consegue entregar no pais da rota.
 *
 * Uma zona que cobre o pais mas nao tem NENHUMA tarifa faz a Shopify mostrar
 * "no shipping methods available for your address" no checkout: o cliente
 * preenche tudo e nao consegue pagar. Isso aconteceu em producao e o health,
 * que so olhava SKU, reportava tudo verde enquanto nenhum pedido fechava.
 */
async function checkShipping(
  creds: ShopifyCredentials,
  countryCode: string | null
): Promise<{
  ok: boolean;
  reason?: string;
  zone?: string;
  checkedCountry?: string | null;
}> {
  try {
    const data = await shopifyRestGet<{ shipping_zones?: ShippingZone[] }>(
      creds,
      "shipping_zones.json"
    );
    const zones = data.shipping_zones || [];
    if (zones.length === 0) {
      return { ok: false, reason: "Nenhuma zona de envio configurada.", checkedCountry: countryCode };
    }
    if (!countryCode) {
      // Sem pais definido na rota, so checamos se existe alguma tarifa.
      const anyRate = zones.some((zone) => countRates(zone) > 0);
      return anyRate
        ? { ok: true, checkedCountry: null }
        : { ok: false, reason: "Nenhuma zona de envio tem tarifa configurada.", checkedCountry: null };
    }

    const covering = zones.filter((zone) =>
      (zone.countries || []).some(
        (country) => (country.code || "").toUpperCase() === countryCode
      )
    );
    if (covering.length === 0) {
      return {
        ok: false,
        reason: `Nenhuma zona de envio cobre o pais ${countryCode}.`,
        checkedCountry: countryCode,
      };
    }
    const withRates = covering.find((zone) => countRates(zone) > 0);
    if (!withRates) {
      return {
        ok: false,
        reason: `A zona que cobre ${countryCode} nao tem nenhuma tarifa de envio — o cliente nao consegue finalizar a compra.`,
        zone: covering[0]?.name,
        checkedCountry: countryCode,
      };
    }
    return { ok: true, zone: withRates.name, checkedCountry: countryCode };
  } catch (error) {
    // Falta de escopo ou erro de rede nao deve derrubar o health inteiro.
    return {
      ok: true,
      reason:
        error instanceof Error
          ? `Nao foi possivel verificar o frete: ${error.message}`
          : undefined,
      checkedCountry: countryCode,
    };
  }
}

// "es-CL" -> "CL". Quando o idioma nao carrega regiao, cai no pais principal
// do perfil de mercado (ex.: "ja" -> Japao).
function countryFromLanguage(language: string | null | undefined): string | null {
  const value = (language || "").trim();
  if (!value) return null;
  const parts = value.split(/[-_]/);
  if (parts.length > 1 && parts[1].length === 2) return parts[1].toUpperCase();
  const fallback: Record<string, string> = { pt: "BR", ja: "JP", en: "US" };
  const base = parts[0].toLowerCase();
  // marketProfileFor valida que o idioma e conhecido antes do fallback.
  return marketProfileFor(base) && fallback[base] ? fallback[base] : null;
}

function countRates(zone: ShippingZone): number {
  return (
    (zone.price_based_shipping_rates?.length || 0) +
    (zone.weight_based_shipping_rates?.length || 0) +
    (zone.carrier_shipping_rate_providers?.length || 0)
  );
}

export const runtime = "nodejs";
export const maxDuration = 300;

interface FlatVariant {
  id: string;
  sku: string | null;
}

function numericId(gid: string | number | undefined | null): string | null {
  if (gid === undefined || gid === null) return null;
  const match = String(gid).match(/(\d+)$/);
  return match?.[1] || null;
}

async function getAllVariants(creds: ShopifyCredentials): Promise<FlatVariant[]> {
  const flat: FlatVariant[] = [];
  let after: string | null = null;
  for (let page = 0; page < 40; page += 1) {
    const data = await getProducts(creds, { first: 250, after });
    const nodes = data?.products?.nodes || [];
    // Produto com mais de 50 variantes vinha cortado: o teste contava so as
    // 50 primeiras e dava cobertura que a rota nao tinha.
    await completarVariantes(creds, nodes);
    for (const product of nodes) {
      for (const variant of product.variants?.nodes || []) {
        flat.push({ id: variant.id, sku: variant.sku?.trim() || null });
      }
    }
    const pageInfo = data?.products?.pageInfo;
    if (!pageInfo?.hasNextPage || !pageInfo?.endCursor) break;
    after = pageInfo.endCursor;
  }
  return flat;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const routeId = typeof body.id === "string" ? body.id : "";
  if (!routeId) {
    return NextResponse.json({ error: "Id da rota e obrigatorio." }, { status: 400 });
  }

  // Qual loja de checkout verificar. A verificacao pagina o catalogo das DUAS
  // lojas; rodar isso para todos os destinos numa requisicao so estouraria o
  // maxDuration em catalogo grande. Entao verifica uma por vez e diz qual.
  const targetIdPedido = typeof body.targetId === "string" ? body.targetId : "";

  const { data: config, error: configError } = await supabase
    .from("routed_checkout_configs")
    .select("id, name, sku_map, settings, source_store_id, target_store_id")
    .eq("id", routeId)
    .eq("user_id", user.id)
    .single();

  if (configError || !config) {
    return NextResponse.json({ error: "Rota nao encontrada." }, { status: 404 });
  }

  // "Testar agora" e o que o lojista faz depois de dar read_orders ao app:
  // reconfere ja os avisos da Shopify que estavam faltando nesta rota (os que
  // ja estao ligados seguem a conferencia diaria). Depois da resposta.
  depoisDaResposta(() =>
    conferirWebhooks(createAdminClient(), { rotaId: routeId, reconferirPendentes: true }).then(
      () => undefined,
      (e) => console.warn("[health] webhooks do sensor:", e instanceof Error ? e.message : e)
    )
  );

  const { data: todosAlvos } = await supabase
    .from("routed_checkout_targets")
    .select("id, target_store_id, sku_map, enabled, settings")
    .eq("route_id", routeId)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  const alvosLigados = (todosAlvos || []).filter((alvo) => alvo.enabled !== false);
  const alvo = targetIdPedido
    ? (todosAlvos || []).find((item) => item.id === targetIdPedido)
    : alvosLigados[0];

  if (targetIdPedido && !alvo) {
    return NextResponse.json(
      { error: "Loja de checkout nao encontrada nesta rota." },
      { status: 404 }
    );
  }

  // Rota legada sem linha de destino: cai nas colunas da propria rota.
  const targetStoreId = alvo?.target_store_id || config.target_store_id;
  const skuMapDoAlvo = (alvo ? alvo.sku_map : config.sku_map) || {};

  const { data: stores } = await supabase
    .from("stores")
    .select("id, name, shop_domain, client_id, client_secret, access_token, target_language")
    .in("id", [config.source_store_id, targetStoreId]);

  const sourceStore = stores?.find((store) => store.id === config.source_store_id);
  const targetStore = stores?.find((store) => store.id === targetStoreId);
  if (!sourceStore || !targetStore) {
    return NextResponse.json({ error: "Vitrine ou loja checkout nao encontrada." }, { status: 404 });
  }

  const sourceCreds: ShopifyCredentials = {
    shopDomain: sourceStore.shop_domain,
    clientId: sourceStore.client_id,
    clientSecret: sourceStore.client_secret,
    accessToken: sourceStore.access_token,
  };
  const targetCreds: ShopifyCredentials = {
    shopDomain: targetStore.shop_domain,
    clientId: targetStore.client_id,
    clientSecret: targetStore.client_secret,
    accessToken: targetStore.access_token,
  };

  // Antes de qualquer coisa: as duas lojas respondem?
  //
  // Rota apontando para loja congelada/desinstalada e o pior estado possivel —
  // o painel mostrava tudo verde enquanto todo cliente que clicava em
  // finalizar caia num checkout que nao carrega. Sem esta checagem, a leitura
  // do catalogo abaixo explodiria com um erro cru de API.
  const lojas = await verificarParDaRota(sourceCreds, targetCreds);
  if (!lojas.ok) {
    return NextResponse.json({
      ok: false,
      checkedAt: new Date().toISOString(),
      storeIssue: {
        message: lojas.mensagem,
        source: lojas.source.ok ? null : lojas.source,
        target: lojas.target.ok ? null : lojas.target,
      },
      totalSourceSkus: 0,
      noSkuCount: 0,
      sourceVariantCount: 0,
      coveragePercent: 0,
      mappedCount: 0,
      missingCount: 0,
      missingSkus: [],
      wrongCount: 0,
      wrongSkus: [],
      fallbackCount7d: 0,
      loaderReady7d: 0,
      routedOk7d: 0,
      fallbackByReason: {},
      recentFallbacks: [],
    });
  }

  try {
    const [sourceVariants, targetVariants] = await Promise.all([
      getAllVariants(sourceCreds),
      getAllVariants(targetCreds),
    ]);

    const targetSkuIndex = new Map<string, string>(); // lowercase sku -> numeric variant id
    for (const variant of targetVariants) {
      if (variant.sku) {
        const key = variant.sku.toLowerCase();
        if (!targetSkuIndex.has(key)) {
          const id = numericId(variant.id);
          if (id) targetSkuIndex.set(key, id);
        }
      }
    }

    const skuMap = skuMapDoAlvo as Record<string, string | number>;

    const missingSkus: string[] = [];
    const wrongSkus: { sku: string; expectedVariantId: string | null; mappedVariantId: string }[] = [];
    let checkedCount = 0;

    // Variante sem SKU nunca entra no mapa e nunca roteia. Antes ela era
    // simplesmente pulada, e a rota aparecia como 100% saudavel enquanto a
    // maior parte do trafego caia no checkout da vitrine.
    let noSkuCount = 0;

    for (const variant of sourceVariants) {
      if (!variant.sku) {
        noSkuCount += 1;
        continue;
      }
      checkedCount += 1;
      const mapped = skuMap[variant.sku];
      if (mapped === undefined) {
        missingSkus.push(variant.sku);
        continue;
      }
      const expected = targetSkuIndex.get(variant.sku.toLowerCase()) || null;
      const mappedId = numericId(mapped);
      if (expected && mappedId && expected !== mappedId) {
        wrongSkus.push({ sku: variant.sku, expectedVariantId: expected, mappedVariantId: mappedId });
      }
    }

    // Ultimos 7 dias de fallback pro checkout nativo (vitrine sem como
    // cobrar): da visibilidade de quanto e por que a rota esta falhando no
    // momento do clique, em vez de so o mapa estar correto em si.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: fallbacks } = await supabase
      .from("routed_checkout_fallbacks")
      .select("reason, detail, created_at")
      .eq("route_config_id", config.id)
      .gte("created_at", sevenDaysAgo)
      .order("created_at", { ascending: false })
      .limit(200);

    // O loader usa a mesma tabela para sinal de vida e sucesso; so a coluna
    // reason distingue. Contar tudo como "fallback" mostrava 43 falhas numa
    // rota que nao tinha falhado nenhuma vez.
    const EVENTOS_DE_SUCESSO = new Set(["loader_ready", "routed_ok"]);

    const fallbackByReason: Record<string, number> = {};
    let loaderReady = 0;
    let routedOk = 0;
    for (const item of fallbacks || []) {
      if (item.reason === "loader_ready") loaderReady += 1;
      else if (item.reason === "routed_ok") routedOk += 1;
      else fallbackByReason[item.reason] = (fallbackByReason[item.reason] || 0) + 1;
    }
    const falhasReais = (fallbacks || []).filter(
      (f) => !EVENTOS_DE_SUCESSO.has(f.reason)
    );

    // Pais efetivo do checkout desta loja: o ajuste do DESTINO (o que o
    // resolve usa; rota legada sem linha le o da rota), senao o do idioma da
    // loja. "Pais do comprador" nao tem pais: confere so se ha alguma tarifa.
    const ajuste = lerAjusteDeMercado(alvo ? alvo.settings : config.settings);
    const marketCountry =
      ajuste.modo === "fixo"
        ? (ajuste.country ?? null)
        : ajuste.modo === "comprador"
          ? null
          : countryFromLanguage(targetStore.target_language);
    const shipping = await checkShipping(targetCreds, marketCountry);

    const ok =
      missingSkus.length === 0 &&
      wrongSkus.length === 0 &&
      noSkuCount === 0 &&
      shipping.ok;

    return NextResponse.json({
      ok,
      shipping,
      checkedAt: new Date().toISOString(),
      // Qual loja de checkout este resultado descreve. Sem isso, uma rota com
      // rodizio mostraria um numero de cobertura sem dizer de quem ele e.
      checkedTargetId: alvo?.id ?? null,
      checkedTargetName: targetStore.name || targetStore.shop_domain,
      checkedTargetDomain: targetStore.shop_domain,
      targetCount: alvosLigados.length,
      totalSourceSkus: checkedCount,
      noSkuCount,
      sourceVariantCount: sourceVariants.length,
      coveragePercent:
        sourceVariants.length > 0
          ? Math.round(
              ((checkedCount - missingSkus.length) / sourceVariants.length) * 100
            )
          : 100,
      mappedCount: checkedCount - missingSkus.length,
      missingCount: missingSkus.length,
      missingSkus: missingSkus.slice(0, 50),
      wrongCount: wrongSkus.length,
      wrongSkus: wrongSkus.slice(0, 50),
      fallbackCount7d: falhasReais.length,
      fallbackByReason,
      recentFallbacks: falhasReais.slice(0, 10),
      // Funil do loader: quantas sessoes viram o script e quantas chegaram a
      // rotear. A diferenca e o vazamento — cliente que clicou em finalizar e
      // nao foi redirecionado.
      loaderReady7d: loaderReady,
      routedOk7d: routedOk,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Falha ao verificar a rota.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
