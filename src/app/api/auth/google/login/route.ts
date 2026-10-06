import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  COOKIE_GOOGLE_STATE,
  novoNonceGoogle,
  opcoesCookieGoogleState,
  serializarEstadoGoogle,
} from "@/lib/ads/google-oauth-state";
import { montarUrlLoginGoogle, obterRedirectUriGoogle } from "@/lib/ads/google-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    const loginUrl = new URL("/login", request.nextUrl.origin);
    loginUrl.searchParams.set("next", "/integracoes/google");
    return NextResponse.redirect(loginUrl);
  }

  const nonce = novoNonceGoogle();
  const state = serializarEstadoGoogle({ nonce, userId: user.id });
  const redirectUri = obterRedirectUriGoogle(request.nextUrl.origin);

  const authUrl = montarUrlLoginGoogle({ redirectUri, state });

  const response = NextResponse.redirect(authUrl);
  response.cookies.set(COOKIE_GOOGLE_STATE, state, opcoesCookieGoogleState());

  return response;
}
