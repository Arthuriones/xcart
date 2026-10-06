import "server-only";
import { safeFetch } from "@/lib/net/safe-url";

/**
 * Comunicacao com a Google Identity & OAuth 2.0 API para conexao com 1 clique (Google Ads).
 * Garante obtencao do `refresh_token` offline para atualizacoes continuas.
 */

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";
const GOOGLE_ADS_API_BASE = "https://googleads.googleapis.com/v18";
const TIMEOUT_MS = 25_000;

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export function obterCredenciaisGoogle(): GoogleCredentials {
  const clientId = (process.env.GOOGLE_CLIENT_ID || "").trim();
  const clientSecret = (process.env.GOOGLE_CLIENT_SECRET || "").trim();

  if (!clientId || !clientSecret) {
    throw new Error("Credenciais do Google OAuth (GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET) não configuradas.");
  }

  return { clientId, clientSecret };
}

/**
 * Descobre a URI de callback exata com base no host da requisicao ou no ambiente.
 * As duas URIs cadastradas no Google Cloud Console sao:
 * - http://localhost:3000/api/auth/google/callback
 * - https://user.xcart.app/api/auth/google/callback
 */
export function obterRedirectUriGoogle(origem?: string | null): string {
  if (origem) {
    try {
      const u = new URL(origem);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        return `${u.protocol}//${u.host}/api/auth/google/callback`;
      }
    } catch {
      // Ignora erro de parse e usa producao
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return `${appUrl.replace(/\/+$/, "")}/api/auth/google/callback`;
  }

  return "https://user.xcart.app/api/auth/google/callback";
}

/**
 * Monta a URL oficial do Google OAuth 2.0 Consent Screen.
 */
export function montarUrlLoginGoogle({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}): string {
  const { clientId } = obterCredenciaisGoogle();
  const url = new URL(AUTH_BASE);

  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  // Escopos: Google Ads + Email + Perfil
  url.searchParams.set(
    "scope",
    "https://www.googleapis.com/auth/adwords email profile openid"
  );
  // access_type=offline e prompt=consent garantem a devolucao do refresh_token
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return url.toString();
}

export interface TokenGoogleResultado {
  accessToken: string;
  refreshToken: string | null;
  expiresInSegundos: number;
}

/**
 * Troca o `code` de autorizacao pelos tokens do Google (`access_token` e `refresh_token`).
 */
export async function trocarCodigoPorTokenGoogle({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<TokenGoogleResultado> {
  const { clientId, clientSecret } = obterCredenciaisGoogle();

  const params = new URLSearchParams();
  params.set("code", code);
  params.set("client_id", clientId);
  params.set("client_secret", clientSecret);
  params.set("redirect_uri", redirectUri);
  params.set("grant_type", "authorization_code");

  let resp: Response;
  try {
    resp = await safeFetch(TOKEN_URL, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: params.toString(),
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    throw new Error("Falha de rede ao conectar com o Google para troca de código.");
  }

  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || !json.access_token) {
    const erroMsg =
      (json?.error_description as string) ||
      (json?.error as string) ||
      `HTTP ${resp.status} na autorização do Google`;
    throw new Error(String(erroMsg));
  }

  return {
    accessToken: String(json.access_token),
    refreshToken: json.refresh_token ? String(json.refresh_token) : null,
    expiresInSegundos: Number(json.expires_in) || 3600,
  };
}

export interface PerfilGoogle {
  id: string;
  nome: string;
  email: string | null;
  fotoUrl: string | null;
}

/**
 * Busca informacoes basicas do perfil Google autenticado (Nome, email e foto).
 */
export async function buscarPerfilGoogle(accessToken: string): Promise<PerfilGoogle> {
  let resp: Response;
  try {
    resp = await safeFetch(USERINFO_URL, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        accept: "application/json",
      },
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    throw new Error("Falha ao consultar informações do perfil Google.");
  }

  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || !json.sub) {
    throw new Error(`HTTP ${resp.status} ao consultar perfil Google`);
  }

  return {
    id: String(json.sub),
    nome: String(json.name || json.email || "Conta Google"),
    email: json.email ? String(json.email) : null,
    fotoUrl: json.picture ? String(json.picture) : null,
  };
}

export interface ContaGoogleAdsDescoberta {
  customerId: string; // 10 digitos
  nome?: string;
}

/**
 * Tenta listar os Customer IDs acessiveis via Google Ads API.
 * Retorna lista de IDs de 10 digitos (ex: "1234567890").
 */
export async function listarContasGoogleAds(
  accessToken: string,
  developerToken?: string
): Promise<ContaGoogleAdsDescoberta[]> {
  const devToken = (developerToken || process.env.GOOGLE_ADS_DEVELOPER_TOKEN || "").trim();
  if (!devToken) {
    // Sem developer token, devolve lista vazia sem quebrar o login
    return [];
  }

  try {
    const resp = await safeFetch(`${GOOGLE_ADS_API_BASE}/customers:listAccessibleCustomers`, {
      method: "GET",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "developer-token": devToken,
        accept: "application/json",
      },
      timeoutMs: TIMEOUT_MS,
    });

    if (!resp.ok) return [];

    const json = (await resp.json().catch(() => ({}))) as {
      resourceNames?: string[];
    };

    const contas: ContaGoogleAdsDescoberta[] = [];
    for (const res of json.resourceNames || []) {
      // Formato: "customers/1234567890"
      const match = res.match(/customers\/(\d{10})/);
      if (match) {
        contas.push({ customerId: match[1] });
      }
    }

    return contas;
  } catch {
    return [];
  }
}
