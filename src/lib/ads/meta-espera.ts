import type { AdAccountRow } from "@/lib/financeiro/tipos";

// ============================================================================
// Conta do Meta com o token recusado (190) ou sem ads_read: o cron do gasto
// para de chamar o Meta por ela ate o token mudar, e confere 1x por dia.
// Medido em producao (24/10/2026): 10 de 16 contas com 190, tentadas de 15 em
// 15 min para sempre -- ~19% das chamadas com erro, e o Full access do Meta
// pede menos de 15%.
//
// Sem migration: o estado e o que a conta ja tem -- a frase de ultimo_erro
// (que so o cron grava, daqui) e a hora da tentativa (ultimo_sync_em). Token
// novo = ad_account_secrets.updated_at depois da tentativa (o "conectar" e o
// callback do OAuth gravam essa hora). ultimo_erro fica como esta: Integracoes
// e o alerta "Gasto do Meta sem atualizar" seguem mostrando o problema. O
// botao "Atualizar agora" nunca espera.
// ============================================================================

/** As frases de ultimo_erro. A tela (integracoes/regras.ts) reconhece o "190" desta. */
export const ERRO_TOKEN_RECUSADO = "Token do Meta recusado (190). Gere outro e cole em Contas de anúncio.";
export const ERRO_SEM_PERMISSAO = "Sem permissão de leitura nesta conta (ads_read).";

/** Sem token novo, o cron confere a conta uma vez por dia. */
export const ESPERA_TOKEN_RECUSADO_MS = 24 * 60 * 60 * 1000;
/**
 * Token gravado ate 10 min antes do FIM da tentativa (o teto da trava) pode
 * nao ter sido o que ela leu: conta como novo, e o cron tenta mais uma vez.
 */
const FOLGA_TOKEN_MS = 10 * 60 * 1000;

/** A ultima tentativa parou no token ou na permissao: so outro token resolve. */
export function contaPedeTokenNovo(ultimoErro: string | null | undefined): boolean {
  return ultimoErro === ERRO_TOKEN_RECUSADO || ultimoErro === ERRO_SEM_PERMISSAO;
}

/**
 * O cron pula a conta nesta rodada? So a marcada, enquanto a ultima tentativa
 * tem menos de 24 h e nenhum token foi gravado depois dela.
 */
export function cronPulaConta(
  conta: Pick<AdAccountRow, "ultimo_erro" | "ultimo_sync_em">,
  tokenSalvoEm: string | null | undefined,
  agora: number
): boolean {
  if (!contaPedeTokenNovo(conta.ultimo_erro)) return false;
  const tentouEm = Date.parse(conta.ultimo_sync_em ?? "");
  if (!Number.isFinite(tentouEm) || agora - tentouEm >= ESPERA_TOKEN_RECUSADO_MS) return false;
  const salvoEm = Date.parse(tokenSalvoEm ?? "");
  return !(Number.isFinite(salvoEm) && salvoEm > tentouEm - FOLGA_TOKEN_MS);
}
