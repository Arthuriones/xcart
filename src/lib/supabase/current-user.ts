import "server-only";
import { cache } from "react";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";

/**
 * O usuário da requisição, validado uma vez só.
 *
 * `supabase.auth.getUser()` vai à rede para validar o token -- não é leitura
 * de cookie. O layout do painel chamava uma vez, a página chamava de novo, e
 * cada consulta de dados chamava mais uma: quatro idas à rede para responder
 * a mesma pergunta na mesma requisição.
 *
 * `cache` do React memoriza por requisição (não entre requisições, não entre
 * usuários), então a primeira chamada paga e as seguintes leem o resultado.
 *
 * null é sessão ausente ou revogada (401, 403, sessão encerrada). Login fora
 * do ar -- rede, 5xx, prazo estourado (AuthRetryableFetchError) ou 429 --
 * LANÇA: devolver null fazia cada tela tratar o lojista como conta vazia
 * ("Conecte uma loja", "Nada quebrado agora") no meio da pane, sem botão de
 * tentar de novo. Quem chama já tem try/catch, allSettled ou o error.tsx.
 */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error && (isAuthRetryableFetchError(error) || error.status === 429)) {
    throw new Error("O login do xcart não respondeu agora.");
  }
  return user;
});
