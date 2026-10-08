import {
  CREDIT_PACKS,
  GARANTIA as GARANTIA_DO_PLANO,
  PLANOS as PLANOS_COBRADOS,
  PRO_INCLUDED_CREDITS,
  formatBRL,
  textoLimiteRastreamento,
  textoLimiteRoteamento,
  type PlanoId,
} from "@/lib/billing/plans";

// ============================================================================
// Os planos como a landing mostra. Preco, limites, creditos e pacotes saem de
// src/lib/billing/plans.ts (o mesmo arquivo que cobra): nada de numero escrito
// a mao aqui, e todo valor passa pelo mesmo formatador (Intl, pt-BR, centavos
// inclusos).
//
// A lista do que todo plano inclui NAO mora aqui: e a mesma de /billing e do
// paywall, em src/components/billing/beneficios.ts (decisao 2 do redesign).
// ============================================================================

export const CREDITOS_INCLUSOS = PRO_INCLUDED_CREDITS;

/**
 * "R$ 79,90" em duas partes, para o cartao por "R$" pequeno ao lado do valor
 * grande. Se o formato mudar e o corte falhar, o valor inteiro vai no lugar e
 * a moeda some -- nunca um numero diferente do cobrado.
 */
export function precoEmPartes(centavos: number): { moeda: string; valor: string } {
  const texto = formatBRL(centavos);
  const m = texto.match(/^(\D*?)\s*([\d.,]+)$/);
  return m ? { moeda: m[1], valor: m[2] } : { moeda: "", valor: texto };
}

export interface PlanoNaTela {
  id: PlanoId;
  nome: string;
  subtitulo: string;
  /** "79,90" -- o "R$" vai separado, pequeno. */
  valor: string;
  selo?: string;
  destaque?: boolean;
  itens: readonly string[];
}

// Texto de venda do Arthur (08/10/2026). Os limites de loja NAO entram aqui:
// saem de plans.ts, no topo de cada lista.
const ITENS_COMUNS = [
  `${GARANTIA_DO_PLANO.curta}.`,
  "Métricas de produto 100% assertivas.",
  "Perfis de Facebook e Google ilimitados.",
  "Análise de tráfego detalhada.",
  "Suporte prioritário.",
] as const;

const ITENS_DO_PLANO: Record<PlanoId, readonly string[]> = {
  loja1: [],
  lojas3: ["20% OFF todo mês de assinatura."],
  ilimitado: ["Desconto insuperável."],
};

export const PLANOS: readonly PlanoNaTela[] = PLANOS_COBRADOS.map((p) => ({
  id: p.id,
  nome: p.nome,
  subtitulo: p.subtitulo,
  valor: precoEmPartes(p.precoCentavos).valor,
  ...(p.selo ? { selo: p.selo } : {}),
  ...(p.destaque ? { destaque: true } : {}),
  itens: [
    `${textoLimiteRastreamento(p.limites.rastreamento)}.`,
    `${textoLimiteRoteamento(p.limites.roteamento)}.`,
    ...ITENS_DO_PLANO[p.id],
    ...ITENS_COMUNS,
  ],
}));

/** "R$ 79,90": o plano mais barato. */
export const PRECO_A_PARTIR = formatBRL(
  Math.min(...PLANOS_COBRADOS.map((p) => p.precoCentavos))
);

export const GARANTIA = GARANTIA_DO_PLANO;

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
