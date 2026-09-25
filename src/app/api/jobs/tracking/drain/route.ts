import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { drenarFila } from "@/lib/tracking/fila";

export const runtime = "nodejs";
export const maxDuration = 120;

// ============================================================================
// Retentativa da fila de rastreamento.
//
// O Purchase e enviado na hora em que o webhook chega, mas esse envio falha:
// limite de taxa do Meta (justamente no pico de venda), token vencido, rede.
// Sem este job, cada falha dessas some -- e conversao que some e otimizacao de
// campanha comprometida, porque o Meta deixa de ver as vendas que o anuncio
// gerou.
//
// De 10 em 10 minutos, e nao de hora em hora como os outros: evento de
// conversao envelhece. O Meta aceita ate 7 dias, mas quanto mais fresco, melhor
// a atribuicao.
// ============================================================================

const POR_EXECUCAO = 50;

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
  // Fora do cron, so admin: a fila tem evento de todas as lojas, e drenar
  // dispara envio para pixel de terceiro.
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

  const limite = Math.min(
    Math.max(Number(request.nextUrl.searchParams.get("limit") || POR_EXECUCAO), 1),
    200
  );

  try {
    const r = await drenarFila(limite);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const mensagem = e instanceof Error ? e.message : "falha ao drenar a fila";
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
