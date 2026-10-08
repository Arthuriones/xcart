import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getSubscription,
  getTransaction,
  planoDoStatus,
} from "@/lib/billing/pagou";
import { PRO_INCLUDED_CREDITS } from "@/lib/billing/plans";
import { atualizarPerfil, lerComPlano } from "@/lib/billing/limites";
import { decidirAviso, type PerfilDoAviso } from "@/lib/billing/evento-assinatura";

export const runtime = "nodejs";

/**
 * Webhook da Pagou.
 *
 * SEGURANCA — a Pagou nao documenta assinatura HMAC no webhook. Em vez de
 * confiar no corpo recebido, este handler o trata como simples AVISO:
 *
 *   1. exige um token secreto na querystring (vai na notify_url);
 *   2. deduplica pelo id de topo do evento, como a doc pede;
 *   3. le apenas o id do recurso do corpo e busca o estado real via GET
 *      autenticado na API antes de creditar ou mudar plano.
 *
 * Assim, mesmo que alguem descubra a URL e poste um "transaction.paid" forjado,
 * nada e creditado: a API da Pagou desmente.
 */

interface Envelope {
  id?: string;
  event?: string;
  type?: string;
  data?: {
    id?: string;
    event_type?: string;
    object?: { id?: string; [k: string]: unknown };
    [k: string]: unknown;
  };
}

