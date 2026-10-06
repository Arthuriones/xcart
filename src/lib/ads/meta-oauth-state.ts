import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Cookie e nonce para protecao contra CSRF no fluxo OAuth do Meta Ads.
 * Segue o mesmo padrao seguro do OAuth da Shopify (src/lib/shopify/oauth-state.ts).
 */

export const COOKIE_META_STATE = "xcart_meta_oauth_state";
export const VALIDADE_STATE_SEGUNDOS = 10 * 60; // 10 minutos

export interface EstadoOAuthMeta {
  nonce: string;
  userId: string;
}

export function novoNonce(): string {
  return randomBytes(32).toString("hex");
}

export function serializarEstadoMeta(estado: EstadoOAuthMeta): string {
  return `${estado.nonce}.${estado.userId}`;
}

export function lerEstadoMeta(valor: string | undefined): EstadoOAuthMeta | null {
  if (!valor) return null;
  const ponto = valor.indexOf(".");
  if (ponto <= 0 || ponto === valor.length - 1) return null;
  const nonce = valor.slice(0, ponto);
  const userId = valor.slice(ponto + 1);
  if (nonce.length < 32 || !userId) return null;
  return { nonce, userId };
}

export function nonceConfere(esperado: string, recebido: string): boolean {
  if (!esperado || !recebido) return false;
  const a = Buffer.from(esperado, "utf8");
  const b = Buffer.from(recebido, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function opcoesCookieMetaState() {
  const isProd = process.env.NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax" as const,
    path: "/",
    maxAge: VALIDADE_STATE_SEGUNDOS,
  };
}
