import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido } from "@/lib/filtro-global";
import type { EntradaFinanceiro, LojaFinanceira } from "@/lib/financeiro/calculo";
import {
  FUSO_RELATORIO_PADRAO,
  diaNoFuso,
  intervaloDoPeriodo,
  somarDias,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type FinSyncStateRow,
  type FxRateRow,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";

// ============================================================================
// As linhas cruas do Lucro, para as leituras NOVAS da tela (serie diaria, por
// produto, por campanha). So leitura, pela sessao (RLS), so banco.
//
// E a mesma leitura de getFinanceiro (src/lib/financeiro/queries.ts): mesmas
// tabelas, mesmos filtros, mesmo intervalo. Ela nao devolve as linhas, so o
// resultado, e mexer nela esta fora do combinado -- dai esta copia, que
// acrescenta so o gasto no nivel campanha. Se a leitura de la mudar, mude aqui.
//
// Erro de banco LANCA: quem chama mostra o erro da secao, nunca zero.
// ============================================================================

const PAGINA = 1000;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

async function lerTudo<T>(
  rotulo: string,
  consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler ${rotulo}: ${error.message}`);
    const lote = data ?? [];
    saida.push(...lote);
    if (lote.length < PAGINA) return saida;
  }
}

export interface BaseLucro {
  /** Pronta para calcularFinanceiro e as montagens de src/lib/leitura. */
  entrada: EntradaFinanceiro;
  lojaIds: string[];
  /** Todas as contas de anuncio do usuario. */
  contas: AdAccountRow[];
  /** ad_spend_daily no nivel campanha, so do periodo atual. */
  gastosCampanha: AdSpendDailyRow[];
}

/** null = usuario sem loja (ou sem sessao). Memorizado por requisicao. */
export const lerBaseLucro = cache(async (): Promise<BaseLucro | null> => {
  const { filtro, lojas, lojaIds } = await filtroResolvido();
  if (lojas.length === 0 || lojaIds.length === 0) return null;
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const estados = await lerTudo<FinSyncStateRow>("o estado da sincronização de pedidos", (de, ate) =>
    supabase
      .from("fin_sync_state")
      .select("*")
      .in("store_id", lojaIds)
      .order("store_id", { ascending: true })
      .range(de, ate)
  );
  const estadoPorLoja = new Map(estados.map((e) => [e.store_id, e]));

  const fusoRef =
    lojaIds.length === 1
      ? estadoPorLoja.get(lojaIds[0])?.fuso || FUSO_RELATORIO_PADRAO
      : FUSO_RELATORIO_PADRAO;
  const hoje = diaNoFuso(new Date(), fusoRef);
  const intervalos = intervaloDoPeriodo(filtro.periodo, hoje);
  const desde = intervalos.anterior.desde;
  const ate = intervalos.atual.ate;

  const [pedidos, custos, configs, contas] = await Promise.all([
    lerTudo<FinOrderRow>("os pedidos", (de, a) =>
      supabase
        .from("fin_orders")
        .select(
          "store_id, user_id, shopify_order_id, nome, processado_em, dia_local, criado_em, atualizado_em, cancelado_em, tipo, status_financeiro, origem, moeda, moeda_cliente, total_bruto, total_atual, imposto_atual, taxas_alfandega, gorjeta, descontos, frete_cobrado, recebido, reembolsado, liquido_pago, total_cliente, gateways, linhas"
        )
        .in("store_id", lojaIds)
        .gte("dia_local", desde)
        .lte("dia_local", ate)
        .order("store_id", { ascending: true })
        .order("shopify_order_id", { ascending: true })
        .range(de, a)
    ),
    lerTudo<ProductCostRow>("os custos dos produtos", (de, a) =>
      supabase
        .from("product_costs")
        .select("*")
        .in("store_id", lojaIds)
        .order("id", { ascending: true })
        .range(de, a)
    ),
    lerTudo<FinStoreSettingsRow>("as taxas das lojas", (de, a) =>
      supabase
        .from("fin_store_settings")
        .select("*")
        .in("store_id", lojaIds)
        .order("store_id", { ascending: true })
        .range(de, a)
    ),
    lerTudo<AdAccountRow>("as contas de anúncio", (de, a) =>
      supabase
        .from("ad_accounts")
        .select("*")
        .eq("user_id", user.id)
        .order("id", { ascending: true })
        .range(de, a)
    ),
  ]);

  const lojaSet = new Set(lojaIds);
  const contaIds = contas.filter((c) => c.store_id && lojaSet.has(c.store_id)).map((c) => c.id);

  const [gastos, gastosCampanha] = contaIds.length
    ? await Promise.all([
        lerTudo<AdSpendDailyRow>("o gasto de anúncio", (de, a) =>
          supabase
            .from("ad_spend_daily")
            .select("*")
            .in("ad_account_id", contaIds)
            .eq("nivel", "conta")
            .gte("data", desde)
            .lte("data", ate)
            .order("ad_account_id", { ascending: true })
            .order("data", { ascending: true })
            .range(de, a)
        ),
        lerTudo<AdSpendDailyRow>("o gasto por campanha", (de, a) =>
          supabase
            .from("ad_spend_daily")
            .select("*")
            .in("ad_account_id", contaIds)
            .eq("nivel", "campanha")
            .gte("data", intervalos.atual.desde)
            .lte("data", ate)
            .order("ad_account_id", { ascending: true })
            .order("data", { ascending: true })
            .order("campanha_id", { ascending: true })
            .range(de, a)
        ),
      ])
    : [[], []];

  const moedas = new Set<string>([filtro.moeda, "USD"]);
  for (const p of pedidos) moedas.add(String(p.moeda).toUpperCase());
  for (const c of custos) moedas.add(String(c.moeda).toUpperCase());
  for (const g of gastos) moedas.add(String(g.moeda).toUpperCase());
  for (const g of gastosCampanha) moedas.add(String(g.moeda).toUpperCase());

  const cambio = await lerTudo<FxRateRow>("o câmbio", (de, a) =>
    supabase
      .from("fx_rates")
      .select("data, moeda, por_usd, fonte")
      .in("moeda", [...moedas])
      .gte("data", somarDias(desde, -10))
      .lte("data", ate)
      .order("data", { ascending: true })
      .order("moeda", { ascending: true })
      .range(de, a)
  );

  const lojasDoFiltro: LojaFinanceira[] = lojas
    .filter((l) => lojaSet.has(l.id))
    .map((l) => ({
      ...l,
      fuso: estadoPorLoja.get(l.id)?.fuso ?? null,
      moeda: estadoPorLoja.get(l.id)?.moeda ?? null,
    }));

  return {
    entrada: {
      lojas: lojasDoFiltro,
      pedidos,
      custos,
      configs,
      contas,
      gastos,
      cambio,
      intervalos,
      moeda: filtro.moeda,
      hoje,
    },
    lojaIds,
    contas,
    gastosCampanha,
  };
});
