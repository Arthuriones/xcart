/**
 * Loja de demonstracao na conta do Arthur: pedidos, custos, gasto de anuncio,
 * origem por campanha e eventos de rastreamento gravados direto no banco, sem
 * Shopify, Meta ou Google por tras (migration 074, src/lib/demonstracao/).
 *
 * A loja e marcada (stores.demonstracao): o app nao chama nada de fora por
 * ela, nao abre alerta e nao a sincroniza com a Shopify. Quem a mantem em dia
 * e o cron api/jobs/demonstracao (15 em 15 min, src/lib/demonstracao/
 * atualizar.ts): completa ate agora pelo MESMO gerador daqui
 * (src/lib/demonstracao/plano.ts, linhas.ts, semeadura.ts, gravacao.ts) e
 * apaga, uma vez por dia, o que saiu das janelas. Este script cria a loja,
 * sobe as fotos, mede o espaco, regrava de uma vez e apaga a loja.
 *
 * ORDEM (a primeira vez):
 *   1. Aplicar a migration 074 (SQL editor) e conferir com os SELECTs do fim dela.
 *   2. Merge na main e deploy de PRODUCAO da Vercel em READY -- uma build com
 *      src/lib/demonstracao/ (commit 2be37b1 ou depois). Sem ela no ar, o
 *      cron de 15 min trata a loja como real: chama a Shopify e o Meta com a
 *      credencial inventada, grava "Token invalido" na loja, abre alerta e
 *      manda pelo Telegram; o coletor antigo aceita evento para ela. Vale para
 *      qualquer instancia rodando os crons no mesmo banco (Docker).
 *   3. So entao o `semear --app-publicado`.
 *   Antes de um rollback da Vercel para uma build anterior a 2be37b1: `limpar`.
 *
 * Uso (da raiz do repo, com o .env.local):
 *   npm run op -- scripts/demo-loja.ts semear --dry-run                   resumo por dia e espaco no banco; NAO grava (le o banco so com SELECT)
 *   npm run op -- scripts/demo-loja.ts semear --app-publicado             cria a loja se faltar, completa ate agora e apaga o que saiu da janela
 *                                                                          (confere com o banco desde 20 dias antes da ultima rodada que fechou --
 *                                                                          ou a janela inteira, se o fuso gravado nao e o do gerador -- e grava
 *                                                                          so o que difere)
 *   npm run op -- scripts/demo-loja.ts semear --app-publicado --tudo      regrava a janela inteira sem conferir (formato novo de linha)
 *   npm run op -- scripts/demo-loja.ts semear --app-publicado --ao-vivo 60  depois, a rodada do cron a cada 60 s, ate Ctrl+C
 *   npm run op -- scripts/demo-loja.ts semear --app-publicado --imagens <pasta>
 *       sobe <pasta>/<SKU>.jpg|jpeg|png|webp (miniatura de 192 px) para o bucket
 *       publico product-images e grava a foto de Custos (demonstracao_catalogo)
 *   npm run op -- scripts/demo-loja.ts limpar                             mostra o que sairia
 *   npm run op -- scripts/demo-loja.ts limpar --confirmar <dominio.myshopify.com>
 *
 * Fora da raiz: XCART_ENV=<caminho do .env.local>.
 *
 * O BANCO E PEQUENO: producao esta no plano free do Supabase (500 MB; cheio,
 * fica so leitura e para webhook, coletor e roteamento das lojas reais). A
 * loja guarda so janelas que rolam (semeadura.ts): pedidos, origem e gasto
 * desde o dia 1 do mes retrasado (60 a 92 dias: o periodo atual e o anterior
 * de todo periodo do app), Purchase dos ultimos 35 dias ou desde o dia 1 do
 * mes anterior (35 a 62 dias) e o funil das ultimas 48 h. O semear de verdade
 * mede a carga no banco (tamanho.ts, so SELECT) e RECUSA gravar se ela passar
 * de 70 MB ou se o banco mais ela passar de 400 MB. O cron nao usa a
 * Management API: a trava dele e a contagem de linhas da loja por tabela
 * (TETO_DE_LINHAS, gravacao.ts).
 *
 * Re-executavel e idempotente: os ids sao fixos (uuid v5 da semente) e cada
 * dia nasce do mesmo sorteio, entao rodar de novo da o mesmo dado e completa
 * o dia de hoje ate a hora atual. O script e o cron gravam pelas mesmas
 * funcoes: um em cima do outro nao duplica nada.
 */
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "dotenv";
import sharp from "sharp";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { calcularFinanceiro } from "../src/lib/financeiro/calculo";
import { paraNumero, type FxRateRow } from "../src/lib/financeiro/tipos";
import {
  ARTHUR,
  CATALOGO,
  CONTA_GOOGLE,
  CONTA_META,
  CONTAS_DESDE,
  DESTINO_GOOGLE,
  DESTINO_META,
  DOMINIO,
  FUSO,
  HORAS_DE_FUNIL,
  LANCAMENTO,
  LOJA_CONECTADA_EM,
  LOJA_ID,
  MAIOR_JANELA,
  MAIOR_JANELA_DE_COMPRA,
  MOEDA,
  NOME_LOJA,
  RASTREAMENTO_DESDE,
  diaDaSemana,
  diaLocal,
  diasEntre,
  inicioDaJanela,
  instanteLocal,
  sha256,
  somarDia,
} from "../src/lib/demonstracao/plano";
import { cotacaoBrl, custosDosProdutos, montarCambio } from "../src/lib/demonstracao/linhas";
import { configLoja, contasDaLoja, granularDe, intervalosDaJanela, lojaFinanceira, montar, type Semeadura } from "../src/lib/demonstracao/semeadura";
import { lerCambio, lerEstado, planejar, type Estado, type Modo, type Pendente } from "../src/lib/demonstracao/gravacao";
import { atualizarLoja, modoDoScript, semearAgora } from "../src/lib/demonstracao/atualizar";
import { LIMITE_DA_CARGA, LIMITE_DO_BANCO, conferirEspaco, estimarCarga, mb, type Estimativa, type ParteDaCarga } from "./demo-loja/tamanho";

