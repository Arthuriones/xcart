import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdAccountRow, AdSpendDailyRow } from "@/lib/financeiro/tipos";
import { RE_MOEDA } from "@/lib/financeiro/tipos";
import {
  ErroGraph,
  buscarConta,
  buscarInsightsDetalhado,
} from "@/lib/ads/meta-graph";
import {
  classificarErroMeta,
  deduplicarLinhas,
  deveBuscarCampanha,
  janelaDeSync,
  linhasDeInsights,
  niveisParaLimpar,
  preencherDiasConta,
  type ContextoLinhas,
  type InsightMeta,
} from "@/lib/ads/meta-mapear";

// ============================================================================
// Sincroniza o gasto de UMA conta do Meta em ad_spend_daily.
//
// Quem trava a conta (sincronizando_desde) e trata o erro e o job; aqui so o
// caminho feliz. Idempotente: rodar duas vezes grava o mesmo resultado.
// ============================================================================

const LOTE = 500;

export async function sincronizarContaMeta(
  admin: SupabaseClient,
  conta: AdAccountRow,
  token: string,
  agora: Date
): Promise<{ linhas: number }> {
  const agoraIso = agora.toISOString();
  let fuso = conta.fuso;
  let moeda = conta.moeda;

  // 1-2) No reprocesso relemos a conta: o lojista pode ter trocado fuso ou
  // moeda no Gerenciador, e a primeira rodada (sem fuso ainda) precisa dele
  // para cortar o "hoje" no lugar certo.
  const reprocesso = janelaDeSync(conta, agora).reprocesso;
  if (reprocesso) {
    const info = await buscarConta(conta.external_id, token);
    fuso = info.fuso ?? fuso;
    moeda = info.moeda ?? moeda;
    const { error } = await admin
      .from("ad_accounts")
      .update({
        nome: info.nome ?? conta.nome,
        moeda,
        fuso,
        status_externo: info.status,
        updated_at: agoraIso,
      })
      .eq("id", conta.id);
    if (error) throw new Error(`falha ao atualizar a conta: ${error.message}`);
  }
  // Recalcula com o fuso que acabou de chegar.
  const janela = janelaDeSync({ fuso, ultimo_reprocesso_em: conta.ultimo_reprocesso_em }, agora);

  // 3) Total da conta primeiro: e a verdade do gasto (inclui anuncio apagado).
  const total = await buscarInsightsDetalhado(
    conta.external_id,
    token,
    janela.desde,
    janela.ate,
    "account"
  );

  // 7) Cota quase no fim: pula o detalhe nesta rodada.
  let campanhaBuscada = deveBuscarCampanha(total.throttle);
  let rowsCampanha: InsightMeta[] = [];
  if (campanhaBuscada) {
    try {
      rowsCampanha = (
        await buscarInsightsDetalhado(conta.external_id, token, janela.desde, janela.ate, "campaign")
      ).rows;
    } catch (e) {
      // Limite no detalhe nao pode custar o total que ja chegou.
      if (e instanceof ErroGraph && classificarErroMeta(e.codigo) === "limite") {
        campanhaBuscada = false;
        rowsCampanha = [];
      } else {
        throw e;
      }
    }
  }

  const moedaConta =
    [moeda, total.rows[0]?.account_currency, rowsCampanha[0]?.account_currency]
      .map((m) => (m ?? "").toUpperCase())
      .find((m) => RE_MOEDA.test(m)) ?? "";
  if (!moedaConta) {
    throw new Error("O Meta nao informou a moeda da conta.");
  }

  // 4) Monta as linhas; o total ganha zero nos dias sem entrega.
  const ctx: ContextoLinhas = {
    ad_account_id: conta.id,
    user_id: conta.user_id,
    moedaConta,
    sincronizado_em: agoraIso,
  };
  const linhasConta = preencherDiasConta(
    linhasDeInsights(total.rows, "conta", ctx),
    janela,
    ctx
  );
  const linhasCampanha = campanhaBuscada ? linhasDeInsights(rowsCampanha, "campanha", ctx) : [];
  const linhas: AdSpendDailyRow[] = deduplicarLinhas([...linhasConta, ...linhasCampanha]);

  // 5) Grava e apaga o que nao veio nesta rodada (campanha que o Meta corrigiu
  // para zero some do Insights; sem o delete ficaria com o valor velho). O
  // delete so mexe nos niveis que foram de fato reescritos.
  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await admin
      .from("ad_spend_daily")
      .upsert(linhas.slice(i, i + LOTE), { onConflict: "ad_account_id,data,nivel,campanha_id" });
    if (error) throw new Error(`falha ao gravar o gasto: ${error.message}`);
  }
  const { error: erroLimpeza } = await admin
    .from("ad_spend_daily")
    .delete()
    .eq("ad_account_id", conta.id)
    .in("nivel", niveisParaLimpar(campanhaBuscada))
    .gte("data", janela.desde)
    .lte("data", janela.ate)
    .lt("sincronizado_em", agoraIso);
  if (erroLimpeza) throw new Error(`falha ao limpar gasto antigo: ${erroLimpeza.message}`);

  // 6) Marca o sucesso.
  const { error: erroConta } = await admin
    .from("ad_accounts")
    .update({
      ultimo_sync_em: agoraIso,
      ultimo_sync_ok_em: agoraIso,
      ultimo_erro: null,
      ...(janela.reprocesso ? { ultimo_reprocesso_em: agoraIso } : {}),
      updated_at: agoraIso,
    })
    .eq("id", conta.id);
  if (erroConta) throw new Error(`falha ao marcar a conta: ${erroConta.message}`);

  return { linhas: linhas.length };
}
