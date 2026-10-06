import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  COOKIE_META_STATE,
  novoNonce,
  opcoesCookieMetaState,
  serializarEstadoMeta,
} from "@/lib/ads/meta-oauth-state";
import { montarUrlLoginMeta, obterRedirectUriMeta } from "@/lib/ads/meta-oauth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
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
