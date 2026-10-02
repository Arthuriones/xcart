import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { MAX_LINHAS_CSV, validarCustoItem, type CustoCru } from "@/lib/financeiro/csv-custos";
import { diaNoFuso, ehUuid, type CustoItemCorpo, type CustosCorpo } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Custos por SKU: lancar versoes (manual ou CSV) e apagar uma versao.
//
// Escrita pelo service role porque a 052 revoga INSERT/UPDATE/DELETE do
// authenticated em product_costs: o user_id da linha nao pode vir do cliente.
// O dono e conferido pela LOJA, a partir da sessao -- nunca pelo corpo.
//
// Cada linha e uma VERSAO (store_id, sku, valido_desde). Lancar o mesmo SKU
// com a mesma data substitui; com data nova, cria versao e os pedidos antigos
// ficam com o custo antigo. Por isso a data vazia vira "hoje no fuso da loja",
// e nao "hoje em UTC": a loja de Sao Paulo as 22h ainda esta no dia de hoje.
// ============================================================================

const LOTE_UPSERT = 500;

type Autorizacao =
  | { erro: NextResponse }
  | {
      erro: null;
      admin: ReturnType<typeof createAdminClient>;
      loja: { id: string; user_id: string };
    };

/** A sessao e a loja que ela pode mexer. Loja alheia = 404, como se nao existisse. */
async function autorizar(storeId: string): Promise<Autorizacao> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const admin = createAdminClient();
  const { data: loja, error } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", storeId)
    .maybeSingle();
  if (error) {
    return { erro: NextResponse.json({ error: `Falha ao ler a loja: ${error.message}` }, { status: 500 }) };
  }
  if (!loja || loja.user_id !== user.id) {
    return { erro: NextResponse.json({ error: "Loja não encontrada." }, { status: 404 }) };
  }
  return { erro: null, admin, loja: { id: String(loja.id), user_id: String(loja.user_id) } };
}

export async function POST(request: NextRequest) {
  let corpo: Partial<CustosCorpo> | null = null;
  try {
    corpo = (await request.json()) as Partial<CustosCorpo>;
  } catch {
    corpo = null;
  }
  if (!corpo || !ehUuid(corpo.store_id)) {
    return NextResponse.json({ error: "Loja inválida." }, { status: 400 });
  }
  const itensCrus = Array.isArray(corpo.itens) ? corpo.itens : null;
  if (!itensCrus || itensCrus.length === 0) {
    return NextResponse.json({ error: "Nenhum custo para gravar." }, { status: 400 });
  }
  if (itensCrus.length > MAX_LINHAS_CSV) {
    return NextResponse.json(
      { error: `No máximo ${MAX_LINHAS_CSV} custos por vez. Divida o arquivo.` },
      { status: 400 }
    );
  }
  const origem = corpo.origem === "csv" ? "csv" : "manual";

  const auth = await autorizar(corpo.store_id.toLowerCase());
  if (auth.erro) return auth.erro;
  const { admin, loja } = auth;

  // Mesma regra da previa da tela: o que ela mostrou como valido passa aqui.
  const validos: CustoItemCorpo[] = [];
  const erros: string[] = [];
  itensCrus.forEach((cru, i) => {
    const r = validarCustoItem((cru ?? {}) as CustoCru, null);
    if (r.ok) validos.push(r.item);
    else erros.push(`item ${i + 1}: ${r.motivo}`);
  });
  if (erros.length > 0) {
    return NextResponse.json(
      { error: `Custos inválidos — nada foi gravado. ${erros.slice(0, 10).join("; ")}` },
      { status: 400 }
    );
  }

  // "Hoje" no fuso da loja, que o sync de pedidos le da Shopify. Sem sync
  // ainda, UTC: no pior caso a versao comeca um dia antes ou depois.
  let hoje: string | null = null;
  if (validos.some((v) => !v.valido_desde)) {
    const { data: estado, error } = await admin
      .from("fin_sync_state")
      .select("fuso")
      .eq("store_id", loja.id)
      .maybeSingle();
    if (error) {
      return NextResponse.json({ error: `Falha ao ler o fuso da loja: ${error.message}` }, { status: 500 });
    }
    hoje = diaNoFuso(new Date(), (estado as { fuso: string | null } | null)?.fuso);
  }

  // Duas linhas com o mesmo SKU e a mesma data no mesmo envio: o upsert do
  // Postgres recusa o lote inteiro ("cannot affect row a second time"). A
  // ultima vence, como numa planilha lida de cima para baixo.
  const porChave = new Map<string, Record<string, unknown>>();
  for (const v of validos) {
    const valido_desde = v.valido_desde || (hoje as string);
    porChave.set(`${v.sku}\u0000${valido_desde}`, {
      store_id: loja.id,
      user_id: loja.user_id,
      sku: v.sku,
      custo_unitario: v.custo_unitario,
      frete_unitario: v.frete_unitario ?? 0,
      moeda: v.moeda,
      valido_desde,
      origem,
    });
  }
  const linhas = [...porChave.values()];

  let gravados = 0;
  for (let i = 0; i < linhas.length; i += LOTE_UPSERT) {
    const lote = linhas.slice(i, i + LOTE_UPSERT);
    const { error } = await admin
      .from("product_costs")
      .upsert(lote, { onConflict: "store_id,sku,valido_desde" });
    if (error) {
      return NextResponse.json(
        {
          error: `Falha ao gravar os custos (${gravados} de ${linhas.length} já gravados): ${error.message}`,
          gravados,
        },
        { status: 500 }
      );
    }
    gravados += lote.length;
  }

  return NextResponse.json({ ok: true, gravados });
}

export async function DELETE(request: NextRequest) {
  const id = request.nextUrl.searchParams.get("id");
  if (!ehUuid(id)) return NextResponse.json({ error: "Custo inválido." }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // O gatilho da 052 obriga user_id = dono da loja em toda escrita, entao
  // filtrar pelo user_id da sessao basta para nao apagar versao de outro.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("product_costs")
    .delete()
    .eq("id", id.toLowerCase())
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    return NextResponse.json({ error: `Falha ao apagar o custo: ${error.message}` }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ error: "Custo não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
