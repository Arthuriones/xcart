import {
  NAO_ENCONTRADO,
  checkoutDaSessao,
  json,
  resumoDoCheckout,
  usuarioDaSessao,
} from "@/lib/checkouts-externos/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/checkouts/[id]/status: o ultimo evento e o ultimo erro, para o
// dialog de cadastro mostrar "chegou" sem recarregar a pagina. So a sessao
// (RLS), sem o token.
// ============================================================================

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuarioDaSessao();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  try {
    const checkout = await checkoutDaSessao(id);
    if (!checkout) return NAO_ENCONTRADO();
    return json(200, { ok: true, checkout: resumoDoCheckout(checkout) });
  } catch (e) {
    return json(500, { ok: false, erro: `Falha ao ler o checkout: ${e instanceof Error ? e.message : e}` });
  }
}
