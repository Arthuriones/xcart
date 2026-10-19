/**
 * Loja de demonstracao na conta do Arthur: pedidos, custos, gasto de anuncio,
 * origem por campanha e eventos de rastreamento gravados direto no banco, sem
 * Shopify, Meta ou Google por tras (migration 074, src/lib/demonstracao.ts).
 *
 * A loja e marcada (stores.demonstracao): o app nao chama nada de fora por
 * ela, nao abre alerta e nao a sincroniza -- os numeros so mudam quando este
 * script roda. Rode o `semear` logo antes de gravar a tela.
 *
 * Uso (da raiz do repo, com o .env.local):
 *   npm run op -- scripts/demo-loja.ts semear --dry-run     resumo por dia; NAO grava (le o banco so com SELECT)
 *   npm run op -- scripts/demo-loja.ts semear               cria a loja se faltar e completa ate agora
 *   npm run op -- scripts/demo-loja.ts semear --tudo        regrava todos os dias (padrao: os ultimos 25)
 *   npm run op -- scripts/demo-loja.ts semear --ao-vivo 60  completa hoje a cada 60 s, ate Ctrl+C
 *   npm run op -- scripts/demo-loja.ts limpar               mostra o que sairia
 *   npm run op -- scripts/demo-loja.ts limpar --confirmar <dominio.myshopify.com>
 *
 * Fora da raiz: XCART_ENV=<caminho do .env.local>.
 *
 * Re-executavel e idempotente: os ids sao fixos (uuid v5 da semente) e cada
 * dia nasce do mesmo sorteio, entao rodar de novo regrava o mesmo dado e
 * completa o dia de hoje ate a hora atual.
 */
import { randomBytes } from "node:crypto";
import { config } from "dotenv";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { calcularFinanceiro } from "../src/lib/financeiro/calculo";
import {
  paraNumero,
  receitaDoPedido,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type FxRateRow,
} from "../src/lib/financeiro/tipos";
import {
  ARTHUR,
  CATALOGO,
  CONTA_GOOGLE,
  CONTA_META,
  CONTAS_DESDE,
  DESTINO_GOOGLE,
  DESTINO_META,
  DIAS_DE_FUNIL,
  DOMINIO,
  FUSO,
  LANCAMENTO,
  LOJA_CONECTADA_EM,
  LOJA_ID,
  MOEDA,
  NOME_LOJA,
  RASTREAMENTO_DESDE,
  TAXA_FIXA,
  TAXA_PCT,
  diaDaSemana,
  diaLocal,
  fracaoDoDia,
  gerarPlano,
  instanteLocal,
  segundosLocais,
  sha256,
  somarDia,
  type DiaPlano,
} from "./demo-loja/plano";
import {
  compraDoPedido,
  custosDosProdutos,
  funilDoDia,
  gastoDoDia,
  granularDeHoje,
  linhaDaOrigem,
  linhaDoPedido,
  linhasDeGasto,
  sincronizadoDoDia,
  type Cambio,
  type GastoDoDia,
  type LinhaEvento,
} from "./demo-loja/linhas";

config({ path: process.env.XCART_ENV || ".env.local" });

const args = process.argv.slice(2);
const comando = args[0];
const tem = (flag: string) => args.includes(flag);
const valorDe = (flag: string): string | null => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

/** Dias regravados a cada execucao: envio, entrega e reembolso mudam o pedido ate ~19 dias depois. */
const DIAS_REGRAVADOS = 25;
/** ROAS real minimo e maximo de um dia: fora disso o gasto e ajustado e o lucro sai da meta. */
const ROAS_MIN = 2.15;
const ROAS_MAX = 3.3;
/** O estado final de cada pedido (reembolso e entrega ja aconteceram). */
const FIM_DOS_TEMPOS = Date.parse("2100-01-01T00:00:00Z");
const MOEDAS_CLIENTE = ["CAD", "GBP", "AUD", "EUR", "BRL"];
/** Cotacao de reserva (unidades por USD) quando o banco nao responde: so para o --dry-run sem banco. */
const COTACAO_RESERVA: Record<string, number> = { USD: 1, CAD: 1.38, GBP: 0.76, AUD: 1.53, EUR: 0.87, BRL: 5.42 };
const FUNIL = ["view_item", "add_to_cart", "begin_checkout", "payment_info"];

type Admin = SupabaseClient;

function falhar(msg: string): never {
  console.error(`\nERRO: ${msg}\n`);
  process.exit(1);
}

/** Cliente que so le: no --dry-run, qualquer escrita lanca antes de sair da maquina. */
function somenteLeitura(c: Admin): Admin {
  const bloquear = (o: string) => () => {
    throw new Error(`--dry-run: ${o} bloqueado`);
  };
  return new Proxy(c, {
    get(alvo, p) {
      if (p === "rpc") return bloquear("rpc");
      if (p !== "from") return Reflect.get(alvo, p);
      return (tabela: string) => {
        const q = alvo.from(tabela);
        return new Proxy(q, {
          get(b, m) {
            if (m === "insert" || m === "upsert" || m === "update" || m === "delete") return bloquear(`${String(m)} em ${tabela}`);
            const v = Reflect.get(b, m);
            return typeof v === "function" ? v.bind(b) : v;
          },
        });
      };
    },
  }) as Admin;
}

