import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";

export const runtime = "nodejs";

// ============================================================================
// Salva a configuracao de rastreamento de UMA loja.
//
// Passa pelo service role de proposito: a linha carrega `user_id`, e deixar o
// cliente escolher esse campo abriria a porta para apontar a configuracao
// para a loja de outro. O dono e lido do banco a partir da sessao, nunca do
// corpo da requisicao.
// ============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let corpo: {
    storeId?: string;
    enabled?: boolean;
    googleConversionId?: string | null;
    googleConversionLabel?: string | null;
    googleCustomerId?: string | null;
    googleLoginCustomerId?: string | null;
  };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo invalido." }, { status: 400 });
  }

  if (!corpo.storeId) {
    return NextResponse.json({ error: "storeId ausente." }, { status: 400 });
  }

  const admin = createAdminClient();

  // A loja tem que ser do usuario da sessao. Sem esta checagem, storeId vindo
  // do corpo permitiria configurar a loja de qualquer outro.
  const { data: loja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", corpo.storeId)
    .maybeSingle();

  if (!loja || loja.user_id !== user.id) {
    return NextResponse.json({ error: "Loja nao encontrada." }, { status: 404 });
  }

  const id = (corpo.googleConversionId || "").trim() || null;
  const rotulo = (corpo.googleConversionLabel || "").trim() || null;

  if (id && !apenasNumeroDaConversao(id)) {
    return NextResponse.json(
      { error: "ID de conversao invalido. Esperado algo como AW-123456789." },
      { status: 400 }
    );
  }

  // Um sem o outro nao identifica conversao nenhuma: a requisicao sairia e o
  // Google descartaria em silencio. Melhor recusar aqui.
  if (Boolean(id) !== Boolean(rotulo)) {
    return NextResponse.json(
      { error: "Preencha o ID e o rotulo juntos, ou deixe os dois vazios." },
      { status: 400 }
    );
  }

  const ligar = Boolean(corpo.enabled);
  if (ligar && !id) {
    return NextResponse.json(
      { error: "Para ligar, informe o ID e o rotulo da conversao." },
      { status: 400 }
    );
  }

  // Conta de anuncios: o painel do Google mostra 123-456-7890, e a API recusa
  // qualquer coisa que nao seja digito puro.
  const soDigitos = (v: string | null | undefined) => {
    const d = (v || "").replace(/\D/g, "");
    return d || null;
  };
  const customerId = soDigitos(corpo.googleCustomerId);
  const mcc = soDigitos(corpo.googleLoginCustomerId);

  if (corpo.googleCustomerId?.trim() && !customerId) {
    return NextResponse.json(
      { error: "Customer id invalido. Esperado algo como 1234567890." },
      { status: 400 }
    );
  }

  // O id da conversion action e derivado do rotulo e fica guardado para nao
  // custar uma consulta por pedido. Se o rotulo ou a conta mudou, o id guardado
  // aponta para OUTRA conversao -- e o enhancement iria enriquecer a conversao
  // errada, sem erro nenhum aparecendo. Entao o cache e descartado e descoberto
  // de novo no proximo envio.
  const { data: anterior } = await admin
    .from("tracking_configs")
    .select("google_conversion_label, google_customer_id")
    .eq("store_id", loja.id)
    .maybeSingle();

  const mudouAConversao =
    Boolean(anterior) &&
    (anterior?.google_conversion_label !== rotulo ||
      anterior?.google_customer_id !== customerId);

  const { error } = await admin.from("tracking_configs").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      enabled: ligar,
      google_conversion_id: id,
      google_conversion_label: rotulo,
      google_customer_id: customerId,
      google_login_customer_id: mcc,
      ...(mudouAConversao ? { google_conversion_action_id: null } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
