import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const checks: Record<string, "ok" | "error"> = {};

  try {
    const supabase = await createClient();
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
  checks.cron =
    process.env.CRON_SECRET || process.env.BULK_IMPORT_CRON_SECRET ? "ok" : "error";

  const allOk = Object.values(checks).every((v) => v === "ok");

  return NextResponse.json(
    { status: allOk ? "healthy" : "degraded", checks },
    { status: allOk ? 200 : 503 }
  );
}
