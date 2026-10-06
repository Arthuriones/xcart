import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import { META_GRAPH_VERSAO } from "@/lib/financeiro/tipos";

/**
 * Funcoes de comunicacao com a API da Meta para o fluxo OAuth (Login com Facebook).
 * Utilizado para conexao com 1 clique (estilo UTMify) e troca por Long-Lived User Token (60 dias).
 */

const VERSAO = META_GRAPH_VERSAO || "v20.0";
const GRAPH_BASE = `https://graph.facebook.com/${VERSAO}`;
const DIALOG_BASE = `https://www.facebook.com/${VERSAO}/dialog/oauth`;
const TIMEOUT_MS = 25_000;

export interface MetaAppCredentials {
  appId: string;
  appSecret: string;
}

export function obterCredenciaisMeta(): MetaAppCredentials {
  const appId = (process.env.META_APP_ID || "").trim();
  const appSecret = (process.env.META_APP_SECRET || "").trim();

  if (!appId || !appSecret) {
    throw new Error("Credenciais do Meta App (META_APP_ID / META_APP_SECRET) não configuradas.");
  }
  return { appId, appSecret };
}

/**
 * Descobre a URI de callback exata com base no host da requisicao ou no ambiente.
 * As duas unicas URIs validas cadastradas no portal Meta sao:
 * - http://localhost:3000/api/auth/meta/callback
 * - https://user.xcart.app/api/auth/meta/callback
 */
export function obterRedirectUriMeta(origem?: string | null): string {
  if (origem) {
    try {
      const u = new URL(origem);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") {
        return `${u.protocol}//${u.host}/api/auth/meta/callback`;
      }
    } catch {
      // Ignora erro de parse e usa producao
    }
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (appUrl) {
    return `${appUrl.replace(/\/+$/, "")}/api/auth/meta/callback`;
  }

  return "https://user.xcart.app/api/auth/meta/callback";
}

/**
 * Monta a URL oficial do Facebook OAuth Dialog.
 */
export function montarUrlLoginMeta({
  redirectUri,
  state,
}: {
  redirectUri: string;
  state: string;
}): string {
  const { appId } = obterCredenciaisMeta();
  const url = new URL(DIALOG_BASE);

  url.searchParams.set("client_id", appId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  // Permissoes para perfil, email e leitura de contas e campanhas de anuncio
  url.searchParams.set("scope", "public_profile,email,ads_read,read_insights");

  return url.toString();
}

export interface TokenMetaResultado {
  accessToken: string;
  expiresInSegundos: number; // Ex: 5184000 (60 dias)
}

/**
 * Troca o `code` de autorizacao por um token de usuario de curta duracao
 * e em seguida troca pelo Long-Lived User Token (com validade de 60 dias).
 */
export async function trocarCodigoPorTokenMeta({
  code,
  redirectUri,
}: {
  code: string;
  redirectUri: string;
}): Promise<TokenMetaResultado> {
  const { appId, appSecret } = obterCredenciaisMeta();

  // 1. Troca code por Short-Lived Token
  const tokenUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  tokenUrl.searchParams.set("client_id", appId);
  tokenUrl.searchParams.set("client_secret", appSecret);
  tokenUrl.searchParams.set("redirect_uri", redirectUri);
  tokenUrl.searchParams.set("code", code);

  let resp: Response;
  try {
    resp = await safeFetch(tokenUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    throw new Error("Falha de rede ao conectar com o Meta para troca de código.");
  }

  const jsonCurto = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || !jsonCurto.access_token) {
    const erroMsg =
      (jsonCurto?.error as Record<string, unknown>)?.message ||
      `HTTP ${resp.status} na autorização do Meta`;
    throw new Error(String(erroMsg));
  }

  const tokenCurto = String(jsonCurto.access_token);
  const expiraCurto = Number(jsonCurto.expires_in) || 3600;

  // 2. Troca por Long-Lived Token (60 dias)
  const exchangeUrl = new URL(`${GRAPH_BASE}/oauth/access_token`);
  exchangeUrl.searchParams.set("grant_type", "fb_exchange_token");
  exchangeUrl.searchParams.set("client_id", appId);
  exchangeUrl.searchParams.set("client_secret", appSecret);
  exchangeUrl.searchParams.set("fb_exchange_token", tokenCurto);

  try {
    const respLongo = await safeFetch(exchangeUrl.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: TIMEOUT_MS,
    });

    if (respLongo.ok) {
      const jsonLongo = (await respLongo.json().catch(() => ({}))) as Record<string, unknown>;
      if (jsonLongo.access_token) {
        return {
          accessToken: String(jsonLongo.access_token),
          expiresInSegundos: Number(jsonLongo.expires_in) || 60 * 24 * 60 * 60, // 60 dias
        };
      }
    }
  } catch {
    // Se a troca pelo token longo falhar, continua com o token curto como fallback
  }

  return {
    accessToken: tokenCurto,
    expiresInSegundos: expiraCurto,
  };
}

export interface PerfilMeta {
  id: string;
  nome: string;
  email: string | null;
  fotoUrl: string | null;
}

/**
 * Busca informacoes basicas do perfil do Facebook que fez o login (Nome, email e foto de perfil).
 */
export async function buscarPerfilMeta(accessToken: string): Promise<PerfilMeta> {
  const url = new URL(`${GRAPH_BASE}/me`);
  url.searchParams.set("fields", "id,name,email,picture.width(200).height(200)");
  url.searchParams.set("access_token", accessToken);

  let resp: Response;
  try {
    resp = await safeFetch(url.toString(), {
      method: "GET",
      headers: { accept: "application/json" },
      timeoutMs: TIMEOUT_MS,
    });
  } catch {
    throw new Error("Falha ao consultar perfil do Facebook no Meta Graph.");
  }

  const json = (await resp.json().catch(() => ({}))) as Record<string, unknown>;
  if (!resp.ok || !json.id) {
    const erroMsg =
      (json?.error as Record<string, unknown>)?.message || `HTTP ${resp.status} ao consultar perfil`;
    throw new Error(String(erroMsg));
  }

  const picture = json.picture as { data?: { url?: string } } | undefined;
  const fotoUrl = picture?.data?.url ? String(picture.data.url) : null;

  return {
    id: String(json.id),
    nome: String(json.name || "Perfil Facebook"),
    email: json.email ? String(json.email) : null,
    fotoUrl,
  };
}
