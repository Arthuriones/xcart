import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  COOKIE_META_STATE,
  lerEstadoMeta,
  nonceConfere,
  novoNonce,
  serializarEstadoMeta,
} from "@/lib/ads/meta-oauth-state";
import { montarUrlLoginMeta, obterRedirectUriMeta } from "@/lib/ads/meta-oauth";

describe("Meta OAuth (fluxo 1-clique estilo UTMify)", () => {
  it("gera nonce seguro e serializa/desserializa com userId", () => {
    const nonce = novoNonce();
    expect(nonce.length).toBe(64); // 32 bytes em hex

    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const estadoSerializado = serializarEstadoMeta({ nonce, userId });
    expect(estadoSerializado).toBe(`${nonce}.${userId}`);

    const lido = lerEstadoMeta(estadoSerializado);
    expect(lido).not.toBeNull();
    expect(lido?.nonce).toBe(nonce);
    expect(lido?.userId).toBe(userId);
  });

  it("recusa state malformado ou truncado", () => {
    expect(lerEstadoMeta(undefined)).toBeNull();
    expect(lerEstadoMeta("")).toBeNull();
    expect(lerEstadoMeta("sem-ponto")).toBeNull();
    expect(lerEstadoMeta("curto.123")).toBeNull();
  });

  it("valida nonce em tempo constante", () => {
    const n1 = novoNonce();
    const n2 = novoNonce();
    expect(nonceConfere(n1, n1)).toBe(true);
    expect(nonceConfere(n1, n2)).toBe(false);
    expect(nonceConfere(n1, "")).toBe(false);
  });

  it("obterRedirectUriMeta devolve localhost no ambiente local e producao no padrao", () => {
    expect(obterRedirectUriMeta("http://localhost:3000")).toBe("http://localhost:3000/api/auth/meta/callback");
    expect(obterRedirectUriMeta("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/auth/meta/callback");
    expect(obterRedirectUriMeta("https://user.xcart.app")).toBe("https://user.xcart.app/api/auth/meta/callback");
  });

  it("monta a URL oficial do dialog/oauth com appId e escopos corretos", () => {
    process.env.META_APP_ID = "mock-meta-app-id";
    process.env.META_APP_SECRET = "mock-meta-app-secret";

    const redirectUri = "https://user.xcart.app/api/auth/meta/callback";
    const state = "nonce-teste.user-123";

    const urlStr = montarUrlLoginMeta({ redirectUri, state });
    const url = new URL(urlStr);

    expect(url.origin).toBe("https://www.facebook.com");
    expect(url.pathname).toContain("/dialog/oauth");
    expect(url.searchParams.get("client_id")).toBe("mock-meta-app-id");
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe(state);

    const scopes = url.searchParams.get("scope") || "";
    expect(scopes).toContain("public_profile");
    expect(scopes).toContain("email");
    expect(scopes).toContain("ads_read");
    expect(scopes).toContain("read_insights");
  });
});