config({ path: process.env.XCART_ENV || ".env.local" });

const args = process.argv.slice(2);
const comando = args[0];
const tem = (flag: string) => args.includes(flag);
const valorDe = (flag: string): string | null => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};

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
      if (p === "storage") {
        // Listar pode (o limpar sem --confirmar conta as fotos); subir e apagar, nao.
        return {
          from: (bucket: string) => {
            const b = alvo.storage.from(bucket);
            return new Proxy(b, {
              get(x, m) {
                if (m !== "list" && m !== "getPublicUrl") return bloquear(`storage.${String(m)} em ${bucket}`);
                const v = Reflect.get(x, m);
                return typeof v === "function" ? v.bind(x) : v;
              },
            });
          },
        };
      }
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
// Resumo (a conta do app sobre o que seria gravado)
// ---------------------------------------------------------------------------

const SEMANA = ["dom", "seg", "ter", "qua", "qui", "sex", "sab"];
const n0 = (v: number) => Math.round(v).toLocaleString("pt-BR");
const n2 = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pad = (s: string, n: number) => s.padStart(n);
const iso = (ms: number) => new Date(ms).toISOString();

/**
 * O funil de ontem (o dia fechado dentro das 48 h): sessoes, conversao,
 * carrinho e quanto dos cliques do Meta virou sessao.
 */
