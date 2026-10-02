import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { lerFeed } from "@/lib/tracking/feed";
import { TODAS, ehUuid } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/tracking/eventos?loja=<todas|uuid>&antes=<ISO>
//
// O polling da tela "Eventos ao vivo". So leitura, com o cliente da sessao: a
// RLS de tracking_events vale dentro da RPC. A loja pedida e conferida contra
// as lojas do usuario mesmo assim -- loja alheia e 404, nao lista vazia, para
// nao parecer "loja sem evento".
// ============================================================================

const SEM_CACHE = { "Cache-Control": "no-store" };

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: SEM_CACHE });
  }

  const { data: lojas, error } = await supabase
    .from("stores")
    .select("id")
    .eq("user_id", user.id);
  if (error) {
    return NextResponse.json(
      { error: `Falha ao ler as lojas: ${error.message}` },
      { status: 500, headers: SEM_CACHE }
    );
  }
  const minhas = (lojas || []).map((l: { id: string }) => String(l.id).toLowerCase());

  const params = request.nextUrl.searchParams;
  const loja = (params.get("loja") || TODAS).toLowerCase();
  let ids: string[];
  if (loja === TODAS) {
    ids = minhas;
  } else if (ehUuid(loja) && minhas.includes(loja)) {
    ids = [loja];
  } else {
    return NextResponse.json({ error: "Loja não encontrada." }, { status: 404, headers: SEM_CACHE });
  }

  const antesCru = params.get("antes");
  const antes = antesCru && !Number.isNaN(Date.parse(antesCru)) ? antesCru : null;

  try {
    const eventos = await lerFeed(ids, antes);
    return NextResponse.json({ eventos }, { headers: SEM_CACHE });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Falha ao ler os eventos." },
      { status: 500, headers: SEM_CACHE }
    );
  }
}
