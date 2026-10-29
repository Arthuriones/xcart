import { createAdminClient } from "@/lib/supabase/admin";
import { erroDoApp, respostaDoApp, sessaoDoApp } from "@/lib/app-api/sessao";
import { plataformaValida, semTabelaDeAparelhos, tokenExpoValido } from "@/lib/alertas/push-expo";

export const runtime = "nodejs";

// ============================================================================
// O token de push (Expo) do aparelho com o app logado (app_aparelhos, 084).
//
//   POST   { expoToken, plataforma: "ios" | "android" } registra o aparelho na
//          conta da sessao. expo_token e unico: o celular que entrou em outra
//          conta passa para ela (upsert pelo token) e nao avisa as duas.
//   DELETE { expoToken } tira o aparelho, SO se for da conta da sessao (o app
//          chama ao sair, ANTES de descartar o login).
//
// A tabela nao tem policy: a sessao diz quem e o dono e o service role grava,
// sempre com o user_id da sessao. O token nunca volta na resposta nem no log.
// ============================================================================

const SEM_TABELA = "As notificações no celular ainda não estão disponíveis. Tente de novo mais tarde.";

async function lerCorpo(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const corpo = (await request.json()) as unknown;
    return corpo && typeof corpo === "object" && !Array.isArray(corpo) ? (corpo as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function POST(request: Request) {
  const s = await sessaoDoApp();
  if (s.resposta) return s.resposta;

  const corpo = await lerCorpo(request);
  if (!corpo) return erroDoApp(400, "corpo_invalido", "Corpo inválido.");
  if (!tokenExpoValido(corpo.expoToken)) return erroDoApp(400, "token_invalido", "Token de push inválido.");
  if (!plataformaValida(corpo.plataforma)) {
    return erroDoApp(400, "plataforma_invalida", "Plataforma deve ser ios ou android.");
  }

  const { error } = await createAdminClient()
    .from("app_aparelhos")
    .upsert(
      {
        user_id: s.user.id,
        expo_token: corpo.expoToken,
        plataforma: corpo.plataforma,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: "expo_token" }
    );
  if (error) {
    if (semTabelaDeAparelhos(error)) return erroDoApp(503, "push_indisponivel", SEM_TABELA);
    // CHECK do formato (23514): o mesmo da validacao acima, so por garantia.
    if (error.code === "23514") return erroDoApp(400, "token_invalido", "Token de push inválido.");
    console.error("[app/aparelhos] nao registrou o aparelho", error.message);
    return erroDoApp(500, "erro_banco", "Não deu para registrar o aparelho agora. Tente de novo.");
  }
  return respostaDoApp({});
}

/**
 * Sair do app tira o aparelho SEM pedir sessao: quem tem o token do Expo e o
 * proprio aparelho (ele ja recebe o push), entao apagar a linha nao da poder
 * novo a ninguem. Exigir sessao deixava o celular recebendo as vendas depois
 * de a sessao cair (senha trocada, "Sair" global, plano vencido).
 */
export async function DELETE(request: Request) {
  const corpo = await lerCorpo(request);
  if (!corpo) return erroDoApp(400, "corpo_invalido", "Corpo inválido.");
  if (!tokenExpoValido(corpo.expoToken)) return erroDoApp(400, "token_invalido", "Token de push inválido.");

  const { data, error } = await createAdminClient()
    .from("app_aparelhos")
    .delete()
    .eq("expo_token", corpo.expoToken)
    .select("id");
  if (error) {
    if (semTabelaDeAparelhos(error)) return erroDoApp(503, "push_indisponivel", SEM_TABELA);
    console.error("[app/aparelhos] nao removeu o aparelho", error.message);
    return erroDoApp(500, "erro_banco", "Não deu para remover o aparelho agora. Tente de novo.");
  }
  // Ja removido: nada some, e o app segue o logout igual.
  return respostaDoApp({ removido: (data || []).length > 0 });
}
