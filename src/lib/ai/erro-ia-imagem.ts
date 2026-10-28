// ============================================================================
// O que o lojista le quando a foto com IA nao sai (fila de neutralizacao,
// lib/jobs/image-neutralize-processor). Puro: o processador grava a frase em
// background_jobs.error, e o alerta do operador (alertas/avaliar.ts) conta as
// linhas pela MESMA frase.
//
// Por que existe: entre 12/08 e 05/09/2026, 306 fotos falharam com o 429
// "Your prepayment credits are depleted" do Google -- era o saldo pre-pago do
// xcart no AI Studio, mas o lojista lia o texto cru e achava que eram as fotos
// DELE que tinham acabado. O credito ja era devolvido; faltava dizer isso.
// ============================================================================

/** Sem saldo de fotos com IA na conta do lojista. */
export const FRASE_SEM_FOTOS = "Suas fotos com IA acabaram. Compre mais em Assinatura e refaça a troca.";

/**
 * A IA de imagem (nossa conta no Google) recusou: saldo, cota ou limite. Sem
 * "tente de novo": o job volta para a fila e retenta sozinho.
 */
export const FRASE_IA_FORA = "A IA de fotos está fora do ar agora. Nada foi descontado.";

/**
 * Erro do Gemini que e NOSSO (saldo pre-pago, cota, limite de taxa), nao do
 * produto: 429, RESOURCE_EXHAUSTED, "prepayment", "depleted", "quota".
 */
export function ehIaDeImagemFora(mensagem: string): boolean {
  return /\b429\b|resource_exhausted|prepayment|depleted|quota/i.test(mensagem);
}

/**
 * A frase gravada no job: a nossa quando a falha e da IA, senao a original.
 * So para o erro da etapa do Gemini: o processador nao passa por aqui o 429
 * do throttle da Shopify.
 */
export function erroDoJobDeImagem(mensagem: string): { texto: string; iaFora: boolean } {
  if (ehIaDeImagemFora(mensagem)) return { texto: FRASE_IA_FORA, iaFora: true };
  return { texto: mensagem, iaFora: false };
}
