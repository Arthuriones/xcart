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
// Os planos (decisao do Arthur, 24/10/2026): Roteamento, Completo e
// Ilimitado. Todos sao "pro" para fins de acesso (profiles.plan = 'pro'); o
// que muda e o LIMITE, gravado em profiles.plano:
//   - vitrines e lojas de checkout no roteamento, contadas a parte;
//   - operacoes (loja Shopify ou checkout externo) com o rastreamento ligado.
//     0 = o plano nao inclui rastreamento (nenhum a venda hoje: desde
//     25/10/2026 o Roteamento rastreia 1 operacao).
// A trava e so de quantidade (limites.ts). Recurso nenhum fica preso ao plano.
//
// Os planos de 08/10/2026 (1 Loja, 3 Lojas, Ilimitado de R$ 169,90) sairam da
// venda, mas quem ja paga por eles MANTEM preco e limite: continuam
// reconhecidos pelo valor (webhook), pelos limites, no MRR do admin e na troca
// por Pix (apply_paid_purchase, migration 078). O limite deles era de lojas
// distintas no roteamento (vitrines + checkouts juntas): `roteamento`.
//
// Este e o catalogo UNICO: o checkout cobra daqui, a landing, o paywall e a
// Assinatura mostram daqui, e a trava de limite (limites.ts) le daqui.
// ============================================================================

export type PlanoAVendaId = "roteamento" | "completo" | "ilimitado_v2";
export type PlanoAnteriorId = "loja1" | "lojas3" | "ilimitado";
export type PlanoId = PlanoAVendaId | PlanoAnteriorId;

export interface LimitesPlano {
  /**
   * Operacoes com o rastreamento ligado: lojas Shopify e checkouts externos,
   * no mesmo conjunto. 0 = nao incluso. null = sem limite.
   */
  rastreamento: number | null;
  /** Vitrines distintas no roteamento. null = sem limite. */
  vitrines: number | null;
  /** Lojas de checkout distintas no roteamento. null = sem limite. */
  checkouts: number | null;
  /**
   * Lojas distintas no roteamento, vitrines e checkouts juntas: o teto dos
   * planos anteriores. null = sem esse teto.
   */
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
  /** Aparece para assinar. Os anteriores so valem para quem ja paga por eles. */
  aVenda: boolean;
}

export const PLANOS: readonly Plano[] = [
  {
    id: "roteamento",
    nome: "Roteamento",
    precoCentavos: 19700,
    limites: { rastreamento: 1, vitrines: 1, checkouts: 1, roteamento: null },
    selo: null,
    subtitulo: "Uma vitrine roteando para uma loja de checkout",
    destaque: false,
    aVenda: true,
  },
  {
    id: "completo",
    nome: "Completo",
    precoCentavos: 49700,
    limites: { rastreamento: 5, vitrines: 5, checkouts: 5, roteamento: null },
    selo: "Recomendado",
    subtitulo: "Roteamento com rodízio e rastreamento",
    destaque: true,
    aVenda: true,
  },
  {
    id: "ilimitado_v2",
    nome: "Ilimitado",
    precoCentavos: 99700,
    limites: { rastreamento: null, vitrines: null, checkouts: null, roteamento: null },
    selo: null,
    subtitulo: "Vitrines, checkouts e rastreamento sem limite",
    destaque: false,
    aVenda: true,
  },
];

/** Fora da venda desde 24/10/2026. Mesmos preco e limites de quando foram assinados. */
export const PLANOS_ANTERIORES: readonly Plano[] = [
  {
    id: "loja1",
    nome: "1 Loja",
    precoCentavos: 7990,
    limites: { rastreamento: 1, vitrines: null, checkouts: null, roteamento: 6 },
    selo: null,
    subtitulo: "Perfeito para começar",
    destaque: false,
    aVenda: false,
  },
  {
    id: "lojas3",
    nome: "3 Lojas",
    precoCentavos: 11990,
    limites: { rastreamento: 3, vitrines: null, checkouts: null, roteamento: 12 },
    selo: null,
    subtitulo: "Mais lojas para integrar",
    destaque: false,
    aVenda: false,
  },
  {
    id: "ilimitado",
    nome: "Ilimitado",
    precoCentavos: 16990,
    limites: { rastreamento: null, vitrines: null, checkouts: null, roteamento: null },
    selo: null,
    subtitulo: "Máxima economia + recursos infinitos",
    destaque: false,
    aVenda: false,
  },
];

const TODOS_OS_PLANOS: readonly Plano[] = [...PLANOS, ...PLANOS_ANTERIORES];

/**
 * Limites de quem nao tem tier gravado: assinante de antes dos planos (Stripe
 * ou Pagou a R$ 89) e conta sem assinatura. Palavra do Arthur (08/10): o do
 * 1 Loja -- e continua assim.
 */
export const PLANO_BASE: PlanoId = "loja1";

export const GARANTIA_DIAS = 7;

/** A garantia em texto. O reembolso e manual, pelo suporte. */
export const GARANTIA = {
  curta: `${GARANTIA_DIAS} dias de garantia`,
  longa: `${GARANTIA_DIAS} dias de garantia de satisfação ou seu dinheiro de volta!`,
} as const;

