import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { filtroResolvido } from "@/lib/filtro-global";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { rotuloDoPeriodo } from "@/components/layout/contexto";
import { semMigration069 } from "@/lib/checkouts-externos/tipos";
import { semMigration071 } from "@/lib/tracking/origem-banco";
import type { EntradaFinanceiro } from "@/lib/financeiro/calculo";
import {
  FUSO_RELATORIO_PADRAO,
  TODAS,
  diaNoFuso,
  intervaloDoPeriodo,
  somarDias,
  type AdAccountRow,
  type FxRateRow,
  type MoedaRelatorio,
} from "@/lib/financeiro/tipos";
import {
  idsFaltando,
  montarCampanhas,
  type ContaCampanhas,
  type GastoDiarioRow,
  type InsightGranularRow,
  type OrigemExterna,
  type OrigemShopify,
  type ResultadoCampanhas,
} from "@/lib/campanhas/montar";

// ============================================================================
// Leitura da tela Campanhas. So banco, pela sessao (RLS); a conta e de
// src/lib/campanhas/montar.ts.
//
// Pedidos, custos, taxas, cambio e o PERIODO sao os do Lucro (lerBaseLucro,
// memorizada: a mesma leitura do Dashboard). Daqui saem so o que o Lucro nao
// le: o detalhe por campanha/conjunto/anuncio (ad_insights_granular), o gasto
// das contas sem loja, os ids de campanha de cada pedido e o cambio das moedas
// das contas que o Lucro nao viu.
//
// As contas sao as do filtro do topo: a da loja (ou do checkout) escolhida;
// com Todas, as das lojas de Todas e as que nao tem loja.
//
// Erro de banco LANCA (a tela mostra o erro, nunca zero). Tabela que ainda
// nao existe (061, 071, 072) = nenhuma linha.
// ============================================================================

const PAGINA = 1000;
/** Ids por consulta: `in` com 25 ids de 18 digitos cabe folgado na URL. */
const IDS_POR_CONSULTA = 25;

type ErroBanco = { message: string; code?: string };
type Resposta<T> = { data: T[] | null; error: ErroBanco | null };

class TabelaAusente extends Error {}

const tabelaAusente = (e: ErroBanco) => e.code === "42P01" || e.code === "PGRST205";

async function lerTudo<T>(
  rotulo: string,
  consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>,
  ausente: (e: ErroBanco) => boolean = tabelaAusente
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) {
      if (ausente(error)) throw new TabelaAusente(rotulo);
      throw new Error(`Falha ao ler ${rotulo}: ${error.message}`);
    }
    const lote = data ?? [];
    saida.push(...lote);
    if (lote.length < PAGINA) return saida;
  }
}

/** Tabela que nao existe vira lista vazia; qualquer outro erro passa adiante. */
const ouVazio = <T>(p: Promise<T[]>): Promise<T[]> =>
  p.catch((e: unknown) => {
    if (e instanceof TabelaAusente) return [] as T[];
    throw e;
  });

const COLUNAS_GRANULAR =
  "ad_account_id, data, nivel, objeto_id, objeto_nome, objeto_status, campanha_id, campanha_nome, grupo_id, grupo_nome, tipo, orcamento, cpa_desejado, gasto, impressoes, cliques, ic, vis_video, vis_3s, retencao_75, frequencia, moeda, sincronizado_em";
const COLUNAS_GASTO = "ad_account_id, data, nivel, campanha_id, campanha_nome, moeda, gasto, impressoes, cliques, sincronizado_em";
const TEM_ID = "campanha_id.not.is.null,conjunto_id.not.is.null,anuncio_id.not.is.null";

export interface ContaDoSeletor {
  id: string;
  nome: string;
  plataforma: string;
}

export interface DadosCampanhas {
  /** As contas do filtro, para o seletor. Vazio = nenhuma conta conectada. */
  contas: ContaDoSeletor[];
  resultado: ResultadoCampanhas | null;
  colunasSalvas: string[];
  moeda: MoedaRelatorio;
  /** "Últimos 7 dias (18/10–24/10)": o periodo que esta valendo. */
  periodo: string;
}

