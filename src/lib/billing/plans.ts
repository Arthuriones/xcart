// Configuracao de planos e pacotes de credito do SaaS.
// Cobranca via Pagou.ai. Valores em BRL porque Pix so existe em real.

export const CURRENCY = "BRL";

// Preco do Pro de antes dos planos (R$ 89/mes). Ninguem mais assina por ele:
// so serve para o MRR do admin de quem ja paga assim (plano sem tier gravado)
// e para o webhook reconhecer a assinatura antiga.
export const PRO_PRICE_CENTS = 8900; // R$ 89,00

// Creditos de IA inclusos em qualquer plano. 1 credito = 1 produto
// neutralizado com foto. Resetados a cada cobranca paga da assinatura.
export const PRO_INCLUDED_CREDITS = 20;

// ============================================================================
// Os 3 planos (decisao do Arthur, 08/10/2026). Todos sao "pro" para fins de
// acesso (profiles.plan = 'pro'); o que muda e o limite de lojas, gravado em
// profiles.plano. Mesmos recursos e mesmos creditos inclusos nos tres.
//
// Este e o catalogo UNICO: o checkout cobra daqui, a landing, o paywall e a
// Assinatura mostram daqui, e a trava de limite (limites.ts) le daqui.
// ============================================================================

export type PlanoId = "loja1" | "lojas3" | "ilimitado";

export interface LimitesPlano {
  /** Lojas com o rastreamento ligado. null = sem limite. */
  rastreamento: number | null;
  /** Lojas distintas no roteamento (vitrines + lojas de checkout). null = sem limite. */
  roteamento: number | null;
}

export interface Plano {
  id: PlanoId;
  nome: string;
  precoCentavos: number;
  limites: LimitesPlano;
  selo: string | null;
  subtitulo: string;
  /** O cartao em evidencia na landing e o marcado de partida na escolha. */
  destaque: boolean;
}

export const PLANOS: readonly Plano[] = [
  {
    id: "loja1",
    nome: "1 Loja",
    precoCentavos: 7990,
    limites: { rastreamento: 1, roteamento: 6 },
    selo: null,
    subtitulo: "Perfeito para começar",
    destaque: false,
  },
  {
    id: "lojas3",
    nome: "3 Lojas",
    precoCentavos: 11990,
    limites: { rastreamento: 3, roteamento: 12 },
    selo: "Custo benefício!",
    subtitulo: "Mais lojas para integrar",
    destaque: true,
  },
  {
    id: "ilimitado",
    nome: "Ilimitado",
    precoCentavos: 16990,
    limites: { rastreamento: null, roteamento: null },
    selo: "Maior desconto!",
    subtitulo: "Máxima economia + recursos infinitos",
    destaque: false,
  },
];

/**
 * Limites de quem nao tem tier gravado: assinante de antes dos planos (Stripe
 * ou Pagou a R$ 89) e conta sem assinatura. Palavra do Arthur: o do 1 Loja.
 */
export const PLANO_BASE: PlanoId = "loja1";

export const GARANTIA_DIAS = 7;

/** A garantia em texto. O reembolso e manual, pelo suporte. */
export const GARANTIA = {
  curta: `${GARANTIA_DIAS} dias de garantia`,
  longa: `${GARANTIA_DIAS} dias de garantia de satisfação ou seu dinheiro de volta!`,
} as const;

export function ehPlanoId(v: unknown): v is PlanoId {
  return v === "loja1" || v === "lojas3" || v === "ilimitado";
}

export function planoPorId(id: unknown): Plano | undefined {
  return PLANOS.find((p) => p.id === id);
}

/** O plano de partida da escolha (o em destaque). */
export function planoEmDestaque(): Plano {
  return PLANOS.find((p) => p.destaque) ?? PLANOS[0];
}

/** O plano seguinte, com mais lojas. null no ultimo. */
export function proximoPlano(id: PlanoId): Plano | null {
  const i = PLANOS.findIndex((p) => p.id === id);
  return i >= 0 && i < PLANOS.length - 1 ? PLANOS[i + 1] : null;
}

/**
 * O tier de uma cobranca pelo VALOR que a Pagou devolve. E o que o webhook usa
 * para gravar o plano quando a gravacao do subscribe se perdeu. O valor antigo
 * (R$ 89) e os desconhecidos voltam null: o webhook entao nao mexe no plano.
 */
export function planoDoValor(centavos: number | null | undefined): PlanoId | null {
  return PLANOS.find((p) => p.precoCentavos === centavos)?.id ?? null;
}

/** Quanto a conta paga por mes (centavos), para o MRR do admin. 0 sem Pro. */
export function precoMensalCentavos(p: { plan?: string | null; plano?: string | null }): number {
  if (p.plan !== "pro") return 0;
  return planoPorId(p.plano)?.precoCentavos ?? PRO_PRICE_CENTS;
}

/** "1 loja com rastreamento", "Rastreamento sem limite de lojas". */
export function textoLimiteRastreamento(n: number | null): string {
  if (n === null) return "Rastreamento sem limite de lojas";
  return n === 1 ? "1 loja com rastreamento" : `${n} lojas com rastreamento`;
}

/** "Até 6 lojas no roteamento", "Roteamento sem limite de lojas". */
export function textoLimiteRoteamento(n: number | null): string {
  if (n === null) return "Roteamento sem limite de lojas";
  return n === 1 ? "1 loja no roteamento" : `Até ${n} lojas no roteamento`;
}

// Trial: quantas lojas uma conta nova pode clonar de graca antes de assinar.
// A trava usa profiles.free_clone_store_id (1 loja), entao manter em 1.
export const FREE_CLONE_LIMIT = 1;

// Pacotes de recarga avulsos (Pix, pagamento unico). amountCents em BRL.
export interface CreditPack {
  id: string;
  credits: number;
  amountCents: number;
  label: string;
}

export const CREDIT_PACKS: CreditPack[] = [
  { id: "pack_50", credits: 50, amountCents: 2500, label: "50 créditos" },
  { id: "pack_200", credits: 200, amountCents: 7500, label: "200 créditos" },
  { id: "pack_500", credits: 500, amountCents: 15000, label: "500 créditos" },
];

export function getCreditPack(id: string): CreditPack | undefined {
  return CREDIT_PACKS.find((pack) => pack.id === id);
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}

// Taxa usada APENAS no painel admin, para comparar receita (BRL, Pagou) com
// custo de IA (USD, Gemini) na mesma unidade. Nao afeta cobranca nenhuma.
// Ajuste por env quando o cambio andar demais.
export const USD_BRL_REPORTING = Number(process.env.USD_BRL_RATE) || 5.4;

/** Os dois limites numa linha: "1 loja com rastreamento · até 6 lojas no roteamento". */
export function resumoDosLimites(l: LimitesPlano): string {
  if (l.rastreamento === null && l.roteamento === null) {
    return "Rastreamento e roteamento sem limite de lojas";
  }
  const rota = textoLimiteRoteamento(l.roteamento);
  return `${textoLimiteRastreamento(l.rastreamento)} · ${rota.charAt(0).toLowerCase()}${rota.slice(1)}`;
}
