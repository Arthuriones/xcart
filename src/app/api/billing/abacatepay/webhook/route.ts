import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  buscarAssinatura,
  conferirPix,
  corpoDoWebhookIntegro,
  segredoDoWebhookValido,
} from "@/lib/billing/abacatepay";
import {
  contaDoExternalId,
  decidirEventoDeAssinatura,
  ehEventoDeAssinatura,
  statusDoPix,
  type PerfilDaAbacate,
} from "@/lib/billing/abacatepay-regras";
import { PRO_INCLUDED_CREDITS } from "@/lib/billing/plans";
import { atualizarPerfil, lerComPlano } from "@/lib/billing/limites";

export const runtime = "nodejs";

/**
 * Webhook da AbacatePay (docs/migracao-abacatepay/estudo.md, 4.3).
 *
 * SEGURANCA. A origem se prova pelo `?webhookSecret=` que NOS definimos ao
 * cadastrar o webhook (ABACATEPAY_WEBHOOK_SECRET), conferido em tempo
 * constante. O `X-Webhook-Signature` e HMAC do corpo cru com uma chave PUBLICA
 * (a mesma para todas as lojas, esta na doc): garante so que o corpo chegou
 * inteiro, e tambem e exigido. Sem os dois: 401 -- a AbacatePay nao repete
 * 4xx, e repetir nao consertaria.
 *
 * Nao ha timestamp para barrar reenvio. Por isso, mesmo autorizado, o corpo e
 * so AVISO, como no webhook da Pagou:
 *   1. deduplica pelo `id` do corpo (o mesmo em todas as retentativas);
 *   2. le o id do recurso e busca o estado real na API antes de creditar ou
 *      mudar plano. Um evento repetido de fora nao muda nada que a API nao
 *      confirme.
 *
 * Falha ao processar responde 500: a AbacatePay tenta de novo (5 s, 5 min,
 * 30 min, 2 h, 5 h, 10 h -- ~18 h) e o evento que falhou e reprocessado.
 */

interface Envelope {
  id?: string;
  event?: string;
  devMode?: boolean;
  data?: {
    transparent?: { id?: string };
    subscription?: { id?: string; frequency?: string | null };
    customer?: { id?: string } | null;
    payment?: { createdAt?: string | null; updatedAt?: string | null } | null;
    checkout?: { externalId?: string | null } | null;
    [k: string]: unknown;
  };
}