function resumirFunil(s: Semeadura) {
  const ontem = somarDia(s.hoje, -1);
  if (instanteLocal(ontem, 0) < s.cortes.funil) return;
  const sessoes = new Map<string, { atc: boolean; ic: boolean; meta: boolean }>();
  let eventos = 0;
  for (const e of s.funil) {
    if (diaLocal(Date.parse(e.created_at)) !== ontem) continue;
    eventos += 1;
    const k = String(e.visitor_id);
    const x = sessoes.get(k) ?? { atc: false, ic: false, meta: false };
    if (e.event_name === "add_to_cart") x.atc = true;
    if (e.event_name === "begin_checkout") x.ic = true;
    if (e.event_name === "view_item" && String(e.payload.event_source_url ?? "").includes("utm_source=FB")) x.meta = true;
    sessoes.set(k, x);
  }
  const compras = s.pedidos.filter((p) => p.tipo === "venda" && paraNumero(p.total_bruto) > 0 && p.dia_local === ontem).length;
  const cliquesMeta = s.gastos
    .filter((g) => g.dia === ontem)
    .reduce((t, g) => t + g.campanhas.filter((c) => c.campanha.plataforma === "meta").reduce((a, c) => a + c.cliques, 0), 0);
  const lista = [...sessoes.values()];
  const n = Math.max(1, lista.length);
  const pct = (v: number) => `${((v / n) * 100).toFixed(1)}%`;
  const doMeta = lista.filter((x) => x.meta).length;
  console.log(
    `  funil de ontem (${ontem}): ${n0(lista.length)} sessoes · ${n0(eventos)} eventos · compra ${pct(compras)} das sessoes · carrinho ${pct(lista.filter((x) => x.atc).length)} · checkout ${pct(lista.filter((x) => x.ic).length)} · sessoes do Meta ${((doMeta / Math.max(1, cliquesMeta)) * 100).toFixed(0)}% dos cliques do Meta`
  );
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
    intervalos: intervalosDaJanela(s.cortes.janela, s.hoje),
    moeda: "USD",
    hoje: s.hoje,
    agoraMs: s.agoraMs,
  });

  console.log(`\nLoja de demonstracao: ${NOME_LOJA} · ${DOMINIO} (id ${LOJA_ID})`);
  console.log(`Agora: ${iso(s.agoraMs)} · hoje no fuso da loja (${FUSO}): ${s.hoje}`);
  console.log(
    `Janelas: pedidos/origem/gasto desde ${s.cortes.janela} (${diasEntre(s.cortes.janela, s.hoje).length} dias) · Purchase desde ${iso(s.cortes.compras)} (${diasDeCompra(s)} dias) · funil desde ${iso(s.cortes.funil)} (${HORAS_DE_FUNIL} h)`
  );
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
  console.log(`  AOV (ticket, receita/pedido) ${n2(t.ticket ?? 0)} · ROAS ${t.roas?.toFixed(2)} · ROAS de equilibrio ${t.roasEquilibrio?.toFixed(2)} · margem ${pct(t.lucro, t.receita)} · CPA ${n2(t.cpa ?? 0)} · reenvios ${t.reenvios} · cobertura de custo ${pct(t.coberturaCusto ?? 0, 1)}`);
  console.log(`  cancelados ${pct(cancelados, vendas.length)} · com reembolso ${pct(reembolsados, vendas.length)}`);
  console.log(`  origem: ${[...origemPor].map(([k, v]) => `${k} ${pct(v, vendas.length)}`).join(" · ")} · sem jornada ${pct(semOrigem, vendas.length)}`);
  console.log(`  moeda do comprador: ${[...moedaPor].map(([k, v]) => `${k} ${pct(v, vendas.length)}`).join(" · ")}`);
  console.log(`  gateway: ${[...gatewayPor].map(([k, v]) => `${k} ${pct(v, vendas.length)}`).join(" · ")}`);
  resumirFunil(s);
  const avisos = r.avisos;
  if (avisos.moedasSemCotacao.length || avisos.lojasSemTaxa.length || avisos.lojasSemCustoPadraoComFalta.length || avisos.fusosDiferentes.length) {
    console.log(`  AVISOS do calculo: ${JSON.stringify(avisos)}`);
  }
  const numeros = s.pedidos.map((p) => Number(String(p.nome).slice(1)) || 0).filter((n) => n > 0);
  console.log(`  pedidos na janela: #${Math.min(...numeros)} a #${Math.max(...numeros)}`);

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
    const brl = cotacaoBrl(fx);
    const granular = granularDe(s, brl);
    console.log(`\n--- ad_insights_granular: ${granular.length} linhas (BRL ${brl})`);
    um("ad_insights_granular (anuncio no ar)", granular.find((g) => g.nivel === "anuncio" && g.objeto_status === "ACTIVE" && g.vendas > 0));
    um("ad_insights_granular (conta Meta)", granular.find((g) => g.nivel === "conta"));
  }
}

// ---------------------------------------------------------------------------
// Espaco no banco (tamanho.ts: so SELECT)
// ---------------------------------------------------------------------------

/** Os dias locais com Purchase na fila, contando hoje (35 a 62). */
function diasDeCompra(s: Semeadura): number {
  return diasEntre(diaLocal(s.cortes.compras), s.hoje).length;
}

const ROTULO_COMPRAS = "tracking_events: Purchase";

/** O que a loja ocupa nas tabelas que crescem (a loja, as contas e a config sao umas poucas linhas). */
function partesDaCarga(s: Semeadura, brl: number): ParteDaCarga[] {
  return [
    { rotulo: "fin_orders", tabela: "fin_orders", linhas: s.pedidos },
    { rotulo: "fin_order_origem", tabela: "fin_order_origem", linhas: s.origens },
    { rotulo: `${ROTULO_COMPRAS} (${diasDeCompra(s)} d)`, tabela: "tracking_events", linhas: s.compras },
    { rotulo: `tracking_events: funil (${HORAS_DE_FUNIL} h)`, tabela: "tracking_events", linhas: s.funil },
    { rotulo: "ad_spend_daily", tabela: "ad_spend_daily", linhas: s.linhasGasto },
    { rotulo: "ad_insights_granular (hoje)", tabela: "ad_insights_granular", linhas: granularDe(s, brl) },
    { rotulo: "product_costs", tabela: "product_costs", linhas: custosDosProdutos() },
    {
      rotulo: "demonstracao_catalogo",
      tabela: "demonstracao_catalogo",
      linhas: CATALOGO.map((i) => ({ store_id: LOJA_ID, sku: i.sku, nome: i.produto, variante: i.variante, imagem: null })),
    },
  ];
}

