import "server-only";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { tokenDoApp } from "@/lib/supabase/server";
import { userHasAccess } from "@/lib/billing/access";

// ============================================================================
// Porta de toda rota de /api/app/v1 (o app do celular).
//
// So o login do app conta: `Authorization: Bearer <access token do Supabase>`
// (tokenDoApp). Cookie nao abre estas rotas -- nem o do site no mesmo
// navegador -- e o filtro (loja, periodo, moeda, comparar) vem nos cabecalhos
// x-xc-* (src/lib/filtro-global.ts). Sem acesso (plano vencido) e 403
// `sem_acesso`: o app mostra uma tela neutra, sem preco nem link de compra
// (regra 3.1.1 da Apple).
//
// Resposta sempre { ok: true, ... } ou { ok: false, codigo, erro }, e nunca
// guardada em cache (sao numeros do lojista).
// ============================================================================

export type UsuarioDoApp = NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>;

const SEM_CACHE = { "cache-control": "no-store" };

export function erroDoApp(status: number, codigo: string, erro: string) {
  return NextResponse.json({ ok: false, codigo, erro }, { status, headers: SEM_CACHE });
}

export function respostaDoApp<T extends object>(corpo: T, status = 200) {
  return NextResponse.json({ ok: true, ...corpo }, { status, headers: SEM_CACHE });
}

/**
 * O usuario do app, conferido; ou a resposta de erro pronta para devolver.
 *
 * `semAcesso: true` pula so a conferencia do plano: sair do app (tirar o
 * aparelho), desligar o aviso de venda e excluir a conta tem que funcionar com
 * o plano vencido -- senao o push continuaria chegando sem como parar.
 */
export async function sessaoDoApp(
  opcoes: { semAcesso?: boolean } = {}
): Promise<{ user: UsuarioDoApp; resposta?: never } | { user?: never; resposta: NextResponse }> {
  if (!(await tokenDoApp())) {
    return { resposta: erroDoApp(401, "sem_login", "Entre de novo no app.") };
  }
  let user: Awaited<ReturnType<typeof getCurrentUser>>;
  try {
    user = await getCurrentUser();
  } catch {
    return { resposta: erroDoApp(503, "login_fora", "O login do Panda Track não respondeu agora. Tente de novo.") };
  }
  if (!user) return { resposta: erroDoApp(401, "sem_login", "Sua sessão expirou. Entre de novo.") };
  if (!opcoes.semAcesso && !(await userHasAccess(user.id))) {
    return { resposta: erroDoApp(403, "sem_acesso", "Sua conta está sem acesso ao Panda Track agora.") };
  }
  return { user };
}