function conectar(dryRun: boolean): Admin | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) return null;
  const c = createClient(url, chave, { auth: { autoRefreshToken: false, persistSession: false } });
  return dryRun ? somenteLeitura(c) : c;
}

const ehColunaAusente = (e: { code?: string; message?: string } | null) =>
  Boolean(e && (e.code === "42703" || e.code === "PGRST204" || /column .* does not exist/i.test(e.message ?? "")));

// ---------------------------------------------------------------------------
// Cambio
// ---------------------------------------------------------------------------

async function lerCambio(admin: Admin | null, desde: string, ate: string): Promise<{ linhas: FxRateRow[]; doBanco: boolean }> {
  if (!admin) return { linhas: [], doBanco: false };
  const linhas: FxRateRow[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await admin
      .from("fx_rates")
      .select("data, moeda, por_usd, fonte")
      .in("moeda", MOEDAS_CLIENTE)
      .gte("data", somarDia(desde, -10))
      .lte("data", ate)
      .order("data", { ascending: true })
      .order("moeda", { ascending: true })
      .range(de, de + 999);
    if (error) falhar(`fx_rates: ${error.message}`);
    linhas.push(...((data ?? []) as FxRateRow[]));
    if ((data ?? []).length < 1000) break;
  }
  return { linhas, doBanco: true };
}

/** Unidades por USD no dia: a ultima cotacao ate o dia, ou a de reserva. */
function montarCambio(linhas: FxRateRow[]): Cambio {
  const porMoeda = new Map<string, { data: string; v: number }[]>();
  for (const l of linhas) {
    const lista = porMoeda.get(l.moeda) ?? [];
    lista.push({ data: String(l.data).slice(0, 10), v: paraNumero(l.por_usd) });
    porMoeda.set(l.moeda, lista);
  }
  return (moeda, dia) => {
    if (moeda === "USD") return 1;
    const lista = porMoeda.get(moeda) ?? [];
    let achado: number | null = null;
    for (const c of lista) if (c.data <= dia && c.v > 0) achado = c.v;
    return achado ?? COTACAO_RESERVA[moeda] ?? 1;
  };
}

// ---------------------------------------------------------------------------
// O plano no estado de agora
// ---------------------------------------------------------------------------

interface Semeadura {
  agoraMs: number;
  hoje: string;
  plano: DiaPlano[];
  pedidos: FinOrderRow[];
  origens: NonNullable<ReturnType<typeof linhaDaOrigem>>[];
  compras: LinhaEvento[];
  funil: LinhaEvento[];
  gastos: GastoDoDia[];
  linhasGasto: AdSpendDailyRow[];
  /** O gasto do dia inteiro (a conta do lucro) e a meta, por dia. */
  porDia: Map<string, { gastoDia: number; meta: number; roasMeta: number; ajustado: boolean }>;
}

const configLoja: FinStoreSettingsRow = {
  store_id: LOJA_ID,
  user_id: ARTHUR,
  taxa_pct: TAXA_PCT,
  taxa_fixa: TAXA_FIXA,
  custo_padrao_pct: null,
  contra_entrega: false,
};

const lojaFinanceira = { id: LOJA_ID, nome: NOME_LOJA, dominio: DOMINIO, fuso: FUSO, moeda: MOEDA };

function montar(agoraMs: number, cambio: Cambio, fx: FxRateRow[]): Semeadura {
  const hoje = diaLocal(agoraMs);
  const plano = gerarPlano(hoje);
  const custos = custosDosProdutos();

  // 1) O gasto de cada dia sai do estado FINAL dos pedidos (o reembolso que
  //    ainda vai acontecer ja conta): o gasto de um dia passado nunca muda.
  const finais = plano.flatMap((d) => d.pedidos.map((p) => linhaDoPedido(p, FIM_DOS_TEMPOS, cambio)));
  const contaFinal = calcularFinanceiro({
    lojas: [lojaFinanceira],
    pedidos: finais,
    custos,
    configs: [configLoja],
    contas: [],
    gastos: [],
    cambio: fx,
    intervalos: { atual: { desde: LANCAMENTO, ate: hoje }, anterior: { desde: somarDia(LANCAMENTO, -1), ate: somarDia(LANCAMENTO, -1) } },
    moeda: "USD",
    hoje,
  });
  const porDia = new Map<string, { gastoDia: number; meta: number; roasMeta: number; ajustado: boolean }>();
  for (const d of plano) {
    const t = contaFinal.porDia.find((x) => x.dia === d.dia)!;
    const sobra = t.receita - t.cmv - t.taxas - d.meta.lucro;
    const gastoDia = Math.min(t.receita / ROAS_MIN, Math.max(t.receita / ROAS_MAX, sobra));
    porDia.set(d.dia, { gastoDia, meta: d.meta.lucro, roasMeta: d.meta.roas, ajustado: Math.abs(gastoDia - sobra) > 0.01 });
  }

  // 2) O estado de agora: so o que ja aconteceu.
  const pedidos: FinOrderRow[] = [];
  const origens: Semeadura["origens"] = [];
  const compras: LinhaEvento[] = [];
  const funil: LinhaEvento[] = [];
  const gastos: GastoDoDia[] = [];
  const corteFunil = somarDia(hoje, -(DIAS_DE_FUNIL - 1));
  const fracaoHoje = fracaoDoDia(segundosLocais(agoraMs));
  for (const d of plano) {
    for (const p of d.pedidos) {
      if (p.criadoMs > agoraMs) continue;
      pedidos.push(linhaDoPedido(p, agoraMs, cambio));
      const o = linhaDaOrigem(p, agoraMs, cambio);
      if (o) origens.push(o);
      const c = compraDoPedido(p, agoraMs);
      if (c) compras.push(c);
    }
    if (d.dia >= corteFunil) funil.push(...funilDoDia(d, agoraMs));
    gastos.push(gastoDoDia(d, porDia.get(d.dia)!.gastoDia, d.dia === hoje ? fracaoHoje : 1, agoraMs));
  }
  const linhasGasto = gastos.flatMap((g) =>
    linhasDeGasto(g, g.dia === hoje ? new Date(agoraMs - 3 * 60_000).toISOString() : sincronizadoDoDia(g.dia, agoraMs))
  );
  return { agoraMs, hoje, plano, pedidos, origens, compras, funil, gastos, linhasGasto, porDia };
}

