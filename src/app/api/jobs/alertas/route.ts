import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { avaliarEEnviar } from "@/lib/alertas/avaliar";

export const runtime = "nodejs";
export const maxDuration = 120;

// ============================================================================
// Cron de alertas (*/10): reavalia as 7 regras para todas as lojas e manda no
// maximo UMA mensagem de Telegram por usuario.
//
// Rodar duas vezes seguidas e seguro: a abertura e idempotente (indice unico
// parcial da 052) e o "notificado_em" segura a renotificacao. Por isso o admin
// pode chamar na mao para conferir, sem medo de duplicar mensagem.
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
  // Fora do cron, so admin: a avaliacao cobre as lojas de todos os usuarios e
  // manda mensagem para o Telegram de cada um.
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
    const r = await avaliarEEnviar(createAdminClient());
    return NextResponse.json({ ok: r.erros.length === 0, ...r });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "falha ao avaliar os alertas";
    return NextResponse.json({ ok: false, error: mensagem }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
