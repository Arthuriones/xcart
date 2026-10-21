import "server-only";

// ============================================================================
// Loja de demonstracao: o que vai do gerador (plano/linhas/semeadura) para o
// banco. O cron (atualizar.ts, api/jobs/demonstracao) e o scripts/demo-loja.ts
// gravam por AQUI -- o mesmo instante da as mesmas linhas, e rodar um em cima
// do outro nao duplica nada (ids fixos, upsert).
//
// Tres modos (modoDaRodada):
//   - incremental: o que mudou desde a ultima rodada (fin_sync_state.
//     cursor_atualizado, o "maior updatedAt gravado" do sync de verdade) --
//     pedidos novos e os que mudaram (envio, entrega, reembolso), a origem e o
//     Purchase dos novos, o funil desde o ultimo evento gravado, o gasto de
//     hoje e o retrato de Campanhas. Hoje e ontem sao CONFERIDOS com o banco
//     a cada rodada (1 pagina): o cambio do dia e o id do gerador.
//   - diario (a primeira rodada do dia no fuso da loja): o incremental mais a
//     conferencia (pedido, origem, Purchase e gasto) desde DIAS_REGRAVADOS dias
//     antes do dia do CURSOR -- com o cron parado dias, o pedido mais velho que
//     mudou depois dele tambem volta -- e a limpeza do que saiu das janelas.
//   - completo (fuso trocado, sem cursor, cursor velho, comeco faltando): a
//     janela inteira conferida com o banco, linha a linha, e so o que difere
//     vai. Retomavel: com teto por rodada, a proxima continua de onde parou.
//
// Escrita so pelo service role, so nas linhas da loja do gerador (LOJA_ID e
// as contas/destino dela): nenhuma consulta daqui toca outra loja. Nada daqui
// chama fora do banco.
// ============================================================================

import type { createAdminClient } from "@/lib/supabase/admin";
import { paraNumero, type AdSpendDailyRow, type FinOrderRow, type FxRateRow } from "@/lib/financeiro/tipos";
import type { LinhaOrigem } from "@/lib/tracking/origem-pedido";
import {
  ARTHUR,
  CONTA_GOOGLE,
  CONTA_META,
  DESTINO_META,
  FUSO,
  LOJA_ID,
  MOEDA,
  corteDasCompras,
  diaLocal,
  inicioDaJanela,
  instanteLocal,
  segundosLocais,
  somarDia,
} from "./plano";
import { MOEDAS_CLIENTE, atualizadoEm, type LinhaEvento } from "./linhas";
import { granularDe, type Selecao, type Semeadura } from "./semeadura";

export type Admin = ReturnType<typeof createAdminClient>;

/**
 * Dias em que um pedido ainda muda: envio, entrega e reembolso acontecem ate
 * 18 dias depois de ele nascer (linhaDoTempo, plano.ts). Os mais velhos ja
 * estao no estado final.
 */
export const DIAS_REGRAVADOS = 20;
/** Sobreposicao com a rodada anterior: o Purchase chega ate 9 s depois do pedido, e relogio anda torto. */
export const MARGEM_MS = 15 * 60_000;
/** Linhas gravadas (upsert) por rodada do cron, no maximo. O resto fica para a proxima. */
export const LIMITE_POR_RODADA = 12_000;
/**
 * Teto de linhas da loja por tabela -- a trava de tamanho do cron, sem a
 * Management API. Sai das janelas no pico do plano (de 2026-07 a 2027-12,
 * travado em tests/loja-demonstracao-cron.test.ts): 16.041 pedidos em 93 dias
 * seguidos (a janela mais longa, mais o dia antes da limpeza), 11.030 em 63 (a
 * de Purchase), 11.502 eventos de funil num dia (o funil guarda 48 h), 17
 * linhas de gasto por dia e 86 objetos no retrato de Campanhas. ~25% de
 * folga; cheia assim, a loja ocupa ~60 MB.
 */
export const TETO_DE_LINHAS = {
  fin_orders: 20_000,
  fin_order_origem: 20_000,
  tracking_events: 14_000 + 2 * 14_500,
  ad_spend_daily: 2_000,
  ad_insights_granular: 250,
} as const;
export type TabelaContada = keyof typeof TETO_DE_LINHAS;

export const FUNIL = ["view_item", "add_to_cart", "begin_checkout", "payment_info"];
const EVENTOS = ["Purchase", ...FUNIL];
const CONTAS = [CONTA_META.id, CONTA_GOOGLE.id];
const PAGINA = 1000;
const iso = (ms: number) => new Date(ms).toISOString();

function erro(rotulo: string, e: { message?: string } | null | undefined): never {
  throw new Error(`${rotulo}: ${e?.message ?? "falha sem mensagem"}`);
}

