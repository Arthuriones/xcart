import "server-only";
import { safeFetch } from "@/lib/net/safe-url";
import type { createAdminClient } from "@/lib/supabase/admin";

// ============================================================================
// Envio pelo Bot API do Telegram.
//
// A URL do Bot API CONTEM o token (https://api.telegram.org/bot<TOKEN>/...).
// Por isso nada aqui loga a URL, e todo texto de erro que volta passa por
// `semToken` -- erro de rede do Node as vezes repete o endereco.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

const TIMEOUT_MS = 10_000;
const LIMITE_TELEGRAM = 4096;

function semToken(texto: string, token: string): string {
  return token ? texto.split(token).join("***") : texto;
}

export async function enviarTelegram(
  token: string,
  chatId: string,
  texto: string,
  silenciosa: boolean
): Promise<{ ok: boolean; erro?: string; retryAfter?: number }> {
  try {
    const resposta = await safeFetch("https://api.telegram.org/bot" + token + "/sendMessage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: texto.slice(0, LIMITE_TELEGRAM),
        disable_notification: silenciosa,
      }),
      timeoutMs: TIMEOUT_MS,
    });

    let json: {
      ok?: boolean;
      description?: string;
      parameters?: { retry_after?: number };
    } | null = null;
    try {
      json = await resposta.json();
    } catch {
      /* corpo nao-JSON: cai no status abaixo */
    }

    if (resposta.ok && json?.ok) return { ok: true };

    const retry = json?.parameters?.retry_after;
    return {
      ok: false,
      erro: semToken(json?.description || `Telegram respondeu ${resposta.status}`, token),
      ...(typeof retry === "number" ? { retryAfter: retry } : {}),
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "falha de rede";
    return { ok: false, erro: semToken(`Nao foi possivel falar com o Telegram: ${msg}`, token) };
  }
}

/**
 * Token do bot do usuario; sem ele, o da env (bot unico da instalacao).
 * Le com service role: alerta_config_secrets nao tem policy.
 */
export async function tokenDoBot(admin: Admin, userId: string): Promise<string | null> {
  const { data } = await admin
    .from("alerta_config_secrets")
    .select("telegram_bot_token")
    .eq("user_id", userId)
    .maybeSingle();
  const proprio = String((data as { telegram_bot_token?: string | null } | null)?.telegram_bot_token || "").trim();
  if (proprio) return proprio;
  const env = String(process.env.TELEGRAM_BOT_TOKEN || "").trim();
  return env || null;
}
