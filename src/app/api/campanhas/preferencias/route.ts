import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, erro: "não autenticado" }, { status: 401 });
  }

  const { data } = await supabase
    .from("user_dashboard_preferences")
    .select("colunas, filtros_padrao")
    .eq("user_id", user.id)
    .maybeSingle();

  return NextResponse.json({
    ok: true,
    colunas: data?.colunas ?? null,
    filtrosPadrao: data?.filtros_padrao ?? null,
  });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, erro: "não autenticado" }, { status: 401 });
  }

  const corpo = (await request.json().catch(() => ({}))) as {
    colunas?: string[];
    filtrosPadrao?: Record<string, unknown>;
  };

  if (!Array.isArray(corpo.colunas)) {
    return NextResponse.json({ ok: false, erro: "colunas inválidas" }, { status: 400 });
  }

  const { error } = await supabase.from("user_dashboard_preferences").upsert(
    {
      user_id: user.id,
      colunas: corpo.colunas,
      filtros_padrao: corpo.filtrosPadrao || {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
