import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";
import { TODAS } from "@/lib/financeiro/tipos";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { montarSerieDiaria, type PontoDia } from "@/lib/leitura/serie-diaria";
import { derivar } from "@/app/(dashboard)/financeiro/lucro-dados";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/app/v1/dashboard/serie -- o grafico do Dashboard no celular: o
// miolo de /api/leitura/serie (montarSerieDiaria) com a porta do app e o
// filtro dos cabecalhos x-xc-*.
//
// Resposta: { ok, vazio: true } sem loja nem checkout, ou { ok, vazio: false,
// moeda, intervalos, atual, anterior, porLoja }. Cada dia leva as somas cruas
// e o `lucro` do dia pela MESMA formula do grafico do site (derivar), para o
// app nao refazer a conta. porLoja (lucro por dia de cada loja) so com "Todas"
// e 2 ou mais lojas, como a pagina pede.
// ============================================================================

function comLucro(p: PontoDia) {
  return { ...p, lucro: derivar(p).lucro };
}

export async function GET() {
  const s = await sessaoDoApp();
  if (s.resposta) return s.resposta;

  try {
    const base = await lerBaseLucro();
    if (!base) return respostaDoApp({ vazio: true });
    const serie = montarSerieDiaria(base.entrada, {
      porLoja: base.filtro.lojaId === TODAS && base.lojaIds.length + base.checkoutIds.length >= 2,
    });
    return respostaDoApp({
      vazio: false,
      moeda: base.entrada.moeda,
      intervalos: base.entrada.intervalos,
      atual: serie.atual.map(comLucro),
      anterior: serie.anterior.map(comLucro),
      porLoja: serie.porLoja,
    });
  } catch (e) {
    // Erro de banco nunca vira serie zerada (diria "nao vendeu").
    console.error("[app/dashboard/serie]", e);
    return erroDoApp(503, "leitura_falhou", "O gráfico do lucro não respondeu agora. Tente de novo.");
  }
}
