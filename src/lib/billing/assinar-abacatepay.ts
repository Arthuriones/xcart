import "server-only";
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AbacatePayError,
  cancelarAssinatura,
  buscarAssinatura,
  checkoutDeAssinatura,
  criarCheckoutDeAssinatura,
  garantirCliente,
  produtoDoPlano,
  respostaDoErroAbacate,
} from "@/lib/billing/abacatepay";
import { decidirEventoDeAssinatura, externalIdDaAssinatura } from "@/lib/billing/abacatepay-regras";
import { atualizarPerfil } from "@/lib/billing/limites";
import type { Plano } from "@/lib/billing/plans";
import { pixAutomaticoLigado } from "@/lib/billing/provedor";
import { getPublicAppUrl } from "@/lib/public-url";

// ============================================================================
// Assinar, ler e cancelar a assinatura pela AbacatePay. As rotas
// /api/billing/subscribe e /api/billing/subscription chamam daqui quando o
// provedor e a AbacatePay (provedorDeCobranca) ou a assinatura e dela.
//
// A assinatura nasce num checkout HOSPEDADO: o lojista vai a pagina da
// AbacatePay (cartao, 3DS dela e, se liberado, Pix Automatico) e volta pelo
// completionUrl. Quem liga o Pro e o webhook subscription.completed -- o
// retorno da pagina so mostra "conferindo o pagamento".
// ============================================================================

const VIVAS = ["active", "trialing", "past_due"];

/** Para onde a pagina da AbacatePay devolve: a Assinatura ou o paywall. */
export type Volta = "billing" | "paywall";

function caminhoDaVolta(volta: Volta, pago: boolean): string {
  const base = volta === "paywall" ? "/no-access" : "/billing";
  return `${getPublicAppUrl().replace(/\/+$/, "")}${base}${pago ? "?assinatura=ok" : ""}`;
}

/**
 * POST /api/billing/subscribe na AbacatePay: devolve `{ url }` do checkout de
 * assinatura. Sem idempotencia na API, o checkout PENDING da mesma conta,
 * plano e hora (externalIdDaAssinatura) e reaproveitado: o clique duplo nao
 * abre duas paginas que poderiam ser pagas.
 */
export async function assinarNaAbacatePay(
  user: { id: string; email?: string | null },
  plano: Plano,
  volta: Volta
): Promise<NextResponse> {
  const admin = createAdminClient();
  const { data: perfil } = await admin
    .from("profiles")
    .select(
      "pagou_subscription_id, abacatepay_subscription_id, subscription_status, document_number, nome, sobrenome, telefone"
    )
    .eq("id", user.id)
    .maybeSingle();
  const p = (perfil || {}) as {
    pagou_subscription_id?: string | null;
    abacatepay_subscription_id?: string | null;
    subscription_status?: string | null;
    document_number?: string | null;
    nome?: string | null;
    sobrenome?: string | null;
    telefone?: string | null;
  };

  // Ja assinante? Evita cobrar duas vezes a mesma conta.
  if ((p.abacatepay_subscription_id || p.pagou_subscription_id) && VIVAS.includes(String(p.subscription_status))) {
    return NextResponse.json({ error: "Você já tem uma assinatura ativa." }, { status: 409 });
  }

  try {
    // O preco mora no produto da AbacatePay; o que vale e o de plans.ts.
    // Produto ausente ou com outro preco: nao vende pelo valor errado.
    const produto = await produtoDoPlano(plano.id);
    if (!produto || produto.price !== plano.precoCentavos || (produto.cycle && produto.cycle !== "MONTHLY")) {
      console.error("[billing/subscribe] produto da AbacatePay fora do plano", {
        plano: plano.id,
        produto: produto ? { preco: produto.price, ciclo: produto.cycle } : null,
      });
      return NextResponse.json(
        { error: "Este plano não está disponível para assinatura agora. Fale com o suporte." },
        { status: 503 }
      );
    }

    const externalId = externalIdDaAssinatura(user.id, plano.id, Date.now());
    const pendente = await checkoutDeAssinatura(externalId);
    if (pendente?.url && String(pendente.status).toUpperCase() === "PENDING") {
      return NextResponse.json({ url: pendente.url, reaproveitado: true });
    }

    const clienteId = await garantirCliente(user.id, {
      email: user.email || `${user.id}@sem-email.xcart`,
      nome: [p.nome, p.sobrenome].filter(Boolean).join(" ") || null,
      telefone: p.telefone || null,
      documento: (p.document_number || "").replace(/\D/g, "") || null,
    });

    const checkout = await criarCheckoutDeAssinatura({
      produtoId: produto.id,
      clienteId,
      externalId,
      completionUrl: caminhoDaVolta(volta, true),
      returnUrl: caminhoDaVolta(volta, false),
      metodos: pixAutomaticoLigado() ? ["CARD", "PIX"] : ["CARD"],
      metadata: { user_id: user.id, plano: plano.id },
    });
    if (!checkout?.url) {
      return NextResponse.json({ error: "Não deu para abrir o pagamento. Tente de novo." }, { status: 502 });
    }
    return NextResponse.json({ url: checkout.url });
  } catch (error) {
    if (error instanceof AbacatePayError) {
      console.error("[billing/subscribe] AbacatePay", error.status, error.message);
      const { status, error: mensagem } = respostaDoErroAbacate(error);
      return NextResponse.json({ error: mensagem }, { status });
    }
    console.error("[billing/subscribe] AbacatePay", error);
    return NextResponse.json({ error: "Falha ao abrir o pagamento." }, { status: 500 });
  }
}

