import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createSubscription,
  getOrCreateCustomer,
  planoDoStatus,
  PagouError,
} from "@/lib/billing/pagou";
import { CURRENCY, ehPlanoId, planoDoValor, planoPorId } from "@/lib/billing/plans";
import { atualizarPerfil } from "@/lib/billing/limites";

export const runtime = "nodejs";

/**
 * POST -> cria a assinatura de um dos planos na Pagou.
 *
 * Body: { plano, cardToken } para cartao, ou { plano, method: "pix_automatic",
 * billingDay }. `plano` e obrigatorio ('loja1' | 'lojas3' | 'ilimitado'): o
 * valor cobrado sai de plans.ts pelo tier, nunca do corpo.
 *
 * Ao contrario do Stripe, nao ha checkout hospedado: o cartao ja vem
 * tokenizado do browser (Payment Element) e a assinatura nasce aqui. Por isso
 * a resposta nao e uma URL de redirect, e sim o estado da assinatura.
 */
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const plano = ehPlanoId(body.plano) ? planoPorId(body.plano)! : null;
  if (!plano) {
    return NextResponse.json({ error: "Escolha um plano." }, { status: 400 });
  }
  const cardToken = typeof body.cardToken === "string" ? body.cardToken.trim() : "";
  const usarPix = body.method === "pix_automatic";

  if (!cardToken && !usarPix) {
    return NextResponse.json(
      { error: "Informe um cartão ou escolha Pix automático." },
      { status: 400 }
    );
  }
  if (cardToken && !cardToken.startsWith("pgct_")) {
    return NextResponse.json(
      { error: "Token de cartão inválido." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // Ja assinante? Evita cobrar duas vezes a mesma conta.
  const { data: profile } = await admin
    .from("profiles")
    .select("plan, pagou_subscription_id, subscription_status")
    .eq("id", user.id)
    .single();

  if (
    profile?.pagou_subscription_id &&
    profile.subscription_status &&
    !["canceled", "incomplete"].includes(profile.subscription_status)
  ) {
    return NextResponse.json(
      { error: "Você já tem uma assinatura ativa." },
      { status: 409 }
    );
  }

  try {
    const customerId = await getOrCreateCustomer(user.id, user.email, null);

    // Chave estavel por usuario+dia+plano: um duplo clique nao gera duas
    // assinaturas. O plano entra na chave porque a Pagou devolve a assinatura
    // da primeira chamada para a mesma chave -- sem ele, quem trocasse de
    // plano no mesmo dia (cartao recusado, tenta de novo com outro) receberia
    // a assinatura do valor antigo.
    const idempotencyKey = `sub_${user.id}_${new Date().toISOString().slice(0, 10)}_${plano.id}`;

    const sub = await createSubscription({
      customerId,
      amountCents: plano.precoCentavos,
      plano: plano.id,
      currency: CURRENCY,
      userId: user.id,
      cardToken: cardToken || undefined,
      billingDayOfMonth: usarPix
        ? Number(body.billingDay) || new Date().getUTCDate()
        : undefined,
      idempotencyKey,
    });

    await atualizarPerfil(admin, user.id, {
      pagou_customer_id: customerId,
      pagou_subscription_id: sub.id,
      payment_provider: "pagou",
      subscription_status: sub.status,
      plan: planoDoStatus(sub.status),
      // O valor que a Pagou devolve manda; o pedido so cobre resposta sem valor.
      plano: planoDoValor(sub.amount) ?? plano.id,
      current_period_end: sub.currentPeriodEnd || null,
      cancel_at_period_end: sub.cancelAtPeriodEnd === true,
      updated_at: new Date().toISOString(),
    });

    return NextResponse.json({
      subscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd || null,
      cardLast4: sub.cardLast4 || null,
      // Devolvida ao Payment Element: e o objeto que ele sabe resolver
      // (inclusive 3DS na primeira cobranca).
      transaction: sub.transactions?.[0] || null,
      // incomplete = a Pagou ainda esta processando a primeira cobranca;
      // o webhook confirma depois.
      pending: sub.status === "incomplete",
    });
  } catch (error) {
    if (error instanceof PagouError) {
      console.error("[billing/subscribe] Pagou", error.status, error.code, error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status >= 400 && error.status < 500 ? error.status : 502 }
      );
    }
    console.error("[billing/subscribe]", error);
    return NextResponse.json(
      { error: "Falha ao criar assinatura." },
      { status: 500 }
    );
  }
}
