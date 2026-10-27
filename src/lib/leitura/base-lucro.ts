import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido, lerCheckoutsDoUsuario } from "@/lib/filtro-global";
import { contarAmostraExterna } from "@/lib/checkouts-externos/financeiro";
import { semMigration069, type PedidoExternoRow } from "@/lib/checkouts-externos/tipos";
import type { EntradaFinanceiro, LojaFinanceira, PedidoExternoFin } from "@/lib/financeiro/calculo";
import { contarAmostra, intervaloDaAmostra, type AmostraEntrega, type PedidoCod } from "@/lib/financeiro/contra-entrega";
import {
  diaNoFuso,
  fusoDoFiltro,
  intervaloDoPeriodo,
  somarDias,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FiltroGlobal,
  type LojaDoSeletor,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type FinSyncStateRow,
  type FxRateRow,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";

// ============================================================================
// A leitura do Lucro, UMA por requisicao. So leitura, pela sessao (RLS).
//
// getFinanceiro (src/lib/financeiro/queries.ts) e as leituras novas da tela
// (serie diaria, por produto, por campanha) usam esta mesma funcao, memorizada
// com cache(): a home le o banco uma vez so. Antes eram duas copias da mesma
// leitura, 15 consultas onde bastavam 8.
//
// Erro de banco LANCA: quem chama mostra o erro, nunca zero. O gasto por
// campanha e a excecao: so a aba Campanha depende dele, entao a falha dele
// vira `erroCampanha` em vez de derrubar a tela inteira.
//
// Checkout externo (069): entra em `entrada.lojas` como "loja" de comissao
// (tipo "checkout"), com os pedidos em `entrada.externos`. `lojas`/`lojaIds`
// do retorno continuam so Shopify; os checkouts vem em `checkouts`/`checkoutIds`.
// Sem a 069 aplicada, nenhum checkout -- o resto segue igual.
// ============================================================================

const PAGINA = 1000;

type Resposta<T> = { data: T[] | null; error: { message: string; code?: string } | null };

/** Coluna que o banco nao tem (42703): a migration ainda nao foi aplicada. */
class ColunaAusente extends Error {}

async function lerTudo<T>(
  rotulo: string,
  consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) {
      const msg = `Falha ao ler ${rotulo}: ${error.message}`;
      if (error.code === "42703" || /column .* does not exist/i.test(error.message)) throw new ColunaAusente(msg);
      throw new Error(msg);
    }
    const lote = data ?? [];
    saida.push(...lote);
    if (lote.length < PAGINA) return saida;
  }
}

const COLUNAS_PEDIDO =
  "store_id, user_id, shopify_order_id, nome, processado_em, dia_local, criado_em, atualizado_em, cancelado_em, tipo, status_financeiro, origem, moeda, moeda_cliente, total_bruto, total_atual, imposto_atual, taxas_alfandega, gorjeta, descontos, frete_cobrado, recebido, reembolsado, liquido_pago, total_cliente, gateways, linhas";
/** Envio e entrega (068). Sem a migration, a leitura cai na lista antiga. */
const COLUNAS_ENVIO = "cod, status_envio, entrega, enviado_em, entregue_em, devolucao, marca_recusa";
/** O que a situacao do contra entrega precisa (a amostra da taxa de entrega). */
const COLUNAS_AMOSTRA = `store_id, dia_local, tipo, gateways, cancelado_em, status_financeiro, recebido, reembolsado, linhas, ${COLUNAS_ENVIO}`;
/** O que o calculo le de um pedido de checkout externo. */
const COLUNAS_EXTERNO = "checkout_id, situacao, moeda, valor, receita, moeda_receita, dia_local";
/** Mais o que a venda (Cakto e Hubla, 072) precisa. Sem a 072, a leitura cai na lista de cima. */
const COLUNAS_EXTERNO_VENDA = `${COLUNAS_EXTERNO}, pedido_id, criado_em, metodo_pagamento, grupo, taxa, comissoes, vence_em, reembolsado_em, chargeback_em, reembolso_pedido_em, custo, status_comissao`;

/**
 * Le pedidos_externos; sem a 069 aplicada, nenhum. Coluna ausente (a 072) NAO
 * chega aqui: quem le cai antes nas colunas da 069 (ColunaAusente) -- senao o
 * semMigration069 esconderia os checkouts em silencio.
 */