export async function lerCampanhas(): Promise<DadosCampanhas> {
  const user = await getCurrentUser();
  if (!user) return { contas: [], resultado: null, colunasSalvas: [], moeda: "BRL", periodo: "" };
  const supabase = await createClient();

  // A base do Lucro (null = usuario sem loja nem checkout: so contas sem loja).
  const base = await lerBaseLucro();
  const { filtro, lojaIds, checkoutIds } = base ?? (await filtroResolvido());
  const hoje = base?.entrada.hoje ?? diaNoFuso(new Date(), FUSO_RELATORIO_PADRAO);
  const intervalos = base?.entrada.intervalos ?? intervaloDoPeriodo(filtro.periodo, hoje);
  const { desde, ate } = intervalos.atual;
  const periodo = rotuloDoPeriodo(filtro.periodo, intervalos.atual, hoje);

  const todasContas =
    base?.contas ??
    (await lerTudo<AdAccountRow>("as contas de anúncio", (de, a) =>
      supabase.from("ad_accounts").select("*").eq("user_id", user.id).order("id", { ascending: true }).range(de, a)
    ));
  const lojaSet = new Set(lojaIds);
  const checkoutSet = new Set(checkoutIds);
  const todas = filtro.lojaId === TODAS;
  const contas: ContaCampanhas[] = todasContas
    .filter((c) => (c.store_id ? lojaSet.has(c.store_id) : c.checkout_id ? checkoutSet.has(c.checkout_id) : todas))
    .map((c) => ({ id: c.id, nome: c.nome, plataforma: c.plataforma, external_id: c.external_id, status_externo: c.status_externo }))
    .sort((a, b) => (a.nome || a.external_id).localeCompare(b.nome || b.external_id));

  if (contas.length === 0) return { contas: [], resultado: null, colunasSalvas: [], moeda: filtro.moeda, periodo };
  const seletor = contas.map((c) => ({ id: c.id, nome: c.nome || `Conta ${c.external_id}`, plataforma: c.plataforma }));

  const contaIds = contas.map((c) => c.id);
  // O pedido nasce no fuso da loja; a origem guarda o instante. Um dia de
  // folga de cada lado pega a meia-noite de qualquer fuso (o join e por id).
  const origemDesde = `${somarDias(desde, -1)}T00:00:00Z`;
  const origemAte = `${somarDias(ate, 2)}T00:00:00Z`;

  const [pref, granular, gastos, origens, origensExternas] = await Promise.all([
    // As colunas escolhidas na tela: sem linha (ou erro), as padrao.
    supabase.from("user_dashboard_preferences").select("colunas").eq("user_id", user.id).maybeSingle(),
    ouVazio(
      lerTudo<InsightGranularRow>("o detalhe das campanhas", (de, a) =>
        supabase
          .from("ad_insights_granular")
          .select(COLUNAS_GRANULAR)
          .in("ad_account_id", contaIds)
          .in("nivel", ["campanha", "grupo", "anuncio"])
          .gte("data", desde)
          .lte("data", ate)
          .order("ad_account_id", { ascending: true })
          .order("data", { ascending: true })
          .order("nivel", { ascending: true })
          .order("objeto_id", { ascending: true })
          .range(de, a)
          .overrideTypes<InsightGranularRow[], { merge: false }>()
      )
    ),
    lerTudo<GastoDiarioRow>("o gasto das campanhas", (de, a) =>
      supabase
        .from("ad_spend_daily")
        .select(COLUNAS_GASTO)
        .in("ad_account_id", contaIds)
        .in("nivel", ["conta", "campanha"])
        .gte("data", desde)
        .lte("data", ate)
        .order("ad_account_id", { ascending: true })
        .order("data", { ascending: true })
        .order("nivel", { ascending: true })
        .order("campanha_id", { ascending: true })
        .range(de, a)
        .overrideTypes<GastoDiarioRow[], { merge: false }>()
    ),
    lojaIds.length === 0
      ? ([] as OrigemShopify[])
      : ouVazio(
          lerTudo<OrigemShopify>(
            "a origem dos pedidos",
            (de, a) =>
              supabase
                .from("fin_order_origem")
                .select("store_id, shopify_order_id, campanha_id, conjunto_id, anuncio_id")
                .in("store_id", lojaIds)
                .gte("pedido_em", origemDesde)
                .lt("pedido_em", origemAte)
                .or(TEM_ID)
                .order("store_id", { ascending: true })
                .order("shopify_order_id", { ascending: true })
                .range(de, a)
                .overrideTypes<OrigemShopify[], { merge: false }>(),
            semMigration071
          )
        ),
    checkoutIds.length === 0 || !base
      ? ([] as OrigemExterna[])
      : ouVazio(
          lerTudo<OrigemExterna>(
            "a origem dos pedidos dos checkouts",
            (de, a) =>
              supabase
                .from("pedidos_externos")
                .select("checkout_id, pedido_id, campanha_id, conjunto_id, anuncio_id")
                .in("checkout_id", checkoutIds)
                .gte("dia_local", desde)
                .lte("dia_local", ate)
                .or(TEM_ID)
                .order("checkout_id", { ascending: true })
                .order("pedido_id", { ascending: true })
                .range(de, a)
                .overrideTypes<OrigemExterna[], { merge: false }>(),
            // Sem a 069/072 (tabela ou coluna dos ids), nenhum id.
            (e) => semMigration069(e)
          )
        ),
  ]);

  const colunasSalvas = Array.isArray(pref.data?.colunas) ? (pref.data.colunas as unknown[]).map(String) : [];

  const financeiro: EntradaFinanceiro = base?.entrada ?? {
    lojas: [],
    pedidos: [],
    custos: [],
    configs: [],
    contas: [],
    gastos: [],
    cambio: [],
    intervalos,
    moeda: filtro.moeda,
    hoje,
  };

  // Campanha que um pedido do periodo traz e o periodo nao tem (pausada,
  // venda de clique antigo): o nome e a conta saem das linhas de antes.
  const faltam = idsFaltando({ financeiro, granular, gastos, origens, origensExternas });
  const anteriores = { granular: [] as InsightGranularRow[], gastos: [] as GastoDiarioRow[] };
  const lotes: string[][] = [];
  for (let i = 0; i < faltam.length; i += IDS_POR_CONSULTA) lotes.push(faltam.slice(i, i + IDS_POR_CONSULTA));
  const lerLote = (lote: string[]) =>
    Promise.all([
      supabase
        .from("ad_insights_granular")
        .select(COLUNAS_GRANULAR)
        .in("ad_account_id", contaIds)
        .in("objeto_id", lote)
        .lt("data", desde)
        .order("data", { ascending: false })
        .limit(PAGINA)
        .overrideTypes<InsightGranularRow[], { merge: false }>(),
      supabase
        .from("ad_spend_daily")
        .select(COLUNAS_GASTO)
        .in("ad_account_id", contaIds)
        .eq("nivel", "campanha")
        .in("campanha_id", lote)
        .lt("data", desde)
        .order("data", { ascending: false })
        .limit(PAGINA)
        .overrideTypes<GastoDiarioRow[], { merge: false }>(),
    ]);
  for (const [g, s] of await Promise.all(lotes.map(lerLote))) {
    // So nome de objeto: falha aqui deixa o pedido em "sem campanha identificada", nao derruba a tela.
    if (g.error && !tabelaAusente(g.error)) console.error("[campanhas] detalhe anterior", g.error.message);
    if (s.error) console.error("[campanhas] gasto anterior", s.error.message);
    anteriores.granular.push(...(g.data ?? []));
    anteriores.gastos.push(...(s.data ?? []));
  }

  // Cambio das moedas das contas que a base do Lucro nao leu (conta sem loja,
  // detalhe em outra moeda), na janela do periodo atual.
  const comCotacao = new Set(financeiro.cambio.map((c) => String(c.moeda).toUpperCase()));
  const moedas = new Set<string>([filtro.moeda]);
  for (const g of [...granular, ...gastos, ...anteriores.granular, ...anteriores.gastos]) moedas.add(String(g.moeda).toUpperCase());
  const faltaCambio = [...moedas].filter((m) => m !== "USD" && !comCotacao.has(m));
  const cambioExtra = faltaCambio.length
    ? await lerTudo<FxRateRow>("o câmbio", (de, a) =>
        supabase
          .from("fx_rates")
          .select("data, moeda, por_usd, fonte")
          .in("moeda", faltaCambio)
          .gte("data", somarDias(desde, -10))
          .lte("data", ate)
          .order("data", { ascending: true })
          .order("moeda", { ascending: true })
          .range(de, a)
      )
    : [];

  const resultado = montarCampanhas({
    financeiro: cambioExtra.length ? { ...financeiro, cambio: [...financeiro.cambio, ...cambioExtra] } : financeiro,
    contas,
    granular,
    gastos,
    origens,
    origensExternas,
    anteriores,
  });

  return { contas: seletor, resultado, colunasSalvas, moeda: filtro.moeda, periodo };
}