export async function POST(request: NextRequest) {
  if (!process.env.ABACATEPAY_WEBHOOK_SECRET?.trim()) {
    return NextResponse.json({ error: "Webhook não configurado." }, { status: 503 });
  }

  // Corpo CRU primeiro: o HMAC e sobre os bytes exatos recebidos.
  const corpoCru = await request.text();
  const autorizado =
    segredoDoWebhookValido(request.nextUrl.searchParams.get("webhookSecret")) &&
    corpoDoWebhookIntegro(corpoCru, request.headers.get("x-webhook-signature"));
  if (!autorizado) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let corpo: Envelope;
  try {
    corpo = JSON.parse(corpoCru) as Envelope;
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  if (!corpo || typeof corpo !== "object" || !corpo.id || typeof corpo.event !== "string") {
    return NextResponse.json({ error: "Evento sem id." }, { status: 400 });
  }

  const evento = corpo.event;
  const recursoId = corpo.data?.transparent?.id || corpo.data?.subscription?.id || null;
  const admin = createAdminClient();

  // Dedupe: o primeiro insert vence; repetido sai em 200 -- menos o que ja
  // chegou e FALHOU (o 500 pediu reenvio, e o reenvio tem que processar).
  const { error: dupErr } = await admin.from("payment_events").insert({
    id: `abacatepay:${corpo.id}`,
    provider: "abacatepay",
    event: evento.split(".")[0],
    event_type: evento,
    resource_id: recursoId,
    payload: corpo as unknown as Record<string, unknown>,
  });
  if (dupErr) {
    if ((dupErr as { code?: string }).code !== "23505") {
      console.error("[abacatepay/webhook] falha ao registrar evento", dupErr);
      return NextResponse.json({ error: "Erro interno." }, { status: 500 });
    }
    const { data: anterior } = await admin
      .from("payment_events")
      .select("processed_at")
      .eq("id", `abacatepay:${corpo.id}`)
      .maybeSingle();
    if (!anterior || anterior.processed_at) {
      return NextResponse.json({ received: true, duplicate: true });
    }
  }

  try {
    if (evento.startsWith("transparent.")) await tratarPix(evento, recursoId);
    else if (ehEventoDeAssinatura(evento)) await tratarAssinatura(evento, corpo);

    await admin
      .from("payment_events")
      .update({ processed_at: new Date().toISOString(), error: null })
      .eq("id", `abacatepay:${corpo.id}`);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "erro";
    console.error("[abacatepay/webhook]", evento, msg);
    await admin.from("payment_events").update({ error: msg }).eq("id", `abacatepay:${corpo.id}`);
    return NextResponse.json({ error: "Erro ao processar." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

// ---------------------------------------------------------------------------

/** Pix avulso (credito ou 30 dias de plano). So o Pix pago aplica. */
async function tratarPix(evento: string, id: string | null) {
  if (!id || !id.startsWith("pix_char_")) return;
  const admin = createAdminClient();

  const { data: compra } = await admin
    .from("credit_purchases")
    .select("id, status")
    .eq("abacatepay_charge_id", id)
    .maybeSingle();
  if (!compra) return; // Pix que nao e nosso

  // Fonte da verdade: a API, nao o corpo.
  const status = statusDoPix((await conferirPix(id)).status);

  if (status === "paid") {
    const { error } = await admin.rpc("apply_paid_charge", { p_charge_id: id });
    if (error) throw new Error(error.message);
    return;
  }
  // Reembolso ou disputa de compra ja paga nao desfaz o credito sozinho: fica
  // registrado no evento, para o suporte. O que nunca pagou fecha.
  if (evento !== "transparent.completed" && compra.status !== "paid" && status !== "pending") {
    await admin.from("credit_purchases").update({ status }).eq("abacatepay_charge_id", id);
  }
}

/** Assinatura: o estado relido na API decide o que o perfil vira. */
async function tratarAssinatura(evento: Parameters<typeof decidirEventoDeAssinatura>[1], corpo: Envelope) {
  const subId = corpo.data?.subscription?.id;
  if (!subId) return;
  const admin = createAdminClient();

  const sub = await buscarAssinatura(subId);
  const clienteId = corpo.data?.customer?.id || sub.customerId || null;

  // A conta: o externalId que o /subscribe montou; senao a assinatura ou o
  // cliente ja gravados no perfil.
  const peloCheckout = contaDoExternalId(corpo.data?.checkout?.externalId)?.userId;
  const porColuna = async (coluna: string, valor: string | null | undefined) =>
    valor
      ? (await admin.from("profiles").select("id").eq(coluna, valor).maybeSingle()).data?.id
      : undefined;
  const userId =
    peloCheckout ||
    (await porColuna("abacatepay_subscription_id", sub.id)) ||
    (await porColuna("abacatepay_customer_id", clienteId));
  if (!userId) {
    console.warn("[abacatepay/webhook] assinatura sem conta", { assinatura: sub.id, evento });
    return;
  }

  const { data: lido, error: erroLeitura } = await lerComPlano((plano) =>
    admin
      .from("profiles")
      .select(
        `payment_provider, abacatepay_subscription_id, pagou_subscription_id, subscription_status, current_period_end${plano}`
      )
      .eq("id", userId)
      .maybeSingle()
  );
  // Lancar responde 500 e a AbacatePay reenvia.
  if (erroLeitura) throw new Error(erroLeitura.message);
  const antes = lido as unknown as PerfilDaAbacate | null;
  if (!antes) return;

  const decisao = decidirEventoDeAssinatura(
    antes,
    evento,
    sub,
    {
      pagoEm: corpo.data?.payment?.createdAt || corpo.data?.payment?.updatedAt || null,
      ciclo: corpo.data?.subscription?.frequency || "MONTHLY",
      clienteId,
    },
    Date.now()
  );
  if (!decisao.aplicar || !decisao.patch) {
    console.warn("[abacatepay/webhook] aviso ignorado", { assinatura: sub.id, evento, motivo: decisao.motivo });
    return;
  }

  const gravado = await atualizarPerfil(admin, userId, {
    ...decisao.patch,
    updated_at: new Date().toISOString(),
  });
  if (gravado.error) throw new Error(gravado.error.message);

  // Pagamento novo do ciclo: repoe os creditos de IA (uma vez por periodo).
  if (decisao.reporCreditosAte) {
    const { error } = await admin.rpc("reset_ai_credits", {
      p_user_id: userId,
      p_amount: PRO_INCLUDED_CREDITS,
      p_period_end: decisao.reporCreditosAte,
    });
    if (error) throw new Error(error.message);
  }
}
