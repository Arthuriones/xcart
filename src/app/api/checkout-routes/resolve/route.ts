import { NextRequest, NextResponse, after } from "next/server";
import { normalizarLinhas } from "@/lib/checkout-routes/linhas";
import { buildCartPermalink, normalizarCupons } from "@/lib/shopify/cart-routing";
import { mercadoDoDestino } from "@/lib/checkout-routes/mercado";
import {
  computeCoverage,
  normalizeRotation,
  pickTarget,
  type RouteTarget,
} from "@/lib/checkout-routes/rotation";
import { destinosParaRotear, RouteTargetsLoadError } from "@/lib/checkout-routes/targets";
import { createAdminClient } from "@/lib/supabase/admin";
import { contarPedidos24h } from "@/lib/checkout-routes/pedidos-24h";
import { hydrateTargetBySku } from "@/lib/checkout-routes/hidratar-por-sku";

export const runtime = "nodejs";
// A resposta sai dentro do orcamento de hidratacao (bem antes do prazo do
// loader); o resto e a leitura do indice de SKU que estourou o orcamento e
// segue por `after` para aquecer o cache. 60 s cobrem as 20 paginas do
// products.json com folga e limitam o que um endpoint publico pode gastar.
export const maxDuration = 60;

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
  // Cupom aplicado no carrinho da vitrine. So o codigo, validado (curto, sem
  // virgula, ate 5); nao entra no sorteio nem na cobertura.
  const discountCodes = normalizarCupons(body.discountCodes);

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

    // Destinos do rodizio. Rota sem NENHUMA linha de destino (apagada a mao)
    // cai no destino legado da propria rota em vez de derrubar o checkout;
    // rota com todas as lojas pausadas nao roteia (ver destinosParaRotear).
    const targets: RouteTarget[] = await destinosParaRotear(supabase, config);
    if (targets.length === 0) {
      return NextResponse.json(
        { error: "Rota sem loja de checkout ligada." },
        { status: 409, headers: corsHeaders }
      );
    }

    const { strategy } = normalizeRotation(config.rotation);

    // Fallback por SKU no products.json publico: cobre variante que ainda nao
    // entrou no mapa. Roda ANTES do sorteio, senao um destino com o mapa
    // desatualizado pareceria ter cobertura pior do que realmente tem e o
    // rodizio o excluiria por um motivo que nao existe.
    //
    // Com orcamento (ver hidratar-por-sku): leitura que nao cabe nele segue
    // depois da resposta, para a proxima tentativa achar o indice pronto.
    const enriched = await Promise.all(
      targets.map(async (target) =>
        hydrateTargetBySku(target, lines, {
          continuarDepois: (leitura) => after(() => leitura),
        })
      )
    );

    // Teto de pedidos por dia: a contagem so e lida quando algum destino tem.
    const pedidos24h = enriched.some((t) => t.dailyLimit)
      ? await contarPedidos24h(supabase, enriched.map((t) => t.targetStoreId))
      : undefined;

    const pick = pickTarget(enriched, lines, { rotationKey, strategy, pedidos24h });

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

    // Pais/idioma do DESTINO sorteado (settings dele), igual ao embed-config.
    const market = mercadoDoDestino(target.settings, target.targetLanguage);

    // Sem atributos de carrinho aqui de proposito -- ver buildCartPermalink.
    // O cupom vai: e o codigo, nao o valor (buildCartPermalink revalida).
    const redirectUrl = buildCartPermalink(target.domain, resolvedLines, market, {
      discountCodes,
    });

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
    // Endpoint publico: a mensagem crua (erro do banco, da Shopify) fica no
    // log; o navegador do comprador so precisa saber que falhou.
    console.error("[checkout-routes/resolve]", error);
    // Nao deu para ler as lojas de checkout: 503, e NAO o destino legado.
    // Rotear pelo legado num soluco do banco mandava o comprador para o mapa
    // velho do primario -- talvez a loja que o lojista pausou.
    if (error instanceof RouteTargetsLoadError) {
      return NextResponse.json(
        { error: "Checkout indisponivel agora. Tente de novo." },
        { status: 503, headers: corsHeaders }
      );
    }
    return NextResponse.json(
      { error: "Falha ao resolver checkout." },
      { status: 500, headers: corsHeaders }
    );
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
