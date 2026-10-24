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
import { recursosDoPlano } from "@/components/billing/beneficios";

// ============================================================================
// Os planos como a landing mostra. Preco, limites, creditos e pacotes saem de
// src/lib/billing/plans.ts (o mesmo arquivo que cobra): nada de numero escrito
// a mao aqui, e todo valor passa pelo mesmo formatador (Intl, pt-BR, centavos
// inclusos).
//
// A lista do que cada plano inclui NAO mora aqui: e a mesma de /billing e do
// paywall, em src/components/billing/beneficios.ts (recursosDoPlano), e sai
// dos limites do plano -- so o que o xcart tem (decisao de 24/10/2026).
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
  /** "197,00" -- o "R$" vai separado, pequeno. */
  valor: string;
  selo?: string;
  destaque?: boolean;
  itens: readonly string[];
}

export const PLANOS: readonly PlanoNaTela[] = PLANOS_COBRADOS.map((p) => ({
  id: p.id,
  nome: p.nome,
  subtitulo: p.subtitulo,
  valor: precoEmPartes(p.precoCentavos).valor,
  ...(p.selo ? { selo: p.selo } : {}),
  ...(p.destaque ? { destaque: true } : {}),
  // Os limites no topo, depois o que o plano inclui e a garantia.
  itens: [
    `${textoLimiteRastreamento(p.limites.rastreamento)}.`,
    `${textoLimiteRoteamento(p.limites)}.`,
    ...recursosDoPlano(p.limites).map((r) => `${r}.`),
    `${GARANTIA_DO_PLANO.curta}.`,
  ],
}));

/** "R$ 197,00": o plano mais barato a venda. */
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
