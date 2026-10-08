import { NextRequest, NextResponse } from "next/server";
import {
  healRoute,
  HealBusyError,
  HealRouteError,
  registrarFalhaDoConserto,
} from "@/lib/checkout-routes/heal";
import { cronPodeTentar } from "@/lib/checkout-routes/loja-fora-do-ar";
import { conferirWebhooks } from "@/lib/checkout-routes/sensores";
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

/**
 * Quantos destinos a fila le de uma vez. O que esta esperando (loja fora do
 * ar, ver loja-fora-do-ar.ts) sai depois da leitura; com folga, a vaga vai
 * para o proximo da fila em vez de ficar vazia.
 */
const JANELA_DA_FILA = 100;

// Os webhooks do sensor (orders/create no checkout, checkouts/create na
// vitrine) sao conferidos no fim da passada, no maximo 1x por dia por loja.
// Poucas lojas por execucao e so se o conserto deixou folga nos 300 s: sao 1
// a 3 chamadas por loja, e a fila por data da ultima conferencia fecha o
// ciclo de todas as lojas em poucas horas.
const LOJAS_DO_SENSOR_POR_EXECUCAO = 6;
const FOLGA_PARA_O_SENSOR_MS = 200_000;

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
  const inicio = Date.now();
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
  //
  // Primeiro as rotas LIGADAS, depois os destinos delas. A fila lia os
  // destinos ligados e tirava a rota desligada depois, ja com o limite
  // aplicado: destino de rota pausada nunca e consertado, entao o
  // last_healed_at dele nunca anda e ele ficava para sempre na cabeca da
  // fila, ocupando as vagas de quem precisava.
  let rotasQuery = admin
    .from("routed_checkout_configs")
    .select("id, name, user_id")
    .eq("enabled", true);
  if (userId) rotasQuery = rotasQuery.eq("user_id", userId);
  const { data: rotasLigadas, error: erroRotas } = await rotasQuery;
  if (erroRotas) {
    return NextResponse.json({ error: "Falha ao listar rotas." }, { status: 500 });
  }
  const rotaPorId = new Map(
    ((rotasLigadas || []) as { id: string; name: string; user_id: string }[]).map((r) => [r.id, r])
  );

  let linhas: { id: string; route_id: string; settings?: unknown }[] = [];
  if (rotaPorId.size > 0) {
    const { data, error } = await admin
      .from("routed_checkout_targets")
      .select("id, route_id, last_healed_at, settings")
      .eq("enabled", true)
      .in("route_id", [...rotaPorId.keys()])
      // nullsFirst: destino nunca revisado tem prioridade sobre o revisado ontem.
      .order("last_healed_at", { ascending: true, nullsFirst: true })
      // Folga porque o destino com loja fora do ar (pausada pela Shopify, sem
      // o app, vitrine com senha) sai abaixo ate a espera dele vencer.
      .limit(JANELA_DA_FILA);
    if (error) {
      return NextResponse.json(
        { error: "Falha ao listar destinos." },
        { status: 500 }
      );
    }
    linhas = (data || []) as typeof linhas;
  }

  const agora = Date.now();
  const prontas = linhas.filter((linha) => cronPodeTentar(linha.settings, agora));
  const esperando = linhas.length - prontas.length;
  const alvos = prontas
    .map((linha) => {
      const rota = rotaPorId.get(linha.route_id);
      return rota ? { targetId: linha.id, rota } : null;
    })
    .filter((item): item is { targetId: string; rota: { id: string; name: string; user_id: string } } =>
      Boolean(item)
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
              // Faltando e NAO criado: a trava do par de lojas segurou (peso
              // 0, rota pausada, cobertura baixa ou leva grande).
              ...(r.creationBlockedReason
                ? {
                    pendingProductCount: r.pendingProductCount,
                    creationBlockedReason: r.creationBlockedReason,
                  }
                : {}),
              theme: r.theme?.estado,
            }),
      });
    } catch (erro) {
      // Um destino quebrado (loja desconectada, token expirado) nao pode
      // impedir o conserto dos outros.
      // Destino ja reservado por outra execucao nao e falha: e a trava
      // funcionando. Vai para o resultado como "ocupado" e a fila segue.
      if (erro instanceof HealBusyError) {
        resultados.push({
          routeId: alvo.rota.id,
          targetId: alvo.targetId,
          name: alvo.rota.name,
          ocupado: true,
        });
        continue;
      }
      const msg =
        erro instanceof HealRouteError || erro instanceof Error
          ? erro.message
          : "erro desconhecido";
      resultados.push({
        routeId: alvo.rota.id,
        targetId: alvo.targetId,
        name: alvo.rota.name,
        error: msg,
        // Loja pausada/sem app/vitrine com senha: o conserto gravou o motivo
        // e a proxima tentativa no destino; a fila pula ele ate la.
        ...(erro instanceof HealRouteError && erro.foraDoAr
          ? { foraDoAr: erro.foraDoAr.motivo, lado: erro.foraDoAr.lado }
          : {}),
      });
      // Marca a tentativa para o destino nao travar a fila para sempre.
      await admin
        .from("routed_checkout_targets")
        .update({ last_healed_at: new Date().toISOString() })
        .eq("id", alvo.targetId);
      // A falha entra no last_heal (e nas falhas seguidas que o alerta
      // "Conserto da rota falhando" le), a nao ser que o conserto ja tenha
      // gravado esta mesma passada antes de lancar.
      if (!(erro instanceof HealRouteError && erro.registrado)) {
        await registrarFalhaDoConserto(admin, alvo.rota.id, msg).catch((e) =>
          console.warn("[heal] nao gravei a falha do conserto:", e instanceof Error ? e.message : e)
        );
      }
    }
  }

  // Sensor: os avisos da Shopify que contam pedido e escape. So no cron, e so
  // com folga -- o conserto e o que mantem a venda de pe e vem primeiro.
  let webhooks: Awaited<ReturnType<typeof conferirWebhooks>> | null = null;
  if (isCron && Date.now() - inicio < FOLGA_PARA_O_SENSOR_MS) {
    try {
      webhooks = await conferirWebhooks(admin, { limiteLojas: LOJAS_DO_SENSOR_POR_EXECUCAO });
    } catch (e) {
      console.warn("[heal] conferencia dos webhooks falhou:", e instanceof Error ? e.message : e);
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
    // Destinos pulados nesta passada: loja fora do ar, esperando a hora.
    waiting: esperando,
    ...(purgados !== null ? { purgedEvents: purgados } : {}),
    ...(webhooks ? { webhooks } : {}),
    results: resultados,
  });
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