// ---------------------------------------------------------------------------
// Resumo (a conta do app sobre o que seria gravado)
// ---------------------------------------------------------------------------

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
const n2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string, n: number) => s.padStart(n);

function contasDaLoja(): AdAccountRow[] {
  const base = {
    user_id: ARTHUR,
    store_id: LOJA_ID,
    checkout_id: null,
    moeda: MOEDA,
    fuso: FUSO,
    ativo: true,
    sincronizando_desde: null,
    ultimo_sync_em: null,
    ultimo_sync_ok_em: null,
    ultimo_reprocesso_em: null,
    ultimo_dado_gerado_em: null,
    ultimo_erro: null,
  };
  return [
    { ...base, id: CONTA_META.id, plataforma: "meta", external_id: CONTA_META.external_id, nome: CONTA_META.nome, status_externo: "ativa", fonte: "api" },
    { ...base, id: CONTA_GOOGLE.id, plataforma: "google", external_id: CONTA_GOOGLE.external_id, nome: CONTA_GOOGLE.nome, status_externo: null, fonte: "script" },
  ];
}

function resumir(s: Semeadura, fx: FxRateRow[], doBanco: boolean) {
  const custos = custosDosProdutos();
  const r = calcularFinanceiro({
    lojas: [lojaFinanceira],
    pedidos: s.pedidos,
    custos,
    configs: [configLoja],
    contas: contasDaLoja(),
    gastos: s.linhasGasto,
    cambio: fx,
    intervalos: { atual: { desde: LANCAMENTO, ate: s.hoje }, anterior: { desde: somarDia(LANCAMENTO, -1), ate: somarDia(LANCAMENTO, -1) } },
    moeda: "USD",
    hoje: s.hoje,
    agoraMs: s.agoraMs,
  });

  console.log(`\nLoja de demonstracao: ${NOME_LOJA} · ${DOMINIO} (id ${LOJA_ID})`);
  console.log(`Agora: ${new Date(s.agoraMs).toISOString()} · hoje no fuso da loja (${FUSO}): ${s.hoje}`);
  console.log(`Cambio: ${doBanco ? "fx_rates do banco" : "cotacao de reserva (sem banco)"}\n`);
  console.log(
    `${"dia".padEnd(10)} sem  ${pad("pedidos", 7)} ${pad("receita", 10)} ${pad("custo prod", 10)} ${pad("taxas", 8)} ${pad("Meta", 9)} ${pad("Google", 8)} ${pad("lucro", 9)} ${pad("ROAS", 5)} ${pad("margem", 6)}`
  );
  const dias = [...r.porDia].reverse();
  for (const d of dias) {
    const extra = d.parcial ? "  <- hoje, parcial" : s.porDia.get(d.dia)?.ajustado ? "  (gasto no teto de ROAS)" : "";
    console.log(
      `${d.dia} ${SEMANA[diaDaSemana(d.dia)]}  ${pad(n0(d.pedidos), 7)} ${pad(n0(d.receita), 10)} ${pad(n0(d.cmv), 10)} ${pad(n0(d.taxas), 8)} ${pad(n0(d.gastoMeta), 9)} ${pad(n0(d.gastoGoogle), 8)} ${pad(n0(d.lucro), 9)} ${pad(d.roas ? d.roas.toFixed(2) : "-", 5)} ${pad(d.margem !== null ? `${(d.margem * 100).toFixed(1)}%` : "-", 6)}${extra}`
    );
  }

  const fechados = dias.filter((d) => !d.parcial);
  const media = (lista: typeof fechados, campo: "lucro" | "receita" | "gasto" | "pedidos") =>
    lista.reduce((t, d) => t + d[campo], 0) / Math.max(1, lista.length);
  const ultimos = (n: number) => fechados.slice(-n);
  const lucros = fechados.map((d) => d.lucro);
  const t = r.atual;
  const vendas = s.pedidos.filter((p) => p.tipo === "venda");
  const cancelados = vendas.filter((p) => p.cancelado_em).length;
  const reembolsados = vendas.filter((p) => !p.cancelado_em && paraNumero(p.reembolsado) > 0).length;
  const origemPor = new Map<string, number>();
  for (const o of s.origens) origemPor.set(o.plataforma ?? "direto", (origemPor.get(o.plataforma ?? "direto") ?? 0) + 1);
  const semOrigem = vendas.length - s.origens.length;
  const moedaPor = new Map<string, number>();
  for (const p of vendas) moedaPor.set(p.moeda_cliente ?? "?", (moedaPor.get(p.moeda_cliente ?? "?") ?? 0) + 1);
  const gatewayPor = new Map<string, number>();
  for (const p of vendas) gatewayPor.set(p.gateways[0] ?? "-", (gatewayPor.get(p.gateways[0] ?? "-") ?? 0) + 1);
  const pct = (a: number, b: number) => `${((a / Math.max(1, b)) * 100).toFixed(1)}%`;

  console.log(`\nResumo (conta do app, calcularFinanceiro, USD; dias fechados = sem o de hoje)`);
  console.log(`  dias: ${fechados.length} fechados + hoje parcial`);
  console.log(`  lucro medio/dia: ${n2(media(fechados, "lucro"))} · ultimos 30: ${n2(media(ultimos(30), "lucro"))} · ultimos 7: ${n2(media(ultimos(7), "lucro"))}`);
  console.log(`  lucro dia minimo/maximo: ${n2(Math.min(...lucros))} / ${n2(Math.max(...lucros))} · dias com lucro < 5k: ${lucros.filter((v) => v < 5000).length} · > 10k: ${lucros.filter((v) => v > 10000).length}`);
  console.log(`  receita media/dia: ${n2(media(fechados, "receita"))} · gasto medio/dia: ${n2(media(fechados, "gasto"))} · pedidos/dia: ${n2(media(fechados, "pedidos"))}`);
  console.log(`  periodo inteiro: pedidos ${n0(t.pedidos)} · receita ${n2(t.receita)} · custo de produto ${n2(t.cmv)} (${pct(t.cmv, t.receita)}) · taxas ${n2(t.taxas)} · gasto ${n2(t.gasto)} (Meta ${n2(t.gastoMeta)}, Google ${n2(t.gastoGoogle)}) · lucro ${n2(t.lucro)}`);
  console.log(`  ROAS ${t.roas?.toFixed(2)} · ROAS de equilibrio ${t.roasEquilibrio?.toFixed(2)} · margem ${pct(t.lucro, t.receita)} · ticket ${n2(t.ticket ?? 0)} · CPA ${n2(t.cpa ?? 0)} · reenvios ${t.reenvios} · cobertura de custo ${pct(t.coberturaCusto ?? 0, 1)}`);
  console.log(`  cancelados ${pct(cancelados, vendas.length)} · com reembolso ${pct(reembolsados, vendas.length)}`);
  console.log(`  origem: ${[...origemPor].map(([k, v]) => `${k} ${pct(v, vendas.length)}`).join(" · ")} · sem jornada ${pct(semOrigem, vendas.length)}`);
  console.log(`  moeda do comprador: ${[...moedaPor].map(([k, v]) => `${k} ${pct(v, vendas.length)}`).join(" · ")}`);
  console.log(`  gateway: ${[...gatewayPor].map(([k, v]) => `${k} ${pct(v, vendas.length)}`).join(" · ")}`);
  const avisos = r.avisos;
  if (avisos.moedasSemCotacao.length || avisos.lojasSemTaxa.length || avisos.lojasSemCustoPadraoComFalta.length || avisos.fusosDiferentes.length) {
    console.log(`  AVISOS do calculo: ${JSON.stringify(avisos)}`);
  }
  console.log(`\nLinhas no estado de agora:`);
  console.log(`  fin_orders ${n0(s.pedidos.length)} · fin_order_origem ${n0(s.origens.length)} · tracking_events ${n0(s.compras.length)} Purchase + ${n0(s.funil.length)} de funil (${DIAS_DE_FUNIL} dias)`);
  console.log(`  ad_spend_daily ${n0(s.linhasGasto.length)} · product_costs ${custosDosProdutos().length} · demonstracao_catalogo ${CATALOGO.length}`);
  const ultimoNumero = s.pedidos.reduce((m, p) => Math.max(m, Number(String(p.nome).slice(1)) || 0), 0);
  console.log(`  pedidos #1001 a #${ultimoNumero}`);
  const tamanho = (l: object[]) => Math.round(l.reduce((t, x) => t + JSON.stringify(x).length, 0) / Math.max(1, l.length));
  console.log(`  tamanho medio (JSON): fin_orders ${tamanho(s.pedidos)} B · Purchase ${tamanho(s.compras)} B · funil ${tamanho(s.funil)} B`);

  if (tem("--amostra")) {
    const um = <T,>(rotulo: string, x: T | undefined) => console.log(`\n--- ${rotulo}\n${JSON.stringify(x, null, 1)}`);
    um("fin_orders (reembolso total)", s.pedidos.find((p) => p.status_financeiro === "REFUNDED" && !p.cancelado_em));
    um("fin_orders (cancelado)", s.pedidos.find((p) => p.cancelado_em));
    um("fin_orders (hoje, nao enviado)", s.pedidos.filter((p) => p.dia_local === s.hoje).pop());
    um("fin_orders (reenvio)", s.pedidos.find((p) => p.tipo === "reenvio"));
    um("fin_order_origem (meta)", s.origens.find((o) => o.plataforma === "meta"));
    um("fin_order_origem (google)", s.origens.find((o) => o.plataforma === "google" && o.conjunto_id));
    um("fin_order_origem (outra)", s.origens.find((o) => o.plataforma === "outra"));
    um("fin_order_origem (direto)", s.origens.find((o) => !o.plataforma));
    um("tracking_events (Purchase)", s.compras[s.compras.length - 1]);
    um("tracking_events (begin_checkout)", s.funil.find((e) => e.event_name === "begin_checkout"));
    um("ad_spend_daily (conta)", s.linhasGasto.find((g) => g.nivel === "conta" && g.data === s.hoje));
    um("ad_spend_daily (campanha)", s.linhasGasto.find((g) => g.nivel === "campanha" && g.data === s.hoje));
    const brl = paraNumero(fx.filter((l) => l.moeda === "BRL").pop()?.por_usd) || 5.4;
    const granular = granularDeHoje(
      s.gastos.find((g) => g.dia === s.hoje)!,
      s.hoje,
      new Map(s.pedidos.filter((p) => p.dia_local === s.hoje).map((p) => [p.shopify_order_id, p])),
      custos,
      brl,
      new Date(s.agoraMs).toISOString()
    );
    console.log(`\n--- ad_insights_granular: ${granular.length} linhas (BRL ${brl})`);
    um("ad_insights_granular (anuncio no ar)", granular.find((g) => g.nivel === "anuncio" && g.objeto_status === "ACTIVE" && g.vendas > 0));
    um("ad_insights_granular (conta Meta)", granular.find((g) => g.nivel === "conta"));
  }
}

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------