export async function POST(request: NextRequest) {
  const esperado = process.env.PAGOU_WEBHOOK_TOKEN;
  if (!esperado) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  // A Pagou envia o token cadastrado no painel, mas a doc nao diz em qual
  // header. Aceitamos tanto pela querystring (?t=, que nos mesmos colocamos na
  // notify_url) quanto pelos headers mais provaveis — assim funciona
  // independente de como eles entregarem.
  const candidatos = [
    request.nextUrl.searchParams.get("t"),
    request.headers.get("x-webhook-token"),
    request.headers.get("x-pagou-token"),
    request.headers.get("x-pagou-signature"),
    request.headers.get("webhook-token"),
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""),
  ].filter(Boolean) as string[];

  const autorizado = candidatos.some(
    (c) =>
      c.length === esperado.length &&
      timingSafeEqual(Buffer.from(c), Buffer.from(esperado))
  );
  if (!autorizado) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let corpo: Envelope;
  try {
    corpo = (await request.json()) as Envelope;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }

  const eventId = corpo.id;
  if (!eventId) {
    return NextResponse.json({ error: "Evento sem id." }, { status: 400 });
  }

  const familia = corpo.event || corpo.type || "";
  const tipo = corpo.data?.event_type || corpo.type || "";
  const recursoId = corpo.data?.id || corpo.data?.object?.id || null;

  const admin = createAdminClient();

  // Dedupe: o primeiro insert vence, os repetidos batem na PK e saem em 200 --
  // menos o evento que ja chegou e FALHOU: o 500 abaixo pede reenvio, e o
  // reenvio tem que processar de novo (antes ele batia na PK e saia em 200, e
  // o evento ficava perdido). Reprocessar e seguro: o Pix aplica uma vez so
  // (apply_paid_purchase) e a assinatura e lida da API e regravada igual.
  const { error: dupErr } = await admin.from("payment_events").insert({
    id: eventId,
    provider: "pagou",
    event: familia,
    event_type: tipo,
    resource_id: recursoId,
    payload: corpo as unknown as Record<string, unknown>,
  });
  if (dupErr) {
    // 23505 = unique_violation: evento ja recebido.
    if ((dupErr as { code?: string }).code !== "23505") {
      console.error("[pagou/webhook] falha ao registrar evento", dupErr);
      return NextResponse.json({ error: "Erro interno." }, { status: 500 });
    }
    const { data: anterior } = await admin
      .from("payment_events")
      .select("processed_at")
      .eq("id", eventId)
      .maybeSingle();
    if (!anterior || anterior.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    if (familia === "transaction" || tipo.startsWith("transaction.")) {
      await tratarTransacao(recursoId);
    } else if (familia === "subscription" || tipo.startsWith("subscription.")) {
      await tratarAssinatura(recursoId);
    }

    await admin
      .from("payment_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", eventId);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "erro";
    console.error("[pagou/webhook]", tipo, msg);
    await admin.from("payment_events").update({ error: msg }).eq("id", eventId);
    // 500 para a Pagou reenviar; o dedupe cobre o reprocessamento.
    return NextResponse.json({ error: "Erro ao processar." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------

async function tratarTransacao(id: string | null) {
  if (!id) return;
  const admin = createAdminClient();

  // Fonte da verdade: a API, nao o corpo do webhook.
  const tx = await getTransaction(id);

  const { data: compra } = await admin
    .from("credit_purchases")
    .select("id, status")
    .eq("pagou_transaction_id", id)
    .maybeSingle();
  if (!compra) return; // transacao que nao e recarga de credito

  if (tx.status === "paid") {
    const { error } = await admin.rpc("apply_paid_purchase", { p_transaction_id: id });
    // Sem isto a falha marcava o evento como processado e o Pix pago ficava
    // sem aplicar ate alguem abrir a tela do QR.
    if (error) throw new Error(error.message);
    return;
  }

  const perdidas = ["refused", "canceled", "expired", "refunded", "chargedback"];
  if (perdidas.includes(tx.status) && compra.status !== "paid") {
    await admin
      .from("credit_purchases")
      .update({ status: tx.status })
      .eq("pagou_transaction_id", id);
  }
}

async function tratarAssinatura(id: string | null) {
  if (!id) return;
  const admin = createAdminClient();

  const sub = await getSubscription(id);

  const userId =
    (sub.metadata?.user_id as string | undefined) ||
    (
      await admin
        .from("profiles")
        .select("id")
        .eq("pagou_subscription_id", id)
        .maybeSingle()
    ).data?.id;
  if (!userId) return;

  const { data: lido, error: erroLeitura } = await lerComPlano((plano) =>
    admin
      .from("profiles")
      .select(`current_period_end, subscription_status, pagou_subscription_id${plano}`)
      .eq("id", userId)
      .maybeSingle()
  );
  // Lancar responde 500 e a Pagou reenvia.
  if (erroLeitura) throw new Error(erroLeitura.message);
  const antes = lido as unknown as
    | (PerfilDoAviso & { current_period_end: string | null })
    | null;
  if (!antes) return;

  // So a assinatura do perfil (ou uma nova que esta pagando) mexe nele: o
  // cancelamento de uma tentativa abandonada, ou do cartao antigo de quem
  // passou para o Pix, nao tira o acesso. O tier sai do VALOR que a API diz
  // que cobra, e so quando a assinatura e nova ou o perfil nao tem tier.
  const decisao = decidirAviso(antes, sub);
  if (!decisao.aplicar) {
    console.warn("[pagou/webhook] aviso ignorado", { assinatura: sub.id, motivo: decisao.motivo });
    return;
  }

  const gravado = await atualizarPerfil(admin, userId, {
    pagou_subscription_id: sub.id,
    pagou_customer_id: sub.customerId,
    payment_provider: "pagou",
    subscription_status: sub.status,
    plan: planoDoStatus(sub.status),
    ...(decisao.plano ? { plano: decisao.plano } : {}),
    current_period_end: sub.currentPeriodEnd || null,
    cancel_at_period_end: sub.cancelAtPeriodEnd === true,
    updated_at: new Date().toISOString(),
  });
  if (gravado.error) throw new Error(gravado.error.message);

  // Renovacao: o periodo avancou e a assinatura esta em dia -> repoe creditos.
  // Comparar o fim do periodo evita repor duas vezes no mesmo ciclo.
  const virouPeriodo =
    sub.currentPeriodEnd && sub.currentPeriodEnd !== antes?.current_period_end;
  const emDia = sub.status === "active" || sub.status === "trialing";

  if (virouPeriodo && emDia) {
    await admin.rpc("reset_ai_credits", {
      p_user_id: userId,
      p_amount: PRO_INCLUDED_CREDITS,
      p_period_end: sub.currentPeriodEnd,
    });
  }
}