/** Le todas as paginas (o PostgREST corta em 1000), na ordem que `consulta` pede. */
async function lerTudo<T>(
  rotulo: string,
  consulta: (de: number, ate: number) => PromiseLike<{ data: unknown[] | null; error: { message?: string } | null }>
): Promise<T[]> {
  const saida: T[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await consulta(de, de + PAGINA - 1);
    if (error) erro(rotulo, error);
    saida.push(...((data ?? []) as T[]));
    if ((data ?? []).length < PAGINA) return saida;
  }
}

// ---------------------------------------------------------------------------
// Cambio
// ---------------------------------------------------------------------------

/** fx_rates das moedas dos compradores, de 10 dias antes de `desde` ate `ate`, por data. */
export async function lerCambio(admin: Admin, desde: string, ate: string): Promise<FxRateRow[]> {
  return lerTudo<FxRateRow>("fx_rates", (de, fim) =>
    admin
      .from("fx_rates")
      .select("data, moeda, por_usd, fonte")
      .in("moeda", MOEDAS_CLIENTE)
      .gte("data", somarDia(desde, -10))
      .lte("data", ate)
      .order("data", { ascending: true })
      .order("moeda", { ascending: true })
      .range(de, fim)
  );
}

// ---------------------------------------------------------------------------
// Estado gravado
// ---------------------------------------------------------------------------

export interface Estado {
  /** fin_sync_state: o fuso em que a loja esta gravada e ate onde esta completa. */
  fuso: string | null;
  cursorMs: number | null;
  temPedidos: boolean;
  /** O primeiro dia de fin_orders e o primeiro Purchase (o comeco das janelas). */
  primeiroDia: string | null;
  primeiraCompra: string | null;
  /** O ultimo evento de funil gravado: o funil continua dele. */
  ultimoFunil: string | null;
}

