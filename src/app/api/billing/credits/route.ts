import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createPixTransaction,
  getOrCreateCustomer,
  getTransaction,
  PagouError,
  respostaDoErroPagou,
} from "@/lib/billing/pagou";
import { AbacatePayError, conferirPix, criarPix, respostaDoErroAbacate } from "@/lib/billing/abacatepay";
import { statusDoPix } from "@/lib/billing/abacatepay-regras";
import { provedorDeCobranca } from "@/lib/billing/provedor";
import {
  CREDIT_PACKS,
  CURRENCY,
  getCreditPack,
  planoPorId,
  PRO_INCLUDED_CREDITS,
} from "@/lib/billing/plans";
import {
  bancoRecusouPlano,
  lerComPlano,
  planoAnteriorDaConta,
  type PerfilParaLimites,
} from "@/lib/billing/limites";
import { digitos, normalizarDocumento } from "@/lib/billing/documento";

export const runtime = "nodejs";

// Um mes de plano pago por Pix, tratado como se fosse um pacote. A Pagou so faz
// recorrencia por cartao (pix_automatic vem UNSUPPORTED nesta conta), entao
// este e o caminho para quem nao quer usar cartao. Nao renova sozinho.
// O tier vem em `plano` e o valor sai de plans.ts, nunca do corpo. Os planos a
// venda, para todo mundo; um plano anterior (fora da venda), so para quem o tem
// valendo agora -- renovar pelo mesmo preco (planoAnteriorDaConta).
// Sem `export`: arquivo de rota so exporta handler e config, e o build com
// webpack (o local, por causa do acento no caminho) recusa o resto.
const PRO_PIX_ID = "pro_month";

const JA_ASSINA_NO_CARTAO =
  "Você já assina no cartão. Para mudar de plano, fale com o suporte.";

