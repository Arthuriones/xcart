import { NextRequest, NextResponse } from "next/server";
import { healRoute, HealRouteError } from "@/lib/checkout-routes/heal";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Auto-conserto das rotas ligadas.
//
// Uma rota nao quebra de uma vez: ela apodrece. O lojista cadastra um produto
// na mao no Shopify, ele nasce sem SKU e fica fora do mapa; ninguem percebe
// porque a vitrine continua vendendo — so que pelo checkout errado. Foi assim
// que uma conta chegou a 27% de cobertura sem nenhum alarme.
//
// Este job roda de hora em hora e passa o mesmo conserto que o botao "Corrigir"
// faz, comecando pelas rotas ha mais tempo sem revisao.
// ============================================================================

// Cada rota le o catalogo inteiro das duas lojas. Poucas por execucao, para
// caber nos 300s da funcao — com o rodizio por last_healed_at, uma loja com 20
// rotas fecha o ciclo em menos de um dia.
const ROTAS_POR_EXECUCAO = 4;

function segredoDoCron() {
  return process.env.CRON_SECRET || process.env.BULK_IMPORT_CRON_SECRET || "";
}

function cronAutorizado(request: NextRequest) {
  const esperado = segredoDoCron();
  if (!esperado) return false;
  return (
    request.headers.get("authorization") === `Bearer ${esperado}` ||
    request.headers.get("x-cron-secret") === esperado
  );
}

async function executar(request: NextRequest) {
  const isCron = cronAutorizado(request);

  // Sem segredo de cron: exige sessao e so mexe nas rotas do proprio usuario.
  let userId: string | undefined;
  if (!isCron) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    userId = user.id;
  }

  const limite = Math.min(
    Math.max(
      Number(request.nextUrl.searchParams.get("limit") || ROTAS_POR_EXECUCAO),
      1
    ),
    10
  );

  const admin = createAdminClient();

  // A unidade de conserto agora e o DESTINO, nao a rota: com rodizio, uma rota
  // tem varias lojas de checkout e cada uma tem o seu mapa para apodrecer. Uma
  // fila por rota consertaria sempre a mesma loja.
  const query = admin
    .from("routed_checkout_targets")
    .select(
      "id, route_id, last_healed_at, route:route_id(id, name, user_id, enabled)"
    )
    .eq("enabled", true)
    // nullsFirst: destino nunca revisado tem prioridade sobre o revisado ontem.
    .order("last_healed_at", { ascending: true, nullsFirst: true })
    // Folga no limite porque a filtragem de rota desligada/de outro dono
    // acontece abaixo, ja com as linhas em maos.
    .limit(limite * 4);

  const { data: linhas, error } = await query;
  if (error) {
    return NextResponse.json(
      { error: "Falha ao listar destinos." },
      { status: 500 }
    );
  }

  interface LinhaDestino {
    id: string;
    route_id: string;
    route?: { id: string; name: string; user_id: string; enabled: boolean } |
      { id: string; name: string; user_id: string; enabled: boolean }[] | null;
  }

  const alvos = ((linhas || []) as LinhaDestino[])
    .map((linha) => {
      const rota = Array.isArray(linha.route) ? linha.route[0] : linha.route;
      return rota ? { targetId: linha.id, rota } : null;
    })
    .filter(
      (item): item is { targetId: string; rota: { id: string; name: string; user_id: string; enabled: boolean } } =>
        Boolean(item && item.rota.enabled && (!userId || item.rota.user_id === userId))
    )
    .slice(0, limite);

  const resultados: Record<string, unknown>[] = [];
  for (const alvo of alvos) {
    try {
      const r = await healRoute({
        routeId: alvo.rota.id,
        targetId: alvo.targetId,
        origin: request.nextUrl.origin,
      });
      resultados.push({
        routeId: alvo.rota.id,
        targetId: alvo.targetId,
        name: alvo.rota.name,
        ...(r.noop
          ? { noop: true }
          : {
              stampedSkuCount: r.stampedSkuCount,
              dedupedSkuCount: r.dedupedSkuCount,
              fixedWrongCount: r.fixedWrongCount,
              extendedCount: r.extendedCount,
              createdProductCount: r.createdProductCount,
              imageQueueCount: r.imageQueueCount,
            }),
      });
    } catch (erro) {
      // Um destino quebrado (loja desconectada, token expirado) nao pode
      // impedir o conserto dos outros.
      const msg =
        erro instanceof HealRouteError || erro instanceof Error
          ? erro.message
          : "erro desconhecido";
      resultados.push({
        routeId: alvo.rota.id,
        targetId: alvo.targetId,
        name: alvo.rota.name,
        error: msg,
      });
      // Marca a tentativa para o destino nao travar a fila para sempre.
      await admin
        .from("routed_checkout_targets")
        .update({ last_healed_at: new Date().toISOString() })
        .eq("id", alvo.targetId);
    }
  }

  const consertadas = resultados.filter((r) => !r.noop && !r.error).length;

  // Retencao dos eventos do loader, so na passada do cron.
  //
  // routed_checkout_fallbacks e a maior tabela do banco e cresce com o TRAFEGO
  // -- loader_ready sai uma vez por sessao de comprador e ja e 92% dela. Sem
  // poda ela cresce para sempre e leva junto a consulta de carrinhos roteados,
  // que roda em toda carga da tela de roteamento.
  //
  // Pendurado aqui porque este job ja roda de hora em hora e ja e o dono da
  // manutencao das rotas: uma tabela de cron a menos para configurar. Falhar a
  // poda NAO pode derrubar o conserto, que e o que mantem a venda de pe.
  let purgados: number | null = null;
  if (isCron) {
    const { data, error: erroPurga } = await admin.rpc(
      "purge_routed_checkout_fallbacks"
    );
    if (erroPurga) {
      console.warn("[heal] purga de eventos falhou:", erroPurga.message);
    } else {
      purgados = typeof data === "number" ? data : 0;
    }
  }

  return NextResponse.json({
    checked: resultados.length,
    repaired: consertadas,
    ...(purgados !== null ? { purgedEvents: purgados } : {}),
    results: resultados,
  });
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
