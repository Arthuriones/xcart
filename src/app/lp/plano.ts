import {
  CREDIT_PACKS,
  PRO_INCLUDED_CREDITS,
  PRO_PRICE_CENTS,
  formatBRL,
} from "@/lib/billing/plans";

// ============================================================================
// O plano como a landing mostra. Preco, creditos e pacotes saem de
// src/lib/billing/plans.ts (o mesmo arquivo que cobra): nada de numero escrito
// a mao aqui, e todo valor passa pelo mesmo formatador (Intl, pt-BR, centavos
// inclusos). A landing antiga formatava o preco de tres jeitos e cortava os
// centavos.
//
// BENEFICIOS_PRO e a lista unica da decisao 2 do redesign: comeca por Lucro
// por loja, Rastreamento pelo servidor e Alertas. Hoje so a landing le daqui;
// /billing e o paywall ainda tem a lista antiga em assinar-pro.tsx. O texto
// e proposta e espera a aprovacao do Arthur.
// ============================================================================

/** "R$ 89,00" */
export const PRECO_PRO = formatBRL(PRO_PRICE_CENTS);

export const CREDITOS_INCLUSOS = PRO_INCLUDED_CREDITS;

export const BENEFICIOS_PRO: readonly string[] = [
  "Lucro estimado por loja, já descontados produto, frete do fornecedor, taxa de pagamento e anúncio",
  "Compras enviadas ao Meta e ao Google pelo servidor",
  "Alertas no Telegram quando a venda, o rastreamento ou o gasto saem do normal",
  "Gasto do Meta e do Google por conta e por campanha",
  "Importação e clonagem ilimitadas de lojas, com tradução por IA",
  `${PRO_INCLUDED_CREDITS} créditos de IA por mês para refazer fotos sem a marca`,
  "Roteamento entre lojas de checkout, para quem usa vitrine",
];

export interface PacoteNaTela {
  id: string;
  rotulo: string;
  /** "R$ 25,00" */
  preco: string;
}

export const PACOTES: readonly PacoteNaTela[] = CREDIT_PACKS.map((p) => ({
  id: p.id,
  rotulo: p.label,
  preco: formatBRL(p.amountCents),
}));

/**
 * A politica de teste, num lugar so (hero, cartao do plano e perguntas).
 * O brief diz que hoje nao existe teste gratis e que a landing precisa dizer
 * isso com clareza. A frase final e do Arthur.
 */
export const POLITICA_TESTE = {
  curta: "Sem teste grátis",
  longa:
    "Não há período de teste grátis. A assinatura é mensal e você cancela quando quiser, na tela de assinatura do app.",
} as const;
