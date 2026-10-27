// ============================================================================
// Qual processador cobra as assinaturas e os Pix NOVOS.
//
// A troca da Pagou pela AbacatePay (docs/migracao-abacatepay/estudo.md) e por
// configuracao, nao por deploy: sem NEXT_PUBLIC_BILLING_PROVIDER=abacatepay
// tudo segue na Pagou. Assim o codigo da AbacatePay entra na main antes de a
// conta dela ser aprovada, sem tirar a cobranca do ar.
//
// NEXT_PUBLIC_ porque a tela tambem decide por ele (cartao no nosso formulario
// ou na pagina da AbacatePay). A Vercel embute o valor no build: trocar a
// variavel pede um deploy novo.
//
// O que ja existe continua com quem cobrou: a assinatura e a compra Pix
// guardam o proprio provedor (payment_provider, credit_purchases.provider).
// ============================================================================

export type ProvedorDeCobranca = "pagou" | "abacatepay";

export function provedorDeCobranca(): ProvedorDeCobranca {
  return process.env.NEXT_PUBLIC_BILLING_PROVIDER === "abacatepay" ? "abacatepay" : "pagou";
}

/**
 * Pix Automatico na assinatura da AbacatePay. Depende de liberacao do suporte
 * deles: sem ela, o checkout com PIX e recusado. Ligado so com a variavel.
 */
export function pixAutomaticoLigado(): boolean {
  return process.env.NEXT_PUBLIC_ABACATEPAY_PIX_AUTOMATICO === "1";
}
