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
// A lista do que o Pro inclui NAO mora aqui: e a mesma de /billing e do
// paywall, em src/components/billing/beneficios.ts (decisao 2 do redesign).
// ============================================================================

/** "R$ 89,00" */
export const PRECO_PRO = formatBRL(PRO_PRICE_CENTS);

/**
 * O mesmo preco em duas partes, para o cartao do plano por "R$" pequeno ao
 * lado do valor grande. Se o formato mudar e o corte falhar, o valor inteiro
 * vai no lugar e a moeda some -- nunca um numero diferente do cobrado.
 */
export const PRECO_PRO_PARTES: { moeda: string; valor: string } = (() => {
  const m = PRECO_PRO.match(/^(\D*?)\s*([\d.,]+)$/);
  return m ? { moeda: m[1], valor: m[2] } : { moeda: "", valor: PRECO_PRO };
})();

export const CREDITOS_INCLUSOS = PRO_INCLUDED_CREDITS;

// ============================================================================
// Os 3 planos da LANDING (decisao do Arthur, 08/10/2026).
//
// So vitrine por enquanto: a cobranca continua com o plano unico de
// src/lib/billing/plans.ts ate ele liberar os planos de verdade. Quando a
// cobranca mudar, estes numeros passam a sair de plans.ts como o PRECO_PRO.
// ============================================================================

export interface PlanoNaTela {
  id: string;
  nome: string;
  subtitulo: string;
  /** "79,90" -- o "R$" vai separado, pequeno. */
  valor: string;
  selo?: string;
  destaque?: boolean;
  itens: readonly string[];
}

const ITENS_COMUNS = [
  "7 dias de garantia.",
  "Métricas de produto 100% assertivas.",
  "Perfis de Facebook e Google ilimitados.",
  "Análise de tráfego detalhada.",
  "Suporte prioritário.",
] as const;

export const PLANOS: readonly PlanoNaTela[] = [
  {
    id: "1-loja",
    nome: "1 Loja",
    subtitulo: "Perfeito para começar",
    valor: "79,90",
    itens: ["1 loja disponível.", ...ITENS_COMUNS],
  },
  {
    id: "3-lojas",
    nome: "3 Lojas",
    subtitulo: "Mais lojas para integrar",
    valor: "119,90",
    selo: "Custo benefício!",
    destaque: true,
    itens: ["3 lojas disponíveis.", "20% OFF todo mês de assinatura.", ...ITENS_COMUNS],
  },
  {
    id: "ilimitado",
    nome: "Ilimitado",
    subtitulo: "Máxima economia + recursos infinitos",
    valor: "169,90",
    selo: "Maior desconto!",
    itens: ["Sem limite de lojas.", "Desconto insuperável.", ...ITENS_COMUNS],
  },
];

export const PRECO_A_PARTIR = `R$ ${PLANOS[0].valor}`;
export const GARANTIA = {
  curta: "7 dias de garantia",
  longa: "7 dias de garantia de satisfação ou seu dinheiro de volta!",
} as const;

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
