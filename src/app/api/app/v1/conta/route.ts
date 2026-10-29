import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";
import { excluirConta } from "@/lib/conta/excluir";

export const runtime = "nodejs";

export const maxDuration = 60;

/**
 * DELETE /api/app/v1/conta { confirmacao: "<e-mail da conta>" } -- excluir a
 * conta pelo app (Apple 5.1.1(v), Google Play). Sem a conferencia do plano:
 * quem esta com o plano vencido tem que conseguir excluir a conta do mesmo jeito.
 */
export async function DELETE(request: Request) {
  const s = await sessaoDoApp({ semAcesso: true });
  if (s.resposta) return s.resposta;

  const corpo = (await request.json().catch(() => null)) as { confirmacao?: unknown } | null;
  const r = await excluirConta(s.user.id, corpo?.confirmacao);
  return r.ok ? respostaDoApp({ excluida: true }) : erroDoApp(r.status, r.codigo, r.erro);
}
