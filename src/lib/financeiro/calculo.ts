import { TAXAS_BRL } from "@/lib/sales/cambio";
import {
  chaveSku,
  custoVigente,
  diasDoIntervalo,
  paraNumero,
  pedidoConta,
  pedidoTemCusto,
  qtdParaCusto,
  receitaDoPedido,
  somarDias,
  type AdAccountRow,
  type AdSpendDailyRow,
  type FinOrderRow,
  type FinStoreSettingsRow,
  type FxRateRow,
  type Intervalo,
  type LojaDoSeletor,
  type MoedaRelatorio,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Motor do Lucro. Puro: recebe as linhas do banco, devolve os totais.
//
// Fica separado da leitura (queries.ts) para ser testado com fixture pequena --
// e a conta que o lojista usa para decidir se escala ou desliga anuncio, entao
// cada regra aqui tem teste em tests/financeiro-calculo.test.ts.
//
// Valores chegam na moeda ORIGINAL (a da loja para pedido e custo, a da conta
// para gasto) e so viram a moeda do relatorio aqui, pela cotacao do dia de
// cada valor. Converter na gravacao congelaria a cotacao errada.
// ============================================================================

/**
 * ROAS real abaixo de 1,2x o de equilibrio = "no limite". O 1,2 e palpite da
 * pesquisa (margem para devolucao e chargeback que ainda nao chegaram), nao
 * regra da plataforma: fica constante para ser ajustado num lugar so.
 */
export const LIMITE_AMARELO = 1.2;

/** Fim de semana e feriado nao tem cotacao: vale a ultima ate N dias antes. */
export const DIAS_MAX_COTACAO = 10;

export type Semaforo = "verde" | "amarelo" | "vermelho" | "cinza";

export interface Totais {
  pedidos: number;
  receita: number;
  /** Custo de produtos: produto + frete do fornecedor. */
  cmv: number;
  taxas: number;
  gastoMeta: number;
  gastoGoogle: number;
  gasto: number;
  lucro: number;
  roas: number | null;
  roasEquilibrio: number | null;
  margem: number | null;
  cpa: number | null;
  ticket: number | null;
  reenvios: number;
  /** Fracao (0..1) do valor vendido que tem custo cadastrado. */
  coberturaCusto: number | null;
}

export type LinhaLoja = Totais & {
  storeId: string;
  nome: string;
  dominio: string;
  moedaLoja: string | null;
  fuso: string | null;
  semaforo: Semaforo;
};

export type LinhaDia = Totais & { dia: string; parcial: boolean };

export interface Avisos {
  cambioAproximado: boolean;
  moedasSemCotacao: string[];
  lojasSemTaxa: string[];
  lojasSemCustoPadraoComFalta: string[];
  fusosDiferentes: { conta: string; fusoConta: string; loja: string; fusoLoja: string }[];
}

export interface ResultadoFinanceiro {
  moeda: MoedaRelatorio;
  intervalos: { atual: Intervalo; anterior: Intervalo };
  atual: Totais;
  anterior: Totais;
  porLoja: LinhaLoja[];
  porDia: LinhaDia[];
  avisos: Avisos;
}

export type LojaFinanceira = LojaDoSeletor & { fuso: string | null; moeda: string | null };

export interface EntradaFinanceiro {
  lojas: LojaFinanceira[];
  pedidos: FinOrderRow[];
  custos: ProductCostRow[];
  configs: FinStoreSettingsRow[];
  contas: AdAccountRow[];
  gastos: AdSpendDailyRow[];
  cambio: FxRateRow[];
  intervalos: { atual: Intervalo; anterior: Intervalo };
  moeda: MoedaRelatorio;
  /** "Hoje" no fuso do relatorio: o dia que ainda esta acontecendo. */
  hoje: string;
}

// ---------------------------------------------------------------------------
// Cambio
// ---------------------------------------------------------------------------

export type Conversor = (
  valor: number,
  de: string,
  para: string,
  dia: string
) => { valor: number; aproximado: boolean } | null;

/**
 * Conversor pela cotacao do DIA do valor. Sem cotacao no banco (cron de cambio
 * ainda nao rodou, moeda fora da lista), cai na tabela fixa de
 * src/lib/sales/cambio.ts marcando `aproximado` -- a tela avisa. Sem nenhuma
 * das duas: null, e quem chama deixa o valor de fora em vez de somar errado.
 */
export function criarConversor(cambio: FxRateRow[]): Conversor {
  const porMoeda = new Map<string, { data: string; porUsd: number }[]>();
  for (const c of cambio) {
    const moeda = String(c.moeda || "").toUpperCase();
    const porUsd = paraNumero(c.por_usd);
    if (!moeda || porUsd <= 0) continue;
    const lista = porMoeda.get(moeda) ?? [];
    lista.push({ data: String(c.data).slice(0, 10), porUsd });
    porMoeda.set(moeda, lista);
  }
  // Mais recente primeiro: a busca para na primeira data <= dia.
  for (const lista of porMoeda.values()) lista.sort((a, b) => (a.data < b.data ? 1 : -1));

  const memo = new Map<string, number | null>();
  const porUsdNoDia = (moeda: string, dia: string): number | null => {
    if (moeda === "USD") return 1;
    const chave = `${moeda}|${dia}`;
    if (memo.has(chave)) return memo.get(chave) ?? null;
    const limite = somarDias(dia, -DIAS_MAX_COTACAO);
    let achado: number | null = null;
    for (const c of porMoeda.get(moeda) ?? []) {
      if (c.data > dia) continue;
      if (c.data >= limite) achado = c.porUsd;
      break;
    }
    memo.set(chave, achado);
    return achado;
  };

  return (valor, de, para, dia) => {
    const origem = String(de || "").toUpperCase();
    const destino = String(para || "").toUpperCase();
    if (origem === destino) return { valor, aproximado: false };
    const a = porUsdNoDia(origem, dia);
    const b = porUsdNoDia(destino, dia);
    if (a && b) return { valor: (valor / a) * b, aproximado: false };
    const brlDe = TAXAS_BRL[origem];
    const brlPara = TAXAS_BRL[destino];
    if (brlDe && brlPara) return { valor: (valor * brlDe) / brlPara, aproximado: true };
    return null;
  };
}

// ---------------------------------------------------------------------------
// Totais
// ---------------------------------------------------------------------------

/** Soma bruta antes dos derivados. As bases de custo dao a cobertura. */
interface Acumulador {
  pedidos: number;
  receita: number;
  cmv: number;
  taxas: number;
  gastoMeta: number;
  gastoGoogle: number;
  reenvios: number;
  baseComCusto: number;
  baseEstimado: number;
  baseSemCusto: number;
}

function acumuladorVazio(): Acumulador {
  return {
    pedidos: 0,
    receita: 0,
    cmv: 0,
    taxas: 0,
    gastoMeta: 0,
    gastoGoogle: 0,
    reenvios: 0,
    baseComCusto: 0,
    baseEstimado: 0,
    baseSemCusto: 0,
  };
}

function somarEm(alvo: Acumulador, parte: Partial<Acumulador>) {
  for (const [k, v] of Object.entries(parte) as [keyof Acumulador, number][]) {
    alvo[k] += v;
  }
}

function totaisDe(a: Acumulador): Totais {
  const gasto = a.gastoMeta + a.gastoGoogle;
  const lucro = a.receita - a.cmv - a.taxas - gasto;
  const cm2 = a.receita - a.cmv - a.taxas;
  const baseTotal = a.baseComCusto + a.baseEstimado + a.baseSemCusto;
  return {
    pedidos: a.pedidos,
    receita: a.receita,
    cmv: a.cmv,
    taxas: a.taxas,
    gastoMeta: a.gastoMeta,
    gastoGoogle: a.gastoGoogle,
    gasto,
    lucro,
    roas: gasto > 0 ? a.receita / gasto : null,
    roasEquilibrio: cm2 > 0 ? a.receita / cm2 : null,
    margem: a.receita > 0 ? lucro / a.receita : null,
    cpa: a.pedidos > 0 && gasto > 0 ? gasto / a.pedidos : null,
    ticket: a.pedidos > 0 ? a.receita / a.pedidos : null,
    reenvios: a.reenvios,
    coberturaCusto: baseTotal > 0 ? a.baseComCusto / baseTotal : null,
  };
}

export function semaforoDe(t: Pick<Totais, "gasto" | "lucro" | "roas" | "roasEquilibrio">): Semaforo {
  if (t.gasto <= 0) return "cinza";
  if (t.lucro < 0) return "vermelho";
  if (t.roas !== null && t.roasEquilibrio !== null && t.roas < LIMITE_AMARELO * t.roasEquilibrio) {
    return "amarelo";
  }
  return "verde";
}

/** "Nome · dominio" sem .myshopify.com: o nome no banco e velho em algumas lojas. */
export function rotuloLoja(l: Pick<LojaDoSeletor, "nome" | "dominio">): string {
  const dominio = String(l.dominio || "").replace(/\.myshopify\.com$/i, "");
  if (!dominio || l.nome === l.dominio || l.nome === dominio) return l.nome || dominio;
  return `${l.nome} · ${dominio}`;
}

function dentro(dia: string, i: Intervalo): boolean {
  return dia >= i.desde && dia <= i.ate;
}

// ---------------------------------------------------------------------------
// Calculo
// ---------------------------------------------------------------------------

export function calcularFinanceiro(e: EntradaFinanceiro): ResultadoFinanceiro {
  const converter = criarConversor(e.cambio);
  const { atual: iAtual, anterior: iAnterior } = e.intervalos;

  const lojaPorId = new Map(e.lojas.map((l) => [l.id, l]));
  const configPorLoja = new Map(e.configs.map((c) => [c.store_id, c]));

  const custosPorSku = new Map<string, ProductCostRow[]>();
  for (const c of e.custos) {
    const chave = `${c.store_id}\u0000${chaveSku(c.sku)}`;
    const lista = custosPorSku.get(chave) ?? [];
    lista.push({ ...c, valido_desde: String(c.valido_desde).slice(0, 10) });
    custosPorSku.set(chave, lista);
  }

  const totAtual = acumuladorVazio();
  const totAnterior = acumuladorVazio();
  const porLoja = new Map<string, Acumulador>();
  const porDia = new Map<string, Acumulador>();
  const diasAtual = diasDoIntervalo(iAtual);
  for (const d of diasAtual) porDia.set(d, acumuladorVazio());
  for (const l of e.lojas) porLoja.set(l.id, acumuladorVazio());

  let cambioAproximado = false;
  const moedasSemCotacao = new Set<string>();
  const lojasSemTaxa = new Set<string>();
  const lojasSemCustoPadraoComFalta = new Set<string>();

  /** Soma `parte` no periodo certo, e (so no atual) na loja e no dia. */
  const lancar = (storeId: string, dia: string, parte: Partial<Acumulador>) => {
    if (dentro(dia, iAtual)) {
      somarEm(totAtual, parte);
      const loja = porLoja.get(storeId);
      if (loja) somarEm(loja, parte);
      const noDia = porDia.get(dia);
      if (noDia) somarEm(noDia, parte);
    } else if (dentro(dia, iAnterior)) {
      somarEm(totAnterior, parte);
    }
  };

  // --- Pedidos ------------------------------------------------------------
  for (const p of e.pedidos) {
    const loja = lojaPorId.get(p.store_id);
    if (!loja) continue;
    // Teste e PDV nao sao venda de anuncio: nem receita, nem custo.
    if (p.tipo === "teste" || p.tipo === "pdv") continue;
    const dia = String(p.dia_local).slice(0, 10);
    if (!dentro(dia, iAtual) && !dentro(dia, iAnterior)) continue;

    const moedaPedido = String(p.moeda || "").toUpperCase();
    // Conversao e linear: o fator de 1 unidade serve para receita, custo,
    // taxa e as bases da cobertura, que estao todos na moeda da loja.
    const fator = converter(1, moedaPedido, e.moeda, dia);
    if (!fator) {
      // Sem cotacao nenhuma: o pedido fica de fora. Somar CLP como se fosse
      // real inflaria o faturamento em ordens de grandeza.
      moedasSemCotacao.add(moedaPedido);
      continue;
    }
    if (fator.aproximado) cambioAproximado = true;

    const receita = receitaDoPedido(p);
    const conta = pedidoConta(p);
    const cfg = configPorLoja.get(p.store_id);
    if (!cfg) lojasSemTaxa.add(rotuloLoja(loja));
    const taxas =
      conta && cfg
        ? (paraNumero(p.recebido) * paraNumero(cfg.taxa_pct)) / 100 + paraNumero(cfg.taxa_fixa)
        : 0;

    let cmv = 0;
    let baseComCusto = 0;
    let baseEstimado = 0;
    let baseSemCusto = 0;
    if (pedidoTemCusto(p)) {
      const pctPadrao =
        cfg && cfg.custo_padrao_pct !== null && cfg.custo_padrao_pct !== undefined
          ? paraNumero(cfg.custo_padrao_pct)
          : null;
      for (const l of Array.isArray(p.linhas) ? p.linhas : []) {
        const q = qtdParaCusto(l, Boolean(p.cancelado_em));
        if (q <= 0) continue;
        const base = paraNumero(l.preco) * q;
        const versao = custoVigente(
          custosPorSku.get(`${p.store_id}\u0000${chaveSku(l.sku)}`) ?? [],
          dia
        );
        if (versao) {
          const bruto = (paraNumero(versao.custo_unitario) + paraNumero(versao.frete_unitario)) * q;
          const c = converter(bruto, versao.moeda, moedaPedido, dia);
          if (c) {
            if (c.aproximado) cambioAproximado = true;
            cmv += c.valor;
            baseComCusto += base;
            continue;
          }
          // Custo numa moeda sem cotacao: vale como "sem custo", com aviso.
          moedasSemCotacao.add(String(versao.moeda).toUpperCase());
        }
        if (pctPadrao !== null) {
          cmv += (base * pctPadrao) / 100;
          baseEstimado += base;
        } else {
          baseSemCusto += base;
          lojasSemCustoPadraoComFalta.add(rotuloLoja(loja));
        }
      }
    }

    const k = fator.valor;
    lancar(p.store_id, dia, {
      pedidos: conta ? 1 : 0,
      reenvios: p.tipo === "reenvio" ? 1 : 0,
      receita: receita * k,
      cmv: cmv * k,
      taxas: taxas * k,
      baseComCusto: baseComCusto * k,
      baseEstimado: baseEstimado * k,
      baseSemCusto: baseSemCusto * k,
    });
  }

  // --- Gasto --------------------------------------------------------------
  const contaPorId = new Map<string, AdAccountRow>();
  const fusosDiferentes: Avisos["fusosDiferentes"] = [];
  for (const c of e.contas) {
    if (!c.store_id || !lojaPorId.has(c.store_id)) continue;
    contaPorId.set(c.id, c);
    const loja = lojaPorId.get(c.store_id)!;
    if (c.fuso && loja.fuso && c.fuso !== loja.fuso) {
      fusosDiferentes.push({
        conta: c.nome || c.external_id,
        fusoConta: c.fuso,
        loja: rotuloLoja(loja),
        fusoLoja: loja.fuso,
      });
    }
  }

  for (const g of e.gastos) {
    // Nivel conta e a verdade (no Meta inclui anuncio apagado); campanha e
    // detalhe e somaria em dobro.
    if (g.nivel !== "conta") continue;
    const conta = contaPorId.get(g.ad_account_id);
    if (!conta || !conta.store_id) continue;
    const dia = String(g.data).slice(0, 10);
    if (!dentro(dia, iAtual) && !dentro(dia, iAnterior)) continue;
    const c = converter(paraNumero(g.gasto), g.moeda, e.moeda, dia);
    if (!c) {
      moedasSemCotacao.add(String(g.moeda).toUpperCase());
      continue;
    }
    if (c.aproximado) cambioAproximado = true;
    lancar(
      conta.store_id,
      dia,
      conta.plataforma === "google" ? { gastoGoogle: c.valor } : { gastoMeta: c.valor }
    );
  }

  // --- Saida --------------------------------------------------------------
  const linhasLoja: LinhaLoja[] = e.lojas.map((l) => {
    const t = totaisDe(porLoja.get(l.id) ?? acumuladorVazio());
    return {
      ...t,
      storeId: l.id,
      nome: l.nome,
      dominio: l.dominio,
      moedaLoja: l.moeda,
      fuso: l.fuso,
      semaforo: semaforoDe(t),
    };
  });
  linhasLoja.sort((a, b) => b.lucro - a.lucro);

  const linhasDia: LinhaDia[] = [...diasAtual].reverse().map((dia) => ({
    ...totaisDe(porDia.get(dia) ?? acumuladorVazio()),
    dia,
    parcial: dia === e.hoje,
  }));

  return {
    moeda: e.moeda,
    intervalos: e.intervalos,
    atual: totaisDe(totAtual),
    anterior: totaisDe(totAnterior),
    porLoja: linhasLoja,
    porDia: linhasDia,
    avisos: {
      cambioAproximado,
      moedasSemCotacao: [...moedasSemCotacao].filter(Boolean).sort(),
      lojasSemTaxa: [...lojasSemTaxa].sort(),
      lojasSemCustoPadraoComFalta: [...lojasSemCustoPadraoComFalta].sort(),
      fusosDiferentes,
    },
  };
}
