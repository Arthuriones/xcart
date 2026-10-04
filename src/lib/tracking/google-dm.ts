import "server-only";
import { createSign } from "node:crypto";
import { safeFetch } from "@/lib/net/safe-url";

// ============================================================================
// Google Data Manager API: autenticacao e as duas chamadas que o xcart usa.
//
//   POST /v1/events:ingest            manda a conversao, devolve requestId
//   GET  /v1/requestStatus:retrieve   diz, 30 min a 24 h depois, se contou
//
// O corpo e montado em google-url.ts (puro, testado). Aqui so rede e chave.
//
// CREDENCIAL
//
// Service account, por variavel de ambiente -- so as contas do Arthur por
// enquanto; OAuth de cliente fica para depois. Service account nao passa por
// verificacao OAuth e a Data Manager nao pede developer token.
//
//   GOOGLE_DM_SA_EMAIL   e-mail da service account (xxx@projeto.iam.gserviceaccount.com)
//   GOOGLE_DM_SA_KEY     a chave privada PEM -- ou o JSON inteiro baixado do
//                        Google Cloud, que ja traz o e-mail junto
//
// Sem as duas, o destino configurado fica "falta configurar" e nao recebe
// evento nenhum (destinos.ts). Nao ha erro de envio a mostrar.
//
//   GOOGLE_DM_DONOS      uuids (virgula) dos usuarios que podem usar a service
//                        account. Ela e UMA so, do Arthur: sem esta lista,
//                        qualquer lojista apontaria customer_id/MCC para uma
//                        conta onde a service account tem acesso e mandaria
//                        conversao para la.
//
// O token de acesso (1 h) fica em memoria da instancia: o JWT e assinado com
// node:crypto, sem biblioteca do Google.
// ============================================================================

const ESCOPO = "https://www.googleapis.com/auth/datamanager";
const URL_TOKEN = "https://oauth2.googleapis.com/token";
const URL_INGEST = "https://datamanager.googleapis.com/v1/events:ingest";
const URL_STATUS = "https://datamanager.googleapis.com/v1/requestStatus:retrieve";

/** O envio roda no cron; o coletor so agenda. Mesmo assim, nada de esperar a toa. */
const TIMEOUT_MS = 8000;

interface Credencial {
  email: string;
  chave: string;
}

/** A service account do ambiente, ou null quando falta alguma parte. */
export function credencialDoGoogle(): Credencial | null {
  const bruto = (process.env.GOOGLE_DM_SA_KEY || "").trim();
  let email = (process.env.GOOGLE_DM_SA_EMAIL || "").trim();
  let chave = bruto;

  // O JSON baixado do Google Cloud, colado inteiro na variavel.
  if (bruto.startsWith("{")) {
    try {
      const json = JSON.parse(bruto) as { private_key?: string; client_email?: string };
      chave = json.private_key || "";
      email = email || json.client_email || "";
    } catch {
      return null;
    }
  }

  // A Vercel guarda quebra de linha como "\n" literal quando a chave e colada
  // numa linha so.
  chave = chave.replace(/\\n/g, "\n");
  if (!email || !chave.includes("PRIVATE KEY")) return null;
  return { email, chave };
}

export function temCredencialDoGoogle(): boolean {
  return credencialDoGoogle() !== null;
}

/** O usuario pode configurar envio pela service account? Ver GOOGLE_DM_DONOS. */
export function podeUsarDataManager(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return (process.env.GOOGLE_DM_DONOS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .includes(userId);
}

function base64url(texto: string): string {
  return Buffer.from(texto, "utf8").toString("base64url");
}

let tokenEmCache: { token: string; expiraEm: number; email: string } | null = null;

type ResultadoToken =
  | { ok: true; token: string }
  | { ok: false; erro: string; podeTentarDeNovo: boolean };

/** Token de acesso da service account, reaproveitado ate 5 min antes de vencer. */
async function tokenDeAcesso(): Promise<ResultadoToken> {
  const cred = credencialDoGoogle();
  if (!cred) {
    return { ok: false, erro: "falta a credencial do Google (GOOGLE_DM_SA_EMAIL/KEY)", podeTentarDeNovo: false };
  }
  if (tokenEmCache && tokenEmCache.email === cred.email && tokenEmCache.expiraEm > Date.now()) {
    return { ok: true, token: tokenEmCache.token };
  }

  let assertion: string;
  try {
    const agora = Math.floor(Date.now() / 1000);
    const cabecalho = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const corpo = base64url(
      JSON.stringify({ iss: cred.email, scope: ESCOPO, aud: URL_TOKEN, iat: agora, exp: agora + 3600 })
    );
    const assinatura = createSign("RSA-SHA256")
      .update(`${cabecalho}.${corpo}`)
      .sign(cred.chave)
      .toString("base64url");
    assertion = `${cabecalho}.${corpo}.${assinatura}`;
  } catch {
    // Chave colada pela metade ou de outro tipo. Repetir nao conserta.
    return { ok: false, erro: "chave da service account do Google inválida", podeTentarDeNovo: false };
  }

  try {
    const resposta = await safeFetch(URL_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }).toString(),
      timeoutMs: TIMEOUT_MS,
    });
    const json = (await resposta.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };
    if (!resposta.ok || !json.access_token) {
      return {
        ok: false,
        erro: `Google recusou a service account: ${json.error_description || json.error || `HTTP ${resposta.status}`}`,
        // Credencial recusada se conserta na Vercel; ate MAX_TENTATIVAS a
        // compra espera em vez de virar 'falhou' para sempre.
        podeTentarDeNovo: true,
      };
    }
    const validade = Math.min(Number(json.expires_in) || 3600, 3600);
    tokenEmCache = {
      token: json.access_token,
      email: cred.email,
      expiraEm: Date.now() + (validade - 300) * 1000,
    };
    return { ok: true, token: json.access_token };
  } catch (e) {
    return {
      ok: false,
      erro: e instanceof Error ? e.message.slice(0, 300) : "falha de rede no token do Google",
      podeTentarDeNovo: true,
    };
  }
}