async function lerExternos<T>(rotulo: string, ler: () => Promise<T[]>): Promise<T[]> {
  try {
    return await ler();
  } catch (e) {
    if (e instanceof Error && semMigration069({ message: e.message })) return [];
    throw new Error(e instanceof Error ? e.message : `Falha ao ler ${rotulo}`);
  }
}

export interface BaseLucro {
  /** Pronta para calcularFinanceiro e as montagens de src/lib/leitura. */
  entrada: EntradaFinanceiro;
  filtro: FiltroGlobal;
  /** Todas as lojas do usuario (o seletor), nao so as do filtro. So Shopify. */
  lojas: LojaDoSeletor[];
  lojaIds: string[];
  /** Os checkouts externos do usuario (069) e os do filtro. */
  checkouts: LojaDoSeletor[];
  checkoutIds: string[];
  estados: FinSyncStateRow[];
  /** Fuso do relatorio: o da loja, quando o filtro tem uma so. */
  fuso: string;
  /** Todas as contas de anuncio do usuario. */
  contas: AdAccountRow[];
  /** ad_spend_daily no nivel campanha, so do periodo atual. */
  gastosCampanha: AdSpendDailyRow[];
  /** Falha ao ler o gasto por campanha: so a aba Campanha fica sem dado. */
  erroCampanha: string | null;
}

/**
 * null = usuario sem loja (ou sem sessao). Memorizado por requisicao.
 *
 * `enxuta` (tela Pedidos): so os pedidos e o cambio do periodo ATUAL, sem
 * contas nem gasto de anuncio. calcularFinanceiro sobre ela daria o periodo
 * anterior e o anuncio zerados -- nao use no Dashboard.
 */
