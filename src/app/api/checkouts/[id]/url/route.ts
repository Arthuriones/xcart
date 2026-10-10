import { createAdminClient } from "@/lib/supabase/admin";
import {
  NAO_ENCONTRADO,
  checkoutDaSessao,
  json,
  tokenDoCheckout,
  urlPublica,
  usuarioDaSessao,
} from "@/lib/checkouts-externos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/checkouts/[id]/url: a URL do webhook, so para o dono (a sessao
// confere pela RLS; o token vem pelo service role, a tabela nao tem policy).
// A lista de checkouts NUNCA traz a URL: ela so sai quando o lojista pede.
// ============================================================================

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  try {
    const checkout = await checkoutDaSessao(id);
    if (!checkout) return NAO_ENCONTRADO();
    const token = await tokenDoCheckout(createAdminClient(), checkout.id);
    if (!token) return json(409, { ok: false, erro: "Este checkout está sem URL. Use “Trocar URL”." });
    return json(200, { ok: true, url: urlPublica(token) });
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler a URL: ${e instanceof Error ? e.message : e}` });
  }
}
