import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { atualizarLojasDeDemonstracao } from "@/lib/demonstracao/atualizar";

export const runtime = "nodejs";
export const maxDuration = 300;

// ============================================================================
// Loja de demonstracao (074), de 15 em 15 minutos: completa ate agora os
// pedidos, a origem, o Purchase, o funil e o gasto pelo mesmo gerador do
// scripts/demo-loja.ts, e uma vez por dia apaga o que saiu das janelas que
// rolam (src/lib/demonstracao/atualizar.ts).
//
// So o cron: a loja nao tem botao. Sem loja marcada, sai na primeira consulta.
// Nada daqui fala com fora do banco.
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
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const r = await atualizarLojasDeDemonstracao(createAdminClient());
  return NextResponse.json(r, { status: r.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return executar(request);
}

export async function POST(request: NextRequest) {
  return executar(request);
}
