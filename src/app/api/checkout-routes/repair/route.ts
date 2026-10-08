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
  // Uma loja de checkout so. E obrigatorio para confirmar a criacao numa
  // rota com mais de uma loja (ver abaixo).
  const targetIdPedido =
    typeof body.targetId === "string" && body.targetId ? body.targetId : null;
  // O lojista viu "N produtos faltam em LOJA X" e confirmou. Sem isto o
  // conserto so cria quando o par de lojas passa na trava (conserto-regras.ts).
  const criarFaltantes = body.criarFaltantes === true;
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
  const { data: alvos, error: alvosError } = await supabase
    .from("routed_checkout_targets")
    .select("id")
    .eq("route_id", routeId)
    .eq("enabled", true)
    .order("position", { ascending: true })
    .order("id", { ascending: true });
  if (alvosError) {
    return NextResponse.json(
      { error: "Não deu para ler as lojas de checkout da rota agora. Tente de novo." },
      { status: 503 }
    );
  }

  // Sem linha de destino (rota legada): uma passada sem targetId, que cai nas
  // colunas da propria rota.
  let targetIds: (string | undefined)[] =
    alvos && alvos.length > 0 ? alvos.map((alvo) => alvo.id) : [undefined];

  if (targetIdPedido) {
    if (!alvos?.some((alvo) => alvo.id === targetIdPedido)) {
      return NextResponse.json(
        { error: "Loja de checkout não encontrada nesta rota, ou está pausada." },
        { status: 404 }
      );
    }
    targetIds = [targetIdPedido];
  }

  // A confirmacao vale para UMA loja: a que o lojista viu na tela. Antes ela
  // ia para todas as lojas ligadas -- e "Criar 40 produtos", visto na loja
  // certa, despejava a vitrine tambem na loja de peso 0 que entrou por
  // "Adicionar loja" com 55% de cobertura (a reclamacao 4 da NORAH). Com uma
  // loja so (assistente, rota de um destino), nao ha o que escolher.
  if (criarFaltantes && targetIds.length !== 1) {
    return NextResponse.json(
      { error: "Diga em qual loja de checkout criar os produtos (targetId)." },
      { status: 400 }
    );
  }

  try {
    const results: HealRouteResult[] = [];
    // Loja de checkout pausada pela Shopify ou sem o app: com rodizio, ela
    // nao impede o conserto das outras. Uma loja so (ou todas fora) = erro.
    const lojasForaDoAr: { targetId: string | null; motivo: string; lado: string; mensagem: string }[] = [];
    let primeiroErro: unknown = null;
    for (const targetId of targetIds) {
      try {
        results.push(
          await healRoute({
            routeId,
            targetId,
            // Escopo do dono: healRoute filtra por user_id, entao rota de outro
            // usuario devolve 404 em vez de ser consertada.
            userId: user.id,
            origin: request.nextUrl.origin,
            cookie: request.headers.get("cookie") || "",
            criarFaltantes,
          })
        );
      } catch (erro) {
        if (targetIds.length > 1 && erro instanceof HealRouteError && erro.foraDoAr) {
          primeiroErro = primeiroErro || erro;
          lojasForaDoAr.push({
            targetId: targetId ?? null,
            motivo: erro.foraDoAr.motivo,
            lado: erro.foraDoAr.lado,
            mensagem: erro.message,
          });
          continue;
        }
        throw erro;
      }
    }
    if (results.length === 0) throw primeiroErro;

    // O primeiro resultado continua no topo do payload para nao quebrar a UI
    // que le r.stampedSkuCount e companhia direto da raiz.
    const soma = (pick: (r: HealRouteResult) => number | undefined) =>
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
      removedPairCount: soma((r) => r.removedPairCount),
      mixedBlockedVariantCount: soma((r) => r.mixedBlockedVariantCount),
      createdProductCount: soma((r) => r.createdProductCount),
      createdVariantCount: soma((r) => r.createdVariantCount),
      imageQueueCount: soma((r) => r.imageQueueCount),
      // Somados so para o resumo. A tela confirma pela pendencia de CADA
      // loja (targets[]), com o targetId dela.
      pendingProductCount: soma((r) => r.pendingProductCount),
      pendingVariantCount: soma((r) => r.pendingVariantCount),
      creationBlockedReason:
        results.find((r) => r.creationBlockedReason)?.creationBlockedReason ?? null,
      // O ultimo reenvio ao tema e o que vale: cada passada compara o config
      // inteiro da rota.
      theme: results[results.length - 1]?.theme,
      warnings: [...lojasForaDoAr.map((l) => l.mensagem), ...results.flatMap((r) => r.warnings)],
      lojasForaDoAr,
      noop: results.every((r) => r.noop) && lojasForaDoAr.length === 0,
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