/** O estado da loja no banco. `sync` = o que a trava do cron ja leu de fin_sync_state. */
export async function lerEstado(admin: Admin, sync?: { fuso: string | null; cursor_atualizado: string | null }): Promise<Estado> {
  let linhaSync = sync;
  if (!linhaSync) {
    const { data, error } = await admin.from("fin_sync_state").select("fuso, cursor_atualizado").eq("store_id", LOJA_ID).maybeSingle();
    if (error) erro("fin_sync_state", error);
    linhaSync = (data as typeof sync) ?? { fuso: null, cursor_atualizado: null };
  }
  const { data: dia, error: e1 } = await admin
    .from("fin_orders")
    .select("dia_local")
    .eq("store_id", LOJA_ID)
    .order("dia_local", { ascending: true })
    .limit(1);
  if (e1) erro("fin_orders", e1);
  const { data: compra, error: e2 } = await admin
    .from("tracking_events")
    .select("created_at")
    .eq("store_id", LOJA_ID)
    .eq("event_name", "Purchase")
    .order("created_at", { ascending: true })
    .limit(1);
  if (e2) erro("tracking_events", e2);
  const { data: fun, error: e3 } = await admin
    .from("tracking_events")
    .select("created_at")
    .eq("store_id", LOJA_ID)
    .in("event_name", FUNIL)
    .order("created_at", { ascending: false })
    .limit(1);
  if (e3) erro("tracking_events", e3);
  const cursor = linhaSync.cursor_atualizado ? Date.parse(linhaSync.cursor_atualizado) : NaN;
  const primeiroDia = ((dia ?? [])[0] as { dia_local?: string } | undefined)?.dia_local ?? null;
  return {
    fuso: linhaSync.fuso ?? null,
    cursorMs: Number.isFinite(cursor) ? cursor : null,
    temPedidos: Boolean(primeiroDia),
    primeiroDia,
    primeiraCompra: ((compra ?? [])[0] as { created_at?: string } | undefined)?.created_at ?? null,
    ultimoFunil: ((fun ?? [])[0] as { created_at?: string } | undefined)?.created_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Modo da rodada
// ---------------------------------------------------------------------------

export type Modo = "incremental" | "diario" | "completo";

/**
 * Falta dia ATRAS do que esta gravado? As janelas so andam para frente
 * (plano.ts), entao isto so acontece quando uma constante muda ou alguem
 * apaga linha a mao -- ai a janela inteira e conferida.
 */
export function faltaOComeco(e: Estado, agoraMs: number): boolean {
  if (!e.temPedidos) return false;
  const hoje = diaLocal(agoraMs);
  const janela = inicioDaJanela(hoje);
  if (!e.primeiroDia || e.primeiroDia > janela) return true;
  return !e.primeiraCompra || diaLocal(Date.parse(e.primeiraCompra)) > diaLocal(corteDasCompras(hoje));
}

export function modoDaRodada(e: Estado, agoraMs: number): { modo: Modo; motivo: string } {
  const hoje = diaLocal(agoraMs);
  if (!e.temPedidos) return { modo: "completo", motivo: "loja sem pedidos gravados" };
  if (e.fuso !== FUSO) return { modo: "completo", motivo: `fuso gravado ${e.fuso ?? "-"}, o do gerador e ${FUSO}` };
  if (e.cursorMs === null) return { modo: "completo", motivo: "sem cursor (a ultima rodada nao fechou)" };
  if (e.cursorMs > agoraMs + MARGEM_MS) return { modo: "completo", motivo: "cursor no futuro" };
  if (faltaOComeco(e, agoraMs)) return { modo: "completo", motivo: "falta dia atras do gravado (a janela cresceu)" };
  const diaDoCursor = diaLocal(e.cursorMs);
  if (diaDoCursor < somarDia(hoje, -(DIAS_REGRAVADOS - 1))) {
    return { modo: "completo", motivo: `ultima rodada completa em ${diaDoCursor}` };
  }
  if (diaDoCursor < hoje) return { modo: "diario", motivo: `primeira rodada de ${hoje}` };
  return { modo: "incremental", motivo: "o que mudou desde a ultima rodada" };
}

/**
 * Os dias conferidos com o banco linha a linha. No diario, contados do dia do
 * CURSOR (a ultima rodada que fechou), nunca de hoje: o pedido muda ate 19
 * dias locais depois de nascer, entao o que nasceu antes de `cursor - 20` ja
 * estava no estado final quando o cursor foi gravado -- e o que nasceu depois
 * pode ter mudado com o cron parado, por mais velho que seja hoje.
 */
export function desdeDaConferencia(modo: Modo, agoraMs: number, cursorMs: number | null): string {
  const hoje = diaLocal(agoraMs);
  const janela = inicioDaJanela(hoje);
  const doCursor = cursorMs === null ? hoje : diaLocal(cursorMs);
  const base = doCursor < hoje ? doCursor : hoje;
  const desde = modo === "completo" ? janela : modo === "diario" ? somarDia(base, -DIAS_REGRAVADOS) : somarDia(hoje, -1);
  return desde < janela ? janela : desde;
}

/**
 * O que o gerador precisa montar na rodada (montar, semeadura.ts): os dias
 * conferidos inteiros e, no incremental, os pedidos mais velhos que mudaram
 * desde o cursor. O completo monta a janela inteira.
 */
export function selecaoDaRodada(modo: Modo, e: Estado, agoraMs: number): Selecao | undefined {
  if (modo === "completo") return undefined;
  const desde = desdeDaConferencia(modo, agoraMs, e.cursorMs);
  const hoje = diaLocal(agoraMs);
  const horizonte = somarDia(hoje, -DIAS_REGRAVADOS);
  const desdeCursor = (e.cursorMs ?? 0) - MARGEM_MS;
  return {
    dias: (dia) => dia >= desde,
    pedido: modo === "incremental" ? (p) => p.dia >= horizonte && atualizadoEm(p, agoraMs) >= desdeCursor : undefined,
  };
}

// ---------------------------------------------------------------------------
// O que gravar (o plano da rodada)
// ---------------------------------------------------------------------------

export interface Pendente {
  origens: LinhaOrigem[];
  compras: LinhaEvento[];
  funil: LinhaEvento[];
  gasto: AdSpendDailyRow[];
  pedidos: FinOrderRow[];
  /**
   * A lista veio da fronteira (o que nasceu desde o cursor, o funil desde o
   * ultimo evento): entra so o que falta (ON CONFLICT DO NOTHING). A lista
   * conferida com o banco sobrescreve o que difere.
   */
  soFaltantes: { origens: boolean; compras: boolean; funil: boolean };
  /** Linhas do banco que o gerador nao tem: saem (so o completo poda). */
  podarEventos: string[];
  podarOrigens: string[];
  /** Quantas das linhas acima NAO existem no banco (teto de cima no incremental). */
  novas: Record<TabelaContada, number>;
  /** Pedidos do banco (dentro dos dias conferidos) que o gerador nao conhece. */
  desconhecidos: string[];
  /** Linhas que a rodada deixou para a proxima (teto por rodada). */
  adiadas: number;
}

interface PedidoGravado {
  shopify_order_id: string;
  nome: string | null;
  dia_local: string;
  criado_em: string;
  atualizado_em: string;
  total_cliente: number | string | null;
}

const mesmoInstante = (a: string | null | undefined, b: string | null | undefined) =>
  a == null || b == null ? a == b : Date.parse(a) === Date.parse(b);
const mesmoNumero = (a: unknown, b: unknown) =>
  a == null || b == null ? a == b : Math.abs(paraNumero(a) - paraNumero(b)) < 0.0005;

/** A linha do pedido mudou? Estado (atualizado_em), cambio (total_cliente) e fuso (dia e instante). */
function pedidoDifere(g: FinOrderRow, b: PedidoGravado | undefined): boolean {
  return (
    !b ||
    b.nome !== g.nome ||
    b.dia_local !== g.dia_local ||
    !mesmoInstante(b.criado_em, g.criado_em) ||
    !mesmoInstante(b.atualizado_em, g.atualizado_em) ||
    !mesmoNumero(b.total_cliente, g.total_cliente)
  );
}

async function pedidosGravados(admin: Admin, desde: string): Promise<Map<string, PedidoGravado>> {
  const linhas = await lerTudo<PedidoGravado>("fin_orders", (de, ate) =>
    admin
      .from("fin_orders")
      .select("shopify_order_id, nome, dia_local, criado_em, atualizado_em, total_cliente")
      .eq("store_id", LOJA_ID)
      .gte("dia_local", desde)
      .order("shopify_order_id", { ascending: true })
      .range(de, ate)
  );
  return new Map(linhas.map((l) => [String(l.shopify_order_id), l]));
}

async function origensGravadas(admin: Admin, desdeMs: number): Promise<Map<string, string>> {
  const linhas = await lerTudo<{ shopify_order_id: string; pedido_em: string }>("fin_order_origem", (de, ate) =>
    admin
      .from("fin_order_origem")
      .select("shopify_order_id, pedido_em")
      .eq("store_id", LOJA_ID)
      .gte("pedido_em", iso(desdeMs))
      .order("shopify_order_id", { ascending: true })
      .range(de, ate)
  );
  return new Map(linhas.map((l) => [String(l.shopify_order_id), l.pedido_em]));
}

async function eventosGravados(admin: Admin, nomes: string[], desdeMs: number): Promise<Map<string, string>> {
  const linhas = await lerTudo<{ id: string; created_at: string }>("tracking_events", (de, ate) =>
    admin
      .from("tracking_events")
      .select("id, created_at")
      .eq("store_id", LOJA_ID)
      .in("event_name", nomes)
      .gte("created_at", iso(desdeMs))
      .order("id", { ascending: true })
      .range(de, ate)
  );
  return new Map(linhas.map((l) => [String(l.id), l.created_at]));
}

const chaveDoGasto = (g: Pick<AdSpendDailyRow, "ad_account_id" | "data" | "nivel" | "campanha_id">) =>
  `${g.ad_account_id}|${String(g.data).slice(0, 10)}|${g.nivel}|${g.campanha_id}`;

async function gastoGravado(admin: Admin, desde: string): Promise<Map<string, AdSpendDailyRow>> {
  const linhas = await lerTudo<AdSpendDailyRow>("ad_spend_daily", (de, ate) =>
    admin
      .from("ad_spend_daily")
      .select("ad_account_id, data, nivel, campanha_id, gasto, impressoes, cliques, compras, valor_compras, sincronizado_em")
      .in("ad_account_id", CONTAS)
      .gte("data", desde)
      .order("data", { ascending: true })
      .order("ad_account_id", { ascending: true })
      .order("nivel", { ascending: true })
      .order("campanha_id", { ascending: true })
      .range(de, ate)
  );
  return new Map(linhas.map((l) => [chaveDoGasto(l), l]));
}

function gastoDifere(g: AdSpendDailyRow, b: AdSpendDailyRow | undefined): boolean {
  return (
    !b ||
    !mesmoNumero(b.gasto, g.gasto) ||
    !mesmoNumero(b.impressoes, g.impressoes) ||
    !mesmoNumero(b.cliques, g.cliques) ||
    !mesmoNumero(b.compras, g.compras) ||
    !mesmoNumero(b.valor_compras, g.valor_compras) ||
    !mesmoInstante(b.sincronizado_em, g.sincronizado_em)
  );
}

function zerado(): Record<TabelaContada, number> {
  return { fin_orders: 0, fin_order_origem: 0, tracking_events: 0, ad_spend_daily: 0, ad_insights_granular: 0 };
}

/**
 * O que a rodada grava, conferido com o banco nos dias da conferencia. So
 * LE o banco: o --dry-run do script chama isto tambem. `tudo` (o --tudo do
 * script) regrava a janela inteira (formato novo de linha) sem olhar se difere.
 */
export async function planejar(
  admin: Admin,
  s: Semeadura,
  modoPedido: Modo,
  e: Estado,
  opcoes: { tudo?: boolean } = {}
): Promise<Pendente> {
  // --tudo: o completo com toda linha "diferente" (regrava a janela, poda e
  // confere os ids do mesmo jeito). Pede a janela inteira montada.
  const modo: Modo = opcoes.tudo ? "completo" : modoPedido;
  const forcar = Boolean(opcoes.tudo);
  const desde = desdeDaConferencia(modo, s.agoraMs, e.cursorMs);
  const p: Pendente = {
    origens: [],
    compras: [],
    funil: [],
    gasto: [],
    pedidos: [],
    soFaltantes: { origens: false, compras: false, funil: false },
    podarEventos: [],
    podarOrigens: [],
    novas: zerado(),
    desconhecidos: [],
    adiadas: 0,
  };
  // O funil continua do ultimo evento gravado (com sobreposicao). Na primeira
  // rodada do dia vao tambem os eventos de hoje de antes da meia-noite (a
  // sessao do primeiro pedido): eles so nascem quando o dia entra no plano.
  const funilDesde = (lista: LinhaEvento[], comMadrugada: boolean) => {
    const fronteira = e.ultimoFunil ? Date.parse(e.ultimoFunil) - MARGEM_MS : -Infinity;
    const novos = lista.filter((x) => Date.parse(x.created_at) > fronteira);
    if (!comMadrugada) return novos;
    const ja = new Set(novos.map((x) => x.id));
    return [...novos, ...s.madrugada.filter((x) => !ja.has(x.id))];
  };
  const emOrdem = (lista: LinhaEvento[]) => [...lista].sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));

  // 1) Pedidos dos dias conferidos: so o que difere do banco. O gerador tem
  //    que conhecer TODO pedido gravado nesses dias -- senao o id mudou (o
  //    gerador mudou) e gravar duplicaria a loja (quem chama recusa).
  const gravados = await pedidosGravados(admin, desde);
  const conferidos = s.pedidos.filter((x) => x.dia_local >= desde);
  const ids = new Set(conferidos.map((x) => x.shopify_order_id));
  // Pedido "do futuro" no banco (relogio torto) nao conta: so o que ja passou de agora.
  p.desconhecidos = [...gravados.values()]
    .filter((b) => !ids.has(String(b.shopify_order_id)) && Date.parse(b.criado_em) <= s.agoraMs)
    .map((b) => String(b.shopify_order_id));

  for (const g of conferidos) {
    const b = gravados.get(g.shopify_order_id);
    if (forcar || pedidoDifere(g, b)) {
      p.pedidos.push(g);
      if (!b) p.novas.fin_orders += 1;
    }
  }

  if (modo === "incremental") {
    // 2) Os mais velhos que mudaram desde o cursor (a selecao ja so trouxe
    //    esses), a origem e o Purchase dos que nasceram desde o cursor, o
    //    funil desde o ultimo evento gravado e o gasto de hoje (e o de ontem
    //    ate o carimbo das 03:14 do dia seguinte).
    const desdeCursor = (e.cursorMs ?? 0) - MARGEM_MS;
    const horizonte = somarDia(s.hoje, -DIAS_REGRAVADOS);
    for (const g of s.pedidos) {
      if (g.dia_local < desde && g.dia_local >= horizonte && Date.parse(g.atualizado_em) >= desdeCursor) p.pedidos.push(g);
    }
    const nasceram = new Set(s.pedidos.filter((x) => Date.parse(x.criado_em) >= desdeCursor).map((x) => x.shopify_order_id));
    p.origens = s.origens.filter((x) => nasceram.has(x.shopify_order_id));
    p.compras = s.compras.filter((x) => nasceram.has(x.order_id));
    p.funil = emOrdem(funilDesde(s.funil, false));
    const diaDoGasto = segundosLocais(s.agoraMs) < 4 * 3600 ? somarDia(s.hoje, -1) : s.hoje;
    p.gasto = s.linhasGasto.filter((g) => g.data >= diaDoGasto);
    p.soFaltantes = { origens: true, compras: true, funil: true };
    p.novas.fin_order_origem = p.origens.length;
    p.novas.tracking_events = p.compras.length + p.funil.length;
    p.novas.ad_spend_daily = p.gasto.length;
    return p;
  }

  // 3) Diario e completo: origem, Purchase e gasto dos dias conferidos, so o
  //    que difere. O funil: no completo, conferido tambem (o fuso trocado
  //    muda o instante de todos); no diario, desde o ultimo gravado.
  const inicio = instanteLocal(desde, 0);
  const origens = await origensGravadas(admin, inicio);
  const ordensConferidas = new Set(conferidos.map((x) => x.shopify_order_id));
  const origensGeradas = s.origens.filter((x) => ordensConferidas.has(x.shopify_order_id));
  for (const o of origensGeradas) {
    const b = origens.get(o.shopify_order_id);
    if (forcar || b === undefined || !mesmoInstante(b, o.pedido_em)) {
      p.origens.push(o);
      if (b === undefined) p.novas.fin_order_origem += 1;
    }
  }
  const comprasGeradas = s.compras.filter((c) => ordensConferidas.has(c.order_id));
  const desdeEventos = modo === "completo" ? Math.min(s.cortes.compras, s.cortes.funil) : Math.max(inicio, s.cortes.compras);
  const eventos = await eventosGravados(admin, modo === "completo" ? EVENTOS : ["Purchase"], desdeEventos);
  for (const c of comprasGeradas) {
    const b = eventos.get(c.id);
    if (forcar || b === undefined || !mesmoInstante(b, c.created_at)) {
      p.compras.push(c);
      if (b === undefined) p.novas.tracking_events += 1;
    }
  }
  if (modo === "completo") {
    for (const f of s.funil) {
      const b = eventos.get(f.id);
      if (forcar || b === undefined || !mesmoInstante(b, f.created_at)) {
        p.funil.push(f);
        if (b === undefined) p.novas.tracking_events += 1;
      }
    }
    p.funil = emOrdem(p.funil);
    const gerados = new Set([...s.compras.map((c) => c.id), ...s.funil.map((f) => f.id)]);
    p.podarEventos = [...eventos.keys()].filter((id) => !gerados.has(id));
    const comOrigem = new Set(s.origens.map((o) => o.shopify_order_id));
    p.podarOrigens = [...origens.keys()].filter((id) => !comOrigem.has(id));
  } else {
    p.funil = emOrdem(funilDesde(s.funil, true));
    p.soFaltantes.funil = true;
    p.novas.tracking_events += p.funil.length;
  }
  const gastos = await gastoGravado(admin, desde);
  for (const g of s.linhasGasto) {
    if (g.data < desde) continue;
    const b = gastos.get(chaveDoGasto(g));
    if (forcar || gastoDifere(g, b)) {
      p.gasto.push(g);
      if (!b) p.novas.ad_spend_daily += 1;
    }
  }
  return p;
}

