import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { COLUNAS_REGRA, rodarRegra, type LinhaRegra } from "@/lib/ads/regras-banco";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST: o que a regra faria AGORA, sem mexer no Meta e sem gravar nada.
export async function POST(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ ok: false, erro: "Regra não encontrada." }, { status: 404 });
  }
  const db = createAdminClient();
  const { data } = await db.from("ad_regras").select(COLUNAS_REGRA).eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!data) return NextResponse.json({ ok: false, erro: "Regra não encontrada." }, { status: 404 });
  const resultado = await rodarRegra(db, data as LinhaRegra, { simular: true, agoraMs: Date.now() });
  return NextResponse.json({ ok: true, resultado });
}