function imprimirEspaco(e: Estimativa, s: Semeadura) {
  console.log(`\nEspaco no banco (estimado, so SELECT):`);
  console.log(
    `  tupla = pg_column_size da amostra das nossas linhas, no tipo da tabela; disco/linha = tupla x (heap/tupla) + indice/linha, medidos nas linhas reais da tabela (pg_total_relation_size, pg_indexes_size, pg_column_size)`
  );
  console.log(`  ${"tabela".padEnd(36)} ${pad("linhas", 7)} ${pad("tupla", 7)} ${pad("disco/linha", 11)} ${pad("total", 9)}`);
  for (const p of e.partes) {
    const nota = !p.medido ? "  (sem medida: JSON e fatores padrao)" : p.porLinha.padrao ? "  (tabela real pequena: fatores padrao)" : "";
    console.log(
      `  ${p.rotulo.padEnd(36)} ${pad(n0(p.linhas), 7)} ${pad(`${n0(p.tupla)} B`, 7)} ${pad(`${n0(p.porLinha.total)} B`, 11)} ${pad(`${mb(p.bytes)} MB`, 9)}${nota}`
    );
  }
  console.log(`  ${"total".padEnd(36)} ${pad("", 7)} ${pad("", 7)} ${pad("", 11)} ${pad(`${mb(e.total)} MB`, 9)}  (limite da carga ${mb(LIMITE_DA_CARGA)} MB)`);
  // Pedidos, origem e gasto crescem com a janela; Purchase com a janela de
  // compras; o funil (48 h) e o resto nao.
  const dias = diasEntre(s.cortes.janela, s.hoje).length;
  const diasCompra = diasDeCompra(s);
  const escala = (p: (typeof e.partes)[number]) =>
    p.tabela === "fin_orders" || p.tabela === "fin_order_origem" || p.tabela === "ad_spend_daily"
      ? MAIOR_JANELA / dias
      : p.rotulo.startsWith(ROTULO_COMPRAS)
        ? MAIOR_JANELA_DE_COMPRA / diasCompra
        : 1;
  const maior = e.partes.reduce((t, p) => t + p.bytes * escala(p), 0);
  console.log(
    `  nas janelas mais longas (${MAIOR_JANELA} dias de pedidos, ${MAIOR_JANELA_DE_COMPRA} de Purchase; hoje sao ${dias} e ${diasCompra}): ~${mb(maior)} MB`
  );
  if (e.banco !== null) {
    console.log(`  banco agora (pg_database_size): ${mb(e.banco)} MB · banco + carga: ${mb(e.banco + e.total)} MB (limite ${mb(LIMITE_DO_BANCO)} MB)`);
  }
  if (e.erros.length) console.log(`  AVISO: sem medida no banco -- ${e.erros.join("; ")}`);
  const recusa = conferirEspaco(e);
  console.log(recusa ? `  O semear de verdade RECUSARIA: ${recusa}` : `  Cabe: o semear de verdade gravaria.`);
}

// ---------------------------------------------------------------------------
// Gravacao
// ---------------------------------------------------------------------------

async function gravarEmLotes(admin: Admin, tabela: string, linhas: object[], onConflict: string, ignorarExistentes = false, rotulo = "") {
  const tamanho = tabela === "tracking_events" ? 400 : 500;
  for (let i = 0; i < linhas.length; i += tamanho) {
    const lote = linhas.slice(i, i + tamanho);
    const { error } = await admin.from(tabela).upsert(lote, { onConflict, ignoreDuplicates: ignorarExistentes });
    if (error) falhar(`${tabela} (lote ${i / tamanho + 1}): ${error.message}`);
  }
  if (linhas.length) console.log(`  ${tabela}${rotulo ? ` (${rotulo})` : ""}: ${n0(linhas.length)}${ignorarExistentes ? " (so as que faltavam entram)" : ""}`);
}

function aleatorio(n: number): string {
  return randomBytes(n).toString("hex");
}