async function gravarEmLotes(admin: Admin, tabela: string, linhas: object[], onConflict: string, ignorarExistentes = false) {
  const tamanho = tabela === "tracking_events" ? 400 : 500;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const { error } = await admin.from(tabela).upsert(lote, { onConflict, ignoreDuplicates: ignorarExistentes });
    if (error) falhar(`${tabela} (lote ${i / tamanho + 1}): ${error.message}`);
  }
  if (linhas.length) console.log(`  ${tabela}: ${n0(linhas.length)}`);
}

function aleatorio(n: number): string {
  return randomBytes(n).toString("hex");
}

async function conferirAntes(admin: Admin, dryRun: boolean): Promise<{ existe: boolean; ultimoDia: string | null; ultimoFunil: string | null }> {
  const { data: loja, error } = await admin.from("stores").select("id, user_id, shop_domain, demonstracao").eq("id", LOJA_ID).maybeSingle();
  if (error) {
    if (ehColunaAusente(error)) {
      if (dryRun) {
        console.log("AVISO: a migration 074 (stores.demonstracao) ainda nao foi aplicada -- o semear de verdade recusa rodar sem ela.");
        return { existe: false, ultimoDia: null, ultimoFunil: null };
      }
      falhar("a migration 074 (stores.demonstracao) nao esta aplicada. Aplique antes: sem a marca, o cron trataria a loja como real.");
    }
    falhar(`stores: ${error.message}`);
  }
  if (loja && (loja.user_id !== ARTHUR || loja.demonstracao !== true)) {
    falhar(`a linha ${LOJA_ID} existe mas nao e a loja de demonstracao do Arthur. Nada foi gravado.`);
  }
  const { data: mesmoDominio } = await admin.from("stores").select("id").eq("user_id", ARTHUR).eq("shop_domain", DOMINIO).neq("id", LOJA_ID);
  if ((mesmoDominio ?? []).length) falhar(`ja existe outra loja do Arthur com o dominio ${DOMINIO}.`);
  if (!dryRun) {
    const { data: perfil } = await admin.from("profiles").select("id").eq("id", ARTHUR).maybeSingle();
    if (!perfil) falhar(`perfil ${ARTHUR} nao encontrado.`);
  }
  if (!loja) return { existe: false, ultimoDia: null, ultimoFunil: null };
  const { data: ult } = await admin.from("fin_orders").select("dia_local").eq("store_id", LOJA_ID).order("dia_local", { ascending: false }).limit(1);
  const { data: fun } = await admin
    .from("tracking_events")
    .select("created_at")
    .eq("store_id", LOJA_ID)
    .not("visitor_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(1);
  return {
    existe: true,
    ultimoDia: (ult ?? [])[0]?.dia_local ?? null,
    ultimoFunil: (fun ?? [])[0]?.created_at ?? null,
  };
}

async function gravarBase(admin: Admin, existe: boolean) {
  if (!existe) {
    const { error } = await admin.from("stores").insert({
      id: LOJA_ID,
      user_id: ARTHUR,
      shop_domain: DOMINIO,
      name: NOME_LOJA,
      client_id: aleatorio(16),
      client_secret: aleatorio(16),
      access_token: null,
      niche: "Sleep & comfort",
      target_audience: "Adults 28-65 in the US, Canada, UK and Australia who sleep badly: neck pain, side sleepers, hot sleepers.",
      brand_voice: "Calm, warm and confident. Short sentences, real benefits, no hype.",
      store_description:
        "Quillmere makes the sleep basics that fix the small things that ruin a night: a contour memory foam pillow for neck pain, a cooling weighted blanket, bamboo sheets and silk sleep masks.",
      currency_code: MOEDA,
      target_language: "en-US",
      product_count: new Set(CATALOGO.map((i) => i.handle)).size,
      variant_count: CATALOGO.length,
      catalog_synced_at: "2026-07-15T14:13:02.000Z",
      created_at: LOJA_CONECTADA_EM,
      updated_at: LOJA_CONECTADA_EM,
      demonstracao: true,
    });
    if (error) falhar(`stores: ${error.message}`);
    console.log(`  stores: loja criada (${DOMINIO})`);
  }

  await gravarEmLotes(
    admin,
    "demonstracao_catalogo",
    CATALOGO.map((i) => ({ store_id: LOJA_ID, sku: i.sku, nome: i.produto, variante: i.variante, imagem: null })),
    "store_id,sku",
    true
  );
  await gravarEmLotes(
    admin,
    "fin_store_settings",
    [{ ...configLoja, cod_taxa_entrega: 70, cod_custo_devolucao: 0, created_at: "2026-07-19T22:38:12.000Z", updated_at: "2026-07-19T22:38:12.000Z" }],
    "store_id",
    true
  );
  await gravarEmLotes(admin, "product_costs", custosDosProdutos(), "store_id,sku,valido_desde", true);
  await gravarEmLotes(
    admin,
    "tracking_configs",
    [
      {
        store_id: LOJA_ID,
        user_id: ARTHUR,
        enabled: true,
        meta_pixel_id: DESTINO_META.conta,
        google_conversion_id: DESTINO_GOOGLE.conta,
        google_conversion_label: DESTINO_GOOGLE.labels.purchase,
        google_labels: DESTINO_GOOGLE.labels,
        created_at: RASTREAMENTO_DESDE,
        updated_at: RASTREAMENTO_DESDE,
      },
    ],
    "store_id",
    true
  );
  await gravarEmLotes(
    admin,
    "tracking_destinations",
    [
      { id: DESTINO_META.id, store_id: LOJA_ID, user_id: ARTHUR, plataforma: "meta", nome: DESTINO_META.nome, conta: DESTINO_META.conta, labels: {}, ativo: true, created_at: RASTREAMENTO_DESDE, updated_at: RASTREAMENTO_DESDE },
      { id: DESTINO_GOOGLE.id, store_id: LOJA_ID, user_id: ARTHUR, plataforma: "google", nome: DESTINO_GOOGLE.nome, conta: DESTINO_GOOGLE.conta, labels: DESTINO_GOOGLE.labels, ativo: true, created_at: RASTREAMENTO_DESDE, updated_at: RASTREAMENTO_DESDE },
    ],
    "id",
    true
  );
  // Token inventado: so a EXISTENCIA aparece na tela. O app nao o usa (074).
  await gravarEmLotes(
    admin,
    "tracking_destination_secrets",
    [{ destination_id: DESTINO_META.id, access_token: `EAA${aleatorio(90)}`, updated_at: RASTREAMENTO_DESDE }],
    "destination_id",
    true
  );
  await gravarEmLotes(
    admin,
    "ad_accounts",
    contasDaLoja().map((c) => ({ ...c, created_at: CONTAS_DESDE, updated_at: CONTAS_DESDE })),
    "id",
    true
  );
  await gravarEmLotes(
    admin,
    "ad_account_secrets",
    [
      { ad_account_id: CONTA_META.id, meta_access_token: `EAA${aleatorio(90)}`, updated_at: CONTAS_DESDE },
      { ad_account_id: CONTA_GOOGLE.id, ingest_token_hash: sha256(aleatorio(32)), updated_at: CONTAS_DESDE },
    ],
    "ad_account_id",
    true
  );
}

async function gravarDados(admin: Admin, s: Semeadura, desde: string, desdeFunil: string | null) {
  const novoDia = (dia: string) => dia >= desde;
  const pedidos = s.pedidos.filter((p) => novoDia(p.dia_local));
  const ids = new Set(pedidos.map((p) => p.shopify_order_id));
  await gravarEmLotes(admin, "fin_orders", pedidos, "store_id,shopify_order_id");
  await gravarEmLotes(admin, "fin_order_origem", s.origens.filter((o) => ids.has(o.shopify_order_id)), "store_id,shopify_order_id");
  await gravarEmLotes(admin, "tracking_events", s.compras.filter((c) => ids.has(c.order_id)), "id");
  const funil = desdeFunil ? s.funil.filter((e) => e.created_at > desdeFunil) : s.funil;
  await gravarEmLotes(admin, "tracking_events", funil, "id");
  await gravarEmLotes(admin, "ad_spend_daily", s.linhasGasto.filter((g) => novoDia(g.data)), "ad_account_id,data,nivel,campanha_id");

  // Funil fora da janela sai (a compra fica: o Pedidos e o Rastreamento leem).
  const corte = new Date(instanteLocal(somarDia(s.hoje, -(DIAS_DE_FUNIL - 1)), 0)).toISOString();
  const { error: erroFunil } = await admin.from("tracking_events").delete().eq("store_id", LOJA_ID).in("event_name", FUNIL).lt("created_at", corte);
  if (erroFunil) falhar(`tracking_events (funil antigo): ${erroFunil.message}`);

  // Campanhas: o retrato de hoje, e so ele (a tela nao filtra por data).
  const gastoHoje = s.gastos.find((g) => g.dia === s.hoje)!;
  const porId = new Map(s.pedidos.filter((p) => p.dia_local === s.hoje).map((p) => [p.shopify_order_id, p]));
  const brl = (await lerCambio(admin, s.hoje, s.hoje)).linhas.filter((l) => l.moeda === "BRL").pop();
  const granular = granularDeHoje(gastoHoje, s.hoje, porId, custosDosProdutos(), paraNumero(brl?.por_usd) || 5.4, new Date(s.agoraMs).toISOString());
  const { error: erroGran } = await admin.from("ad_insights_granular").delete().in("ad_account_id", [CONTA_META.id, CONTA_GOOGLE.id]).neq("data", s.hoje);
  if (erroGran) falhar(`ad_insights_granular (dias antigos): ${erroGran.message}`);
  await gravarEmLotes(admin, "ad_insights_granular", granular, "ad_account_id,data,nivel,objeto_id");
}

/** A hora das leituras: o que a tela usa para "Atualizado ha X" e para o pixel ativo. */
async function gravarFrescor(admin: Admin, agoraMs: number) {
  const ha = (min: number) => new Date(agoraMs - min * 60_000).toISOString();
  const { count } = await admin.from("fin_orders").select("store_id", { count: "exact", head: true }).eq("store_id", LOJA_ID);
  const { error: e1 } = await admin.from("fin_sync_state").upsert(
    {
      store_id: LOJA_ID,
      user_id: ARTHUR,
      fuso: FUSO,
      moeda: MOEDA,
      cursor_atualizado: ha(2),
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
  if (e1) falhar(`fin_sync_state: ${e1.message}`);
  const { error: e2 } = await admin
    .from("ad_accounts")
    .update({ ultimo_sync_em: ha(2), ultimo_sync_ok_em: ha(2), ultimo_reprocesso_em: ha(240), sincronizando_desde: null, ultimo_erro: null, updated_at: ha(2) })
    .eq("id", CONTA_META.id);
  if (e2) falhar(`ad_accounts (Meta): ${e2.message}`);
  const { error: e3 } = await admin
    .from("ad_accounts")
    .update({ ultimo_sync_em: ha(17), ultimo_sync_ok_em: ha(17), ultimo_dado_gerado_em: ha(19), ultimo_erro: null, updated_at: ha(17) })
    .eq("id", CONTA_GOOGLE.id);
  if (e3) falhar(`ad_accounts (Google): ${e3.message}`);
  const { error: e4 } = await admin
    .from("tracking_configs")
    .update({ web_pixel_visto_em: ha(1), web_pixel_com_id_em: ha(1) })
    .eq("store_id", LOJA_ID);
  if (e4) falhar(`tracking_configs: ${e4.message}`);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

async function semear() {
  const dryRun = tem("--dry-run");
  const tudo = tem("--tudo");
  const aoVivo = tem("--ao-vivo") ? Math.max(15, Number(valorDe("--ao-vivo") ?? 60)) : null;
  const admin = conectar(dryRun);
  if (!admin && !dryRun) falhar("sem NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (rode da raiz, com o .env.local, ou XCART_ENV=...).");
  if (!admin) console.log("Sem credencial do banco: --dry-run com cambio de reserva.");

  const estado = admin ? await conferirAntes(admin, dryRun) : { existe: false, ultimoDia: null, ultimoFunil: null };
  const agoraMs = Date.now();
  const hoje = diaLocal(agoraMs);
  const fx = await lerCambio(admin, LANCAMENTO, hoje);
  const cambio = montarCambio(fx.linhas);
  const s = montar(agoraMs, cambio, fx.linhas);
  const desde = tudo || !estado.ultimoDia ? LANCAMENTO : [LANCAMENTO, somarDia(estado.ultimoDia, -DIAS_REGRAVADOS)].sort().pop()!;

  if (dryRun) {
    resumir(s, fx.linhas, fx.doBanco);
    console.log(
      `\n--dry-run: nada foi gravado. A loja ${estado.existe ? `existe (ultimo dia gravado ${estado.ultimoDia ?? "-"}); seriam regravados os dias desde ${desde}` : "ainda nao existe; seria criada com os dias desde " + LANCAMENTO}.`
    );
    return;
  }

  console.log(`\nSemeando ${NOME_LOJA} (${DOMINIO}) ate ${new Date(agoraMs).toISOString()} -- dias desde ${desde}`);
  await gravarBase(admin!, estado.existe);
  await gravarDados(admin!, s, desde, tudo ? null : estado.ultimoFunil ? new Date(Date.parse(estado.ultimoFunil) - 15 * 60_000).toISOString() : null);
  await gravarFrescor(admin!, agoraMs);
  const hojeNoPlano = s.porDia.get(s.hoje)!;
  console.log(`\nPronto. Pedidos ate #${s.pedidos.reduce((m, p) => Math.max(m, Number(String(p.nome).slice(1)) || 0), 0)}; meta de lucro de hoje ${n2(hojeNoPlano.meta)} (dia inteiro).`);

  if (aoVivo) {
    console.log(`\nAo vivo: completando hoje a cada ${aoVivo} s. Ctrl+C para parar.`);
    for (;;) {
      await new Promise((ok) => setTimeout(ok, aoVivo * 1000));
      const agora = Date.now();
      const est = await conferirAntes(admin!, false);
      const fxv = await lerCambio(admin!, LANCAMENTO, diaLocal(agora));
      const sv = montar(agora, montarCambio(fxv.linhas), fxv.linhas);
      // Hoje (e ontem, na virada do dia), e o funil desde o ultimo evento gravado.
      await gravarDados(admin!, sv, somarDia(sv.hoje, -1), est.ultimoFunil ? new Date(Date.parse(est.ultimoFunil) - 15 * 60_000).toISOString() : null);
      await gravarFrescor(admin!, agora);
      const hojePedidos = sv.pedidos.filter((p) => p.dia_local === sv.hoje);
      console.log(`  ${new Date(agora).toISOString()}: ${hojePedidos.length} pedidos hoje, receita ${n2(hojePedidos.reduce((t, p) => t + receitaDoPedido(p), 0))}`);
    }
  }
}

async function limpar() {
  const confirmado = valorDe("--confirmar");
  const admin = conectar(!confirmado);
  if (!admin) falhar("sem credencial do banco (rode da raiz, com o .env.local, ou XCART_ENV=...).");
  const { data: lojas, error } = await admin.from("stores").select("id, name, shop_domain").eq("user_id", ARTHUR).eq("demonstracao", true);
  if (error) falhar(ehColunaAusente(error) ? "a migration 074 nao esta aplicada: nao ha loja de demonstracao." : `stores: ${error.message}`);
  if (!lojas?.length) {
    console.log("Nenhuma loja de demonstracao na conta do Arthur. Nada a fazer.");
    return;
  }
  const ids = lojas.map((l) => l.id as string);
  const contar = async (tabela: string, coluna = "store_id") => {
    const { count, error: e } = await admin.from(tabela).select(coluna, { count: "exact", head: true }).in(coluna, ids);
    if (e) falhar(`${tabela}: ${e.message}`);
    return count ?? 0;
  };
  const { data: contas } = await admin.from("ad_accounts").select("id").in("store_id", ids);
  const contaIds = (contas ?? []).map((c) => c.id as string);
  const contarContas = async (tabela: string) => {
    if (!contaIds.length) return 0;
    const { count } = await admin.from(tabela).select("ad_account_id", { count: "exact", head: true }).in("ad_account_id", contaIds);
    return count ?? 0;
  };
  const tabelas = ["fin_orders", "fin_order_origem", "tracking_events", "product_costs", "fin_sync_state", "fin_store_settings", "tracking_configs", "tracking_destinations", "alertas", "demonstracao_catalogo"];
  const antes: Record<string, number> = {};
  for (const t of tabelas) antes[t] = await contar(t);
  antes.ad_accounts = contaIds.length;
  antes.ad_spend_daily = await contarContas("ad_spend_daily");
  antes.ad_insights_granular = await contarContas("ad_insights_granular");

  console.log(`\nLojas de demonstracao: ${lojas.map((l) => `${l.name} · ${l.shop_domain} (${l.id})`).join(", ")}`);
  for (const [t, n] of Object.entries(antes)) console.log(`  ${t}: ${n0(n)}`);

  if (!confirmado) {
    console.log(`\nNada foi apagado. Para apagar: npm run op -- scripts/demo-loja.ts limpar --confirmar ${lojas[0].shop_domain}`);
    return;
  }
  if (!lojas.some((l) => l.shop_domain === confirmado)) falhar(`--confirmar ${confirmado} nao e o dominio de uma loja de demonstracao.`);
  const alvo = lojas.filter((l) => l.shop_domain === confirmado).map((l) => l.id as string);

  // 1) Contas primeiro: a FK delas e ON DELETE SET NULL, e sem isto ficariam
  //    orfas em Integracoes. Levam gasto, campanhas e segredos (cascade).
  const { error: e1 } = await admin.from("ad_accounts").delete().in("store_id", alvo);
  if (e1) falhar(`ad_accounts: ${e1.message}`);
  // 2) A fila em pedacos (a maior tabela), para nenhum DELETE estourar o tempo.
  for (let dia = LANCAMENTO; dia <= somarDia(diaLocal(Date.now()), 1); dia = somarDia(dia, 7)) {
    const { error: e } = await admin.from("tracking_events").delete().in("store_id", alvo).lt("created_at", `${somarDia(dia, 7)}T00:00:00Z`);
    if (e) falhar(`tracking_events: ${e.message}`);
  }
  // 3) A loja: o resto vai junto (cascade).
  const { error: e2 } = await admin.from("stores").delete().in("id", alvo).eq("user_id", ARTHUR).eq("demonstracao", true);
  if (e2) falhar(`stores: ${e2.message}`);

  // 4) Conferir.
  let sobrou = 0;
  for (const t of tabelas) sobrou += await contar(t);
  const { count: contasRestantes } = await admin.from("ad_accounts").select("id", { count: "exact", head: true }).in("id", contaIds.length ? contaIds : ["00000000-0000-0000-0000-000000000000"]);
  const { count: lojasRestantes } = await admin.from("stores").select("id", { count: "exact", head: true }).in("id", alvo);
  sobrou += (contasRestantes ?? 0) + (lojasRestantes ?? 0);
  if (sobrou > 0) falhar(`sobraram ${sobrou} linhas. Confira com SELECT.`);
  console.log(`\nApagado: ${confirmado} e tudo dela. Conferido: zero linhas restantes.`);
}

(async () => {
  if (comando === "semear") await semear();
  else if (comando === "limpar") await limpar();
  else {
    console.log("Uso: npm run op -- scripts/demo-loja.ts semear [--dry-run] [--tudo] [--ao-vivo 60] | limpar [--confirmar <dominio>]");
    process.exit(comando ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
