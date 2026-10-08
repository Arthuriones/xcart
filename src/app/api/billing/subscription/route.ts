import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cancelSubscription,
  getSubscription,
  planoDoStatus,
  PagouError,
  respostaDoErroPagou,
} from "@/lib/billing/pagou";
import { atualizarPerfil, lerComPlano } from "@/lib/billing/limites";
import { decidirAviso } from "@/lib/billing/evento-assinatura";

export const runtime = "nodejs";

/**
 * Substitui o Customer Portal do Stripe, que a Pagou nao tem.
 *
 * GET    -> estado atual da assinatura (sincronizado com a API da Pagou).
 * DELETE -> agenda o cancelamento. A Pagou so cancela no fim do periodo:
 *           nao existe cancelamento imediato.
 */

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: lido } = await lerComPlano((plano) =>
    admin
      .from("profiles")
      .select(
        `plan, payment_provider, pagou_subscription_id, stripe_subscription_id, subscription_status, current_period_end, cancel_at_period_end${plano}`
      )
      .eq("id", user.id)
      .single()
  );
  const profile = lido as {
    plan: string | null;
    plano?: string | null;
    payment_provider: string | null;
    pagou_subscription_id: string | null;
    subscription_status: string | null;
    current_period_end: string | null;
    cancel_at_period_end: boolean | null;
  } | null;

  // Assinatura legada do Stripe: o app so mostra, nao gerencia por aqui.
  if (profile?.payment_provider === "stripe") {
    return NextResponse.json({
      provider: "stripe",
      legacy: true,
      plan: profile.plan,
      status: profile.subscription_status,
      currentPeriodEnd: profile.current_period_end,
      cancelAtPeriodEnd: profile.cancel_at_period_end === true,
      manageable: false,
    });
  }

  if (!profile?.pagou_subscription_id) {
    return NextResponse.json({ provider: "pagou", subscription: null });
  }

  try {
    const sub = await getSubscription(profile.pagou_subscription_id);

    // Mantem o profile em dia mesmo se algum webhook tiver se perdido. O tier
    // so e gravado pelo valor quando o perfil ainda nao tem: se o suporte
    // mudou o plano, a visita a esta tela nao desfaz.
    const { plano } = decidirAviso(profile, sub);
    const gravado = await atualizarPerfil(admin, user.id, {
      subscription_status: sub.status,
      plan: planoDoStatus(sub.status),
      ...(plano ? { plano } : {}),
      current_period_end: sub.currentPeriodEnd || null,
      cancel_at_period_end: sub.cancelAtPeriodEnd === true,
      updated_at: new Date().toISOString(),
    });
    if (gravado.error) console.error("[billing/subscription] GET sincronizar", gravado.error.message);

    return NextResponse.json({
      provider: "pagou",
      manageable: true,
      subscription: {
        id: sub.id,
        status: sub.status,
        amount: sub.amount,
        currency: sub.currency,
        currentPeriodEnd: sub.currentPeriodEnd || null,
        cancelAtPeriodEnd: sub.cancelAtPeriodEnd === true,
        cardLast4: sub.cardLast4 || null,
      },
    });
  } catch (error) {
    console.error("[billing/subscription] GET", error);
    // Cai para o que esta no banco em vez de quebrar a tela.
    return NextResponse.json({
      provider: "pagou",
      manageable: true,
      stale: true,
      subscription: {
        id: profile.pagou_subscription_id,
        status: profile.subscription_status,
        currentPeriodEnd: profile.current_period_end,
        cancelAtPeriodEnd: profile.cancel_at_period_end === true,
      },
    });
  }
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from("profiles")
    .select("payment_provider, pagou_subscription_id")
    .eq("id", user.id)
    .single();

  if (profile?.payment_provider === "stripe") {
    return NextResponse.json(
      {
        error:
          "Esta assinatura foi criada no provedor anterior. Fale com o suporte para cancelar.",
      },
      { status: 409 }
    );
  }
  if (!profile?.pagou_subscription_id) {
    return NextResponse.json(
      { error: "Nenhuma assinatura ativa." },
      { status: 404 }
    );
  }

  try {
    const sub = await cancelSubscription(profile.pagou_subscription_id, "user_requested");

    await admin
      .from("profiles")
      .update({
        subscription_status: sub.status,
        cancel_at_period_end: true,
        current_period_end: sub.currentPeriodEnd || null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", user.id);

    return NextResponse.json({
      status: sub.status,
      cancelAtPeriodEnd: true,
      // O acesso continua ate esta data — a Pagou nao cancela na hora.
      accessUntil: sub.currentPeriodEnd || null,
    });
  } catch (error) {
    if (error instanceof PagouError) {
      console.error("[billing/subscription] DELETE Pagou", error.status, error.code, error.message);
      const { status, error: mensagem } = respostaDoErroPagou(error);
      return NextResponse.json({ error: mensagem }, { status });
    }
    console.error("[billing/subscription] DELETE", error);
    return NextResponse.json({ error: "Falha ao cancelar." }, { status: 500 });
  }
}
