import type { NextRequest } from "next/server";
import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";
import { lerCampanhas } from "@/lib/leitura/campanhas";
import { tomDoRoas, type LinhaCampanha } from "@/lib/campanhas/metricas";
import {
  filtrarLinhas,
  filtroDeParametros,
  semDetalheDoFiltro,
  totalDasLinhas,
  type TotalCampanhas,
} from "@/lib/campanhas/filtrar";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/app/v1/campanhas?nivel=&plataforma=&conta=&status=&q=&campanhaId=
//
// A aba Campanhas no celular: a MESMA leitura da tela (lerCampanhas, com
// periodo, loja e moeda dos cabecalhos x-xc-*), o MESMO filtro
// (src/lib/campanhas/filtrar.ts) e a mesma linha de total. Parametro torto
// vira o padrao, nunca erro. Sai so o que a tela mostra: as somas cruas que
// so servem de base (gasto/impressoes do detalhe, peso da frequencia) ficam.
// ============================================================================

/** As colunas de numero da tabela: as mesmas para a linha e o total. */
function numerosDaTela(v: TotalCampanhas) {
  // IC e video so existem nos dias com detalhe: sem ele, null (a tela mostra "—").
  const doDetalhe = (n: number) => (v.detalhe ? n : null);
  return {
    gastos: v.gastos,
    faturamento: v.faturamento,
    lucro: v.lucro,
    roas: v.roas,
    /** Cor do ROAS na tela: pelo sinal do lucro da linha. */
    roasTom: tomDoRoas(v),
    margem: v.margem,
    roi: v.roi,
    custoProduto: v.custoProduto,
    vendas: v.vendas,
    vendasPendentes: v.vendasPendentes,
    vendasTotais: v.vendasTotais,
    cpa: v.cpa,
    cpt: v.cpt,
    cpp: v.cpp,
    impressoes: v.impressoes,
    cliques: v.cliques,
    ctr: v.ctr,
    cpc: v.cpc,
    cpm: v.cpm,
    ic: doDetalhe(v.ic),
    cpi: v.cpi,
    visVideo: doDetalhe(v.visVideo),
    vis3s: doDetalhe(v.vis3s),
    retencao75: v.retencao75,
    hookRate: v.hookRate,
    holdRate: v.holdRate,
    frequencia: v.frequencia,
  };
}

function linhaDoApp(l: LinhaCampanha) {
  return {
    id: l.id,
    objetoId: l.objetoId,
    nome: l.nome,
    status: l.status,
    plataforma: l.plataforma,
    nivel: l.nivel,
    contaId: l.contaId,
    contaNome: l.contaNome,
    campanhaId: l.campanhaId,
    campanhaNome: l.campanhaNome,
    grupoId: l.grupoId,
    grupoNome: l.grupoNome,
    tipo: l.tipo,
    orcamento: l.orcamento,
    cpaDesejado: l.cpaDesejado,
    ...numerosDaTela(l),
  };
}

export async function GET(request: NextRequest) {
  const s = await sessaoDoApp();
  if (s.resposta) return s.resposta;

  let dados: Awaited<ReturnType<typeof lerCampanhas>>;
  try {
    dados = await lerCampanhas();
  } catch (e) {
    // Erro de banco nunca vira lista vazia (a tela tambem mostra o erro).
    console.error("[app/campanhas]", e);
    return erroDoApp(503, "leitura_falhou", "Não conseguimos abrir as campanhas agora. Tente de novo.");
  }

  const filtro = filtroDeParametros(request.nextUrl.searchParams, dados.contas.map((c) => c.id));
  const { busca, ...resto } = filtro;
  const filtroAplicado = { ...resto, q: busca };

  // Nenhuma conta de anuncio no filtro: a tela mostra "conecte uma conta".
  if (!dados.resultado || dados.contas.length === 0) {
    return respostaDoApp({
      periodo: dados.periodo,
      moeda: dados.moeda,
      contas: [],
      filtro: filtroAplicado,
      linhas: [],
      total: null,
      atribuicao: null,
      avisos: { semDetalhe: [], diasNoPeriodo: null, moedasSemCotacao: [], contraEntrega: false, sincronizadoEm: null },
    });
  }

  const r = dados.resultado;
  const linhas = filtrarLinhas(r.linhas, filtro);
  return respostaDoApp({
    periodo: dados.periodo,
    moeda: dados.moeda,
    contas: dados.contas,
    filtro: filtroAplicado,
    linhas: linhas.map(linhaDoApp),
    total: { quantidade: linhas.length, ...numerosDaTela(totalDasLinhas(linhas)) },
    atribuicao: r.atribuicao,
    avisos: {
      semDetalhe: semDetalheDoFiltro(r.semDetalhe, filtro),
      diasNoPeriodo: r.diasNoPeriodo,
      moedasSemCotacao: r.moedasSemCotacao,
      contraEntrega: r.contraEntrega,
      sincronizadoEm: r.sincronizadoEm,
    },
  });
}
