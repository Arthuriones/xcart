import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFaturamentoAdmin } from "@/lib/sales/admin";
import { SALES_PERIODS, type SalesPeriod } from "@/lib/sales/types";

export const runtime = "nodejs";

// Pergunta ao vivo a cada loja de checkout: com dezenas de lojas isso passa
// facil do teto padrao da Vercel.
export const maxDuration = 120;

// GET -> faturamento por usuario do xcart nas lojas que recebem roteamento.
export async function GET(request: Request) {
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

  const bruto = new URL(request.url).searchParams.get("period");
  const period: SalesPeriod = SALES_PERIODS.some((p) => p.id === bruto)
    ? (bruto as SalesPeriod)
    : "30";

  try {
    const dados = await getFaturamentoAdmin(period);
    return NextResponse.json(dados);
  } catch (erro) {
    const mensagem = erro instanceof Error ? erro.message : "Falha ao apurar faturamento.";
    return NextResponse.json({ error: mensagem }, { status: 500 });
  }
}