/**
 * A loja do gerador no banco: existe? Se existe, e a de demonstracao do
 * Arthur (senao nada e gravado). Sem a 074, o semear de verdade recusa.
 */
async function conferirLoja(admin: Admin, dryRun: boolean): Promise<{ existe: boolean }> {
  const { data: loja, error } = await admin.from("stores").select("id, user_id, shop_domain, demonstracao").eq("id", LOJA_ID).maybeSingle();
  if (error) {
    if (ehColunaAusente(error)) {
      if (dryRun) {
        console.log("AVISO: a migration 074 (stores.demonstracao) ainda nao foi aplicada -- o semear de verdade recusa rodar sem ela.");
        return { existe: false };
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
  return { existe: Boolean(loja) };
}

const ESTADO_VAZIO: Estado = { fuso: null, cursorMs: null, temPedidos: false, primeiroDia: null, primeiraCompra: null, ultimoFunil: null };

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
        "Quillmere makes the sleep basics that fix the small things that ruin a night: a contour memory foam pillow for neck pain, a cooling weighted blanket, bamboo sheets, silk sleep masks and complete sleep kits.",
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

// ---------------------------------------------------------------------------
// Fotos do catalogo (opcional): a miniatura de Custos
// ---------------------------------------------------------------------------

const EXTENSOES = [".jpg", ".jpeg", ".png", ".webp"];
const BUCKET_IMAGENS = "product-images";

/** O arquivo de cada SKU na pasta (<SKU>.jpg|jpeg|png|webp, sem diferenca de maiuscula). */
function imagensDaPasta(pasta: string): Map<string, string> {
  if (!existsSync(pasta)) falhar(`--imagens: a pasta ${pasta} nao existe.`);
  const arquivos = readdirSync(pasta);
  const achadas = new Map<string, string>();
  for (const item of CATALOGO) {
    const nome = arquivos.find((a) => EXTENSOES.some((e) => a.toLowerCase() === `${item.sku.toLowerCase()}${e}`));
    if (nome) achadas.set(item.sku, join(pasta, nome));
  }
  return achadas;
}

function conferirImagens(pasta: string) {
  const achadas = imagensDaPasta(pasta);
  const faltam = CATALOGO.filter((i) => !achadas.has(i.sku)).map((i) => i.sku);
  console.log(`\n--imagens: ${achadas.size} de ${CATALOGO.length} SKUs com foto em ${pasta}${faltam.length ? ` (faltam: ${faltam.join(", ")})` : ""}.`);
}

/**
 * Sobe a miniatura (192 px, webp) de cada SKU para o bucket publico do app e
 * grava a URL em demonstracao_catalogo.imagem. SKU sem arquivo fica como
 * esta (a foto que ja tinha continua).
 */
async function gravarImagens(admin: Admin, pasta: string) {
  const achadas = imagensDaPasta(pasta);
  if (achadas.size === 0) falhar(`--imagens: nenhum arquivo <SKU>.jpg|jpeg|png|webp em ${pasta}.`);
  for (const [sku, arquivo] of achadas) {
    const miniatura = await sharp(readFileSync(arquivo)).rotate().resize(192, 192, { fit: "cover" }).webp({ quality: 82 }).toBuffer();
    const caminho = `catalogo/${LOJA_ID}/${sku.toLowerCase()}.webp`;
    const { error: erroUpload } = await admin.storage
      .from(BUCKET_IMAGENS)
      .upload(caminho, miniatura, { contentType: "image/webp", upsert: true, cacheControl: "3600" });
    if (erroUpload) falhar(`foto de ${sku}: ${erroUpload.message}`);
    const url = admin.storage.from(BUCKET_IMAGENS).getPublicUrl(caminho).data.publicUrl;
    if (!url.startsWith("https://")) falhar(`foto de ${sku}: a URL publica nao e https (${url}).`);
    // ?v= muda a URL quando a foto muda: o navegador nao fica com a antiga.
    const comVersao = `${url}?v=${sha256(miniatura.toString("base64")).slice(0, 10)}`;
    const { error } = await admin.from("demonstracao_catalogo").update({ imagem: comVersao }).eq("store_id", LOJA_ID).eq("sku", sku);
    if (error) falhar(`demonstracao_catalogo (${sku}): ${error.message}`);
  }
  console.log(`  demonstracao_catalogo: ${achadas.size} fotos`);
}

// ---------------------------------------------------------------------------
// Comandos
// ---------------------------------------------------------------------------

const ORDEM = `A ordem:
  1. Aplicar a migration 074 (SQL editor) e conferir com os SELECTs do fim dela.
  2. Merge na main e deploy de PRODUCAO da Vercel em READY, com src/lib/demonstracao/
     (commit 2be37b1 ou depois). Nenhuma instancia com codigo anterior (Docker,
     preview com os crons) rodando no mesmo banco.
  3. npm run op -- scripts/demo-loja.ts semear --app-publicado
  Depois disso o cron api/jobs/demonstracao mantem a loja em dia sozinho.

Sem o app novo no ar, o cron de 15 min trata a loja como real: chama a Shopify e o
Meta com a credencial inventada, grava "Token invalido" na loja, abre alerta e manda
pelo Telegram, e o coletor antigo aceita evento para ela.
Antes de um rollback da Vercel para uma build anterior a 2be37b1, rode o limpar.`;

/** O que a rodada gravaria, por tabela. */
function imprimirPlano(p: Pendente, modo: Modo, motivo: string) {
  const linha = (rotulo: string, n: number, novas?: number) =>
    n ? `  ${rotulo.padEnd(30)} ${pad(n0(n), 7)}${novas !== undefined ? `  (${n0(novas)} novas)` : ""}` : null;
  const linhas = [
    linha("fin_orders", p.pedidos.length, p.novas.fin_orders),
    linha("fin_order_origem", p.origens.length, p.soFaltantes.origens ? undefined : p.novas.fin_order_origem),
    linha("tracking_events (Purchase)", p.compras.length),
    linha("tracking_events (funil)", p.funil.length),
    linha("ad_spend_daily", p.gasto.length, p.novas.ad_spend_daily),
    linha("podar: tracking_events", p.podarEventos.length),
    linha("podar: fin_order_origem", p.podarOrigens.length),
  ].filter(Boolean);
  console.log(`\nModo ${modo} (${motivo}). Conferido com o banco, so o que difere:`);
  console.log(linhas.length ? linhas.join("\n") : "  nada -- o banco ja esta como o gerador.");
  if (p.desconhecidos.length) {
    console.log(`  RECUSARIA: ${p.desconhecidos.length} pedido(s) no banco que o gerador nao conhece (ex.: ${p.desconhecidos.slice(0, 3).join(", ")}).`);
  }
}

async function semear() {
  const dryRun = tem("--dry-run");
  const tudo = tem("--tudo");
  const aoVivo = tem("--ao-vivo") ? Math.max(15, Number(valorDe("--ao-vivo") ?? 60)) : null;
  const pastaImagens = valorDe("--imagens");
  if (tem("--imagens") && !pastaImagens) falhar("--imagens pede a pasta: --imagens <pasta com <SKU>.jpg|png|webp>.");
  if (!dryRun && !tem("--app-publicado")) {
    falhar(`o semear grava a loja no banco de producao. Confirme com --app-publicado que o app que a reconhece ja esta no ar.\n\n${ORDEM}`);
  }
  const admin = conectar(dryRun);
  if (!admin && !dryRun) falhar("sem NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (rode da raiz, com o .env.local, ou XCART_ENV=...).");
  if (!admin) console.log("Sem credencial do banco: --dry-run com cambio de reserva.");

  const loja = admin ? await conferirLoja(admin, dryRun) : { existe: false };
  const estado = admin && loja.existe ? await lerEstado(admin) : ESTADO_VAZIO;
  const agoraMs = Date.now();
  const hoje = diaLocal(agoraMs);
  const janela = inicioDaJanela(hoje);
  const fx = admin ? await lerCambio(admin, janela, hoje) : [];
  const s = montar(agoraMs, montarCambio(fx), fx);
  // O script confere no minimo desde DIAS_REGRAVADOS dias antes da ultima
  // rodada que fechou (o "diario" do cron) e limpa as janelas; fuso trocado,
  // comeco faltando ou loja nova: a janela inteira.
  const { modo, motivo } = modoDoScript(estado, agoraMs, tudo);

  // O espaco no banco, medido so com SELECT. O de verdade nao grava sem a
  // medida, nem acima dos limites.
  const espaco = await estimarCarga(partesDaCarga(s, cotacaoBrl(fx)));

  if (dryRun) {
    resumir(s, fx, Boolean(admin));
    imprimirEspaco(espaco, s);
    if (admin && loja.existe) {
      imprimirPlano(await planejar(admin, s, modo, estado, { tudo }), modo, motivo);
      console.log(`\n--dry-run: nada foi gravado. A loja existe (gravada desde ${estado.primeiroDia ?? "-"}, fuso ${estado.fuso ?? "-"}${estado.cursorMs ? `, completa ate ${iso(estado.cursorMs)}` : ""}).`);
    } else {
      console.log(`\n--dry-run: nada foi gravado. A loja ainda nao existe; seria criada com os dias desde ${janela}.`);
    }
    if (pastaImagens) conferirImagens(pastaImagens);
    console.log(`\nPara gravar de verdade: semear --app-publicado. ${ORDEM}`);
    return;
  }

  const recusa = conferirEspaco(espaco);
  if (recusa) {
    imprimirEspaco(espaco, s);
    falhar(`nada foi gravado: ${recusa} Libere espaco no banco (ou rode o limpar) antes.`);
  }
  console.log(`\nEspaco: carga ~${mb(espaco.total)} MB, banco ${mb(espaco.banco!)} MB -> ${mb(espaco.banco! + espaco.total)} MB (limites ${mb(LIMITE_DA_CARGA)} e ${mb(LIMITE_DO_BANCO)} MB).`);
  console.log(`Semeando ${NOME_LOJA} (${DOMINIO}) ate ${iso(agoraMs)} no fuso ${FUSO} -- modo ${modo} (${motivo}), janela desde ${janela}`);
  await gravarBase(admin!, loja.existe);
  if (pastaImagens) await gravarImagens(admin!, pastaImagens);
  const { apagadas, gravadas } = await semearAgora(admin!, s, fx, estado, { tudo });
  for (const [t, n] of Object.entries(apagadas)) if (n) console.log(`  ${t}: ${n0(n)} apagadas (fora da janela)`);
  for (const [t, n] of Object.entries(gravadas)) if (n) console.log(`  ${t}: ${n0(n)}`);
  const hojeNoPlano = s.porDia.get(s.hoje)!;
  console.log(`\nPronto. Pedidos ate #${s.pedidos.reduce((m, p) => Math.max(m, Number(String(p.nome).slice(1)) || 0), 0)}; meta de lucro de hoje ${n2(hojeNoPlano.meta)} (dia inteiro).`);

  if (aoVivo) {
    console.log(`\nAo vivo: a rodada do cron a cada ${aoVivo} s (so o que mudou). Ctrl+C para parar.`);
    for (;;) {
      await new Promise((ok) => setTimeout(ok, aoVivo * 1000));
      const r = await atualizarLoja(admin!, Date.now());
      console.log(`  ${iso(Date.now())}: ${r.pulada ? `PULADA: ${r.pulada}` : `${r.modo} ${JSON.stringify(r.gravadas ?? {})}`} (${r.ms} ms)`);
    }
  }
}

/** Os caminhos das fotos que o --imagens subiu para a loja (catalogo/<id>/). */
async function fotosNoBucket(admin: Admin, lojaId: string): Promise<string[]> {
  const pasta = `catalogo/${lojaId}`;
  const { data, error } = await admin.storage.from(BUCKET_IMAGENS).list(pasta, { limit: 1000 });
  if (error) falhar(`fotos (storage): ${error.message}`);
  return (data ?? []).filter((a) => a.name && a.id).map((a) => `${pasta}/${a.name}`);
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
  const contar = async (tabela: string, coluna = "store_id", de: string[] = ids) => {
    const { count, error: e } = await admin.from(tabela).select(coluna, { count: "exact", head: true }).in(coluna, de);
    if (e) falhar(`${tabela}: ${e.message}`);
    return count ?? 0;
  };
  const { data: contas, error: erroContas } = await admin.from("ad_accounts").select("id").in("store_id", ids);
  if (erroContas) falhar(`ad_accounts: ${erroContas.message}`);
  const contaIds = (contas ?? []).map((c) => c.id as string);
  const contarContas = async (tabela: string, de: string[] = contaIds) => {
    if (!de.length) return 0;
    const { count, error: e } = await admin.from(tabela).select("ad_account_id", { count: "exact", head: true }).in("ad_account_id", de);
    if (e) falhar(`${tabela}: ${e.message}`);
    return count ?? 0;
  };
  const tabelas = ["fin_orders", "fin_order_origem", "tracking_events", "product_costs", "fin_sync_state", "fin_store_settings", "tracking_configs", "tracking_destinations", "alertas", "demonstracao_catalogo"];
  const antes: Record<string, number> = {};
  for (const t of tabelas) antes[t] = await contar(t);
  antes.ad_accounts = contaIds.length;
  antes.ad_spend_daily = await contarContas("ad_spend_daily");
  antes.ad_insights_granular = await contarContas("ad_insights_granular");
  let fotos = 0;
  for (const id of ids) fotos += (await fotosNoBucket(admin, id)).length;
  antes["fotos (storage)"] = fotos;

  console.log(`\nLojas de demonstracao: ${lojas.map((l) => `${l.name} · ${l.shop_domain} (${l.id})`).join(", ")}`);
  for (const [t, n] of Object.entries(antes)) console.log(`  ${t}: ${n0(n)}`);

  if (!confirmado) {
    console.log(`\nNada foi apagado. Para apagar: npm run op -- scripts/demo-loja.ts limpar --confirmar ${lojas[0].shop_domain}`);
    return;
  }
  if (!lojas.some((l) => l.shop_domain === confirmado)) falhar(`--confirmar ${confirmado} nao e o dominio de uma loja de demonstracao.`);
  const alvo = lojas.filter((l) => l.shop_domain === confirmado).map((l) => l.id as string);
  // As contas da loja confirmada, lidas ANTES de apagar: a conferencia do fim
  // olha so ela (outra loja de demonstracao, se houver, fica como esta).
  const { data: contasDoAlvo, error: erroContasAlvo } = await admin.from("ad_accounts").select("id").in("store_id", alvo);
  if (erroContasAlvo) falhar(`ad_accounts: ${erroContasAlvo.message}`);
  const contaIdsAlvo = (contasDoAlvo ?? []).map((c) => c.id as string);

  // 1) Contas primeiro: a FK delas e ON DELETE SET NULL, e sem isto ficariam
  //    orfas em Integracoes. Levam gasto, campanhas e segredos (cascade).
  const { error: e1 } = await admin.from("ad_accounts").delete().in("store_id", alvo);
  if (e1) falhar(`ad_accounts: ${e1.message}`);
  // 2) A fila em pedacos (a maior tabela), para nenhum DELETE estourar o tempo.
  for (let dia = LANCAMENTO; dia <= somarDia(diaLocal(Date.now()), 1); dia = somarDia(dia, 7)) {
    const { error: e } = await admin.from("tracking_events").delete().in("store_id", alvo).lt("created_at", `${somarDia(dia, 7)}T00:00:00Z`);
    if (e) falhar(`tracking_events: ${e.message}`);
  }
  // 3) As fotos do catalogo (--imagens), se subiram: o storage nao tem cascade.
  for (const id of alvo) {
    const caminhos = await fotosNoBucket(admin, id);
    if (!caminhos.length) continue;
    const { error: e } = await admin.storage.from(BUCKET_IMAGENS).remove(caminhos);
    if (e) falhar(`fotos (storage): ${e.message}`);
  }
  // 4) A loja: o resto vai junto (cascade).
  const { error: e2 } = await admin.from("stores").delete().in("id", alvo).eq("user_id", ARTHUR).eq("demonstracao", true);
  if (e2) falhar(`stores: ${e2.message}`);

  // 5) Conferir: so a loja confirmada e as contas dela.
  let sobrou = 0;
  for (const t of tabelas) sobrou += await contar(t, "store_id", alvo);
  if (contaIdsAlvo.length) {
    const { count: contasRestantes, error: e3 } = await admin.from("ad_accounts").select("id", { count: "exact", head: true }).in("id", contaIdsAlvo);
    if (e3) falhar(`ad_accounts: ${e3.message}`);
    sobrou += contasRestantes ?? 0;
    for (const t of ["ad_spend_daily", "ad_insights_granular"]) sobrou += await contarContas(t, contaIdsAlvo);
  }
  const { count: lojasRestantes, error: e4 } = await admin.from("stores").select("id", { count: "exact", head: true }).in("id", alvo);
  if (e4) falhar(`stores: ${e4.message}`);
  sobrou += lojasRestantes ?? 0;
  for (const id of alvo) sobrou += (await fotosNoBucket(admin, id)).length;
  if (sobrou > 0) falhar(`sobraram ${sobrou} linhas da loja ${confirmado}. Confira com SELECT.`);
  console.log(`\nApagado: ${confirmado} e tudo dela. Conferido: zero linhas restantes.`);
}

(async () => {
  if (comando === "semear") await semear();
  else if (comando === "limpar") await limpar();
  else {
    console.log(
      "Uso: npm run op -- scripts/demo-loja.ts semear --dry-run | semear --app-publicado [--tudo] [--ao-vivo 60] [--imagens <pasta>] | limpar [--confirmar <dominio>]"
    );
    process.exit(comando ? 1 : 0);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
