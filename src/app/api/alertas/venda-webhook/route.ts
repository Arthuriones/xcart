import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarNotificacaoDeVenda, urlDeWebhookValida } from "@/lib/alertas/venda-webhook";

export const runtime = "nodejs";

// ============================================================================
// Notificacao de venda no celular: a URL de webhook (Pushcut, ntfy...) e o
// liga/desliga.
//
// A URL e segredo e vai para alerta_config_secrets (so service role); nunca
// volta inteira -- a tela recebe so o host. Campo vazio = manter a gravada;
// `remover: true` apaga.
//
// ?testar=1 manda uma venda de exemplo para a URL GRAVADA: testa o que o
// webhook da Shopify vai usar, nao o que esta digitado.
// ============================================================================

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, erro: "Unauthorized" }, { status: 401 });

  let corpo: { url?: string | null; remover?: boolean; ativo?: boolean };
  try {
    corpo = await request.json();
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }

  const url = typeof corpo.url === "string" ? corpo.url.trim() : "";
  if (url && !urlDeWebhookValida(url)) {
    return NextResponse.json(
      { ok: false, erro: "Cole a URL inteira do webhook, começando com https://." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const agora = new Date().toISOString();

  // Linha de config pode nao existir ainda (quem nunca abriu o Telegram).
  const { error: erroCfg } = await admin
    .from("alerta_config")
    .upsert({ user_id: user.id, notificar_vendas: corpo.ativo !== false, updated_at: agora }, { onConflict: "user_id" });
  if (erroCfg) {
    return NextResponse.json({ ok: false, erro: `Não foi possível salvar: ${erroCfg.message}` }, { status: 500 });
  }

  if (url || corpo.remover) {
    const { error } = await admin
      .from("alerta_config_secrets")
      .upsert(
        { user_id: user.id, venda_webhook_url: corpo.remover ? null : url, updated_at: agora },
        { onConflict: "user_id" }
      );
    if (error) {
      return NextResponse.json({ ok: false, erro: `Não foi possível salvar a URL: ${error.message}` }, { status: 500 });
    }
  }

  if (request.nextUrl.searchParams.get("testar") !== "1") {
    return NextResponse.json({ ok: true });
  }

  const { data } = await admin
    .from("alerta_config_secrets")
    .select("venda_webhook_url")
    .eq("user_id", user.id)
    .maybeSingle();
  const gravada = String((data as { venda_webhook_url?: string | null } | null)?.venda_webhook_url || "");
  if (!gravada) return NextResponse.json({ ok: false, erro: "Cole a URL do webhook antes de testar." });

  const envio = await enviarNotificacaoDeVenda(gravada, {
    loja: "Teste xcart",
    pedido: "#1001",
    valor: 69,
    moeda: "USD",
    statusFinanceiro: "paid",
    produtos: ["Produto de exemplo"],
  });
  if (!envio.ok) {
    return NextResponse.json({ ok: false, erro: `Salvo, mas o teste não chegou: ${envio.erro}` });
  }
  return NextResponse.json({ ok: true });
}
