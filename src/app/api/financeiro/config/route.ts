import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehUuid, type ConfigFinanceiraCorpo } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Taxa de pagamento e custo padrao de uma loja (fin_store_settings).
//
// A taxa e uma regra simples (percentual + fixo por pedido, na moeda da loja)
// ate o xcart ler a taxa real do Shopify Payments. Escrita pelo service role
// depois de conferir pela sessao que a loja e do usuario: a 052 revoga escrita
// do authenticated.
//
// Os limites repetem os CHECK da tabela: recusar aqui da uma mensagem que o
// lojista entende, em vez do erro cru do Postgres.
// ============================================================================

function numeroValido(v: unknown, min: number, max: number, maxInclusivo: boolean): v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (v < min) return false;
  return maxInclusivo ? v <= max : v < max;
}

export async function POST(request: NextRequest) {
  let corpo: Partial<ConfigFinanceiraCorpo> | null = null;
  try {
    corpo = (await request.json()) as Partial<ConfigFinanceiraCorpo>;
  } catch {
    corpo = null;
  }
  if (!corpo || !ehUuid(corpo.store_id)) {
    return NextResponse.json({ error: "Loja inválida." }, { status: 400 });
  }
  if (!numeroValido(corpo.taxa_pct, 0, 100, false)) {
    return NextResponse.json({ error: "Taxa percentual deve ficar entre 0 e 99,999%." }, { status: 400 });
  }
  if (!numeroValido(corpo.taxa_fixa, 0, 10000, true)) {
    return NextResponse.json({ error: "Taxa fixa deve ficar entre 0 e 10.000." }, { status: 400 });
  }
  const custoPadrao = corpo.custo_padrao_pct ?? null;
  if (custoPadrao !== null && !numeroValido(custoPadrao, 0, 100, true)) {
    return NextResponse.json({ error: "Custo padrão deve ficar entre 0 e 100%, ou vazio." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const storeId = corpo.store_id.toLowerCase();
  const { data: loja, error: erroLoja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", storeId)
    .maybeSingle();
  if (erroLoja) {
    return NextResponse.json({ error: `Falha ao ler a loja: ${erroLoja.message}` }, { status: 500 });
  }
  if (!loja || loja.user_id !== user.id) {
    return NextResponse.json({ error: "Loja não encontrada." }, { status: 404 });
  }

  const { error } = await admin.from("fin_store_settings").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      taxa_pct: corpo.taxa_pct,
      taxa_fixa: corpo.taxa_fixa,
      custo_padrao_pct: custoPadrao,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );
  if (error) {
    return NextResponse.json({ error: `Falha ao gravar as taxas: ${error.message}` }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
