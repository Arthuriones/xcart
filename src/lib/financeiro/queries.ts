import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido } from "@/lib/filtro-global";
import { calcularFinanceiro, type LojaFinanceira, type ResultadoFinanceiro } from "./calculo";
import {
  FUSO_RELATORIO_PADRAO,
  diaNoFuso,
  intervaloDoPeriodo,
  somarDias,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FiltroGlobal,
  type FinOrderRow,
  type FinSyncStateRow,
  type FinStoreSettingsRow,
  type FxRateRow,
  type LojaDoSeletor,
  type ProductCostRow,
} from "./tipos";

// ============================================================================
// Leitura da tela Lucro. So banco (fin_orders, gasto, cambio): nada de Shopify
// nem Meta aqui -- a home nao pode depender de API externa para abrir. Quem
// fala com elas sao os crons.
//
// Erro de banco LANCA. Zero no lugar de "nao consegui ler" diria ao lojista
// que ele nao vendeu nada, e ele desligaria anuncio por isso.
// ============================================================================

/** Teto de linhas por requisicao do PostgREST. */
const PAGINA = 1000;

/** Script do Google roda de hora em hora: 3h sem dado ja e falha, nao atraso. */
const GOOGLE_SEM_DADO_MS = 3 * 60 * 60 * 1000;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

/**
 * Le tudo em paginas de 1000. A consulta precisa de ORDER BY estavel (a chave
 * primaria): sem ele o Postgres pode repetir ou pular linha entre paginas.
 */
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

export interface ResumoContas {
  total: number;
  semLoja: number;
  comErro: { nome: string; erro: string }[];
  googleSemDado3h: string[];
}

export type DadosFinanceiro =
  | { vazio: true }
  | {
      vazio: false;
      filtro: FiltroGlobal;
      lojas: LojaDoSeletor[];
      lojaIds: string[];
      estados: FinSyncStateRow[];
      contas: ResumoContas;
      resultado: ResultadoFinanceiro;
      /** Maior ultimo_sync_ok_em entre pedidos e contas. */
      atualizadoEm: string | null;
      /** Fuso do "hoje" usado no periodo: o da loja, ou Sao Paulo com todas. */
      fuso: string;
    };

function maiorData(datas: (string | null | undefined)[]): string | null {
  let maior: string | null = null;
  let maiorMs = -Infinity;
  for (const d of datas) {
    if (!d) continue;
    const ms = Date.parse(d);
    if (Number.isFinite(ms) && ms > maiorMs) {
      maiorMs = ms;
      maior = d;
    }
  }
  return maior;
}

export async function getFinanceiro(): Promise<DadosFinanceiro> {
  const { filtro, lojas, lojaIds } = await filtroResolvido();
  if (lojas.length === 0 || lojaIds.length === 0) return { vazio: true };

  const user = await getCurrentUser();
  if (!user) return { vazio: true };
  const supabase = await createClient();

  // Estado da sincronizacao: traz o fuso e a moeda reais da loja
  // (Shop.ianaTimezone / currencyCode), que stores nao tem.
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
    // Todas as contas do usuario, nao so as das lojas filtradas: a tela
    // precisa contar as que ainda nao foram ligadas a loja nenhuma.
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
  const contasDasLojas = contas.filter((c) => c.store_id && lojaSet.has(c.store_id));
  const contaIds = contasDasLojas.map((c) => c.id);

  const gastos = contaIds.length
    ? await lerTudo<AdSpendDailyRow>("o gasto de anúncio", (de, a) =>
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
      )
    : [];

  // So as moedas que aparecem: a tabela tem ~30 por dia e 70 dias de janela.
  const moedas = new Set<string>([filtro.moeda, "USD"]);
  for (const p of pedidos) moedas.add(String(p.moeda).toUpperCase());
  for (const c of custos) moedas.add(String(c.moeda).toUpperCase());
  for (const g of gastos) moedas.add(String(g.moeda).toUpperCase());

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

  const resultado = calcularFinanceiro({
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
  });

  // Contas que importam para ESTA tela: as das lojas filtradas e as soltas
  // (sem loja, o gasto delas nao entra em lugar nenhum).
  const relevantes = contas.filter((c) => !c.store_id || lojaSet.has(c.store_id));
  const agora = Date.now();
  const nomeConta = (c: AdAccountRow) =>
    `${c.plataforma === "google" ? "Google" : "Meta"} ${c.nome || c.external_id}`;
  const resumoContas: ResumoContas = {
    total: contas.length,
    semLoja: contas.filter((c) => !c.store_id && c.ativo).length,
    comErro: relevantes
      .filter((c) => c.ativo && c.ultimo_erro)
      .map((c) => ({ nome: nomeConta(c), erro: String(c.ultimo_erro) })),
    googleSemDado3h: contasDasLojas
      .filter((c) => {
        if (c.plataforma !== "google" || !c.ativo) return false;
        const ultimo = c.ultimo_sync_ok_em || c.ultimo_dado_gerado_em;
        const ms = ultimo ? Date.parse(ultimo) : NaN;
        return !Number.isFinite(ms) || agora - ms > GOOGLE_SEM_DADO_MS;
      })
      .map(nomeConta),
  };

  return {
    vazio: false,
    filtro,
    lojas,
    lojaIds,
    estados,
    contas: resumoContas,
    resultado,
    atualizadoEm: maiorData([
      ...estados.map((e) => e.ultimo_sync_ok_em),
      ...contasDasLojas.map((c) => c.ultimo_sync_ok_em),
    ]),
    fuso: fusoRef,
  };
}
