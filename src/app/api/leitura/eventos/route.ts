import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { listarLojasDoUsuario } from "@/lib/filtro-global";
import { lerFeed } from "@/lib/tracking/feed";
import { nomesDosPedidos } from "@/lib/leitura/eventos";
import { TODAS, ehUuid } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/leitura/eventos?loja=<todas|uuid>&antes=<ISO>
 *
 * O polling da tela Eventos ao vivo: o mesmo feed de /api/tracking/eventos
 * (que continua igual) mais o nome de cada pedido ("#1040"), lido de
 * fin_orders. So leitura, pela sessao: a RLS vale na RPC e em fin_orders.
 * Loja alheia e 404, nao lista vazia, para nao parecer "loja sem evento".
 *
 * Resposta: { eventos: EventoFeed[], pedidos: { "loja:pedidoId": "#1040" } }.
 */
const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json(
        { erro: "Entre na sua conta para ver os eventos." },
        { status: 401, headers: SEM_CACHE }
      );
    }

    const minhas = (await listarLojasDoUsuario()).map((l) => l.id.toLowerCase());
    const loja = (params.get("loja") || TODAS).toLowerCase();
    let ids: string[];
    if (loja === TODAS) ids = minhas;
    else if (ehUuid(loja) && minhas.includes(loja)) ids = [loja];
    else {
      return NextResponse.json(
        { erro: "Loja não encontrada." },
        { status: 404, headers: SEM_CACHE }
      );
    }

    const antesCru = params.get("antes");
    const antes = antesCru && !Number.isNaN(Date.parse(antesCru)) ? antesCru : null;

    const eventos = await lerFeed(ids, antes);
    const pedidos = await nomesDosPedidos(eventos);
    return NextResponse.json({ eventos, pedidos }, { headers: SEM_CACHE });
  } catch (e) {
    console.error("[leitura/eventos]", e);
    return NextResponse.json(
      { erro: "Não conseguimos buscar os eventos agora." },
      { status: 500, headers: SEM_CACHE }
    );
  }
}
