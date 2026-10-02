import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  chaveSku,
  custoVigente,
  diaNoFuso,
  paraNumero,
  pedidoTemCusto,
  qtdParaCusto,
  somarDias,
  type FinStoreSettingsRow,
  type LinhaPedido,
  type ProductCostRow,
  type TipoPedido,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Dados da tela Custos e taxas.
//
// Le so o banco (fin_orders e a foto que o cron de pedidos grava): a Shopify
// nao e consultada aqui. A lista de SKUs sai dos pedidos dos ultimos 60 dias
// porque e isso que o lojista precisa custear -- o catalogo inteiro traria
// centenas de variantes que nunca venderam e esconderia as que importam.
//
// Leitura com createClient (RLS): a policy da 052 ja limita a loja ao dono.
// ============================================================================

/** Janela dos "SKUs vendidos": a mesma da carga inicial de pedidos. */
const DIAS_JANELA = 60;
const PAGINA = 1000;

export interface SkuVendido {
  sku: string;
  /** Unidades que geram custo nos ultimos 60 dias (qtdParaCusto). */
  unidades: number;
  /** Preco unitario x unidades, moeda da loja. Antes de desconto: so para ordenar e dar ideia. */
  receitaBruta: number;
  /** Custo valendo hoje, ou null. */
  vigente: ProductCostRow | null;
  /** Todas as versoes do SKU, valido_desde crescente. */
  versoes: ProductCostRow[];
}

export interface DadosCustos {
  storeId: string;
  moedaLoja: string | null;
  fusoLoja: string | null;
  /** Hoje no fuso da loja (UTC se o fuso ainda nao foi lido). */
  hoje: string;
  /** Ja houve uma sincronizacao de pedidos que terminou bem? */
  sincronizado: boolean;
  config: FinStoreSettingsRow | null;
  skus: SkuVendido[];
  unidadesSemSku: number;
}

function linhaDeCusto(r: Record<string, unknown>): ProductCostRow {
  return {
    id: String(r.id),
    store_id: String(r.store_id),
    user_id: String(r.user_id),
    sku: String(r.sku),
    custo_unitario: paraNumero(r.custo_unitario),
    frete_unitario: paraNumero(r.frete_unitario),
    moeda: String(r.moeda),
    valido_desde: String(r.valido_desde),
    origem: r.origem === "csv" ? "csv" : "manual",
    created_at: r.created_at ? String(r.created_at) : undefined,
  };
}

