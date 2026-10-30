import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { temAcessoAEdicao } from "@/lib/ads/gerenciar";
import { erroDaRegra } from "@/lib/ads/gerenciar-regras";
import {
  COLUNAS_REGRA,
  colunasDaEntrada,
  entradaDoCorpo,
  escoposDoUsuario,
  escopoEDoUsuario,
  historicoDoUsuario,
  regraTela,
  tabelaAusente,
  type LinhaRegra,
} from "@/lib/ads/regras-banco";
import type { RespostaRegras } from "@/lib/ads/regras-tipos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// Regras automaticas (plano-de-acao/03). GET lista regras, escopos e o
// historico; POST cria. Escrita pelo service role, depois de conferir que o
// escopo (loja, checkout ou conta) e do usuario -- o cron agiria nele.
// ============================================================================

/** Teto de regras por conta: cada uma custa leitura e chamada ao Meta por passada. */
const MAX_REGRAS = 30;

export async function GET() {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  const db = createAdminClient();
  try {
    const escopos = await escoposDoUsuario(db, user.id);
    const { data, error } = await db
      .from("ad_regras")
      .select(COLUNAS_REGRA)
      .eq("user_id", user.id)
      .order("criado_em", { ascending: true });
    if (error && !tabelaAusente(error.code)) throw new Error(error.message);
    const disponivel = !error;
    const historico = disponivel ? ((await historicoDoUsuario(db, user.id)) ?? []) : [];
    const resposta: RespostaRegras = {
      ok: true,
      regras: ((data ?? []) as LinhaRegra[]).map((l) => regraTela(l, escopos)),
      escopos,
      historico,
      disponivel,
    };
    return NextResponse.json(resposta);
  } catch (e) {
    return NextResponse.json(
      { ok: false, erro: e instanceof Error ? e.message : "Falha ao ler as regras." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  if (!(await temAcessoAEdicao(user.id))) {
    return NextResponse.json({ ok: false, erro: "Regras automáticas são do plano pago." }, { status: 403 });
  }
  const entrada = entradaDoCorpo(await request.json().catch(() => null));
  if (!entrada) return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
  const erro = erroDaRegra({ id: "", ...entrada });
  if (erro) return NextResponse.json({ ok: false, erro }, { status: 400 });

  const db = createAdminClient();
  if (!(await escopoEDoUsuario(db, user.id, entrada.escopo))) {
    return NextResponse.json({ ok: false, erro: "Loja, checkout ou conta não encontrada." }, { status: 404 });
  }
  const { count } = await db.from("ad_regras").select("id", { count: "exact", head: true }).eq("user_id", user.id);
  if ((count ?? 0) >= MAX_REGRAS) {
    return NextResponse.json({ ok: false, erro: `Limite de ${MAX_REGRAS} regras por conta.` }, { status: 409 });
  }

  const { data, error } = await db
    .from("ad_regras")
    .insert({ ...colunasDaEntrada(entrada), user_id: user.id })
    .select(COLUNAS_REGRA)
    .single();
  if (error) {
    const erroTela = tabelaAusente(error.code)
      ? "As regras ficam disponíveis depois da atualização do banco."
      : `Falha ao gravar a regra: ${error.message}`;
    return NextResponse.json({ ok: false, erro: erroTela }, { status: 500 });
  }
  const escopos = await escoposDoUsuario(db, user.id);
  return NextResponse.json({ ok: true, regra: regraTela(data as LinhaRegra, escopos) });
}
