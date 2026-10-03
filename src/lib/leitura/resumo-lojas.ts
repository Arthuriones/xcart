import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { getStoresWithRoles } from "@/lib/stores/queries";
import { lerComparacao, lerFiltroGlobal } from "@/lib/filtro-global";
import { calcularFinanceiro, type ResultadoFinanceiro } from "@/lib/financeiro/calculo";
import {
  FUSO_RELATORIO_PADRAO,
  diaNoFuso,
  ehUuid,
  intervaloDoPeriodo,
  somarDias,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FiltroGlobal,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type FinSyncStateRow,
  type FxRateRow,
  type Intervalo,
  type LojaDoSeletor,
  type MoedaRelatorio,
  type PeriodoId,
  type ProductCostRow,
  type SeveridadeAlerta,
} from "@/lib/financeiro/tipos";
import { getPainelTracking, type LojaTracking } from "@/lib/tracking/queries";
import { diagnosticar, type DiagnosticoLoja } from "@/lib/tracking/diagnostico";
import { saudeDaLoja, type Motivo, type Saude } from "@/app/(dashboard)/tracking/saude";
import type { Comparacao } from "@/components/layout/contexto";
import type { StoreRole } from "@/lib/checkout-routes/store-roles";
import { estadoConexao, type EstadoConexao, type InventarioLoja } from "./lojas-estado";

// ============================================================================
// Leitura da tela Lojas e do detalhe da loja. So LEITURA, pela sessao (RLS),
// sem Shopify -- exceto o diagnostico do rastreamento, que so roda na aba
// Rastreamento do detalhe, dentro de Suspense.
//
// O faturamento e o lucro saem de calcularFinanceiro, o mesmo motor do Lucro,
// com as mesmas tabelas lidas do mesmo jeito (getFinanceiro). A diferenca e a
// lista de lojas: aqui sao TODAS as do usuario (ou uma, no detalhe), nao a
// loja escolhida na barra do topo.
//
// Erro de banco na lista de lojas LANCA. Faturamento e rastreamento sao parte
// da linha, nao a linha: se um deles falha, a tabela abre com "—" e um aviso,
// em vez de sumir com todas as lojas.
// ============================================================================

type Cliente = Awaited<ReturnType<typeof createClient>>;
type Resposta<T> = { data: T[] | null; error: { message: string } | null };

const PAGINA = 1000;

/** Le tudo em paginas de 1000, com ORDER BY estavel (ver financeiro/queries.ts). */
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

/**
 * calcularFinanceiro para um conjunto de lojas. Mesmas consultas de
 * getFinanceiro (financeiro/queries.ts), sem o resumo das contas -- que e
 * assunto da tela Lucro.
 */