function itemDe(packId: string, planoId: unknown) {
  if (packId === PRO_PIX_ID) {
    const plano = planoPorId(planoId);
    if (!plano) return null;
    return {
      id: PRO_PIX_ID,
      kind: "pro_month" as const,
      plano: plano.id,
      aVenda: plano.aVenda,
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
    aVenda: true,
    credits: pack.credits,
    amountCents: pack.amountCents,
    nome: `xcart — ${pack.label}`,
  };
}

// GET -> pacotes disponiveis (para a UI).
export async function GET() {
  return NextResponse.json({ packs: CREDIT_PACKS, currency: CURRENCY });
}

/** O Pix da AbacatePay vale 1 h: o prazo da janela do QR (pix-dialog.tsx). */
const PIX_ABACATE_EXPIRA_S = 3600;

/**
 * POST { packId, plano?, document? } -> gera uma cobranca Pix.
 *
 * packId pode ser um pacote de creditos ou "pro_month" (30 dias de um plano,
 * com `plano` = 'roteamento' | 'completo' | 'ilimitado_v2', ou o plano
 * anterior que a conta ainda paga).
 *
 * O Pix e assincrono: a compra nasce PENDENTE e so e aplicada quando o
 * processador confirmar (webhook ou o PATCH abaixo). Nunca creditamos na
 * criacao. Quem cobra e o de provedorDeCobranca(): a Pagou exige o CPF em
 * todo Pix; na AbacatePay ele so e pedido nos 30 dias de plano (a cobranca
 * fica no nome de quem assina), e a recarga de creditos sai sem.
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
  // O plano e o acesso dizem se um plano anterior ainda pode ser renovado.
  const { data: lido } = await lerComPlano((plano) =>
    admin
      .from("profiles")
      .select(
        `document_number, nome, sobrenome, telefone, pagou_subscription_id, abacatepay_subscription_id, subscription_status, plan, payment_provider, current_period_end, is_admin, access_granted${plano}`
      )
      .eq("id", user.id)
      .maybeSingle()
  );
  const perfil = lido as unknown as
    | (PerfilParaLimites & {
        document_number: string | null;
        nome?: string | null;
        sobrenome?: string | null;
        telefone?: string | null;
        subscription_status: string | null;
        abacatepay_subscription_id?: string | null;
      })
    | null;

  // Plano fora da venda: so a renovacao de quem o tem valendo agora.
  if (item.kind === "pro_month" && !item.aVenda && planoAnteriorDaConta(perfil) !== item.plano) {
    return NextResponse.json({ error: "Escolha um plano." }, { status: 400 });
  }

  // 30 dias por Pix em cima de um cartao que esta cobrando: a renovacao do
  // cartao regrava o fim do periodo e os dias do Pix somem.
  if (
    item.kind === "pro_month" &&
    (perfil?.pagou_subscription_id || perfil?.abacatepay_subscription_id) &&
    ["active", "trialing", "past_due"].includes(String(perfil.subscription_status))
  ) {
    return NextResponse.json({ error: JA_ASSINA_NO_CARTAO }, { status: 409 });
  }

  const abacate = provedorDeCobranca() === "abacatepay";
  const informado = digitos(typeof body.document === "string" ? body.document : "");
  const bruto = informado || digitos(perfil?.document_number || "");
  // Recarga de creditos na AbacatePay sai sem CPF.
  if (abacate && !bruto && item.kind === "credits") {
    return gerarPixAbacate(admin, user, item, null, perfil);
  }

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

  if (abacate) return gerarPixAbacate(admin, user, item, doc.number, perfil);

  try {
    const customerId = await getOrCreateCustomer(user.id, user.email, null, doc);

    // Referencia unica por chamada (Date.now()), que tambem vai como
    // Idempotency-Key: so protege a MESMA requisicao repetida. Dois cliques
    // geram dois Pix pagaveis -- a trava de clique duplo fica no cliente.
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
    // O banco nao aceita o tier (coluna da 064 ausente, ou o CHECK de antes da
    // 078): o Pix ja foi gerado, entao registra sem o tier -- o pagamento cai
    // como Pro legado em vez de se perder.
    if (bancoRecusouPlano(insErr) && "plano" in linha) {
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
      const { status, error: mensagem } = respostaDoErroPagou(error);
      return NextResponse.json({ error: mensagem }, { status });
    }
    console.error("[billing/credits]", error);
    return NextResponse.json({ error: "Falha ao gerar cobrança." }, { status: 500 });
  }
}

type Item = NonNullable<ReturnType<typeof itemDe>>;

/**
 * O Pix pela AbacatePay (checkout transparente). Mesmo registro pendente e
 * mesma resposta do da Pagou -- a janela do QR (pix-dialog.tsx) nao muda: o
 * `brCode` e o copia-e-cola, e o status vem no vocabulario dela (statusDoPix).
 * O cliente so vai completo (nome, e-mail, CPF e celular do cadastro); faltou
 * um, o Pix sai sem cliente (criarPix).
 */
async function gerarPixAbacate(
  admin: ReturnType<typeof createAdminClient>,
  user: { id: string; email?: string | null },
  item: Item,
  documento: string | null,
  perfil: { nome?: string | null; sobrenome?: string | null; telefone?: string | null } | null
) {
  try {
    const pix = await criarPix({
      valorCentavos: item.amountCents,
      descricao: item.nome,
      expiraEmSegundos: PIX_ABACATE_EXPIRA_S,
      cliente:
        documento && user.email
          ? {
              nome: [perfil?.nome, perfil?.sobrenome].filter(Boolean).join(" ").trim(),
              email: user.email,
              documento,
              telefone: digitos(perfil?.telefone || "") || null,
            }
          : null,
      metadata: { user_id: user.id, kind: item.kind, pack_id: item.id, ...(item.plano ? { plano: item.plano } : {}) },
    });

    const linha = {
      user_id: user.id,
      abacatepay_charge_id: pix.id,
      provider: "abacatepay",
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
    if (bancoRecusouPlano(insErr) && "plano" in linha) {
      const resto: Record<string, unknown> = { ...linha };
      delete resto.plano;
      ({ error: insErr } = await admin.from("credit_purchases").insert(resto));
    }
    if (insErr) {
      console.error("[billing/credits] falha ao registrar cobranca AbacatePay", insErr);
      return NextResponse.json(
        { error: "Cobrança criada, mas não foi registrada. Fale com o suporte." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      transactionId: pix.id,
      status: statusDoPix(pix.status),
      kind: item.kind,
      plano: item.plano,
      credits: item.credits,
      amountCents: item.amountCents,
      pix: { qrCode: pix.brCode || null, expiresAt: pix.expiresAt || null },
    });
  } catch (error) {
    if (error instanceof AbacatePayError) {
      console.error("[billing/credits] AbacatePay", error.status, error.message);
      const { status, error: mensagem } = respostaDoErroAbacate(error);
      return NextResponse.json({ error: mensagem }, { status });
    }
    console.error("[billing/credits] AbacatePay", error);
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
  // O id diz quem cobrou: o Pix da AbacatePay e pix_char_...; o resto e Pagou.
  const abacate = transactionId.startsWith("pix_char_");

  // A cobranca tem que ser deste usuario.
  const { data: compra, error: erroLeitura } = await admin
    .from("credit_purchases")
    .select("id, user_id, status, kind")
    .eq(abacate ? "abacatepay_charge_id" : "pagou_transaction_id", transactionId)
    .maybeSingle();

  // Banco instavel nao e "cobranca nao encontrada": o modal trata como
  // consulta que falhou e nao afirma nada sobre o pagamento.
  if (erroLeitura) {
    console.error("[billing/credits] PATCH leitura", erroLeitura);
    return NextResponse.json({ error: "Não deu para conferir agora." }, { status: 503 });
  }
  if (!compra || compra.user_id !== user.id) {
    return NextResponse.json({ error: "Cobrança não encontrada." }, { status: 404 });
  }
  if (compra.status === "paid") {
    return NextResponse.json({ status: "paid", credited: true, kind: compra.kind });
  }

  try {
    const status = abacate
      ? statusDoPix((await conferirPix(transactionId)).status)
      : (await getTransaction(transactionId)).status;
    if (status !== "paid") {
      return NextResponse.json({ status, credited: false });
    }
    // Atomica e idempotente: se o webhook aplicou antes, devolve false.
    const { data: aplicou, error: erroAplicar } = abacate
      ? await admin.rpc("apply_paid_charge", { p_charge_id: transactionId })
      : await admin.rpc("apply_paid_purchase", { p_transaction_id: transactionId });
    // A Pagou confirmou, entao o status continua "paid" -- mas sem dizer que o
    // plano/credito ja entrou. O modal segue consultando e o proximo PATCH
    // repete o RPC; o webhook (com reenvio) tambem aplica.
    if (erroAplicar) {
      console.error("[billing/credits] PATCH apply", erroAplicar);
      return NextResponse.json({ status: "paid", credited: false, aplicado: false, kind: compra.kind });
    }
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
