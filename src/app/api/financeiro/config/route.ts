import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehColunaAusente } from "@/lib/financeiro/mapear-pedido";
import { ehUuid, type ConfigFinanceiraCorpo, type ConfigRecebimentoCorpo } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Ajustes financeiros de uma loja (fin_store_settings), em dois blocos que a
// tela grava separados:
//   - taxa de pagamento e custo padrao (taxa_pct, taxa_fixa, custo_padrao_pct);
//   - como a loja recebe (068): contra_entrega, cod_taxa_entrega,
//     cod_custo_devolucao.
// O corpo traz um bloco ou os dois; o upsert so mexe nas colunas que vieram.
//
// A taxa e uma regra simples (percentual + fixo por pedido, na moeda da loja)
// ate o xcart ler a taxa real do Shopify Payments. Escrita pelo service role
// depois de conferir pela sessao que a loja e do usuario: a 052 revoga escrita
// do authenticated.
//
// Os limites repetem os CHECK da tabela: recusar aqui da uma mensagem que o
// lojista entende, em vez do erro cru do Postgres.
// ============================================================================

type Corpo = Partial<ConfigFinanceiraCorpo> & Partial<ConfigRecebimentoCorpo>;

function numeroValido(v: unknown, min: number, max: number, maxInclusivo: boolean): v is number {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  if (v < min) return false;
  return maxInclusivo ? v <= max : v < max;
}

function erro(mensagem: string, status = 400) {
  return NextResponse.json({ error: mensagem }, { status });
}

export async function POST(request: NextRequest) {
  let corpo: Corpo | null = null;
  try {
    corpo = (await request.json()) as Corpo;
  } catch {
    corpo = null;
  }
  if (!corpo || !ehUuid(corpo.store_id)) return erro("Loja inválida.");

  const campos: Record<string, unknown> = {};

  const temTaxas = corpo.taxa_pct !== undefined || corpo.taxa_fixa !== undefined || corpo.custo_padrao_pct !== undefined;
  if (temTaxas) {
    if (!numeroValido(corpo.taxa_pct, 0, 100, false)) return erro("Taxa percentual deve ficar entre 0 e 99,999%.");
    if (!numeroValido(corpo.taxa_fixa, 0, 10000, true)) return erro("Taxa fixa deve ficar entre 0 e 10.000.");
    const custoPadrao = corpo.custo_padrao_pct ?? null;
    if (custoPadrao !== null && !numeroValido(custoPadrao, 0, 100, true)) {
      return erro("Custo padrão deve ficar entre 0 e 100%, ou vazio.");
    }
    campos.taxa_pct = corpo.taxa_pct;
    campos.taxa_fixa = corpo.taxa_fixa;
    campos.custo_padrao_pct = custoPadrao;
  }

  const temRecebimento =
    corpo.contra_entrega !== undefined ||
    corpo.cod_taxa_entrega !== undefined ||
    corpo.cod_custo_devolucao !== undefined;
  if (temRecebimento) {
    if (typeof corpo.contra_entrega !== "boolean") return erro("Escolha como a loja recebe.");
    if (!numeroValido(corpo.cod_taxa_entrega, 0, 100, true)) return erro("Taxa de entrega deve ficar entre 0 e 100%.");
    if (!numeroValido(corpo.cod_custo_devolucao, 0, 10000, true)) {
      return erro("Custo por devolução deve ficar entre 0 e 10.000.");
    }
    campos.contra_entrega = corpo.contra_entrega;
    campos.cod_taxa_entrega = corpo.cod_taxa_entrega;
    campos.cod_custo_devolucao = corpo.cod_custo_devolucao;
  }

  if (!temTaxas && !temRecebimento) return erro("Nada para salvar.");

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
  if (erroLoja) return erro(`Falha ao ler a loja: ${erroLoja.message}`, 500);
  if (!loja || loja.user_id !== user.id) return erro("Loja não encontrada.", 404);

  const { error } = await admin.from("fin_store_settings").upsert(
    {
      store_id: loja.id,
      user_id: loja.user_id,
      ...campos,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "store_id" }
  );
  if (error) {
    // Sem a migration 068 as colunas de recebimento nao existem.
    if (temRecebimento && ehColunaAusente(error)) {
      return erro("O modo contra entrega ainda não foi liberado. Tente de novo mais tarde.", 503);
    }
    return erro(`Falha ao gravar as taxas: ${error.message}`, 500);
  }
  return NextResponse.json({ ok: true });
}
