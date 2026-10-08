import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createPixTransaction,
  getOrCreateCustomer,
  getTransaction,
  PagouError,
} from "@/lib/billing/pagou";
import {
  CREDIT_PACKS,
  CURRENCY,
  ehPlanoId,
  getCreditPack,
  planoPorId,
  PRO_INCLUDED_CREDITS,
} from "@/lib/billing/plans";
import { semColunaPlano } from "@/lib/billing/limites";
import { digitos, normalizarDocumento } from "@/lib/billing/documento";

export const runtime = "nodejs";

// Um mes de plano pago por Pix, tratado como se fosse um pacote. A Pagou so faz
// recorrencia por cartao (pix_automatic vem UNSUPPORTED nesta conta), entao
// este e o caminho para quem nao quer usar cartao. Nao renova sozinho.
// O tier vem em `plano` e o valor sai de plans.ts, nunca do corpo.
export const PRO_PIX_ID = "pro_month";

const JA_ASSINA_NO_CARTAO =
  "Você já assina no cartão. Para mudar de plano, fale com o suporte.";

function itemDe(packId: string, planoId: unknown) {
  if (packId === PRO_PIX_ID) {
    const plano = ehPlanoId(planoId) ? planoPorId(planoId)! : null;
    if (!plano) return null;
    return {
      id: PRO_PIX_ID,
      kind: "pro_month" as const,
      plano: plano.id,
      credits: PRO_INCLUDED_CREDITS,
      amountCents: plano.precoCentavos,
      nome: `xcart ${plano.nome} — 30 dias`,
    };
  }
  const pack = getCreditPack(packId);
  if (!pack) return null;
  return {
    id: pack.id,
    kind: "credits" as const,
    plano: null,
    credits: pack.credits,
    amountCents: pack.amountCents,
    nome: `xcart — ${pack.label}`,
  };
}

// GET -> pacotes disponiveis (para a UI).
export async function GET() {
  return NextResponse.json({ packs: CREDIT_PACKS, currency: CURRENCY });
}

