import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { contaDoUsuario, lerAoVivo, temAcessoAEdicao, textoDoErroDeEdicao, tokenDaConta } from "@/lib/ads/gerenciar";
import { NIVEIS_EDICAO, type NivelEdicao } from "@/lib/ads/gerenciar-regras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ============================================================================
// GET /api/ads/meta/objeto?conta=<ad_accounts.id>&nivel=campanha|grupo|anuncio&id=<id no Meta>
// O estado AO VIVO do objeto (status, orcamento, estrategia e lance), para a
// tela abrir a edicao com o valor de agora. So conta do Meta do proprio
// usuario; o objeto precisa ser dessa conta.
// ============================================================================

export async function GET(request: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  if (!(await temAcessoAEdicao(user.id))) {
    return NextResponse.json({ ok: false, erro: "Editar campanhas é do plano pago." }, { status: 403 });
  }

  const q = request.nextUrl.searchParams;
  const nivel = q.get("nivel") as NivelEdicao | null;
  const contaId = q.get("conta") ?? "";
  const objetoId = q.get("id") ?? "";
  if (!nivel || !NIVEIS_EDICAO.includes(nivel) || !/^[0-9]{5,25}$/.test(objetoId)) {
    return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
  }

  const db = createAdminClient();
  const conta = await contaDoUsuario(db, user.id, contaId);
  if (!conta) return NextResponse.json({ ok: false, erro: "Conta do Meta não encontrada." }, { status: 404 });
  const token = await tokenDaConta(db, conta.id);
  if (!token) return NextResponse.json({ ok: false, erro: "Esta conta não tem token do Meta. Reconecte em Integrações." }, { status: 409 });

  try {
    const objeto = await lerAoVivo(conta, token, nivel, objetoId);
    if (!objeto) return NextResponse.json({ ok: false, erro: "Objeto não encontrado nesta conta do Meta." }, { status: 404 });
    return NextResponse.json({ ok: true, objeto });
  } catch (e) {
    return NextResponse.json({ ok: false, erro: textoDoErroDeEdicao(e) }, { status: 502 });
  }
}
