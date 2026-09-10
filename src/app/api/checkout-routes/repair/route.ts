import { NextRequest, NextResponse } from "next/server";
import {
  healRoute,
  HealBusyError,
  HealRouteError,
  type HealRouteResult,
} from "@/lib/checkout-routes/heal";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// Conserto manual de uma rota, disparado pelo botao "Corrigir".
// A logica mora em @/lib/checkout-routes/heal porque o cron roda a mesma coisa
// sozinho de hora em hora (ver /api/jobs/routes/heal).
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
    return NextResponse.json(
      { error: "Id da rota e obrigatorio." },
      { status: 400 }
    );
  }

  // O botao conserta a rota INTEIRA: com rodizio ela tem varias lojas de
  // checkout, e consertar so a primeira deixaria o comprador sorteado para as
  // outras caindo em mapa velho -- exatamente o problema que o botao existe
  // para resolver.
  const { data: alvos } = await supabase
    .from("routed_checkout_targets")
    .select("id")
    .eq("route_id", routeId)
    .eq("enabled", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  // Sem linha de destino (rota legada): uma passada sem targetId, que cai nas
  // colunas da propria rota.
  const targetIds: (string | undefined)[] =
    alvos && alvos.length > 0 ? alvos.map((alvo) => alvo.id) : [undefined];

  try {
    const results: HealRouteResult[] = [];
    for (const targetId of targetIds) {
      results.push(
        await healRoute({
          routeId,
          targetId,
          // Escopo do dono: healRoute filtra por user_id, entao rota de outro
          // usuario devolve 404 em vez de ser consertada.
          userId: user.id,
          origin: request.nextUrl.origin,
          cookie: request.headers.get("cookie") || "",
        })
      );
    }

    // O primeiro resultado continua no topo do payload para nao quebrar a UI
    // que le r.stampedSkuCount e companhia direto da raiz.
    const soma = (pick: (r: HealRouteResult) => number) =>
      results.reduce((total, r) => total + (pick(r) || 0), 0);

    return NextResponse.json({
      ...results[0],
      targetCount: results.length,
      targets: results,
      // Totais somados: com varios destinos, o numero de um so engana.
      stampedSkuCount: soma((r) => r.stampedSkuCount),
      dedupedSkuCount: soma((r) => r.dedupedSkuCount),
      fixedWrongCount: soma((r) => r.fixedWrongCount),
      extendedCount: soma((r) => r.extendedCount),
      createdProductCount: soma((r) => r.createdProductCount),
      createdVariantCount: soma((r) => r.createdVariantCount),
      imageQueueCount: soma((r) => r.imageQueueCount),
      warnings: results.flatMap((r) => r.warnings),
      noop: results.every((r) => r.noop),
    });
  } catch (error) {
    // O cron pegou este destino primeiro. 409 e nao 500: nao houve falha, so
    // nao da para consertar duas vezes ao mesmo tempo -- e o comprador nao
    // perde nada esperando o conserto que ja esta rodando terminar.
    if (error instanceof HealBusyError) {
      return NextResponse.json(
        {
          error:
            "Esta loja de checkout ja esta sendo conferida agora (conserto automatico). Tente de novo em alguns minutos.",
        },
        { status: 409 }
      );
    }
    if (error instanceof HealRouteError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status }
      );
    }
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Falha ao corrigir a rota.",
      },
      { status: 500 }
    );
  }
}
