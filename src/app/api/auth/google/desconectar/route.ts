import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, erro: "Não autenticado." }, { status: 401 });
  }

  let connectionId: string | null = null;
  try {
    const body = (await request.json().catch(() => ({}))) as { connectionId?: string };
    connectionId = body?.connectionId || null;
  } catch {
    connectionId = null;
  }

  try {
    let query = supabase
      .from("ad_connections")
      .delete()
      .eq("user_id", user.id)
      .eq("plataforma", "google");

    if (connectionId) {
      query = query.eq("id", connectionId);
    }

    const { error } = await query;
    if (error) {
      return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro ao desconectar";
    return NextResponse.json({ ok: false, erro: msg }, { status: 500 });
  }
}
