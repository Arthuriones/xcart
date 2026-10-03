import { NextResponse, type NextRequest } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { lerAtividade, type PaginaAtividade } from "@/lib/leitura/atividade";
import { cursorDe, tipoDe } from "@/lib/leitura/atividade-regras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/atividade?antes=&tipo=&loja= -- a proxima pagina da linha
 * do tempo (o "Carregar mais" da tela /activity). So leitura, pela sessao
 * (RLS, e user_id em toda consulta). A loja vem da primeira pagina e e
 * conferida contra as lojas do usuario: loja alheia vira "todas".
 * Resposta: { itens, proximo, falhas, agora }.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ erro: "Entre na sua conta para ver a atividade." }, { status: 401 });
  }
  const p = request.nextUrl.searchParams;
  const loja = p.get("loja");
  try {
    const d = await lerAtividade({
      tipo: tipoDe(p.get("tipo")),
      antes: cursorDe(p.get("antes")),
      lojaId: loja && loja.length <= 64 ? loja : undefined,
    });
    const pagina: PaginaAtividade = {
      itens: d.itens,
      proximo: d.proximo,
      falhas: d.falhas,
      agora: d.agora,
    };
    return NextResponse.json(pagina, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[leitura/atividade]", e);
    return NextResponse.json({ erro: "A atividade não respondeu agora." }, { status: 500 });
  }
}
