import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { enviarTelegram, tokenDoBot } from "@/lib/alertas/telegram";
import type { AlertaCanalCorpo } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Canal dos alertas: chat do Telegram, token do bot e preferencias.
//
// O token do bot vai para alerta_config_secrets (sem policy, so service role)
// e NUNCA volta: a tela recebe so "temToken". Campo vazio = manter o gravado,
// porque a tela manda o campo vazio em todo salvamento normal.
//
// ?testar=1 manda uma mensagem de teste com o que ficou GRAVADO -- testa o
// que o cron vai usar, nao o que esta digitado na tela.
// ============================================================================

const RE_CHAT = /^-?[0-9]{1,20}$/;
const RE_TOKEN = /^[0-9]+:[A-Za-z0-9_-]{30,64}$/;
const TEXTO_TESTE = "xcart: teste de alerta. Se voce recebeu isto, os alertas vao chegar aqui.";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, erro: "Unauthorized" }, { status: 401 });

  let corpo: Partial<AlertaCanalCorpo>;
  try {
    corpo = (await request.json()) as Partial<AlertaCanalCorpo>;
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }

  const chatCru = corpo.chat_id == null ? "" : String(corpo.chat_id).trim();
  if (chatCru && !RE_CHAT.test(chatCru)) {
    return NextResponse.json(
      { ok: false, erro: "Chat id inválido: use só números (grupo começa com -)." },
      { status: 400 }
    );
  }
  const tokenCru = corpo.bot_token == null ? "" : String(corpo.bot_token).trim();
  if (tokenCru && !RE_TOKEN.test(tokenCru)) {
    return NextResponse.json(
      { ok: false, erro: "Token do bot inválido: copie o token inteiro que o @BotFather mandou." },
      { status: 400 }
    );
  }
  const minimo = Number(corpo.gasto_sem_venda_min);
  if (!Number.isFinite(minimo) || minimo < 0 || minimo > 100000) {
    return NextResponse.json(
      { ok: false, erro: "Gasto mínimo deve ficar entre 0 e 100000." },
      { status: 400 }
    );
  }

  const admin = createAdminClient();
  const agora = new Date().toISOString();
  const { error: erroCfg } = await admin.from("alerta_config").upsert(
    {
      user_id: user.id,
      telegram_chat_id: chatCru || null,
      ativo: corpo.ativo !== false,
      receber_avisos: corpo.receber_avisos !== false,
      gasto_sem_venda_min: Math.round(minimo * 100) / 100,
      updated_at: agora,
    },
    { onConflict: "user_id" }
  );
  if (erroCfg) {
    return NextResponse.json(
      { ok: false, erro: `Não foi possível salvar: ${erroCfg.message}` },
      { status: 500 }
    );
  }

  if (tokenCru) {
    const { error } = await admin
      .from("alerta_config_secrets")
      .upsert(
        { user_id: user.id, telegram_bot_token: tokenCru, updated_at: agora },
        { onConflict: "user_id" }
      );
    if (error) {
      return NextResponse.json(
        { ok: false, erro: `Não foi possível salvar o token: ${error.message}` },
        { status: 500 }
      );
    }
  }

  if (request.nextUrl.searchParams.get("testar") !== "1") {
    return NextResponse.json({ ok: true });
  }

  if (!chatCru) {
    return NextResponse.json({ ok: false, erro: "Cole o chat id antes de testar." });
  }
  const token = await tokenDoBot(admin, user.id);
  if (!token) {
    return NextResponse.json({ ok: false, erro: "Cole o token do bot antes de testar." });
  }
  const envio = await enviarTelegram(token, chatCru, TEXTO_TESTE, false);
  if (!envio.ok) {
    return NextResponse.json({ ok: false, erro: `Telegram recusou: ${envio.erro ?? "falha"}` });
  }
  return NextResponse.json({ ok: true });
}
