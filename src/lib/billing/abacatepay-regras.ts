import { ehPlanoId, planoDoValor } from "@/lib/billing/plans";

// ============================================================================
// Regras puras da cobranca pela AbacatePay. Sem rede e sem banco: o cliente
// (abacatepay.ts), o webhook e as rotas usam, e os testes rodam sem nada.
//
// O que a AbacatePay NAO da e o xcart cobre aqui (docs/migracao-abacatepay):
//  - a assinatura nao tem inicio nem fim de periodo: o fim sai da data do
//    pagamento + o ciclo + a folga das retentativas (fimDoPeriodo);
//  - o cancelamento e na hora: o perfil fica "cancel_scheduled" com o Pro ate
//    o fim que ja estava pago;
//  - nao ha "em atraso": o subscription.payment_failed vira past_due.
// ============================================================================

/** Ciclos de produto da AbacatePay. Os planos do xcart sao MONTHLY. */
export type CicloAbacate = "WEEKLY" | "MONTHLY" | "QUARTERLY" | "SEMIANNUALLY" | "ANNUALLY";

const MESES_DO_CICLO: Record<string, number> = {
  MONTHLY: 1,
  QUARTERLY: 3,
  SEMIANNUALLY: 6,
  ANNUALLY: 12,
};

/**
 * A politica de retentativa das nossas assinaturas: 3 tentativas, de 2 em 2
 * dias. A folga do fim do periodo e o tempo delas -- o acesso nao cai enquanto
 * a AbacatePay ainda tenta cobrar.
 */
export const RETENTATIVA = { maxRetry: 3, retryEvery: 2 } as const;

const DIA_MS = 864e5;

/** Soma meses no calendario, sem pular mes: 31/01 + 1 mes = 28 ou 29/02. */
function somarMeses(ms: number, meses: number): number {
  const d = new Date(ms);
  const dia = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + meses);
  const ultimo = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(dia, ultimo));
  return d.getTime();
}

/**
 * Ate quando vale o que foi pago: a data do pagamento + o ciclo + a folga das
 * retentativas (em dias). Data invalida = null (quem chama nao grava).
 */
export function fimDoPeriodo(
  pagoEm: string | null | undefined,
  ciclo: string | null | undefined,
  folgaDias: number = RETENTATIVA.maxRetry * RETENTATIVA.retryEvery
): string | null {
  const ms = Date.parse(pagoEm || "");
  if (!Number.isFinite(ms)) return null;
  const c = String(ciclo || "MONTHLY").toUpperCase();
  const base = c === "WEEKLY" ? ms + 7 * DIA_MS : somarMeses(ms, MESES_DO_CICLO[c] ?? 1);
  return new Date(base + Math.max(0, folgaDias) * DIA_MS).toISOString();
}

/**
 * Status do Pix da AbacatePay no vocabulario que a janela do QR ja entende
 * (pix-dialog.tsx: "paid", e "expired"/"canceled" encerram).
 */
export function statusDoPix(status: unknown): "paid" | "expired" | "canceled" | "refunded" | "pending" {
  switch (String(status || "").toUpperCase()) {
    case "PAID":
      return "paid";
    case "EXPIRED":
      return "expired";
    case "CANCELLED":
    case "CANCELED":
      return "canceled";
    case "REFUNDED":
      return "refunded";
    default:
      return "pending";
  }
}

// ---------------------------------------------------------------------------
// externalId do checkout de assinatura
// ---------------------------------------------------------------------------

const HORA_MS = 36e5;
const RE_EXTERNAL = /^xc_([0-9a-f-]{36})_(.+)_(\d+)$/;

/**
 * O externalId do checkout de assinatura: conta, plano e a HORA do pedido. A
 * API nao tem idempotencia: o clique duplo, ou voltar e clicar de novo na
 * mesma hora, acha o checkout PENDING por este id e reaproveita a mesma
 * pagina, em vez de criar outra que tambem poderia ser paga.
 */
export function externalIdDaAssinatura(userId: string, plano: string, agoraMs: number): string {
  return `xc_${userId}_${plano}_${Math.floor(agoraMs / HORA_MS)}`;
}

/** De volta: a conta e o plano do checkout. Fora do formato, null. */
export function contaDoExternalId(externalId: unknown): { userId: string; plano: string } | null {
  const m = typeof externalId === "string" ? externalId.match(RE_EXTERNAL) : null;
  return m ? { userId: m[1], plano: m[2] } : null;
}

// ---------------------------------------------------------------------------
// O que um evento de assinatura muda no perfil
// ---------------------------------------------------------------------------

export type EventoDeAssinatura =
  | "subscription.completed"
  | "subscription.renewed"
  | "subscription.payment_failed"
  | "subscription.cancelled";

export function ehEventoDeAssinatura(e: unknown): e is EventoDeAssinatura {
  return (
    e === "subscription.completed" ||
    e === "subscription.renewed" ||
    e === "subscription.payment_failed" ||
    e === "subscription.cancelled"
  );
}

export interface PerfilDaAbacate {
  abacatepay_subscription_id?: string | null;
  pagou_subscription_id?: string | null;
  payment_provider?: string | null;
  subscription_status?: string | null;
  current_period_end?: string | null;
  /** profiles.plano. Ausente = coluna da 064 nao existe. */
  plano?: string | null;
}

export interface AssinaturaNaApi {
  id: string;
  /** "ACTIVE" ou "CANCELLED", como a API devolve. */
  status: string;
  amount?: number | null;
  method?: string | null;
}

export interface DecisaoDoEvento {
  aplicar: boolean;
  motivo: string | null;
  /** O que gravar no perfil (sem updated_at: quem grava poe). */
  patch: Record<string, unknown> | null;
  /** O periodo avancou: repor os creditos de IA ate esta data. */
  reporCreditosAte: string | null;
}

