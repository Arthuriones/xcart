import { createAdminClient } from "@/lib/supabase/admin";
import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";

export const runtime = "nodejs";

// ============================================================================
// Preferencia de notificacao do app: o MESMO alerta_config.notificar_vendas
// que o liga/desliga da web grava (/api/alertas/venda-webhook, PATCH). Desliga
// os webhooks do celular e o push do app juntos.
//
//   GET   -> { vendas: boolean }  (sem linha de config = ligado, como na web)
//   PATCH { vendas: boolean } -> { vendas }
//
// Service role filtrando pelo user_id da sessao, como a rota da web.
// ============================================================================

// Ler e desligar o aviso de venda valem com o plano vencido: o push nao confere acesso.
export async function GET() {
  const s = await sessaoDoApp({ semAcesso: true });
  if (s.resposta) return s.resposta;

  const { data, error } = await createAdminClient()
    .from("alerta_config")
    .select("notificar_vendas")
    .eq("user_id", s.user.id)
    .maybeSingle();
  if (error) {
    console.error("[app/notificacoes] nao leu a preferencia", error.message);
    return erroDoApp(500, "erro_banco", "Não deu para ler as notificações agora. Tente de novo.");
  }
  return respostaDoApp({ vendas: (data as { notificar_vendas?: boolean } | null)?.notificar_vendas !== false });
}

export async function PATCH(request: Request) {
  const s = await sessaoDoApp({ semAcesso: true });
  if (s.resposta) return s.resposta;

  let vendas: unknown;
  try {
    vendas = ((await request.json()) as { vendas?: unknown } | null)?.vendas;
  } catch {
    vendas = undefined;
  }
  if (typeof vendas !== "boolean") return erroDoApp(400, "corpo_invalido", "Envie { vendas: true } ou { vendas: false }.");

  // A linha de config pode nao existir ainda (quem nunca abriu o Telegram): a web tambem cria.
  const { error } = await createAdminClient()
    .from("alerta_config")
    .upsert(
      { user_id: s.user.id, notificar_vendas: vendas, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) {
    console.error("[app/notificacoes] nao gravou a preferencia", error.message);
    return erroDoApp(500, "erro_banco", "Não deu para salvar agora. Tente de novo.");
  }
  return respostaDoApp({ vendas });
}