export interface ResultadoDataManager {
  ok: boolean;
  status: number;
  requestId?: string;
  erro?: string;
  podeTentarDeNovo: boolean;
  /** O corpo de erro como veio, para a linha da fila. */
  corpo?: Record<string, unknown> | null;
}

/** Erro da API do Google: { error: { code, message, status } }. */
function mensagemDeErro(json: unknown, status: number): string {
  const erro = (json as { error?: { message?: string; status?: string } } | null)?.error;
  return (erro?.message || erro?.status || `HTTP ${status}`).slice(0, 400);
}

type Chamada =
  | { ok: true; status: number; json: Record<string, unknown> }
  | {
      ok: false;
      status: number;
      erro: string;
      podeTentarDeNovo: boolean;
      corpo?: Record<string, unknown> | null;
    };

async function chamar(
  url: string,
  init: { method: "GET" | "POST"; corpo?: unknown }
): Promise<Chamada> {
  const t = await tokenDeAcesso();
  if (!t.ok) return { ok: false, status: 0, erro: t.erro, podeTentarDeNovo: t.podeTentarDeNovo };

  try {
    const resposta = await safeFetch(url, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${t.token}`,
        ...(init.corpo ? { "Content-Type": "application/json" } : {}),
      },
      body: init.corpo ? JSON.stringify(init.corpo) : undefined,
      timeoutMs: TIMEOUT_MS,
    });
    const json = (await resposta.json().catch(() => ({}))) as Record<string, unknown>;
    if (resposta.ok) return { ok: true, status: resposta.status, json };

    // 401 = token vencido antes da hora: o proximo pedido gera outro.
    if (resposta.status === 401) tokenEmCache = null;
    return {
      ok: false,
      status: resposta.status,
      erro: mensagemDeErro(json, resposta.status),
      // 400 (campo errado) nao melhora sozinho. 403 (sem acesso a conta) e o
      // lojista adicionando a service account: as 8 tentativas (~8 h) dao
      // tempo de consertar sem perder a compra, e o mesmo transactionId nao
      // duplica (DUPLICATE_TRANSACTION_ID vira ok).
      podeTentarDeNovo:
        resposta.status >= 500 ||
        resposta.status === 429 ||
        resposta.status === 401 ||
        resposta.status === 403,
      corpo: json,
    };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      erro: e instanceof Error ? e.message.slice(0, 300) : "falha de rede",
      podeTentarDeNovo: true,
    };
  }
}

/** POST events:ingest. ok = o Google recebeu; se CONTOU, so o diagnostico diz. */
export async function enviarAoDataManager(
  corpo: Record<string, unknown>
): Promise<ResultadoDataManager> {
  const r = await chamar(URL_INGEST, { method: "POST", corpo });
  if (!r.ok) return r;
  const requestId = String(r.json.requestId ?? "");
  return {
    ok: true,
    status: r.status,
    requestId: requestId || undefined,
    podeTentarDeNovo: false,
    corpo: r.json,
  };
}

/** GET requestStatus:retrieve. O corpo vai cru para `lerDiagnostico`. */
export async function consultarEnvio(
  requestId: string
): Promise<{ ok: true; corpo: Record<string, unknown> } | { ok: false; erro: string }> {
  const url = `${URL_STATUS}?requestId=${encodeURIComponent(requestId)}`;
  const r = await chamar(url, { method: "GET" });
  if (!r.ok) return { ok: false, erro: r.erro };
  return { ok: true, corpo: r.json };
}