/** As linhas que o plano grava (upsert), sem o retrato de Campanhas. */
export function linhasDoPlano(p: Pendente): number {
  return p.origens.length + p.compras.length + p.funil.length + p.gasto.length + p.pedidos.length;
}

/**
 * Teto por rodada: com mais de `limite` linhas, so as primeiras na ordem do
 * tempo vao (o funil continua do ultimo gravado, entao a fila anda do mais
 * velho para o mais novo). No completo -- tudo conferido com o banco, a ordem
 * nao importa para o resultado -- vai primeiro o mais NOVO: o "Hoje" da tela
 * fica certo ja na primeira rodada, e o historico vem nas seguintes.
 */
export function cortar(p: Pendente, limite: number, maisNovoPrimeiro: boolean): Pendente {
  const total = linhasDoPlano(p);
  if (total <= limite) return p;
  type Item = { t: number; k: "origens" | "compras" | "funil" | "gasto" | "pedidos"; l: unknown };
  const itens: Item[] = [
    ...p.origens.map((l) => ({ t: Date.parse(l.pedido_em), k: "origens" as const, l })),
    ...p.compras.map((l) => ({ t: Date.parse(l.created_at), k: "compras" as const, l })),
    ...p.funil.map((l) => ({ t: Date.parse(l.created_at), k: "funil" as const, l })),
    ...p.gasto.map((l) => ({ t: instanteLocal(String(l.data).slice(0, 10), 86_399), k: "gasto" as const, l })),
    ...p.pedidos.map((l) => ({ t: Date.parse(l.criado_em), k: "pedidos" as const, l })),
  ];
  itens.sort((a, b) => (maisNovoPrimeiro ? b.t - a.t : a.t - b.t));
  const ficam = itens.slice(0, limite);
  const de = <T,>(k: Item["k"]) => ficam.filter((x) => x.k === k).map((x) => x.l as T);
  return {
    ...p,
    origens: de<LinhaOrigem>("origens"),
    compras: de<LinhaEvento>("compras"),
    funil: de<LinhaEvento>("funil").sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0)),
    gasto: de<AdSpendDailyRow>("gasto"),
    pedidos: de<FinOrderRow>("pedidos"),
    adiadas: total - limite,
  };
}

