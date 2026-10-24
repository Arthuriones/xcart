import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AdAccountRow, AdSpendDailyRow } from "@/lib/financeiro/tipos";
import { RE_MOEDA } from "@/lib/financeiro/tipos";
import {
  ErroGraph,
  buscarConta,
  buscarEstruturaMeta,
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
  type ThrottleMeta,
} from "@/lib/ads/meta-mapear";
import {
  corteDaRetencaoGranular,
  estruturaDaLista,
  linhasGranulares,
  niveisGranularesParaLimpar,
  textoDoErroGranular,
} from "@/lib/ads/meta-granular";

// ============================================================================
// Sincroniza o gasto de UMA conta do Meta em ad_spend_daily e, na mesma
// passada, o detalhe da aba Campanhas (campanha, conjunto e anuncio por dia)
// em ad_insights_granular.
//
// Quem trava a conta (sincronizando_desde) e trata o erro e o job; aqui so o
// caminho feliz. Idempotente: rodar duas vezes grava o mesmo resultado.
// O detalhe vem DEPOIS do gasto e nunca o derruba: falhou, vai para o log e
// para o retorno, e as linhas que ja estavam ficam.
// ============================================================================

const LOTE = 500;

type ResultadoInsights = { rows: InsightMeta[]; throttle: ThrottleMeta | null; completo?: boolean };

function mensagemDe(e: unknown): string {
  return e instanceof Error ? e.message : "falha desconhecida";
}

function codigoDe(e: unknown): number | null {
  return e instanceof ErroGraph ? e.codigo : null;
}

export async function sincronizarContaMeta(
  admin: SupabaseClient,
  conta: AdAccountRow,
  token: string,
  agora: Date
): Promise<{ linhas: number; granular: number; erroGranular: string | null }> {
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
  // O pedido de campanha leva tambem os campos da aba Campanhas (frequencia e
  // video): e o nivel campanha do detalhe, sem pedir de novo.
  let campanhaGranular: ResultadoInsights | null = null;
  let erroGranular: string | null = null;
  if (campanhaBuscada) {
    try {
      campanhaGranular = await buscarInsightsDetalhado(
        conta.external_id,
        token,
        janela.desde,
        janela.ate,
        "campaign",
        { granular: true }
      );
      rowsCampanha = campanhaGranular.rows;
    } catch (e) {
      // Falha no detalhe (limite, timeout, codigo 1 "reduce the amount of
      // data"...) nao pode custar o total que ja chegou. Token ou permissao
      // ruim ja teria falhado no level=account acima, com o mesmo token.
      campanhaBuscada = false;
      rowsCampanha = [];
      // O Meta recusou o pedido (nao foi limite nem rede): pode ser so pelos
      // campos da aba Campanhas. Repete o pedido de antes, para o gasto por
      // campanha nao depender deles.
      if (e instanceof ErroGraph && classificarErroMeta(e.codigo) !== "limite") {
        try {
          rowsCampanha = (
            await buscarInsightsDetalhado(conta.external_id, token, janela.desde, janela.ate, "campaign")
          ).rows;
          campanhaBuscada = true;
          erroGranular = textoDoErroGranular(e.codigo, e.message);
        } catch {
          rowsCampanha = [];
        }
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

  // 8) Detalhe da aba Campanhas. Com a cota perto do fim (o header do pedido
  // de campanha e o mais novo), fica para a proxima rodada, sem erro.
  let linhasGranular = 0;
  if (campanhaGranular && deveBuscarCampanha(campanhaGranular.throttle ?? total.throttle)) {
    try {
      linhasGranular = await sincronizarGranular(admin, conta, token, janela, ctx, campanhaGranular);
    } catch (e) {
      erroGranular = textoDoErroGranular(codigoDe(e), mensagemDe(e));
    }
  }
  // NAO vai para ultimo_erro: o alerta ads_sync_atrasado (critico, "Gasto do
  // Meta sem atualizar") e o "Erro" de Integracoes leem esse campo, e o gasto
  // FOI gravado. Fica no log (a mensagem do Meta ja vem sem token) e no
  // retorno; a aba ve o atraso pelo sincronizado_em das proprias linhas.
  if (erroGranular) console.error("[meta-sync] detalhe de campanhas", conta.id, erroGranular);

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

  return { linhas: linhas.length, granular: linhasGranular, erroGranular };
}

/**
 * Conjunto e anuncio por dia + a lista atual (status, orcamento, CBO/ABO) ->
 * ad_insights_granular. O nivel campanha ja veio no pedido do gasto. Apaga da
 * janela o que nao voltou (so nos niveis que vieram inteiros) e, no
 * reprocesso, o que passou de DIAS_GUARDADOS_GRANULAR. Lanca em qualquer
 * falha: quem chama registra o erro sem tocar no gasto.
 */
async function sincronizarGranular(
  admin: SupabaseClient,
  conta: AdAccountRow,
  token: string,
  janela: { desde: string; ate: string; reprocesso: boolean },
  ctx: ContextoLinhas,
  campanhas: ResultadoInsights
): Promise<number> {
  const [grupos, anuncios, lista] = await Promise.all([
    buscarInsightsDetalhado(conta.external_id, token, janela.desde, janela.ate, "adset", { granular: true }),
    buscarInsightsDetalhado(conta.external_id, token, janela.desde, janela.ate, "ad", { granular: true }),
    buscarEstruturaMeta(conta.external_id, token),
  ]);
  // Lista cortada: objeto que gastou e ficou na pagina que nao veio sairia
  // como arquivado. Melhor nao gravar do que gravar status errado.
  if (!lista.completa.campanhas || !lista.completa.conjuntos || !lista.completa.anuncios) {
    throw new Error(
      "a lista de campanhas, conjuntos e anúncios do Meta não coube numa passada (conta grande demais)."
    );
  }

  const completos = {
    campanha: campanhas.completo !== false,
    grupo: grupos.completo !== false,
    anuncio: anuncios.completo !== false,
  };
  const linhas = linhasGranulares({
    ctx,
    hoje: janela.ate,
    insights: { campanha: campanhas.rows, grupo: grupos.rows, anuncio: anuncios.rows },
    completos,
    estrutura: estruturaDaLista(lista, ctx.moedaConta),
  });

  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await admin
      .from("ad_insights_granular")
      .upsert(linhas.slice(i, i + LOTE), { onConflict: "ad_account_id,data,nivel,objeto_id" });
    if (error) throw new Error(`falha ao gravar o detalhe: ${error.message}`);
  }

  const niveis = niveisGranularesParaLimpar(completos);
  if (niveis.length > 0) {
    const { error } = await admin
      .from("ad_insights_granular")
      .delete()
      .eq("ad_account_id", conta.id)
      .in("nivel", niveis)
      .gte("data", janela.desde)
      .lte("data", janela.ate)
      .lt("sincronizado_em", ctx.sincronizado_em);
    if (error) throw new Error(`falha ao limpar o detalhe antigo: ${error.message}`);
  }

  // Uma vez por dia (o reprocesso) basta: o corte anda um dia por dia.
  if (janela.reprocesso) {
    const { error } = await admin
      .from("ad_insights_granular")
      .delete()
      .eq("ad_account_id", conta.id)
      .lt("data", corteDaRetencaoGranular(janela.ate));
    if (error) throw new Error(`falha ao apagar o detalhe velho: ${error.message}`);
  }

  return linhas.length;
}
