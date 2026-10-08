import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Publico (healthcheck do Docker, monitor de uptime): so "estou de pe". O que
// esta configurado ou faltando e mapa para quem ataca -- detalhe so para o
// cron (CRON_SECRET em Authorization: Bearer, como os jobs) ou admin logado.

function segredoDoCron() {
  return process.env.CRON_SECRET || process.env.BULK_IMPORT_CRON_SECRET || "";
}

function cronAutorizado(request: NextRequest) {
  const esperado = segredoDoCron();
  if (!esperado) return false;
  const a = Buffer.from(request.headers.get("authorization") || "");
  const b = Buffer.from(`Bearer ${esperado}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function ehAdmin() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return false;
    const { data: me } = await createAdminClient()
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    return me?.is_admin === true;
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!cronAutorizado(request) && !(await ehAdmin())) {
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  }

  const checks: Record<string, "ok" | "error"> = {};

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("stores").select("id").limit(1);
    checks.database = error ? "error" : "ok";
  } catch {
    checks.database = "error";
  }

  checks.gemini = process.env.GEMINI_API_KEY ? "ok" : "error";

  // Sem CRON_SECRET o endpoint do cron responde 401 para a propria Vercel: os
  // jobs continuam sendo disparados de hora em hora e nenhum roda. Nada no app
  // reclama -- o auto-conserto simplesmente para e as rotas apodrecem em
  // silencio. Ficou semanas assim antes de alguem olhar.
  checks.cron = segredoDoCron() ? "ok" : "error";

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    { status: allOk ? "healthy" : "degraded", checks },
    { status: allOk ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