// ---------------------------------------------------------------------------
// Escrita
// ---------------------------------------------------------------------------

export type Contagem = Record<string, number>;

async function gravarEmLotes(admin: Admin, tabela: string, linhas: readonly object[], onConflict: string, soOsQueFaltam: boolean): Promise<number> {
  const tamanho = tabela === "tracking_events" ? 400 : 500;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const { error } = await admin.from(tabela).upsert(lote, { onConflict, ignoreDuplicates: soOsQueFaltam });
    if (error) erro(`${tabela} (lote ${i / tamanho + 1})`, error);
  }
  return linhas.length;
}

async function apagarPorId(admin: Admin, tabela: string, coluna: string, ids: readonly string[]): Promise<number> {
  for (let i = 0; i < ids.length; i += 100) {
    const { error } = await admin.from(tabela).delete().eq("store_id", LOJA_ID).in(coluna, ids.slice(i, i + 100));
    if (error) erro(`${tabela} (poda)`, error);
  }
  return ids.length;
}

/**
 * Grava o plano da rodada. fin_orders vai POR ULTIMO (como sempre foi), e o
 * funil em ordem de created_at: a rodada que cair no meio deixa o banco num
 * estado que a proxima continua -- o cursor so anda quando tudo foi.
 */
export async function gravar(admin: Admin, s: Semeadura, p: Pendente, brl: number): Promise<Contagem> {
  const n: Contagem = {};
  if (p.podarOrigens.length) n["fin_order_origem (poda)"] = await apagarPorId(admin, "fin_order_origem", "shopify_order_id", p.podarOrigens);
  if (p.podarEventos.length) n["tracking_events (poda)"] = await apagarPorId(admin, "tracking_events", "id", p.podarEventos);
  n.fin_order_origem = await gravarEmLotes(admin, "fin_order_origem", p.origens, "store_id,shopify_order_id", p.soFaltantes.origens);
  n["tracking_events (Purchase)"] = await gravarEmLotes(admin, "tracking_events", p.compras, "id", p.soFaltantes.compras);
  n["tracking_events (funil)"] = await gravarEmLotes(admin, "tracking_events", p.funil, "id", p.soFaltantes.funil);
  n.ad_spend_daily = await gravarEmLotes(admin, "ad_spend_daily", p.gasto, "ad_account_id,data,nivel,campanha_id", false);
  n.fin_orders = await gravarEmLotes(admin, "fin_orders", p.pedidos, "store_id,shopify_order_id", false);
  // Campanhas: o retrato de hoje, e so ele (a tela nao filtra por data).
  const { error } = await admin.from("ad_insights_granular").delete().in("ad_account_id", CONTAS).neq("data", s.hoje);
  if (error) erro("ad_insights_granular (dias antigos)", error);
  n.ad_insights_granular = await gravarEmLotes(admin, "ad_insights_granular", granularDe(s, brl), "ad_account_id,data,nivel,objeto_id", false);
  return n;
}