export const lerBaseLucro = cache(async (enxuta: boolean = false): Promise<BaseLucro | null> => {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  // O estado da sincronizacao e as contas de anuncio so dependem do usuario:
  // correm junto com o filtro, em vez de uma rodada cada depois dele. O estado
  // e lido pelo dono (a RLS da 052 so devolve as linhas dele) e recortado nas
  // lojas do filtro abaixo -- as mesmas linhas, na mesma ordem.
  const [{ filtro, lojas, lojaIds, checkouts, checkoutIds }, checkoutsDoUsuario, estadosDoUsuario, contas] =
    await Promise.all([
      filtroResolvido(),
      lerCheckoutsDoUsuario(),
      lerTudo<FinSyncStateRow>("o estado da sincronização de pedidos", (de, ate) =>
        supabase
          .from("fin_sync_state")
          .select("*")
          .eq("user_id", user.id)
          .order("store_id", { ascending: true })
          .range(de, ate)
      ),
      enxuta
        ? ([] as AdAccountRow[])
        : lerTudo<AdAccountRow>("as contas de anúncio", (de, a) =>
            supabase
              .from("ad_accounts")
              .select("*")
              .eq("user_id", user.id)
              .order("id", { ascending: true })
              .range(de, a)
          ),
    ]);
  if (lojaIds.length === 0 && checkoutIds.length === 0) return null;
  // Filtro so com checkout: nada de Shopify a ler (e .in() vazio nao vale).
  const temLojas = lojaIds.length > 0;
  const lojaSet = new Set(lojaIds);
  const ckSet = new Set(checkoutIds);
  const checkoutsDoFiltro = checkoutsDoUsuario.filter((c) => ckSet.has(c.id));

  const estados = estadosDoUsuario.filter((e) => lojaSet.has(e.store_id));
  const estadoPorLoja = new Map(estados.map((e) => [e.store_id, e]));

  // O "hoje" no fuso da loja (ou do checkout) quando o filtro tem um so --
  // a mesma regra do topo (topo-dados.tsx), que limita o calendario.
  const fusoRef = fusoDoFiltro(lojaIds, checkoutsDoFiltro, (id) => estadoPorLoja.get(id)?.fuso);
  const hoje = diaNoFuso(new Date(), fusoRef);
  const intervalos = intervaloDoPeriodo(filtro.periodo, hoje);
  const desde = enxuta ? intervalos.atual.desde : intervalos.anterior.desde;
  const ate = intervalos.atual.ate;

  const lerPedidos = (colunas: string) =>
    lerTudo<FinOrderRow>("os pedidos", (de, a) =>
      supabase
        .from("fin_orders")
        .select(colunas)
        .in("store_id", lojaIds)
        .gte("dia_local", desde)
        .lte("dia_local", ate)
        .order("store_id", { ascending: true })
        .order("shopify_order_id", { ascending: true })
        .range(de, a)
        // A lista de colunas vem de variavel: o tipo nao sai do texto.
        .overrideTypes<FinOrderRow[], { merge: false }>()
    );

  const lerPedidosExternos = (colunas: string) =>
    lerTudo<PedidoExternoFin>("os pedidos dos checkouts", (de, a) =>
      supabase
        .from("pedidos_externos")
        .select(colunas)
        .in("checkout_id", checkoutIds)
        .gte("dia_local", desde)
        .lte("dia_local", ate)
        .order("checkout_id", { ascending: true })
        .order("pedido_id", { ascending: true })
        .range(de, a)
        .overrideTypes<PedidoExternoFin[], { merge: false }>()
    );

  // A conta liga a uma loja OU a um checkout (069).
  const contaIds = contas
    .filter((c) => (c.store_id && lojaSet.has(c.store_id)) || (c.checkout_id && ckSet.has(c.checkout_id)))
    .map((c) => c.id);

  // Taxa de entrega: so das lojas em contra entrega (fora delas ninguem olha),
  // com os pedidos finalizados dos ultimos 60 dias, nao so os do periodo.
  // Falha aqui nao derruba a tela: o Previsto cai na taxa padrao.
  const lerAmostraCod = async (
    configs: FinStoreSettingsRow[]
  ): Promise<Record<string, AmostraEntrega> | undefined> => {
    const codIds = configs.filter((c) => c.contra_entrega === true).map((c) => c.store_id);
    if (enxuta || codIds.length === 0) return undefined;
    const janela = intervaloDaAmostra(hoje);
    try {
      const linhas = await lerTudo<PedidoCod & { store_id: string; dia_local: string }>(
        "a amostra de entregas",
        (de, a) =>
          supabase
            .from("fin_orders")
            .select(COLUNAS_AMOSTRA)
            .in("store_id", codIds)
            .gte("dia_local", janela.desde)
            .lte("dia_local", janela.ate)
            .order("store_id", { ascending: true })
            .order("shopify_order_id", { ascending: true })
            .range(de, a)
            .overrideTypes<(PedidoCod & { store_id: string; dia_local: string })[], { merge: false }>()
      );
      return contarAmostra(linhas, janela, hoje);
    } catch (e) {
      console.error("[lucro] amostra de entregas", e);
      return undefined;
    }
  };

  // Taxa de aprovacao dos checkouts de comissao: a mesma janela, amostra
  // propria. A venda (Cakto) nao tem Previsto: fica de fora. Falha aqui
  // tambem nao derruba a tela (cai na taxa padrao do checkout).
  const lerAmostraCheckouts = async (): Promise<Record<string, AmostraEntrega> | undefined> => {
    const comissaoIds = checkoutsDoFiltro.filter((c) => c.modelo !== "venda").map((c) => c.id);
    if (enxuta || comissaoIds.length === 0) return undefined;
    const janela = intervaloDaAmostra(hoje);
    try {
      const linhas = await lerExternos("a amostra dos checkouts", () =>
        lerTudo<Pick<PedidoExternoRow, "checkout_id" | "situacao" | "dia_local">>("a amostra dos checkouts", (de, a) =>
          supabase
            .from("pedidos_externos")
            .select("checkout_id, situacao, dia_local")
            .in("checkout_id", comissaoIds)
            .gte("dia_local", janela.desde)
            .lte("dia_local", janela.ate)
            .order("checkout_id", { ascending: true })
            .order("pedido_id", { ascending: true })
            .range(de, a)
        )
      );
      return contarAmostraExterna(linhas, janela, hoje);
    } catch (e) {
      console.error("[lucro] amostra dos checkouts", e);
      return undefined;
    }
  };

  const configsP = !temLojas
    ? Promise.resolve([] as FinStoreSettingsRow[])
    : lerTudo<FinStoreSettingsRow>("as taxas das lojas", (de, a) =>
        supabase
          .from("fin_store_settings")
          .select("*")
          .in("store_id", lojaIds)
          .order("store_id", { ascending: true })
          .range(de, a)
      );
  // As amostras nao dependem dos pedidos nem do cambio: correm junto com eles.
  // Nunca lancam (a falha vira log); taxa que falhou derruba a leitura abaixo.
  const amostras = Promise.all([configsP.then(lerAmostraCod, () => undefined), lerAmostraCheckouts()]);

  let erroCampanha: string | null = null;
  const [pedidos, custos, configs, externos, [gastos, gastosCampanha]] = await Promise.all([
    !temLojas
      ? ([] as FinOrderRow[])
      : lerPedidos(`${COLUNAS_PEDIDO}, ${COLUNAS_ENVIO}`).catch((e: unknown) => {
          if (e instanceof ColunaAusente) return lerPedidos(COLUNAS_PEDIDO);
          throw e;
        }),
    !temLojas
      ? ([] as ProductCostRow[])
      : lerTudo<ProductCostRow>("os custos dos produtos", (de, a) =>
          supabase
            .from("product_costs")
            .select("*")
            .in("store_id", lojaIds)
            .order("id", { ascending: true })
            .range(de, a)
        ),
    configsP,
    // Checkout externo: os pedidos do periodo (a tela Pedidos le os dela).
    enxuta || checkoutIds.length === 0
      ? ([] as PedidoExternoFin[])
      : lerExternos("os pedidos dos checkouts", () =>
          lerPedidosExternos(COLUNAS_EXTERNO_VENDA).catch((e: unknown) => {
            if (e instanceof ColunaAusente) return lerPedidosExternos(COLUNAS_EXTERNO);
            throw e;
          })
        ),
    // O gasto so precisa das contas e do periodo: vem na mesma rodada.
    contaIds.length
      ? Promise.all([
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
          ).catch((e: unknown) => {
            erroCampanha = e instanceof Error ? e.message : String(e);
            return [] as AdSpendDailyRow[];
          }),
        ])
      : ([[], []] as [AdSpendDailyRow[], AdSpendDailyRow[]]),
  ]);

  const moedas = new Set<string>([filtro.moeda, "USD"]);
  for (const p of pedidos) moedas.add(String(p.moeda).toUpperCase());
  for (const c of custos) moedas.add(String(c.moeda).toUpperCase());
  for (const g of gastos) moedas.add(String(g.moeda).toUpperCase());
  for (const g of gastosCampanha) moedas.add(String(g.moeda).toUpperCase());
  for (const c of checkoutsDoFiltro) moedas.add(c.moeda_receita);
  for (const x of externos) {
    moedas.add(String(x.moeda).toUpperCase());
    if (x.moeda_receita) moedas.add(String(x.moeda_receita).toUpperCase());
  }

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

  const [doCod, dosCheckouts] = await amostras;
  const amostraEntrega: Record<string, AmostraEntrega> | undefined = dosCheckouts
    ? { ...(doCod ?? {}), ...dosCheckouts }
    : doCod;

  const lojasDoFiltro: LojaFinanceira[] = [
    ...lojas
      .filter((l) => lojaSet.has(l.id))
      .map((l) => ({
        ...l,
        fuso: estadoPorLoja.get(l.id)?.fuso ?? null,
        moeda: estadoPorLoja.get(l.id)?.moeda ?? null,
      })),
    ...checkoutsDoFiltro.map((c) => ({
      id: c.id,
      nome: c.nome,
      dominio: checkouts.find((x) => x.id === c.id)?.dominio ?? "Checkout",
      tipo: "checkout" as const,
      modelo: c.modelo,
      fuso: c.fuso,
      moeda: c.moeda_receita,
      taxaPadraoPct: c.taxa_aprovacao_padrao,
    })),
  ];

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
      amostraEntrega,
      externos,
      agoraMs: Date.now(),
    },
    filtro,
    lojas,
    lojaIds,
    checkouts,
    checkoutIds,
    estados,
    fuso: fusoRef,
    contas,
    gastosCampanha,
    erroCampanha,
  };
});
