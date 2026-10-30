import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { temAcessoAEdicao } from "@/lib/ads/gerenciar";
import { erroDaRegra } from "@/lib/ads/gerenciar-regras";
import {
  COLUNAS_REGRA,
  colunasDaEntrada,
  entradaDoCorpo,
  escopoDaLinha,
  escoposDoUsuario,
  escopoEDoUsuario,
  regraDaLinha,
  regraTela,
  type LinhaRegra,
} from "@/lib/ads/regras-banco";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PATCH muda a regra (ou so liga/desliga com { ativa }); DELETE apaga. So do dono.

async function regraDoUsuario(userId: string, id: string): Promise<LinhaRegra | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { data } = await createAdminClient()
    .from("ad_regras")
    .select(COLUNAS_REGRA)
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();
  return (data as LinhaRegra | null) ?? null;
}

export async function PATCH(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  const { id } = await ctx.params;
  const atual = await regraDoUsuario(user.id, id);
  if (!atual) return NextResponse.json({ ok: false, erro: "Regra não encontrada." }, { status: 404 });
  const corpo = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!corpo) return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });

  const db = createAdminClient();
  let mudanca: Record<string, unknown>;
  const soAtiva = Object.keys(corpo).length === 1 && typeof corpo.ativa === "boolean";
  if (soAtiva) {
    // Desligar sempre pode (mesmo sem plano); ligar pede o plano.
    if (corpo.ativa && !(await temAcessoAEdicao(user.id))) {
      return NextResponse.json({ ok: false, erro: "Regras automáticas são do plano pago." }, { status: 403 });
    }
    mudanca = { ativa: corpo.ativa, ...(corpo.ativa ? { proxima_execucao_em: new Date().toISOString() } : {}) };
  } else {
    if (!(await temAcessoAEdicao(user.id))) {
      return NextResponse.json({ ok: false, erro: "Regras automáticas são do plano pago." }, { status: 403 });
    }
    const entrada = entradaDoCorpo({
      ...regraDaLinha(atual),
      ativa: atual.ativa,
      escopo: escopoDaLinha(atual),
      ...corpo,
    });
    if (!entrada) return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
    const erro = erroDaRegra({ id, ...entrada });
    if (erro) return NextResponse.json({ ok: false, erro }, { status: 400 });
    if (!(await escopoEDoUsuario(db, user.id, entrada.escopo))) {
      return NextResponse.json({ ok: false, erro: "Loja, checkout ou conta não encontrada." }, { status: 404 });
    }
    // Regra mudada roda de novo ja na proxima passada do cron.
    mudanca = { ...colunasDaEntrada(entrada), proxima_execucao_em: new Date().toISOString() };
  }

  const { data, error } = await db
    .from("ad_regras")
    .update({ ...mudanca, atualizado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select(COLUNAS_REGRA)
    .single();
  if (error) return NextResponse.json({ ok: false, erro: `Falha ao gravar: ${error.message}` }, { status: 500 });
  const escopos = await escoposDoUsuario(db, user.id);
  return NextResponse.json({ ok: true, regra: regraTela(data as LinhaRegra, escopos) });
}

export async function DELETE(_request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  const { id } = await ctx.params;
  if (!(await regraDoUsuario(user.id, id))) {
    return NextResponse.json({ ok: false, erro: "Regra não encontrada." }, { status: 404 });
  }
  const { error } = await createAdminClient().from("ad_regras").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ ok: false, erro: `Falha ao apagar: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true });
}
