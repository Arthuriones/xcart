import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  COOKIE_META_STATE,
  novoNonce,
  opcoesCookieMetaState,
  serializarEstadoMeta,
} from "@/lib/ads/meta-oauth-state";
import { montarUrlLoginMeta, obterRedirectUriMeta } from "@/lib/ads/meta-oauth";

import { validarTicketMultilogin } from "@/lib/ads/multilogin-ticket";

export const runtime = "nodejs";

function renderErroTicket(mensagem: string) {
  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Link Expirado - xcart</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f1115; color: #f1f3f5; display: grid; place-items: center; height: 100vh; margin: 0; padding: 20px; box-sizing: border-box; }
    .box { background: #181b21; border: 1px solid #282d37; border-radius: 12px; padding: 32px 24px; max-width: 420px; text-align: center; }
    h2 { font-size: 18px; color: #f87171; margin: 0 0 10px; }
    p { font-size: 14px; color: #9ca3af; margin: 0 0 16px; line-height: 1.5; }
  </style>
</head>
<body>
  <div class="box">
    <h2>Link Expirado ou Inválido</h2>
    <p>${mensagem}</p>
    <p>Por segurança, gere um novo link no painel do xcart clicando em "Adicionar perfil" &rarr; "Copiar link para navegador multilogin".</p>
  </div>
</body>
</html>`;
  return new NextResponse(html, {
    status: 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const ticket = searchParams.get("ticket");

  // FLUXO MULTILOGIN: Aberto em outro navegador (Dolphin, AdsPower, etc.)
  if (ticket) {
    const ticketValido = await validarTicketMultilogin(ticket, "meta");
    if (!ticketValido || ticketValido.status !== "pending") {
      return renderErroTicket("Este link de autorização expirou ou já foi utilizado.");
    }

    const state = `ticket.${ticket}`;
    const redirectUri = obterRedirectUriMeta(request.nextUrl.origin);
    const authUrl = montarUrlLoginMeta({ redirectUri, state });
    return NextResponse.redirect(authUrl);
  }

  // FLUXO NORMAL: Navegador atual
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("next", "/integracoes/meta");
    return NextResponse.redirect(loginUrl);
  }

  const nonce = novoNonce();
  const state = serializarEstadoMeta({ nonce, userId: user.id });
  const redirectUri = obterRedirectUriMeta(request.nextUrl.origin);

  const authUrl = montarUrlLoginMeta({ redirectUri, state });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(COOKIE_META_STATE, state, opcoesCookieMetaState());

  return response;
}