// ---------------------------------------------------------------------------
// Limpeza (as janelas que rolam)
// ---------------------------------------------------------------------------

async function apagar(rotulo: string, q: PromiseLike<{ error: { message?: string } | null; count: number | null }>): Promise<number> {
  const { error, count } = await q;
  if (error) erro(`${rotulo} (fora da janela)`, error);
  return count ?? 0;
}

/** O funil com mais de HORAS_DE_FUNIL horas sai (toda rodada: a janela dele anda a cada minuto). */
export async function aparaFunil(admin: Admin, s: Semeadura): Promise<number> {
  return apagar(
    "tracking_events (funil)",
    admin.from("tracking_events").delete({ count: "exact" }).eq("store_id", LOJA_ID).in("event_name", FUNIL).lt("created_at", iso(s.cortes.funil))
  );
}

/**
 * O que saiu das janelas sai do banco (uma vez por dia; o script, toda vez):
 * funil com mais de 48 h, Purchase antes do corte das compras, e pedido,
 * origem e gasto antes de inicioDaJanela. fin_orders por ultimo. Depois, o
 * pixel do Meta "nasce" no corte das compras (pixelDoMetaDesdeOCorte).
 */
export async function apagarForaDaJanela(admin: Admin, s: Semeadura): Promise<Contagem> {
  const inicio = iso(instanteLocal(s.cortes.janela, 0));
  const n: Contagem = {};
  n["tracking_events (funil)"] = await aparaFunil(admin, s);
  n["tracking_events (Purchase)"] = await apagar(
    "tracking_events (Purchase)",
    admin.from("tracking_events").delete({ count: "exact" }).eq("store_id", LOJA_ID).eq("event_name", "Purchase").lt("created_at", iso(s.cortes.compras))
  );
  n.fin_order_origem = await apagar("fin_order_origem", admin.from("fin_order_origem").delete({ count: "exact" }).eq("store_id", LOJA_ID).lt("pedido_em", inicio));
  n.ad_spend_daily = await apagar("ad_spend_daily", admin.from("ad_spend_daily").delete({ count: "exact" }).in("ad_account_id", CONTAS).lt("data", s.cortes.janela));
  n.fin_orders = await apagar("fin_orders", admin.from("fin_orders").delete({ count: "exact" }).eq("store_id", LOJA_ID).lt("dia_local", s.cortes.janela));
  await pixelDoMetaDesdeOCorte(admin, s.cortes.compras);
  return n;
}