/** Qualquer plano conhecido, a venda ou anterior (o que pode estar no banco). */
export function ehPlanoId(v: unknown): v is PlanoId {
  return TODOS_OS_PLANOS.some((p) => p.id === v);
}

/** So os planos que se assinam hoje. */
export function ehPlanoAVenda(v: unknown): v is PlanoAVendaId {
  return PLANOS.some((p) => p.id === v);
}

export function planoPorId(id: unknown): Plano | undefined {
  return TODOS_OS_PLANOS.find((p) => p.id === id);
}

/** "3 Lojas (plano anterior)" para quem ainda paga um plano fora da venda. */
export function nomeNaTela(p: Plano): string {
  return p.aVenda ? p.nome : `${p.nome} (plano anterior)`;
}

/** O plano de partida da escolha (o em destaque). */
export function planoEmDestaque(): Plano {
  return PLANOS.find((p) => p.destaque) ?? PLANOS[0];
}

/** O que a conta usa (ou usaria depois de uma mudanca), contado. */
export interface ContagemDeUso {
  rastreamento: number;
  vitrines: number;
  checkouts: number;
  /** Lojas distintas no roteamento, vitrines e checkouts juntas. */
  roteamento: number;
}

/** O uso cabe nestes limites? */
export function cabeNoPlano(l: LimitesPlano, u: ContagemDeUso): boolean {
  const cabe = (limite: number | null, n: number) => limite === null || n <= limite;
  // Sem teto total, N lojas distintas ainda nao cabem em menos que vitrines + checkouts.
  const total =
    l.roteamento ?? (l.vitrines !== null && l.checkouts !== null ? l.vitrines + l.checkouts : null);
  return (
    cabe(l.rastreamento, u.rastreamento) &&
    cabe(l.vitrines, u.vitrines) &&
    cabe(l.checkouts, u.checkouts) &&
    cabe(total, u.roteamento)
  );
}

/** O primeiro plano A VENDA (do mais barato) onde o uso cabe. null se nenhum. */
export function planoQueCobre(u: ContagemDeUso, atual?: PlanoId | null): Plano | null {
  return PLANOS.find((p) => p.id !== atual && cabeNoPlano(p.limites, u)) ?? null;
}

/**
 * O tier de uma cobranca pelo VALOR que a Pagou devolve. E o que o webhook usa
 * para gravar o plano quando a gravacao do subscribe se perdeu. Reconhece os a
 * venda e os anteriores (os precos nao se repetem). O valor antigo (R$ 89) e
 * os desconhecidos voltam null: o webhook entao nao mexe no plano.
 */
export function planoDoValor(centavos: number | null | undefined): PlanoId | null {
  return TODOS_OS_PLANOS.find((p) => p.precoCentavos === centavos)?.id ?? null;
}

/** Quanto a conta paga por mes (centavos), para o MRR do admin. 0 sem Pro. */
export function precoMensalCentavos(p: { plan?: string | null; plano?: string | null }): number {
  if (p.plan !== "pro") return 0;
  return planoPorId(p.plano)?.precoCentavos ?? PRO_PRICE_CENTS;
}

/** "1 vitrine", "até 5 vitrines". */
export function quantas(n: number, um: string, varios: string): string {
  return n === 1 ? `1 ${um}` : `até ${n} ${varios}`;
}

function comMaiuscula(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function comMinuscula(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** "Sem rastreamento", "Rastreamento em até 5 operações (loja ou checkout)". */
export function textoLimiteRastreamento(n: number | null): string {
  if (n === null) return "Rastreamento sem limite de operações";
  if (n === 0) return "Sem rastreamento";
  return `Rastreamento em ${quantas(n, "operação", "operações")} (loja ou checkout)`;
}

/**
 * "1 vitrine e 1 loja de checkout no roteamento", "Até 6 lojas no roteamento"
 * (os planos anteriores), "Roteamento sem limite de lojas".
 */
export function textoLimiteRoteamento(l: Pick<LimitesPlano, "vitrines" | "checkouts" | "roteamento">): string {
  if (l.vitrines === null && l.checkouts === null) {
    if (l.roteamento === null) return "Roteamento sem limite de lojas";
    return `${comMaiuscula(quantas(l.roteamento, "loja", "lojas"))} no roteamento`;
  }
  const vitrines = l.vitrines === null ? "vitrines sem limite" : quantas(l.vitrines, "vitrine", "vitrines");
  const checkouts =
    l.checkouts === null
      ? "lojas de checkout sem limite"
      : quantas(l.checkouts, "loja de checkout", "lojas de checkout");
  const total = l.roteamento === null ? "" : `, ${quantas(l.roteamento, "loja", "lojas")} no total`;
  return `${comMaiuscula(vitrines)} e ${checkouts} no roteamento${total}`;
}

/** Os limites numa linha: "Rastreamento em 1 operação (loja ou checkout) · 1 vitrine e 1 loja de checkout no roteamento". */
export function resumoDosLimites(l: LimitesPlano): string {
  if (l.rastreamento === null && l.vitrines === null && l.checkouts === null && l.roteamento === null) {
    return "Rastreamento e roteamento sem limite";
  }
  return `${textoLimiteRastreamento(l.rastreamento)} · ${comMinuscula(textoLimiteRoteamento(l))}`;
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