async function calcularParaLojas(
  supabase: Cliente,
  userId: string,
  lojas: LojaDoSeletor[],
  estados: Map<string, FinSyncStateRow>,
  filtro: FiltroGlobal,
  intervalos: { atual: Intervalo; anterior: Intervalo },
  hoje: string,
  comAnterior: boolean
): Promise<ResultadoFinanceiro> {
  const lojaIds = lojas.map((l) => l.id);
  const desde = comAnterior ? intervalos.anterior.desde : intervalos.atual.desde;
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
        .eq("user_id", userId)
        .order("id", { ascending: true })
        .range(de, a)
    ),
  ]);

  const lojaSet = new Set(lojaIds);
  const contaIds = contas.filter((c) => c.store_id && lojaSet.has(c.store_id)).map((c) => c.id);

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

  return calcularFinanceiro({
    lojas: lojas.map((l) => ({
      ...l,
      fuso: estados.get(l.id)?.fuso ?? null,
      moeda: estados.get(l.id)?.moeda ?? null,
    })),
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
}

async function lerEstados(supabase: Cliente, ids: string[]): Promise<Map<string, FinSyncStateRow>> {
  if (ids.length === 0) return new Map();
  const linhas = await lerTudo<FinSyncStateRow>("o estado da sincronização de pedidos", (de, a) =>
    supabase
      .from("fin_sync_state")
      .select("*")
      .in("store_id", ids)
      .order("store_id", { ascending: true })
      .range(de, a)
  );
  return new Map(linhas.map((e) => [e.store_id, e]));
}

function entradaConexao(desinstaladaEm: string | null, s: FinSyncStateRow | undefined) {
  return estadoConexao({
    desinstaladaEm,
    sync: s
      ? {
          ultimoErro: s.ultimo_erro,
          ultimoErroTipo: s.ultimo_erro_tipo,
          ultimoSyncOkEm: s.ultimo_sync_ok_em,
          cargaInicialOk: Boolean(s.carga_inicial_ok),
        }
      : null,
  });
}

// ---------------------------------------------------------------------------
// Lista
// ---------------------------------------------------------------------------

export type ResumoLoja = {
  id: string;
  nome: string;
  dominio: string;
  papel: StoreRole;
  /** Moeda da loja na Shopify (fin_sync_state), ou a do cadastro. */
  moeda: string | null;
  idioma: string | null;
  conexao: EstadoConexao;
  ultimoSyncOk: string | null;
  /** Ha uma busca de pedidos rodando agora. */
  sincronizando: boolean;
  /** Pedidos ja sincronizados da loja (todos os tempos). */
  pedidosTotal: number | null;
  /** Do periodo da barra, na moeda da barra. null = o calculo falhou. */
  financeiro: { receita: number; lucro: number; pedidos: number } | null;
  /** null = a leitura do rastreamento falhou. */
  rastreamento: { saude: Saude; motivo: string | null } | null;
};

export type ResumoLojas = {
  lojas: ResumoLoja[];
  /** Alguma loja esta numa rota: a coluna Papel aparece. */
  temRota: boolean;
  periodo: PeriodoId;
  moeda: MoedaRelatorio;
  intervalo: Intervalo;
  financeiroIndisponivel: boolean;
  rastreamentoIndisponivel: boolean;
};

/** Trava de sincronizacao mais velha que isto e de execucao que morreu. */
const TRAVA_VENCE_MS = 10 * 60 * 1000;

function sincronizandoAgora(desde: string | null | undefined, agora: number): boolean {
  if (!desde) return false;
  const ms = Date.parse(desde);
  return Number.isFinite(ms) && agora - ms < TRAVA_VENCE_MS;
}

/** Todas as lojas do usuario, com conexao, faturamento/lucro do periodo e rastreamento. */
export async function lerResumoLojas(): Promise<ResumoLojas> {
  const [supabase, user, lojas, filtro] = await Promise.all([
    createClient(),
    getCurrentUser(),
    getStoresWithRoles(),
    lerFiltroGlobal(),
  ]);

  const fuso = FUSO_RELATORIO_PADRAO;
  const hoje = diaNoFuso(new Date(), fuso);
  const intervalos = intervaloDoPeriodo(filtro.periodo, hoje);
  const vazio: ResumoLojas = {
    lojas: [],
    temRota: false,
    periodo: filtro.periodo,
    moeda: filtro.moeda,
    intervalo: intervalos.atual,
    financeiroIndisponivel: false,
    rastreamentoIndisponivel: false,
  };
  if (!user || lojas.length === 0) return vazio;

  const ids = lojas.map((l) => l.id);
  const [marcas, estados] = await Promise.all([
    supabase.from("stores").select("id, uninstalled_at").in("id", ids),
    lerEstados(supabase, ids),
  ]);
  if (marcas.error) throw new Error(`Falha ao ler as lojas: ${marcas.error.message}`);
  const desinstalada = new Map(
    ((marcas.data ?? []) as { id: string; uninstalled_at: string | null }[]).map((m) => [
      m.id,
      m.uninstalled_at,
    ])
  );

  const doSeletor: LojaDoSeletor[] = lojas.map((l) => ({
    id: l.id,
    nome: l.name || l.shop_domain,
    dominio: l.shop_domain,
  }));

  const [fin, painel] = await Promise.allSettled([
    calcularParaLojas(supabase, user.id, doSeletor, estados, filtro, intervalos, hoje, false),
    getPainelTracking(),
  ]);
  if (fin.status === "rejected") console.error("[lojas] faturamento por loja", fin.reason);
  if (painel.status === "rejected") console.error("[lojas] rastreamento por loja", painel.reason);

  const linhaFin = new Map(
    fin.status === "fulfilled" ? fin.value.porLoja.map((l) => [l.storeId, l]) : []
  );
  const tracking = new Map(
    painel.status === "fulfilled" ? painel.value.lojas.map((l) => [l.storeId, l]) : []
  );
  const agora = Date.now();

  return {
    ...vazio,
    temRota: lojas.some((l) => l.role !== "unassigned"),
    financeiroIndisponivel: fin.status === "rejected",
    rastreamentoIndisponivel: painel.status === "rejected",
    lojas: lojas.map((l): ResumoLoja => {
      const s = estados.get(l.id);
      const f = linhaFin.get(l.id);
      const t = tracking.get(l.id);
      let rastreamento: ResumoLoja["rastreamento"] = null;
      if (painel.status === "fulfilled") {
        if (!t) {
          rastreamento = { saude: "desligado", motivo: null };
        } else {
          const r = saudeDaLoja(t, t.ligado, null, false);
          rastreamento = { saude: r.saude, motivo: r.motivos[0]?.texto ?? null };
        }
      }
      return {
        id: l.id,
        nome: l.name || l.shop_domain,
        dominio: l.shop_domain,
        papel: l.role,
        moeda: s?.moeda || l.currency_code || null,
        idioma: l.target_language,
        conexao: entradaConexao(desinstalada.get(l.id) ?? null, s),
        ultimoSyncOk: s?.ultimo_sync_ok_em ?? null,
        sincronizando: sincronizandoAgora(s?.sincronizando_desde, agora),
        pedidosTotal: s ? Number(s.pedidos_total) || 0 : null,
        financeiro: f ? { receita: f.receita, lucro: f.lucro, pedidos: f.pedidos } : null,
        rastreamento,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Detalhe
// ---------------------------------------------------------------------------

export type LojaBase = {
  id: string;
  nome: string;
  dominio: string;
  idioma: string | null;
  moeda: string | null;
  /** Fuso real da loja (Shop.ianaTimezone), quando a sincronizacao ja leu. */
  fuso: string | null;
  logoPath: string | null;
  papel: StoreRole;
  criadaEm: string;
  desinstaladaEm: string | null;
  conexao: EstadoConexao;
  sync: {
    ultimoSyncOkEm: string | null;
    ultimoSyncEm: string | null;
    ultimoErro: string | null;
    cargaInicialOk: boolean;
    pedidosTotal: number;
    sincronizando: boolean;
  } | null;
};

/** A loja, se for do usuario. null = nao existe ou e de outro (404 na tela). */
export async function lerLojaBase(id: string): Promise<LojaBase | null> {
  if (!ehUuid(id)) return null;
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return null;

  const { data: loja, error } = await supabase
    .from("stores")
    .select("id, name, shop_domain, target_language, currency_code, logo_path, created_at, uninstalled_at")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler a loja: ${error.message}`);
  if (!loja) return null;

  const [estados, todas] = await Promise.all([lerEstados(supabase, [id]), getStoresWithRoles()]);
  const s = estados.get(id);
  const papel = todas.find((l) => l.id === id)?.role ?? "unassigned";

  return {
    id: String(loja.id),
    nome: String(loja.name || loja.shop_domain),
    dominio: String(loja.shop_domain),
    idioma: loja.target_language ?? null,
    moeda: s?.moeda || loja.currency_code || null,
    fuso: s?.fuso ?? null,
    logoPath: loja.logo_path ?? null,
    papel,
    criadaEm: String(loja.created_at),
    desinstaladaEm: loja.uninstalled_at ?? null,
    conexao: entradaConexao(loja.uninstalled_at ?? null, s),
    sync: s
      ? {
          ultimoSyncOkEm: s.ultimo_sync_ok_em,
          ultimoSyncEm: s.ultimo_sync_em,
          ultimoErro: s.ultimo_erro,
          cargaInicialOk: Boolean(s.carga_inicial_ok),
          pedidosTotal: Number(s.pedidos_total) || 0,
          sincronizando: sincronizandoAgora(s.sincronizando_desde, Date.now()),
        }
      : null,
  };
}

export type FinanceiroDaLoja = {
  resultado: ResultadoFinanceiro;
  filtro: FiltroGlobal;
  comparacao: Comparacao;
  /** Fuso do "hoje" do periodo: o da loja, ou Sao Paulo enquanto nao se sabe. */
  fuso: string;
  hoje: string;
};

/** Faturamento, lucro e o dia a dia de UMA loja, com o periodo anterior. */
export async function lerFinanceiroDaLoja(base: LojaBase): Promise<FinanceiroDaLoja> {
  const [supabase, user, filtro, comparacao] = await Promise.all([
    createClient(),
    getCurrentUser(),
    lerFiltroGlobal(),
    lerComparacao(),
  ]);
  if (!user) throw new Error("Sessão expirada.");
  const fuso = base.fuso || FUSO_RELATORIO_PADRAO;
  const hoje = diaNoFuso(new Date(), fuso);
  const intervalos = intervaloDoPeriodo(filtro.periodo, hoje);
  const estados = await lerEstados(supabase, [base.id]);
  const resultado = await calcularParaLojas(
    supabase,
    user.id,
    [{ id: base.id, nome: base.nome, dominio: base.dominio }],
    estados,
    filtro,
    intervalos,
    hoje,
    true
  );
  return { resultado, filtro, comparacao, fuso, hoje };
}

export type AlertaDaLoja = {
  id: string;
  severidade: SeveridadeAlerta;
  titulo: string;
  abertoEm: string;
};

/** Alertas abertos da loja: quantos e os 3 mais urgentes. Erro LANCA. */
export async function lerAlertasDaLoja(id: string): Promise<{ total: number; itens: AlertaDaLoja[] }> {
  const supabase = await createClient();
  const { data, error, count } = await supabase
    .from("alertas")
    .select("id, severidade, titulo, aberto_em", { count: "exact" })
    .eq("store_id", id)
    .is("resolvido_em", null)
    .order("severidade", { ascending: false })
    .order("aberto_em", { ascending: false })
    .limit(3);
  if (error) throw new Error(`Falha ao ler os alertas: ${error.message}`);
  const itens = ((data ?? []) as { id: string; severidade: string; titulo: string; aberto_em: string }[]).map(
    (a) => ({
      id: String(a.id),
      severidade: (a.severidade === "critico" ? "critico" : "aviso") as SeveridadeAlerta,
      titulo: String(a.titulo),
      abertoEm: String(a.aberto_em),
    })
  );
  return { total: count ?? itens.length, itens };
}

export type RastreamentoDaLoja = {
  /** null = a loja nao aparece no painel (app desinstalado e rastreamento desligado). */
  loja: LojaTracking | null;
  diagnostico: DiagnosticoLoja | null;
  /** O diagnostico rodou (loja ligada e pedido). */
  conferido: boolean;
  saude: Saude;
  motivos: Motivo[];
};

/**
 * O rastreamento da loja pela regra da Saude dos pixels (saudeDaLoja). Com
 * `comShopify`, roda tambem o diagnostico (pedidos, webhook e tema na Shopify),
 * que leva segundos: so na aba Rastreamento.
 */
export async function lerRastreamentoDaLoja(
  id: string,
  comShopify: boolean
): Promise<RastreamentoDaLoja> {
  const painel = await getPainelTracking();
  const loja = painel.lojas.find((l) => l.storeId === id) ?? null;
  if (!loja) {
    return { loja: null, diagnostico: null, conferido: false, saude: "desligado", motivos: [] };
  }
  const conferido = comShopify && loja.ligado && !loja.desinstalada;
  let diagnostico: DiagnosticoLoja | null = null;
  if (conferido) {
    try {
      diagnostico = (await diagnosticar([id])).get(id) ?? null;
    } catch (e) {
      // Falha da Shopify nao derruba a aba: saudeDaLoja acusa "nao deu para conferir".
      console.error("[lojas] diagnostico do rastreamento", e);
    }
  }
  const r = saudeDaLoja(loja, loja.ligado, diagnostico, conferido);
  return { loja, diagnostico, conferido, saude: r.saude, motivos: r.motivos };
}

export type ContaDaLoja = {
  id: string;
  plataforma: "meta" | "google";
  nome: string;
  ativo: boolean;
  ultimoErro: string | null;
  ultimoSyncOk: string | null;
};

/** Taxa do gateway e contas de anuncio ligadas a loja. Erro LANCA. */
export async function lerConfigFinanceiraDaLoja(
  id: string
): Promise<{ taxa: FinStoreSettingsRow | null; contas: ContaDaLoja[] }> {
  const supabase = await createClient();
  const [taxa, contas] = await Promise.all([
    supabase.from("fin_store_settings").select("*").eq("store_id", id).maybeSingle(),
    supabase
      .from("ad_accounts")
      .select("id, plataforma, nome, external_id, ativo, ultimo_erro, ultimo_sync_ok_em")
      .eq("store_id", id)
      .order("plataforma", { ascending: true }),
  ]);
  if (taxa.error) throw new Error(`Falha ao ler a taxa da loja: ${taxa.error.message}`);
  if (contas.error) throw new Error(`Falha ao ler as contas de anúncio: ${contas.error.message}`);
  return {
    taxa: (taxa.data as FinStoreSettingsRow | null) ?? null,
    contas: (
      (contas.data ?? []) as {
        id: string;
        plataforma: string;
        nome: string | null;
        external_id: string;
        ativo: boolean;
        ultimo_erro: string | null;
        ultimo_sync_ok_em: string | null;
      }[]
    ).map((c) => ({
      id: String(c.id),
      plataforma: c.plataforma === "google" ? "google" : "meta",
      nome: c.nome || c.external_id,
      ativo: Boolean(c.ativo),
      ultimoErro: c.ultimo_erro,
      ultimoSyncOk: c.ultimo_sync_ok_em,
    })),
  };
}

export type MaterialDaLoja = {
  id: string;
  store_id: string;
  file_path: string;
  label: string | null;
  created_at: string;
};

/** Logos adicionais e materiais de marca (store_assets). Erro LANCA. */
export async function lerMateriaisDaLoja(id: string): Promise<MaterialDaLoja[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("store_assets")
    .select("id, store_id, file_path, label, created_at")
    .eq("store_id", id)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`Falha ao ler os materiais: ${error.message}`);
  return (data ?? []) as MaterialDaLoja[];
}

// ---------------------------------------------------------------------------
// Inventario da remocao
// ---------------------------------------------------------------------------

/**
 * O que a remocao da loja apaga (12 tabelas com ON DELETE CASCADE) e o que
 * fica sem loja. Contagens reais, pela sessao: a RLS de cada tabela ja
 * restringe ao dono, e a loja e conferida antes. null = loja nao e do usuario.
 *
 * Existe porque a sondagem do DELETE /api/stores/[id] (sem `confirmar`) APAGA
 * na hora quando a loja esta vazia -- nao da para usa-la so para mostrar o
 * inventario antes de o lojista confirmar.
 */
export async function lerInventarioLoja(id: string): Promise<InventarioLoja | null> {
  if (!ehUuid(id)) return null;
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return null;

  const { data: loja, error } = await supabase
    .from("stores")
    .select("id, logo_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`Falha ao ler a loja: ${error.message}`);
  if (!loja) return null;

  const contar = async (tabela: string, coluna: string, campo = "id") => {
    const { count, error: e } = await supabase
      .from(tabela)
      .select(campo, { count: "exact", head: true })
      .eq(coluna, id);
    if (e) throw new Error(`Falha ao contar ${tabela}: ${e.message}`);
    return count ?? 0;
  };

  const [
    produtos,
    materiais,
    rotasComoVitrine,
    configsCk,
    destinosCk,
    destinosRastreamento,
    pedidos,
    custos,
    alertas,
    contasAnuncio,
    cfg,
  ] = await Promise.all([
    contar("products", "store_id"),
    contar("store_assets", "store_id"),
    contar("routed_checkout_configs", "source_store_id"),
    // A loja tambem e checkout pela coluna da propria rota (rota legada, sem
    // linha em targets, roteia por ela). E NOT NULL com ON DELETE CASCADE: a
    // rota inteira some com todos os destinos, nao so o desta loja.
    supabase.from("routed_checkout_configs").select("id, source_store_id").eq("target_store_id", id),
    supabase.from("routed_checkout_targets").select("route_id").eq("target_store_id", id),
    contar("tracking_destinations", "store_id"),
    contar("fin_orders", "store_id", "store_id"),
    contar("product_costs", "store_id"),
    contar("alertas", "store_id"),
    contar("ad_accounts", "store_id"),
    supabase.from("tracking_configs").select("enabled").eq("store_id", id).maybeSingle(),
  ]);
  if (cfg.error) throw new Error(`Falha ao ler o rastreamento: ${cfg.error.message}`);
  if (configsCk.error) throw new Error(`Falha ao contar routed_checkout_configs: ${configsCk.error.message}`);
  if (destinosCk.error) throw new Error(`Falha ao contar routed_checkout_targets: ${destinosCk.error.message}`);

  const rotasCk = (configsCk.data || []) as { id: string; source_store_id: string | null }[];
  // Rotas que somem inteiras: o destino delas nao conta de novo, e a que tem
  // esta loja tambem como vitrine ja esta em rotasComoVitrine.
  const inteiras = new Set(rotasCk.map((r) => String(r.id)));
  const rotasComoCheckout = rotasCk.filter((r) => r.source_store_id !== id).length;
  const destinosComoCheckout = ((destinosCk.data || []) as { route_id: string }[]).filter(
    (t) => !inteiras.has(String(t.route_id))
  ).length;

  return {
    produtos,
    materiais,
    temLogo: Boolean(loja.logo_path),
    rotasComoVitrine,
    rotasComoCheckout,
    destinosComoCheckout,
    destinosRastreamento,
    rastreamentoLigado: Boolean((cfg.data as { enabled?: boolean } | null)?.enabled),
    pedidos,
    custos,
    alertas,
    contasAnuncio,
  };
}
