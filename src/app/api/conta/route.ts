import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { excluirConta } from "@/lib/conta/excluir";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * DELETE /api/conta { confirmacao: "<e-mail da conta>" } -- excluir a conta
 * pelo site (/configuracoes). O usuario vem SEMPRE da sessao. Sem conferir
 * acesso: plano vencido tambem exclui a conta.
 */
export async function DELETE(request: Request) {
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return NextResponse.json(
      { ok: false, codigo: "login_fora", erro: "O login do xcart não respondeu agora. Tente de novo." },
      { status: 503 }
    );
  }
  if (!user) {
    return NextResponse.json(
      { ok: false, codigo: "sem_login", erro: "Sua sessão expirou. Entre de novo." },
      { status: 401 }
    );
  }

  const corpo = (await request.json().catch(() => null)) as { confirmacao?: unknown } | null;
  const r = await excluirConta(user.id, corpo?.confirmacao);
  if (!r.ok) return NextResponse.json({ ok: false, codigo: r.codigo, erro: r.erro }, { status: r.status });

  // Sai da sessao na mesma resposta: o proxy confere o token pela assinatura
  // (getClaims, sem ir ao Auth), e o cookie do usuario apagado passaria por
  // ele ate vencer. O signOut limpa o cookie mesmo com o usuario ja sumido.
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (e) {
    console.error("[conta] signOut", e instanceof Error ? e.message : e);
  }
  return NextResponse.json({ ok: true });
}