const NADA = (motivo: string): DecisaoDoEvento => ({ aplicar: false, motivo, patch: null, reporCreditosAte: null });

/** Assinatura recorrente que ainda cobra (o Pro dela vale e renova). */
const VIVA = new Set(["active", "trialing", "past_due"]);

/**
 * O que o evento muda no perfil, ja com a assinatura RELIDA na API (o corpo do
 * webhook e so aviso).
 *
 * - completed/renewed: so com a assinatura ACTIVE na API. A de outra
 *   assinatura so entra se o perfil nao tem outra viva (a gravacao do
 *   /subscribe que se perdeu); duas vivas na mesma conta ficam para o suporte.
 *   O fim do periodo so anda para frente. O tier sai do valor cobrado, e so
 *   quando a assinatura e nova para o perfil ou o perfil nao tem tier (o
 *   suporte pode ter mudado o plano).
 * - payment_failed: past_due, o acesso segue (a AbacatePay ainda tenta).
 * - cancelled: o Pro fica ate o fim ja pago (cancel_scheduled). Sem fim no
 *   futuro, cai na hora.
 * Evento de OUTRA assinatura que nao e a do perfil nunca derruba nada.
 */
export function decidirEventoDeAssinatura(
  perfil: PerfilDaAbacate,
  evento: EventoDeAssinatura,
  sub: AssinaturaNaApi,
  dados: { pagoEm?: string | null; ciclo?: string | null; clienteId?: string | null },
  agoraMs: number
): DecisaoDoEvento {
  const mesma = !!perfil.abacatepay_subscription_id && perfil.abacatepay_subscription_id === sub.id;
  const status = String(sub.status || "").toUpperCase();

  if (evento === "subscription.completed" || evento === "subscription.renewed") {
    if (status !== "ACTIVE") return NADA("assinatura nao esta ativa na API");
    if (!mesma) {
      const outraDaAbacate =
        !!perfil.abacatepay_subscription_id && VIVA.has(String(perfil.subscription_status ?? ""));
      const outraDaPagou =
        perfil.payment_provider === "pagou" &&
        !!perfil.pagou_subscription_id &&
        VIVA.has(String(perfil.subscription_status ?? ""));
      if (outraDaAbacate || outraDaPagou) return NADA("duas assinaturas vivas na mesma conta");
    }
    const fimNovo = fimDoPeriodo(dados.pagoEm || new Date(agoraMs).toISOString(), dados.ciclo);
    const fimAtual = mesma ? Date.parse(perfil.current_period_end || "") : NaN;
    const fim =
      fimNovo && Number.isFinite(fimAtual) && fimAtual > Date.parse(fimNovo)
        ? (perfil.current_period_end as string)
        : fimNovo;
    const tier = planoDoValor(sub.amount);
    const gravaTier = !mesma || !ehPlanoId(perfil.plano);
    return {
      aplicar: true,
      motivo: null,
      patch: {
        payment_provider: "abacatepay",
        abacatepay_subscription_id: sub.id,
        ...(dados.clienteId ? { abacatepay_customer_id: dados.clienteId } : {}),
        subscription_status: "active",
        subscription_method: String(sub.method || "").toUpperCase() === "PIX" ? "pix" : "card",
        plan: "pro",
        ...(gravaTier && tier ? { plano: tier } : {}),
        current_period_end: fim,
        cancel_at_period_end: false,
      },
      reporCreditosAte: fim && fim !== perfil.current_period_end ? fim : null,
    };
  }

  if (!mesma) return NADA("evento de outra assinatura");

  if (evento === "subscription.payment_failed") {
    return {
      aplicar: true,
      motivo: null,
      patch: { subscription_status: "past_due" },
      reporCreditosAte: null,
    };
  }

  // subscription.cancelled: a AbacatePay ja cancelou (na hora). O que foi pago
  // continua valendo ate o fim.
  const fimMs = Date.parse(perfil.current_period_end || "");
  if (Number.isFinite(fimMs) && fimMs > agoraMs) {
    return {
      aplicar: true,
      motivo: null,
      patch: { subscription_status: "cancel_scheduled", cancel_at_period_end: true },
      reporCreditosAte: null,
    };
  }
  return {
    aplicar: true,
    motivo: null,
    patch: { subscription_status: "canceled", cancel_at_period_end: true, plan: "free" },
    reporCreditosAte: null,
  };
}

// ---------------------------------------------------------------------------
// Acesso: o Pro da AbacatePay que ja venceu
// ---------------------------------------------------------------------------

/**
 * O Pro pago pela AbacatePay que nao renova mais: o Pix avulso (sem
 * assinatura) e a assinatura cancelada. O fim gravado passou = sem acesso,
 * mesmo com o banco ainda dizendo "pro" (ninguem avisa quando o prazo acaba).
 * A assinatura viva NAO vence por aqui: o fim so anda quando o webhook chega,
 * e um atraso tiraria o acesso de quem paga em dia.
 */
export function proDaAbacateVencido(
  p: {
    plan?: string | null;
    payment_provider?: string | null;
    abacatepay_subscription_id?: string | null;
    subscription_status?: string | null;
    current_period_end?: string | null;
  },
  agoraMs: number
): boolean {
  if (p.plan !== "pro" || p.payment_provider !== "abacatepay") return false;
  const naoRenova =
    !p.abacatepay_subscription_id ||
    p.subscription_status === "cancel_scheduled" ||
    p.subscription_status === "canceled";
  if (!naoRenova || !p.current_period_end) return false;
  return Date.parse(p.current_period_end) < agoraMs;
}