/**
 * POST { packId, plano?, document? } -> gera uma cobranca Pix.
 *
 * packId pode ser um pacote de creditos ou "pro_month" (30 dias de um plano,
 * com `plano` = 'loja1' | 'lojas3' | 'ilimitado').
 *
 * O Pix e assincrono: a compra nasce PENDENTE e so e aplicada quando a Pagou
 * confirmar (webhook ou o PATCH abaixo). Nunca creditamos na criacao.
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
  const packId = typeof body.packId === "string" ? body.packId : "";
  const item = itemDe(packId, body.plano);
  if (!item) {
    return NextResponse.json(
      { error: packId === PRO_PIX_ID ? "Escolha um plano." : "Pacote inválido." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();

  // CPF: usa o que ja esta salvo; se vier um novo no corpo, valida e guarda.
  const { data: perfil } = await admin
    .from("profiles")
    .select("document_number, pagou_subscription_id, subscription_status")
    .eq("id", user.id)
    .maybeSingle();

  // 30 dias por Pix em cima de um cartao que esta cobrando: a renovacao do
  // cartao regrava o fim do periodo e os dias do Pix somem.
  if (
    item.kind === "pro_month" &&
    perfil?.pagou_subscription_id &&
    ["active", "trialing", "past_due"].includes(String(perfil.subscription_status))
  ) {
    return NextResponse.json({ error: JA_ASSINA_NO_CARTAO }, { status: 409 });
  }

  const informado = digitos(typeof body.document === "string" ? body.document : "");
  const bruto = informado || digitos(perfil?.document_number || "");

  if (!bruto) {
    // O front usa needsDocument para abrir o campo em vez de mostrar erro cru.
    return NextResponse.json(
      { error: "Informe seu CPF para gerar a cobrança Pix.", needsDocument: true },
      { status: 400 }
    );
  }
  const doc = normalizarDocumento(bruto);
  if (!doc) {
    return NextResponse.json(
      {
        error: `${bruto.length > 11 ? "CNPJ" : "CPF"} inválido. Confira os números.`,
        needsDocument: true,
      },
      { status: 400 }
    );
  }
  if (informado && informado !== digitos(perfil?.document_number || "")) {
    await admin
      .from("profiles")
      .update({ document_number: doc.number, document_type: doc.type })
      .eq("id", user.id);
  }

  try {
    const customerId = await getOrCreateCustomer(user.id, user.email, null, doc);

    // Referencia unica: a Pagou devolve 409 DUPLICATE_EXTERNAL_REF se repetir,
    // o que impede cobrar duas vezes o mesmo clique.
    const externalRef = `${item.kind}_${user.id}_${item.id}_${Date.now()}`;

    const tx = await createPixTransaction({
      amountCents: item.amountCents,
      currency: CURRENCY,
      externalRef,
      buyer: {
        id: customerId,
        name: user.email?.split("@")[0] || "Cliente xcart",
        email: user.email || `${user.id}@sem-email.xcart`,
        document: doc,
      },
      produto: { name: item.nome, price: item.amountCents },
      metadata: externalRef,
    });

    // Registro pendente. A aplicacao acontece em apply_paid_purchase(), que
    // grava o tier no perfil quando o Pix cai.
    const linha = {
      user_id: user.id,
      pagou_transaction_id: tx.id,
      provider: "pagou",
      method: "pix",
      kind: item.kind,
      pack_id: item.id,
      credits: item.credits,
      amount_cents: item.amountCents,
      currency: CURRENCY.toLowerCase(),
      status: "pending",
      ...(item.plano ? { plano: item.plano } : {}),
    };
    let { error: insErr } = await admin.from("credit_purchases").insert(linha);
    // Coluna `plano` ainda nao existe (migration 064 pendente): o Pix ja foi
    // gerado, entao registra sem o tier -- o pagamento cai como Pro legado em
    // vez de se perder.
    if (semColunaPlano(insErr) && "plano" in linha) {
      const resto: Record<string, unknown> = { ...linha };
      delete resto.plano;
      ({ error: insErr } = await admin.from("credit_purchases").insert(resto));
    }
    if (insErr) {
      console.error("[billing/credits] falha ao registrar cobranca", insErr);
      return NextResponse.json(
        { error: "Cobrança criada, mas não foi registrada. Fale com o suporte." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      transactionId: tx.id,
      status: tx.status,
      kind: item.kind,
      plano: item.plano,
      credits: item.credits,
      amountCents: item.amountCents,
      pix: {
        qrCode: tx.pix?.qr_code || null,
        expiresAt: tx.pix?.expiration_date || null,
      },
    });
  } catch (error) {
    if (error instanceof PagouError) {
      console.error("[billing/credits] Pagou", error.status, error.code, error.message);
      return NextResponse.json(
        { error: error.message },
        { status: error.status >= 400 && error.status < 500 ? error.status : 502 }
      );
    }
    console.error("[billing/credits]", error);
    return NextResponse.json({ error: "Falha ao gerar cobrança." }, { status: 500 });
  }
}

/**
 * PATCH { transactionId } -> confere o pagamento sob demanda.
 *
 * A tela do QR chama isso enquanto o usuario paga, para nao depender so do
 * webhook. A fonte da verdade e sempre a API da Pagou, nunca o cliente.
 */
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const transactionId =
    typeof body.transactionId === "string" ? body.transactionId : "";
  if (!transactionId) {
    return NextResponse.json({ error: "transactionId obrigatório." }, { status: 400 });
  }

  const admin = createAdminClient();

  // A cobranca tem que ser deste usuario.
  const { data: compra } = await admin
    .from("credit_purchases")
    .select("id, user_id, status, kind")
    .eq("pagou_transaction_id", transactionId)
    .maybeSingle();

  if (!compra || compra.user_id !== user.id) {
    return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
  }
  if (compra.status === "paid") {
    return NextResponse.json({ status: "paid", credited: true, kind: compra.kind });
  }

  try {
    const tx = await getTransaction(transactionId);
    if (tx.status !== "paid") {
      return NextResponse.json({ status: tx.status, credited: false });
    }
    // Atomica e idempotente: se o webhook aplicou antes, devolve false.
    const { data: aplicou } = await admin.rpc("apply_paid_purchase", {
      p_transaction_id: transactionId,
    });
    return NextResponse.json({
      status: "paid",
      credited: aplicou === true,
      kind: compra.kind,
    });
  } catch (error) {
    console.error("[billing/credits] PATCH", error);
    return NextResponse.json({ error: "Falha ao consultar." }, { status: 502 });
  }
}
