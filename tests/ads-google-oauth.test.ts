import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  COOKIE_GOOGLE_STATE,
  lerEstadoGoogle,
  nonceGoogleConfere,
  novoNonceGoogle,
  serializarEstadoGoogle,
} from "@/lib/ads/google-oauth-state";
import { montarUrlLoginGoogle, obterRedirectUriGoogle } from "@/lib/ads/google-oauth";

describe("Google OAuth (fluxo 1-clique estilo UTMify)", () => {
  it("gera nonce seguro e serializa/desserializa com userId", () => {
    const nonce = novoNonceGoogle();
    expect(nonce.length).toBe(64); // 32 bytes em hex

    const userId = "550e8400-e29b-41d4-a716-446655440000";
    const estadoSerializado = serializarEstadoGoogle({ nonce, userId });
    expect(estadoSerializado).toBe(`${nonce}.${userId}`);

    const lido = lerEstadoGoogle(estadoSerializado);
    expect(lido).not.toBeNull();
    expect(lido?.nonce).toBe(nonce);
    expect(lido?.userId).toBe(userId);
  });

  it("recusa state malformado ou truncado", () => {
    expect(lerEstadoGoogle(undefined)).toBeNull();
    expect(lerEstadoGoogle("")).toBeNull();
    expect(lerEstadoGoogle("sem-ponto")).toBeNull();
    expect(lerEstadoGoogle("curto.123")).toBeNull();
  });

  it("valida nonce em tempo constante", () => {
    const n1 = novoNonceGoogle();
    const n2 = novoNonceGoogle();
    expect(nonceGoogleConfere(n1, n1)).toBe(true);
    expect(nonceGoogleConfere(n1, n2)).toBe(false);
    expect(nonceGoogleConfere(n1, "")).toBe(false);
  });

  it("obterRedirectUriGoogle devolve localhost no ambiente local e producao no padrao", () => {
    expect(obterRedirectUriGoogle("http://localhost:3000")).toBe("http://localhost:3000/api/auth/google/callback");
    expect(obterRedirectUriGoogle("http://127.0.0.1:3000")).toBe("http://127.0.0.1:3000/api/auth/google/callback");
    expect(obterRedirectUriGoogle("https://user.xcart.app")).toBe("https://user.xcart.app/api/auth/google/callback");
  });

  it("monta a URL oficial do Google OAuth com clientId, offline access e escopos corretos", () => {
    process.env.GOOGLE_CLIENT_ID = "mock-google-client-id.apps.googleusercontent.com";
    process.env.GOOGLE_CLIENT_SECRET = "mock-google-client-secret";

    const redirectUri = "https://user.xcart.app/api/auth/google/callback";
    const state = "nonce-teste.user-123";

    const urlStr = montarUrlLoginGoogle({ redirectUri, state });
    const url = new URL(urlStr);

    expect(url.origin).toBe("https://accounts.google.com");
    expect(url.pathname).toBe("/o/oauth2/v2/auth");
    expect(url.searchParams.get("client_id")).toBe(
      "mock-google-client-id.apps.googleusercontent.com"
    );
    expect(url.searchParams.get("redirect_uri")).toBe(redirectUri);
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe(state);

    const scopes = url.searchParams.get("scope") || "";
    expect(scopes).toContain("https://www.googleapis.com/auth/adwords");
    expect(scopes).toContain("email");
    expect(scopes).toContain("profile");
  });
});
