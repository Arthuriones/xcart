import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { accessControlEnabled, profileHasAccess } from "@/lib/billing/access";
import { COLUNAS_REGRA, fecharPassada, rodarRegra, tabelaAusente, type LinhaRegra } from "@/lib/ads/regras-banco";
import { proximaExecucao } from "@/lib/ads/gerenciar-regras";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Cron das regras automaticas (plano-de-acao/03): 10,25,40,55 -- 5 min depois
// do sync do Meta (5,20,35,50), com o gasto e o IC frescos.
//
// Pega as regras ativas vencidas (proxima_execucao_em <= agora), as mais
// atrasadas primeiro. Cada uma e REIVINDICADA antes de rodar: o update so
// passa se proxima_execucao_em ainda e a lida -- duas execucoes sobrepostas
// nao rodam a mesma regra. Dono sem plano: a regra nao roda (fica para o
// proximo intervalo, sem ser desligada).
// ============================================================================

const ORCAMENTO_MS = 240_000;
const MAX_REGRAS_POR_PASSADA = 60;

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

const COLUNAS_PERFIL =
  "id, is_admin, plan, access_granted, free_clone_store_id, payment_provider, pagou_subscription_id, abacatepay_subscription_id, subscription_status, current_period_end";

export async function GET(request: NextRequest) {
  if (!cronAutorizado(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const inicio = Date.now();
  const db = createAdminClient();

  const { data, error } = await db
    .from("ad_regras")
    .select(COLUNAS_REGRA)
    .eq("ativa", true)
    .lte("proxima_execucao_em", new Date(inicio).toISOString())
    .order("proxima_execucao_em", { ascending: true })
    .limit(MAX_REGRAS_POR_PASSADA);
  if (error) {
    if (tabelaAusente(error.code)) return NextResponse.json({ ok: true, rodadas: 0, motivo: "sem a 087" });
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  const linhas = (data ?? []) as LinhaRegra[];

  // Plano de cada dono, uma leitura so.
  const donos = [...new Set(linhas.map((l) => l.user_id))];
  const comPlano = new Set<string>();
  if (!accessControlEnabled()) {
    donos.forEach((d) => comPlano.add(d));
  } else if (donos.length) {
    const { data: perfis } = await db.from("profiles").select(COLUNAS_PERFIL).in("id", donos);
    for (const p of (perfis ?? []) as (Parameters<typeof profileHasAccess>[0] & { id: string })[]) {
      if (profileHasAccess(p)) comPlano.add(p.id);
    }
  }

  let rodadas = 0;
  let acoes = 0;
  let puladas = 0;
  for (const linha of linhas) {
    if (Date.now() - inicio > ORCAMENTO_MS) break;
    const agora = Date.now();
    // Reivindica: so quem ainda ve o mesmo proxima_execucao_em leva a regra.
    const { data: levou } = await db
      .from("ad_regras")
      .update({ proxima_execucao_em: proximaExecucao(agora, linha.intervalo_minutos) })
      .eq("id", linha.id)
      .eq("proxima_execucao_em", linha.proxima_execucao_em)
      .select("id");
    if (!levou || levou.length === 0) continue;
    if (!comPlano.has(linha.user_id)) {
      puladas += 1;
      continue;
    }
    try {
      const resultado = await rodarRegra(db, linha, { simular: false, agoraMs: agora });
      await fecharPassada(db, linha, resultado, agora);
      rodadas += 1;
      acoes += resultado.acoes.filter((a) => a.ok && a.acao !== "avisar").length;
    } catch (e) {
      console.error("[jobs/ads/regras] regra falhou", linha.id, e instanceof Error ? e.message : e);
      await fecharPassada(
        db,
        linha,
        {
          quando: new Date(agora).toISOString(),
          julgados: 0,
          acoes: [],
          ignorados: [],
          cortados: 0,
          avisos: ["Falha inesperada nesta passada; tento de novo no próximo intervalo."],
        },
        agora
      );
    }
  }

  return NextResponse.json({ ok: true, rodadas, acoes, puladas, total: linhas.length });
}