export interface PerfilDaAssinaturaAbacate {
  abacatepay_subscription_id: string | null;
  subscription_status: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
  payment_provider: string | null;
  plano?: string | null;
}

/**
 * GET /api/billing/subscription da assinatura da AbacatePay. A assinatura dela
 * nao tem fim de periodo: o fim e o do banco (o webhook grava). Aqui so se
 * confere se ela foi cancelada sem o aviso chegar -- ai o perfil passa a
 * "cancelamento agendado", com o Pro ate o fim ja pago.
 */
export async function lerAssinaturaAbacate(userId: string, perfil: PerfilDaAssinaturaAbacate) {
  const id = perfil.abacatepay_subscription_id;
  if (!id) return NextResponse.json({ provider: "abacatepay", subscription: null });
  const admin = createAdminClient();
  let status = perfil.subscription_status;
  let cancela = perfil.cancel_at_period_end === true;
  try {
    const sub = await buscarAssinatura(id);
    if (String(sub.status).toUpperCase() === "CANCELLED" && VIVAS.includes(String(status))) {
      const d = decidirEventoDeAssinatura(perfil, "subscription.cancelled", sub, {}, Date.now());
      if (d.patch) {
        const gravado = await atualizarPerfil(admin, userId, { ...d.patch, updated_at: new Date().toISOString() });
        if (gravado.error) console.error("[billing/subscription] GET sincronizar", gravado.error.message);
        else {
          status = String(d.patch.subscription_status);
          cancela = true;
        }
      }
    }
    return NextResponse.json({
      provider: "abacatepay",
      manageable: true,
      subscription: {
        id,
        status,
        amount: sub.amount ?? null,
        currency: "BRL",
        currentPeriodEnd: perfil.current_period_end,
        cancelAtPeriodEnd: cancela,
        cardLast4: null,
      },
    });
  } catch (error) {
    console.error("[billing/subscription] GET AbacatePay", error instanceof Error ? error.message : error);
    return NextResponse.json({
      provider: "abacatepay",
      manageable: true,
      stale: true,
      subscription: {
        id,
        status,
        currentPeriodEnd: perfil.current_period_end,
        cancelAtPeriodEnd: cancela,
      },
    });
  }
}

/**
 * DELETE /api/billing/subscription da AbacatePay. La o cancelamento e na hora
 * e nao devolve dinheiro: o xcart mantem o Pro ate o fim ja pago
 * (cancel_scheduled) e a porta (access.ts) fecha quando ele passa.
 */
export async function cancelarAssinaturaAbacate(userId: string, perfil: PerfilDaAssinaturaAbacate) {
  const id = perfil.abacatepay_subscription_id;
  if (!id) return NextResponse.json({ error: "Nenhuma assinatura ativa." }, { status: 404 });
  const admin = createAdminClient();
  try {
    const sub = await cancelarAssinatura(id);
    const d = decidirEventoDeAssinatura(perfil, "subscription.cancelled", sub, {}, Date.now());
    if (d.patch) {
      const gravado = await atualizarPerfil(admin, userId, { ...d.patch, updated_at: new Date().toISOString() });
      // Cancelada la; o webhook subscription.cancelled grava de novo.
      if (gravado.error) console.error("[billing/subscription] DELETE gravar", gravado.error.message);
    }
    const vale = d.patch?.subscription_status === "cancel_scheduled";
    return NextResponse.json({
      status: d.patch?.subscription_status ?? "canceled",
      cancelAtPeriodEnd: true,
      accessUntil: vale ? perfil.current_period_end : null,
    });
  } catch (error) {
    if (error instanceof AbacatePayError) {
      console.error("[billing/subscription] DELETE AbacatePay", error.status, error.message);
      const { status, error: mensagem } = respostaDoErroAbacate(error);
      return NextResponse.json({ error: mensagem }, { status });
    }
    console.error("[billing/subscription] DELETE AbacatePay", error);
    return NextResponse.json({ error: "Falha ao cancelar." }, { status: 500 });
  }
}
