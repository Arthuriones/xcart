import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { aplicarAlteracoes, contaDoUsuario, temAcessoAEdicao, tokenDaConta, type MudancaPedida } from "@/lib/ads/gerenciar";
import { CAMPOS_EDICAO, NIVEIS_EDICAO, type CampoEdicao, type NivelEdicao } from "@/lib/ads/gerenciar-regras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ============================================================================
// POST /api/ads/meta/alterar
// { conta, nivel, id, campo: status|orcamento_diario|orcamento_total|lance|roas_minimo, valor, esperado? }
// ou { conta, nivel, id, mudancas: [{ campo, valor, esperado? }, ...] } -- varias
// mudancas do mesmo objeto num POST so (o Meta aceita 1 edicao por objeto a
// cada 30 s); tudo ou nada.
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
  mudancas?: unknown;
}

function textoOuNulo(v: unknown): string | null {
  return typeof v === "string" ? v : typeof v === "number" ? String(v) : null;
}

/** O corpo -> a lista de mudancas, ou null se algo nao for valido. */
function mudancasDoCorpo(corpo: Corpo): MudancaPedida[] | null {
  const lista = Array.isArray(corpo.mudancas)
    ? (corpo.mudancas as Record<string, unknown>[])
    : [{ campo: corpo.campo, valor: corpo.valor, esperado: corpo.esperado }];
  if (lista.length === 0 || lista.length > CAMPOS_EDICAO.length) return null;
  const saida: MudancaPedida[] = [];
  for (const m of lista) {
    if (!m || typeof m !== "object" || !CAMPOS_EDICAO.includes(m.campo as CampoEdicao)) return null;
    saida.push({ campo: m.campo as CampoEdicao, valor: m.valor, esperado: textoOuNulo(m.esperado) });
  }
  return saida;
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
  const mudancas = mudancasDoCorpo(corpo);
  const objetoId = typeof corpo.id === "string" ? corpo.id : "";
  const contaId = typeof corpo.conta === "string" ? corpo.conta : "";
  if (!NIVEIS_EDICAO.includes(nivel) || !mudancas || !/^[0-9]{5,25}$/.test(objetoId)) {
    return NextResponse.json({ ok: false, erro: "Pedido inválido." }, { status: 400 });
  }
  const db = createAdminClient();
  const conta = await contaDoUsuario(db, user.id, contaId);
  if (!conta) return NextResponse.json({ ok: false, erro: "Conta do Meta não encontrada." }, { status: 404 });
  const token = await tokenDaConta(db, conta.id);
  if (!token) {
    return NextResponse.json({ ok: false, erro: "Esta conta não tem token do Meta. Reconecte em Integrações." }, { status: 409 });
  }

  const r = await aplicarAlteracoes({ db, conta, token, nivel, objetoId, mudancas, origem: "manual" });
  if (!r.ok) {
    return NextResponse.json({ ok: false, erro: r.erro, objeto: r.conflito ?? null }, { status: r.status });
  }
  return NextResponse.json({ ok: true, objeto: r.objeto, antes: r.antes, depois: r.depois });
}