/**
 * O pixel do Meta "nasce" no corte das compras. A fila so guarda Purchase
 * desde primeiroDiaDeCompra, e a tela Pedidos pinta de vermelho ("nao
 * enviado") o pedido de loja com pixel que nao tem Purchase -- com o destino
 * criado no corte, o pedido mais velho que ele fica "sem pixel" (cinza), como
 * numa loja que ligou o pixel depois. So escreve quando o corte anda.
 */
async function pixelDoMetaDesdeOCorte(admin: Admin, corteMs: number) {
  const corte = iso(corteMs);
  const { error } = await admin
    .from("tracking_destinations")
    .update({ created_at: corte })
    .eq("id", DESTINO_META.id)
    .eq("store_id", LOJA_ID)
    .neq("created_at", corte);
  if (error) erro("tracking_destinations (Meta)", error);
}

// ---------------------------------------------------------------------------
// Tamanho (a trava do cron, sem a Management API)
// ---------------------------------------------------------------------------

/** Linhas da loja por tabela (contagem, sem trazer linha). */
export async function contarLinhas(admin: Admin): Promise<Record<TabelaContada, number>> {
  const contar = async (tabela: TabelaContada, coluna: string, valores: string[]) => {
    const { count, error } = await admin.from(tabela).select(coluna, { count: "exact", head: true }).in(coluna, valores);
    if (error) erro(`${tabela} (contagem)`, error);
    return count ?? 0;
  };
  return {
    fin_orders: await contar("fin_orders", "store_id", [LOJA_ID]),
    fin_order_origem: await contar("fin_order_origem", "store_id", [LOJA_ID]),
    tracking_events: await contar("tracking_events", "store_id", [LOJA_ID]),
    ad_spend_daily: await contar("ad_spend_daily", "ad_account_id", CONTAS),
    ad_insights_granular: await contar("ad_insights_granular", "ad_account_id", CONTAS),
  };
}

