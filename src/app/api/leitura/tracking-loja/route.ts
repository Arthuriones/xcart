import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerFinanceiroDaLoja, lerLojaBase } from "@/lib/leitura/resumo-lojas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/tracking-loja?loja=<id> -- o cabecalho do detalhe da loja
 * no Rastreamento: faturamento, pedidos e ticket do periodo da barra do topo
 * (o mesmo motor do Lucro), moeda, fuso e a data de conexao.
 *
 * So leitura, pela sessao (RLS). Loja de outro dono e 404. O faturamento que
 * falha volta null -- a tela mostra "—", nunca zero.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para ver a loja." }, { status: 401 });
  }
  const id = request.nextUrl.searchParams.get("loja") ?? "";
  try {
    const base = await lerLojaBase(id);
    if (!base) return NextResponse.json({ erro: "Loja não encontrada." }, { status: 404 });

    let financeiro: { receita: number; pedidos: number; ticket: number | null; moeda: string } | null =
      null;
    try {
      const { resultado } = await lerFinanceiroDaLoja(base);
      const a = resultado.atual;
      financeiro = { receita: a.receita, pedidos: a.pedidos, ticket: a.ticket, moeda: resultado.moeda };
    } catch (e) {
      console.error("[leitura/tracking-loja] faturamento", e);
    }

    return NextResponse.json(
      {
        loja: {
          moeda: base.moeda,
          fuso: base.fuso,
          criadaEm: base.criadaEm,
        },
        financeiro,
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (e) {
    console.error("[leitura/tracking-loja]", e);
    return NextResponse.json({ erro: "Não deu para ler a loja agora." }, { status: 500 });
  }
}
