import { createAdminClient } from "@/lib/supabase/admin";
import { segredoDaPlataforma } from "@/lib/checkouts-externos/repo-supabase";
import { usaSegredo } from "@/lib/checkouts-externos/tipos";
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
// Na Cakto, diz tambem SE o secret dela ja foi colado -- nunca o secret.
// ============================================================================

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  try {
    const checkout = await checkoutDaSessao(id);
    if (!checkout) return NAO_ENCONTRADO();
    const admin = createAdminClient();
    const token = await tokenDoCheckout(admin, checkout.id);
    if (!token) return json(409, { ok: false, erro: "Este checkout está sem URL. Use “Trocar URL”." });
    const temSegredo = usaSegredo(checkout.plataforma) ? Boolean(await segredoDaPlataforma(admin, checkout.id)) : undefined;
    return json(200, { ok: true, url: urlPublica(token), ...(temSegredo === undefined ? {} : { temSegredo }) });
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler a URL: ${e instanceof Error ? e.message : e}` });
  }
}
