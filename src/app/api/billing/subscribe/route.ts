import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cancelSubscription,
  createSubscription,
  getOrCreateCustomer,
  getSubscription,
  getTransaction,
  planoDoStatus,
  PagouError,
} from "@/lib/billing/pagou";
import { CURRENCY, ehPlanoId, planoDoValor, planoPorId } from "@/lib/billing/plans";
import { atualizarPerfil } from "@/lib/billing/limites";

export const runtime = "nodejs";

const PROCESSANDO =
  "Seu pagamento anterior ainda está sendo processado. Tente de novo em alguns minutos.";

const SEM_DESFECHO =
  "Não deu para confirmar o pagamento agora. O plano libera assim que o banco confirmar.";

/** O que o Payment Element precisa para resolver a 1a cobranca (3DS incluso). */
interface TransacaoParaOSdk {
  id: string;
  status: string;
  next_action: unknown;
}

/**
 * A transacao da 1a cobranca de uma assinatura de cartao recem-criada, no
 * formato que o Payment Element resolve. Contrato (developer.pagou.ai):
 *  - o POST /v2/subscriptions NAO traz `transactions`: no schema da resposta
 *    o campo e "Included on GET by id" (api-reference/subscriptions/create);
 *  - o GET /v2/subscriptions/{id} traz `transactions`, "ordered by createdAt
 *    descending", mas cada item so tem id/status/valores, sem next_action
 *    (api-reference/subscriptions/get);
 *  - o next_action (3DS) vem no GET /v2/transactions/{id}
 *    (api-reference/transactions/get);
 *  - o SDK quer o payload "without removing id, status, or next_action"
 *    (frontend/payment-element/sdk-reference).
 * A recem-criada so tem uma cobranca; [0] e a mais nova, a que esta em jogo.
 * Sem transacao, ou a Pagou fora do ar: null -- quem chama responde pending.
 */
async function transacaoDaCobranca(subscriptionId: string): Promise<TransacaoParaOSdk | null> {
  try {
    const atual = await getSubscription(subscriptionId);
    const txId = atual?.transactions?.[0]?.id;
    if (!txId) return null;
    const tx = await getTransaction(txId);
    if (!tx?.id || !tx.status) return null;
    return { id: tx.id, status: tx.status, next_action: tx.next_action ?? null };
  } catch (e) {
    console.error(
      "[billing/subscribe] transacao da 1a cobranca",
      subscriptionId,
      e instanceof Error ? e.message : e
    );
    return null;
  }
}

/**
 * A tentativa anterior ficou parada no primeiro pagamento ('incomplete': 3DS,
 * cartao recusado ou em analise). Criar outra por cima deixava duas
 * assinaturas na conta: se as duas aprovassem, duas cobrancas por mes, e o
 * perfil so conhece uma. Entao: o mesmo pedido de novo (duplo clique, mesma
 * chave) segue; a anterior que ja passou e "ja assinante"; a parada e
 * cancelada antes de criar a nova. Devolve a resposta de bloqueio, ou null.
 */
async function liberarTentativaAnterior(id: string, chave: string): Promise<NextResponse | null> {
  try {
    const anterior = await getSubscription(id);
    if (anterior.metadata?.chave === chave) return null;
    if (["active", "trialing", "past_due", "cancel_scheduled"].includes(anterior.status)) {
      return NextResponse.json({ error: "Você já tem uma assinatura ativa." }, { status: 409 });
    }
    if (anterior.status === "incomplete") await cancelSubscription(id, "user_requested");
    return null;
  } catch (e) {
    console.error("[billing/subscribe] tentativa anterior", id, e instanceof Error ? e.message : e);
    return NextResponse.json({ error: PROCESSANDO }, { status: 409 });
  }
}

/**
 * POST -> cria a assinatura de um dos planos na Pagou.
 *
 * Body: { plano, cardToken } para cartao, ou { plano, method: "pix_automatic",
 * billingDay }. `plano` e obrigatorio ('loja1' | 'lojas3' | 'ilimitado'): o
 * valor cobrado sai de plans.ts pelo tier, nunca do corpo.
 *
 * Ao contrario do Stripe, nao ha checkout hospedado: o cartao ja vem
 * tokenizado do browser (Payment Element) e a assinatura nasce aqui. Por isso
 * a resposta nao e uma URL de redirect, e sim o estado da assinatura -- e, no
 * cartao, `transaction` ({ id, status, next_action } da 1a cobranca), que o
 * formulario devolve ao SDK para ele rodar o 3DS e ler o desfecho. Sem ela,
 * `pending` + `mensagem`: o webhook confirma depois.
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

  // Chave: usuario + plano + o cartao (o token pgct_ e de uso unico; vai com
  // hash) ou, no Pix automatico, o dia. A Pagou devolve a assinatura da
  // primeira chamada para a mesma chave: o duplo clique manda o mesmo token e
  // recebe a mesma assinatura; outro cartao depois de uma recusa gera chave
  // nova -- com a chave por dia, a Pagou devolvia a assinatura recusada ate o
  // dia seguinte.
  const idempotencyKey = `sub_${user.id}_${plano.id}_${
    cardToken
      ? createHash("sha256").update(cardToken).digest("hex").slice(0, 24)
      : `pix_${new Date().toISOString().slice(0, 10)}`
  }`;

  if (profile?.pagou_subscription_id && profile.subscription_status === "incomplete") {
    const bloqueio = await liberarTentativaAnterior(profile.pagou_subscription_id, idempotencyKey);
    if (bloqueio) return bloqueio;
  }

  try {
    const customerId = await getOrCreateCustomer(user.id, user.email, null);

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

    const gravado = await atualizarPerfil(admin, user.id, {
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
    // A assinatura ja existe e o cartao pode ja ter sido cobrado: responder
    // erro faria a pessoa tentar de novo. O webhook (pelo user_id do metadata)
    // grava o perfil depois.
    if (gravado.error) {
      console.error("[billing/subscribe] perfil nao gravou", sub.id, gravado.error.message);
    }

    // Devolvida ao Payment Element: e o objeto que ele sabe resolver
    // (inclusive 3DS na primeira cobranca). So no cartao.
    const transaction = cardToken ? await transacaoDaCobranca(sub.id) : null;
    // Sem a transacao, o navegador nao tem o que resolver e decide pelo
    // status da assinatura: "active" so vem depois da 1a cobranca aprovada
    // (api-reference/subscriptions/create); o resto espera o webhook.
    const semDesfecho =
      !!cardToken && !transaction && !["active", "trialing"].includes(sub.status);

    return NextResponse.json({
      subscriptionId: sub.id,
      status: sub.status,
      currentPeriodEnd: sub.currentPeriodEnd || null,
      cardLast4: sub.cardLast4 || null,
      transaction,
      // incomplete = a Pagou ainda esta processando a primeira cobranca;
      // o webhook confirma depois.
      pending: sub.status === "incomplete" || semDesfecho,
      ...(semDesfecho ? { mensagem: SEM_DESFECHO } : {}),
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
