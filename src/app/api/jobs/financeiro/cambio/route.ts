import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { atualizarCambio } from "@/lib/financeiro/cambio-diario";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Cambio diario (fx_rates), a cada 6 h.
//
// Fora do cron, so admin: a tabela e global (vale para todos os usuarios), e
// um usuario comum disparando nao tem o que ganhar alem de gastar a cota das
// fontes. Rodar duas vezes e inofensivo: e upsert por (data, moeda).
// ============================================================================

function segredoDoCron() {
  return process.env.CRON_SECRET || process.env.BULK_IMPORT_CRON_SECRET || "";
}

function cronAutorizado(request: NextRequest) {
  const esperado = segredoDoCron();
  if (!esperado) return false;
  return (
    request.headers.get("authorization") === `Bearer ${esperado}` ||
    request.headers.get("x-cron-secret") === esperado
  );
}

async function executar(request: NextRequest) {
  if (!cronAutorizado(request)) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const admin = createAdminClient();
    const { data: me } = await admin
      .from("profiles")
      .select("is_admin")
      .eq("id", user.id)
      .single();
    if (!me?.is_admin) {
      return NextResponse.json({ error: "Acesso restrito." }, { status: 403 });
    }
  }

  try {
    const r = await atualizarCambio(createAdminClient());
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const mensagem = (e instanceof Error ? e.message : "falha ao atualizar o cambio").slice(0, 300);
    return NextResponse.json({ ok: false, error: mensagem }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
