import { createAdminClient } from "@/lib/supabase/admin";
import { safeFetch } from "@/lib/net/safe-url";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import {
  NAO_ENCONTRADO,
  checkoutDaSessao,
  json,
  resumoDoCheckout,
  tokenDoCheckout,
  urlPublica,
  usuarioDaSessao,
} from "@/lib/checkouts-externos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// ============================================================================
// POST /api/checkouts/[id]/teste: o xcart manda para a PROPRIA URL publica do
// checkout o corpo de exemplo da plataforma, marcado como teste. Passa pelo
// caminho inteiro de um evento real (host, middleware, token, adaptador), mas
// o endpoint reconhece o teste e nunca grava pedido: os numeros nao mudam.
//
// safeFetch, nao fetch: a URL e a nossa (host do app), mas a regra do repo e
// mecanica (tests/sem-fetch-cru.test.ts).
// ============================================================================

const TIMEOUT_MS = 12_000;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  const admin = createAdminClient();
  let url: string;
  let corpoTeste: unknown;
  try {
    const checkout = await checkoutDaSessao(id);
    if (!checkout) return NAO_ENCONTRADO();
    if (!checkout.ativo) return json(409, { ok: false, erro: "O checkout está pausado. Ative para testar." });
    const plataforma = plataformaDe(checkout.plataforma);
    const token = await tokenDoCheckout(admin, checkout.id);
    if (!plataforma || !token) return json(409, { ok: false, erro: "Este checkout está sem URL. Use “Trocar URL”." });
    url = urlPublica(token);
    corpoTeste = plataforma.exemplo(new Date());
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler o checkout: ${e instanceof Error ? e.message : e}` });
  }

  let status = 0;
  let resposta: unknown = null;
  try {
    const r = await safeFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "xcart-teste" },
      body: JSON.stringify(corpoTeste),
      timeoutMs: TIMEOUT_MS,
    });
    status = r.status;
    resposta = await r.json().catch(() => null);
  } catch {
    return json(200, { ok: false, erro: "A URL não respondeu. Tente de novo em instantes." });
  }
  if (status < 200 || status >= 300) {
    return json(200, { ok: false, erro: `A URL respondeu ${status}.`, status });
  }

  // 2xx nao basta (um redirect para GET tambem da 200): so o endpoint do
  // checkout responde { ok: true, teste: true }. Nao relemos ultimo_evento_em:
  // num checkout que ja recebe eventos reais o teste nao o mexe.
  const r = resposta as { ok?: unknown; teste?: unknown } | null;
  if (!r || r.ok !== true || r.teste !== true) {
    return json(200, { ok: false, erro: "A URL respondeu, mas o evento não chegou ao checkout.", status });
  }
  const depois = await checkoutDaSessao(id).catch(() => null);
  return json(200, { ok: true, status, checkout: depois ? resumoDoCheckout(depois) : null });
}
