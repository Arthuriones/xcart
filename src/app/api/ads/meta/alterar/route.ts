import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarAlteracao, contaDoUsuario, temAcessoAEdicao, tokenDaConta } from "@/lib/ads/gerenciar";
import { CAMPOS_EDICAO, NIVEIS_EDICAO, type CampoEdicao, type NivelEdicao } from "@/lib/ads/gerenciar-regras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================================
// POST /api/ads/meta/alterar
// { conta, nivel, id, campo: status|orcamento_diario|orcamento_total|lance|roas_minimo, valor, esperado? }
//
// Liga/pausa, muda orcamento ou lance de UM objeto do Meta, dentro da
// estrategia que ja existe (nada de criar campanha nem trocar estrategia).
// `esperado` e o valor que a tela mostrava: se o Meta tem outro agora, volta
// 409 com o objeto atual e nada muda. Tudo vai para o historico.
// ============================================================================

interface Corpo {
  conta?: unknown;
  nivel?: unknown;
  id?: unknown;
  campo?: unknown;
  valor?: unknown;
  esperado?: unknown;
}

export async function POST(request: NextRequest) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  if (!(await temAcessoAEdicao(user.id))) {
    return NextResponse.json({ ok: false, erro: "Editar campanhas é do plano pago." }, { status: 403 });
  }

  let corpo: Corpo = {};
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    corpo = {};
  }
  const nivel = corpo.nivel as NivelEdicao;
  const campo = corpo.campo as CampoEdicao;
  const objetoId = typeof corpo.id === "string" ? corpo.id : "";
  const contaId = typeof corpo.conta === "string" ? corpo.conta : "";
  if (!NIVEIS_EDICAO.includes(nivel) || !CAMPOS_EDICAO.includes(campo) || !/^[0-9]{5,25}$/.test(objetoId)) {
    return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
  }
  const esperado =
    typeof corpo.esperado === "string" ? corpo.esperado : typeof corpo.esperado === "number" ? String(corpo.esperado) : null;

  const db = createAdminClient();
  const conta = await contaDoUsuario(db, user.id, contaId);
  if (!conta) return NextResponse.json({ ok: false, erro: "Conta do Meta não encontrada." }, { status: 404 });
  const token = await tokenDaConta(db, conta.id);
  if (!token) {
    return NextResponse.json({ ok: false, erro: "Esta conta não tem token do Meta. Reconecte em Integrações." }, { status: 409 });
  }

  const r = await aplicarAlteracao({
    db,
    conta,
    token,
    nivel,
    objetoId,
    campo,
    valor: corpo.valor,
    esperado,
    origem: "manual",
  });
  if (!r.ok) {
    return NextResponse.json({ ok: false, erro: r.erro, objeto: r.conflito ?? null }, { status: r.status });
  }
  return NextResponse.json({ ok: true, objeto: r.objeto, antes: r.antes, depois: r.depois });
}
