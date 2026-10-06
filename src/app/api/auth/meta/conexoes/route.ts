import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ ok: false, erro: "Não autenticado." }, { status: 401 });
  }

  try {
    const { data, error } = await supabase
      .from("ad_connections")
      .select("id, plataforma, external_user_id, nome, email, foto_url, token_expira_em, created_at")
      .eq("user_id", user.id)
      .eq("plataforma", "meta")
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ ok: true, conexoes: [] });
    }

    return NextResponse.json({ ok: true, conexoes: data || [] });
  } catch {
    return NextResponse.json({ ok: true, conexoes: [] });
  }
}