export async function carregarCustos(storeId: string): Promise<DadosCustos> {
  const supabase = await createClient();

  const [estado, ajustes] = await Promise.all([
    supabase
      .from("fin_sync_state")
      .select("moeda, fuso, carga_inicial_ok, ultimo_sync_ok_em")
      .eq("store_id", storeId)
      .maybeSingle(),
    supabase
      .from("fin_store_settings")
      .select("store_id, user_id, taxa_pct, taxa_fixa, custo_padrao_pct, created_at, updated_at")
      .eq("store_id", storeId)
      .maybeSingle(),
  ]);
  if (estado.error) throw new Error(`Falha ao ler a sincronização de pedidos: ${estado.error.message}`);
  if (ajustes.error) throw new Error(`Falha ao ler as taxas da loja: ${ajustes.error.message}`);

  const sync = estado.data as {
    moeda: string | null;
    fuso: string | null;
    carga_inicial_ok: boolean | null;
    ultimo_sync_ok_em: string | null;
  } | null;
  const fusoLoja = sync?.fuso || null;
  const moedaLoja = sync?.moeda || null;
  const hoje = diaNoFuso(new Date(), fusoLoja);

  // Custos cadastrados. Paginado: loja grande com historico de versoes passa
  // de 1000 linhas, e o PostgREST corta em silencio no teto.
  const custos: ProductCostRow[] = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await supabase
      .from("product_costs")
      .select("id, store_id, user_id, sku, custo_unitario, frete_unitario, moeda, valido_desde, origem, created_at")
      .eq("store_id", storeId)
      .order("sku", { ascending: true })
      .order("valido_desde", { ascending: true })
      .range(i, i + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler os custos: ${error.message}`);
    const lote = (data || []) as Record<string, unknown>[];
    custos.push(...lote.map(linhaDeCusto));
    if (lote.length < PAGINA) break;
  }

  // Pedidos da janela. So as colunas que a agregacao usa: a linha inteira traz
  // valores que esta tela nao mostra.
  const desde = somarDias(hoje, -DIAS_JANELA);
  const pedidos: { tipo: string; cancelado_em: string | null; recebido: number | null; linhas: unknown }[] = [];
  for (let i = 0; ; i += PAGINA) {
    const { data, error } = await supabase
      .from("fin_orders")
      .select("tipo, cancelado_em, recebido, linhas")
      .eq("store_id", storeId)
      .gte("dia_local", desde)
      .order("dia_local", { ascending: true })
      .order("shopify_order_id", { ascending: true })
      .range(i, i + PAGINA - 1);
    if (error) throw new Error(`Falha ao ler os pedidos: ${error.message}`);
    const lote = (data || []) as {
      tipo: string;
      cancelado_em: string | null;
      recebido: number | null;
      linhas: unknown;
    }[];
    pedidos.push(...lote);
    if (lote.length < PAGINA) break;
  }

  const porSku = new Map<string, { unidades: number; receitaBruta: number }>();
  let unidadesSemSku = 0;
  for (const p of pedidos) {
    if (!pedidoTemCusto({ tipo: p.tipo as TipoPedido })) continue;
    const linhas = Array.isArray(p.linhas) ? (p.linhas as LinhaPedido[]) : [];
    const cancelado = Boolean(p.cancelado_em);
    const semPagamento = p.tipo === "venda" && paraNumero(p.recebido) <= 0;
    for (const l of linhas) {
      const q = qtdParaCusto(l, cancelado, semPagamento);
      if (q <= 0) continue;
      const sku = chaveSku(l.sku);
      if (!sku) {
        unidadesSemSku += q;
        continue;
      }
      const atual = porSku.get(sku) ?? { unidades: 0, receitaBruta: 0 };
      atual.unidades += q;
      atual.receitaBruta += paraNumero(l.preco) * q;
      porSku.set(sku, atual);
    }
  }

  const versoesPorSku = new Map<string, ProductCostRow[]>();
  for (const c of custos) {
    const sku = chaveSku(c.sku);
    const lista = versoesPorSku.get(sku) ?? [];
    lista.push(c);
    versoesPorSku.set(sku, lista);
  }

  // SKU so com custo cadastrado (ainda nao vendeu na janela) tambem aparece:
  // custo lancado pelo CSV antes da primeira venda tem que ser visivel e apagavel.
  const todos = new Set<string>([...porSku.keys(), ...versoesPorSku.keys()]);
  const skus: SkuVendido[] = [...todos].map((sku) => {
    const vendas = porSku.get(sku) ?? { unidades: 0, receitaBruta: 0 };
    const versoes = (versoesPorSku.get(sku) ?? []).sort((a, b) =>
      a.valido_desde < b.valido_desde ? -1 : a.valido_desde > b.valido_desde ? 1 : 0
    );
    return {
      sku,
      unidades: vendas.unidades,
      receitaBruta: Math.round(vendas.receitaBruta * 100) / 100,
      vigente: custoVigente(versoes, hoje),
      versoes,
    };
  });

  // Sem custo primeiro (e o que falta fazer), depois o que mais vende.
  skus.sort((a, b) => {
    const semA = a.vigente ? 1 : 0;
    const semB = b.vigente ? 1 : 0;
    if (semA !== semB) return semA - semB;
    if (a.unidades !== b.unidades) return b.unidades - a.unidades;
    return a.sku.localeCompare(b.sku);
  });

  const cfg = ajustes.data as Record<string, unknown> | null;
  const config: FinStoreSettingsRow | null = cfg
    ? {
        store_id: String(cfg.store_id),
        user_id: String(cfg.user_id),
        taxa_pct: paraNumero(cfg.taxa_pct),
        taxa_fixa: paraNumero(cfg.taxa_fixa),
        custo_padrao_pct:
          cfg.custo_padrao_pct === null || cfg.custo_padrao_pct === undefined
            ? null
            : paraNumero(cfg.custo_padrao_pct),
        created_at: cfg.created_at ? String(cfg.created_at) : undefined,
        updated_at: cfg.updated_at ? String(cfg.updated_at) : undefined,
      }
    : null;

  return {
    storeId,
    moedaLoja,
    fusoLoja,
    hoje,
    sincronizado: Boolean(sync && (sync.carga_inicial_ok || sync.ultimo_sync_ok_em)),
    config,
    skus,
    unidadesSemSku,
  };
}