/**
 * Passa do teto? `atual` e o que a loja tem; `novas`, o que a rodada poe a
 * mais (no incremental, por cima: origem e evento contam como novos). null =
 * cabe.
 */
export function passaDoTeto(atual: Record<TabelaContada, number>, novas: Record<TabelaContada, number>): string | null {
  const motivos: string[] = [];
  for (const t of Object.keys(TETO_DE_LINHAS) as TabelaContada[]) {
    // O retrato de Campanhas e trocado a cada rodada (os dias antigos saem antes): so o que ja tem conta.
    const depois = atual[t] + (t === "ad_insights_granular" ? 0 : novas[t]);
    if (depois > TETO_DE_LINHAS[t]) motivos.push(`${t} ${atual[t]} + ${depois - atual[t]} > ${TETO_DE_LINHAS[t]}`);
  }
  return motivos.length ? motivos.join("; ") : null;
}

// ---------------------------------------------------------------------------
// Frescor e fuso
// ---------------------------------------------------------------------------

/**
 * O fuso novo vale ja: fin_sync_state e as contas de anuncio passam ao do
 * gerador, e o cursor zera -- as proximas rodadas sao completas ate a janela
 * inteira estar no fuso novo (os dias dos pedidos nao mudam, so o instante).
 */
export async function trocarFuso(admin: Admin): Promise<void> {
  const agora = new Date().toISOString();
  const { error: e1 } = await admin
    .from("fin_sync_state")
    .update({ fuso: FUSO, cursor_atualizado: null, updated_at: agora })
    .eq("store_id", LOJA_ID);
  if (e1) erro("fin_sync_state (fuso)", e1);
  const { error: e2 } = await admin.from("ad_accounts").update({ fuso: FUSO }).in("id", CONTAS).eq("store_id", LOJA_ID);
  if (e2) erro("ad_accounts (fuso)", e2);
}

/**
 * A hora das leituras: o que a tela usa para "Atualizado ha X" e para o pixel
 * ativo. `fechou` = tudo ate `agoraMs` esta no banco: so ai o cursor anda (e
 * a trava do cron sai junto, sempre).
 */
export async function gravarFrescor(admin: Admin, agoraMs: number, fechou: boolean): Promise<void> {
  const ha = (min: number) => iso(agoraMs - min * 60_000);
  const { count, error: e0 } = await admin.from("fin_orders").select("store_id", { count: "exact", head: true }).eq("store_id", LOJA_ID);
  if (e0) erro("fin_orders (contagem)", e0);
  const { error: e1 } = await admin.from("fin_sync_state").upsert(
    {
      store_id: LOJA_ID,
      user_id: ARTHUR,
      fuso: FUSO,
      moeda: MOEDA,
      ...(fechou ? { cursor_atualizado: iso(agoraMs) } : {}),
      sincronizando_desde: null,
      ultimo_sync_em: ha(1),
      ultimo_sync_ok_em: ha(1),
      ultimo_erro: null,
      ultimo_erro_tipo: null,
      carga_inicial_ok: true,
      pedidos_total: count ?? 0,
      retomar_busca: null,
      retomar_cursor: null,
      origem_backfill_em: "2026-07-15T14:31:40.000Z",
      updated_at: ha(1),
    },
    { onConflict: "store_id" }
  );
  if (e1) erro("fin_sync_state", e1);
  const { error: e2 } = await admin
    .from("ad_accounts")
    .update({ fuso: FUSO, ultimo_sync_em: ha(2), ultimo_sync_ok_em: ha(2), ultimo_reprocesso_em: ha(240), sincronizando_desde: null, ultimo_erro: null, updated_at: ha(2) })
    .eq("id", CONTA_META.id)
    .eq("store_id", LOJA_ID);
  if (e2) erro("ad_accounts (Meta)", e2);
  const { error: e3 } = await admin
    .from("ad_accounts")
    .update({ fuso: FUSO, ultimo_sync_em: ha(17), ultimo_sync_ok_em: ha(17), ultimo_dado_gerado_em: ha(19), ultimo_erro: null, updated_at: ha(17) })
    .eq("id", CONTA_GOOGLE.id)
    .eq("store_id", LOJA_ID);
  if (e3) erro("ad_accounts (Google)", e3);
  const { error: e4 } = await admin
    .from("tracking_configs")
    .update({ web_pixel_visto_em: ha(1), web_pixel_com_id_em: ha(1) })
    .eq("store_id", LOJA_ID);
  if (e4) erro("tracking_configs", e4);
}
