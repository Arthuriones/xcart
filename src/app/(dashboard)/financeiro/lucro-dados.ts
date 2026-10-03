import type { BomQuando, FormatoVariacao } from "@/components/ui/variacao";
import type { CorSerie, SerieGrafico } from "@/components/ui/line-chart";
import type { TomStatus } from "@/components/ui/status-badge";
import { diaCurto } from "@/components/layout/contexto";
import {
  ROTAS,
  formatarDinheiro,
  type FinSyncStateRow,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";
// So tipos: o calculo e as leituras nao entram no bundle do navegador.
import type { Avisos, Semaforo } from "@/lib/financeiro/calculo";
import type { ResumoContas } from "@/lib/financeiro/queries";
import type { PontoDia } from "@/lib/leitura/serie-diaria";

// ============================================================================
// Tela Lucro: tudo o que e conta de TELA (formatar, agrupar por semana,
// montar o grafico, as pendencias e o CSV). Puro, sem React, testado em
// tests/lucro-tela.test.ts. O numero de lucro em si vem pronto do calculo.
// ============================================================================

// ---------------------------------------------------------------------------
// Formatacao
// ---------------------------------------------------------------------------

/** Dinheiro na moeda do relatorio. `compacto` = "R$ 48,7 mil" (KPI). */
export function dinheiro(v: number | null, moeda: string, compacto = false): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (!compacto) return formatarDinheiro(v, moeda, 2);
  try {
    return new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency: moeda,
      notation: "compact",
      minimumFractionDigits: 0,
      maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 1,
    }).format(v);
  } catch {
    return formatarDinheiro(v, moeda, 0);
  }
}

const fmtVezes = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtInteiro = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const fmtPct = new Intl.NumberFormat("pt-BR", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

/** ROAS: "2,35×". */
export function vezes(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : `${fmtVezes.format(v)}×`;
}

export function porcento(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : fmtPct.format(v);
}

export function inteiro(v: number | null): string {
  return v === null || !Number.isFinite(v) ? "—" : fmtInteiro.format(v);
}

const DIA_SEMANA = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

export function diaDaSemana(dia: string): string {
  return DIA_SEMANA[new Date(`${dia}T12:00:00Z`).getUTCDay()] ?? "";
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** "Nome · dominio" sem .myshopify.com (o nome no banco e velho em algumas lojas). */
export function nomeDaLoja(l: Pick<LojaDoSeletor, "nome" | "dominio">): string {
  const dominio = String(l.dominio || "").replace(/\.myshopify\.com$/i, "");
  return l.nome || dominio || "Loja";
}

// ---------------------------------------------------------------------------
// Metricas (os 8 KPIs)
// ---------------------------------------------------------------------------

export type IdMetrica = "receita" | "gasto" | "lucro" | "roas" | "pedidos" | "ticket" | "cpa" | "margem";

export const ORDEM_METRICAS: IdMetrica[] = [
  "receita",
  "gasto",
  "lucro",
  "roas",
  "pedidos",
  "ticket",
  "cpa",
  "margem",
];

export interface DefinicaoMetrica {
  rotulo: string;
  bom: BomQuando;
  formatoVariacao: FormatoVariacao;
  tipo: "dinheiro" | "vezes" | "numero" | "pct";
  /** KPI em dinheiro compacto ("R$ 48,7 mil"). */
  compacto?: boolean;
  definicao: string;
  /** Quando o valor e null: por que. */
  semDado: string;
}

export const METRICAS: Record<IdMetrica, DefinicaoMetrica> = {
  receita: {
    rotulo: "Faturamento",
    bom: "subir",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    compacto: true,
    definicao:
      "Soma dos pedidos pagos, com o frete cobrado e sem impostos. Na Shopify, compare com “Vendas totais menos impostos”.",
    semDado: "Sem pedidos no período",
  },
  gasto: {
    rotulo: "Gasto em anúncios",
    bom: "neutro",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    compacto: true,
    definicao:
      "Gasto do Meta e do Google nas contas ligadas a cada loja, convertido pela cotação do dia.",
    semDado: "Sem gasto no período",
  },
  lucro: {
    rotulo: "Lucro estimado",
    bom: "subir",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    compacto: true,
    definicao:
      "Faturamento menos produto, frete do fornecedor, taxa de pagamento e anúncios. Estimado, não contábil.",
    semDado: "Sem movimento no período",
  },
  roas: {
    rotulo: "ROAS real",
    bom: "subir",
    formatoVariacao: "pct",
    tipo: "vezes",
    definicao:
      "Faturamento dividido pelo gasto em anúncios, com os pedidos da Shopify, não os da plataforma.",
    semDado: "Sem gasto no período",
  },
  pedidos: {
    rotulo: "Pedidos",
    bom: "subir",
    formatoVariacao: "pct",
    tipo: "numero",
    definicao: "Pedidos pagos. Reenvios aparecem à parte e não contam como venda.",
    semDado: "Sem pedidos no período",
  },
  ticket: {
    rotulo: "Ticket médio",
    bom: "subir",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    definicao: "Faturamento dividido pelo número de pedidos.",
    semDado: "Sem pedidos no período",
  },
  cpa: {
    rotulo: "CPA",
    bom: "descer",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    definicao: "Gasto em anúncios dividido pelo número de pedidos. Quanto menor, melhor.",
    semDado: "Sem pedidos ou sem gasto",
  },
  margem: {
    rotulo: "Margem",
    bom: "subir",
    formatoVariacao: "pp",
    tipo: "pct",
    definicao: "Lucro estimado dividido pelo faturamento.",
    semDado: "Sem faturamento no período",
  },
};

export function formatarMetrica(id: IdMetrica, v: number | null, moeda: string, kpi = false): string {
  const d = METRICAS[id];
  if (d.tipo === "dinheiro") return dinheiro(v, moeda, kpi && !!d.compacto);
  if (d.tipo === "vezes") return vezes(v);
  if (d.tipo === "pct") return porcento(v);
  return inteiro(v);
}

/** Formato do grafico (tooltip) para a metrica. */
export function formatoDoGrafico(id: IdMetrica | null, moeda: string): Intl.NumberFormatOptions {
  const d = id ? METRICAS[id] : METRICAS.lucro;
  if (d.tipo === "dinheiro") return { style: "currency", currency: moeda };
  if (d.tipo === "vezes") return { minimumFractionDigits: 2, maximumFractionDigits: 2 };
  if (d.tipo === "pct") return { style: "percent", maximumFractionDigits: 1 };
  return { maximumFractionDigits: 0 };
}

/** As somas cruas de um dia (ou de varios): tudo mais se deriva delas. */
export interface Soma {
  pedidos: number;
  receita: number;
  cmv: number;
  taxas: number;
  gastoMeta: number;
  gastoGoogle: number;
}

/**
 * As mesmas formulas de totaisDe (src/lib/financeiro/calculo.ts), para somar
 * dias em semana ou mes no grafico. Nunca inventa: sem base vira null.
 */
export function derivar(s: Soma): Record<IdMetrica, number | null> {
  const gasto = s.gastoMeta + s.gastoGoogle;
  const lucro = s.receita - s.cmv - s.taxas - gasto;
  return {
    receita: s.receita,
    gasto,
    lucro,
    roas: gasto > 0 ? s.receita / gasto : null,
    pedidos: s.pedidos,
    ticket: s.pedidos > 0 ? s.receita / s.pedidos : null,
    cpa: s.pedidos > 0 && gasto > 0 ? gasto / s.pedidos : null,
    margem: s.receita > 0 ? lucro / s.receita : null,
  };
}

function somar(lista: Soma[]): Soma {
  const t: Soma = { pedidos: 0, receita: 0, cmv: 0, taxas: 0, gastoMeta: 0, gastoGoogle: 0 };
  for (const s of lista) {
    t.pedidos += s.pedidos;
    t.receita += s.receita;
    t.cmv += s.cmv;
    t.taxas += s.taxas;
    t.gastoMeta += s.gastoMeta;
    t.gastoGoogle += s.gastoGoogle;
  }
  return t;
}

/** Houve venda, custo ou gasto? Sem isso nao ha base para comparar. */
export function temMovimento(s: Pick<Soma, "receita" | "cmv" | "gastoMeta" | "gastoGoogle" | "pedidos">): boolean {
  return s.receita !== 0 || s.cmv !== 0 || s.gastoMeta !== 0 || s.gastoGoogle !== 0 || s.pedidos !== 0;
}

/**
 * Ordem dos KPIs: os fixados primeiro (na ordem padrao entre eles), depois
 * os outros. Id desconhecido na lista guardada e ignorado.
 */
export function ordenarFixados(fixados: readonly string[]): IdMetrica[] {
  const set = new Set(fixados);
  return [
    ...ORDEM_METRICAS.filter((id) => set.has(id)),
    ...ORDEM_METRICAS.filter((id) => !set.has(id)),
  ];
}

/** Lista guardada no navegador -> lista de texto. Lixo vira o padrao. */
export function lerListaGuardada(texto: string | null, padrao: readonly string[]): string[] {
  if (texto === null) return [...padrao];
  try {
    const v: unknown = JSON.parse(texto);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [...padrao];
  } catch {
    return [...padrao];
  }
}

// ---------------------------------------------------------------------------
// Grafico
// ---------------------------------------------------------------------------

export type Granularidade = "dia" | "semana" | "mes";

export interface Grupo {
  rotulo: string;
  parcial: boolean;
  /** null = nenhum dia do grupo tem dado (fora do historico). */
  soma: Soma | null;
}

type Ponto = PontoDia | null;

function grupoDe(rotulo: string, pontos: Ponto[]): Grupo {
  const comDado = pontos.filter((p): p is PontoDia => p !== null);
  return {
    rotulo,
    parcial: comDado.some((p) => p.parcial),
    soma: comDado.length ? somar(comDado) : null,
  };
}

/**
 * Dias -> grupos. Semana: blocos de 7 a partir do primeiro dia (o rotulo e o
 * dia que abre o bloco). Mes: mes do calendario ("set").
 */
export function agrupar(pontos: Ponto[], dias: string[], gran: Granularidade): Grupo[] {
  if (gran === "dia") return dias.map((d, i) => grupoDe(diaCurto(d), [pontos[i] ?? null]));
  if (gran === "semana") {
    const saida: Grupo[] = [];
    for (let i = 0; i < dias.length; i += 7) {
      saida.push(grupoDe(diaCurto(dias[i]), dias.slice(i, i + 7).map((_, k) => pontos[i + k] ?? null)));
    }
    return saida;
  }
  const meses = new Map<string, Ponto[]>();
  dias.forEach((d, i) => {
    const chave = d.slice(0, 7);
    const lista = meses.get(chave) ?? [];
    lista.push(pontos[i] ?? null);
    meses.set(chave, lista);
  });
  return [...meses.entries()].map(([chave, lista]) =>
    grupoDe(MESES[Number(chave.slice(5, 7)) - 1] ?? chave, lista)
  );
}

/** Quais granularidades fazem sentido para estes dias. */
export function granularidades(dias: string[]): { valor: Granularidade; rotulo: string; desabilitado: boolean; motivo?: string }[] {
  const meses = new Set(dias.map((d) => d.slice(0, 7))).size;
  return [
    { valor: "dia", rotulo: "Dia", desabilitado: false },
    {
      valor: "semana",
      rotulo: "Semana",
      desabilitado: dias.length <= 7,
      motivo: "o período tem uma semana ou menos",
    },
    { valor: "mes", rotulo: "Mês", desabilitado: meses < 2, motivo: "o período cabe num mês só" },
  ];
}

/**
 * Dias do comeco do periodo anterior sem movimento nenhum viram null: em geral
 * e antes do historico (a Shopify entrega uns 60 dias), e uma linha tracejada
 * no zero diria "nao vendeu".
 */
export function semInicioVazio(pontos: PontoDia[]): Ponto[] {
  const primeiro = pontos.findIndex((p) => temMovimento(p));
  if (primeiro < 0) return pontos.map(() => null);
  return pontos.map((p, i) => (i < primeiro ? null : p));
}

export interface Grafico {
  rotulos: string[];
  series: SerieGrafico[];
  parcialUltimo: boolean;
}

/**
 * As series do grafico. Sem metrica: faturamento, gasto e lucro, com o lucro
 * do periodo anterior tracejado. Com metrica (KPI clicado): ela no atual e no
 * anterior. `anterior` null = sem comparacao. Mes nao compara: os meses dos
 * dois periodos nao tem o mesmo tamanho.
 */
export function montarGrafico(opcoes: {
  atual: PontoDia[];
  anterior: PontoDia[] | null;
  gran: Granularidade;
  metrica: IdMetrica | null;
}): Grafico {
  const { atual, gran, metrica } = opcoes;
  const dias = atual.map((p) => p.dia);
  const grupos = agrupar(atual, dias, gran);
  const ant =
    opcoes.anterior && gran !== "mes"
      ? agrupar(semInicioVazio(opcoes.anterior), dias, gran)
      : null;

  const valores = (gs: Grupo[], id: IdMetrica) => gs.map((g) => (g.soma ? derivar(g.soma)[id] : null));
  const serie = (id: string, rotulo: string, cor: CorSerie, v: (number | null)[], destaque = false): SerieGrafico => ({
    id,
    rotulo,
    cor,
    valores: v,
    destaque,
  });

  const series: SerieGrafico[] = metrica
    ? [serie("atual", `${METRICAS[metrica].rotulo} · período atual`, "chart-1", valores(grupos, metrica), true)]
    : [
        serie("receita", "Faturamento", "chart-2", valores(grupos, "receita")),
        serie("gasto", "Gasto em anúncios", "chart-3", valores(grupos, "gasto")),
        serie("lucro", "Lucro estimado", "chart-1", valores(grupos, "lucro"), true),
      ];
  if (ant && ant.some((g) => g.soma !== null)) {
    series.push(
      serie(
        "anterior",
        metrica ? "Período anterior" : "Lucro · período anterior",
        "comparacao",
        valores(ant, metrica ?? "lucro")
      )
    );
  }
  return {
    rotulos: grupos.map((g) => g.rotulo),
    series,
    parcialUltimo: grupos.length > 1 && grupos[grupos.length - 1].parcial,
  };
}

// ---------------------------------------------------------------------------
// Semaforo das lojas
// ---------------------------------------------------------------------------

export const SEMAFORO: Record<Semaforo, { tom: TomStatus; texto: string }> = {
  verde: { tom: "ok", texto: "Lucro" },
  amarelo: { tom: "warn", texto: "No limite" },
  vermelho: { tom: "err", texto: "Prejuízo" },
  cinza: { tom: "neutral", texto: "Sem gasto" },
};

// ---------------------------------------------------------------------------
// Pendencias
// ---------------------------------------------------------------------------

export type TomPendencia = "err" | "warn" | "info";

export interface Pendencia {
  /** Estavel: e a chave de "dispensar" no navegador. */
  id: string;
  tom: TomPendencia;
  titulo: string;
  detalhe?: string;
  /** Link para a tela que resolve, ou "sincronizar agora" (pedidos e Meta). */
  acao?: { rotulo: string; href: string } | { rotulo: string; sincronizar: true };
  /** So o informativo pode ser dispensado. */
  dispensavel?: boolean;
}

export interface EntradaPendencias {
  lojas: LojaDoSeletor[];
  lojaIds: string[];
  estados: Pick<FinSyncStateRow, "store_id" | "carga_inicial_ok" | "ultimo_erro" | "ultimo_erro_tipo">[];
  contas: ResumoContas;
  avisos: Avisos;
  coberturaCusto: number | null;
  /** Movimento por loja no periodo: loja sem acesso que vendeu vira critica. */
  porLoja: { storeId: string; receita: number; pedidos: number }[];
}

const ORDEM_TOM: Record<TomPendencia, number> = { err: 0, warn: 1, info: 2 };

function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/**
 * Os avisos da tela, um por tipo (com as lojas listadas, nunca uma caixa por
 * loja), do mais grave para o informativo. Critico e o que deixa o lucro
 * ERRADO para cima ou esconde venda que aconteceu.
 */
export function montarPendencias(d: EntradaPendencias): Pendencia[] {
  const saida: Pendencia[] = [];
  const lojaPorId = new Map(d.lojas.map((l) => [l.id, l]));
  const nome = (id: string) => {
    const l = lojaPorId.get(id);
    return l ? nomeDaLoja(l) : "loja removida";
  };
  const estadoPorLoja = new Map(d.estados.map((e) => [e.store_id, e]));

  // Custo faltando: o produto entrou como zero e o lucro esta inflado.
  const cobertura = d.coberturaCusto;
  if (cobertura !== null && cobertura < 0.95) {
    const falta = porcento(1 - cobertura);
    if (d.avisos.lojasSemCustoPadraoComFalta.length > 0) {
      saida.push({
        id: "custo-faltando",
        tom: "err",
        titulo: `Lucro inflado: ${falta} da receita vendeu sem custo cadastrado`,
        detalhe: `${listar(d.avisos.lojasSemCustoPadraoComFalta)} ${d.avisos.lojasSemCustoPadraoComFalta.length === 1 ? "vendeu" : "venderam"} SKU sem custo e sem custo padrão. O produto entrou como zero.`,
        acao: { rotulo: "Cadastrar custos", href: ROTAS.custos },
      });
    } else {
      saida.push({
        id: "custo-padrao",
        tom: "info",
        titulo: `${falta} da receita usa o custo padrão, não o custo do SKU`,
        detalhe: "O lucro dessas vendas é uma estimativa pelo percentual da loja.",
        acao: { rotulo: "Cadastrar custos", href: ROTAS.custos },
        dispensavel: true,
      });
    }
  }

  // Shopify negando ler pedidos: critica se a loja vendeu no periodo (faltam
  // vendas de agora); loja antiga, parada, so pede atencao.
  const negadas = d.estados.filter((e) => e.ultimo_erro_tipo === "negado").map((e) => e.store_id);
  if (negadas.length > 0) {
    const movimento = new Map(d.porLoja.map((l) => [l.storeId, l.receita > 0 || l.pedidos > 0]));
    const ativa = negadas.some((id) => movimento.get(id));
    saida.push({
      id: "negado",
      tom: ativa ? "err" : "warn",
      titulo:
        negadas.length === 1
          ? `A Shopify não deixa ler os pedidos de ${nome(negadas[0])}`
          : `A Shopify não deixa ler os pedidos de ${negadas.length} lojas`,
      detalhe: `${negadas.length > 1 ? `${listar(negadas.map(nome))}. ` : ""}Loja pausada, app desinstalado ou token vencido: as vendas novas ficam de fora. Se não usa mais, remova em Lojas; se usa, reconecte.`,
      acao: { rotulo: "Abrir Lojas", href: "/stores" },
    });
  }

  for (const c of d.contas.comErro) {
    saida.push({
      id: `conta-erro-${c.nome}`,
      tom: "err",
      titulo: `O gasto de ${c.nome} não está sendo lido`,
      detalhe: `O lucro pode estar alto demais. Motivo: ${c.erro}`,
      acao: { rotulo: "Contas de anúncio", href: ROTAS.anuncios },
    });
  }

  const carregando = d.lojaIds.filter((id) => {
    const e = estadoPorLoja.get(id);
    // Loja com erro fica so com o aviso do erro: loja morta nao prende o
    // "ainda puxando" para sempre.
    return !e || (!e.carga_inicial_ok && !e.ultimo_erro);
  });
  if (carregando.length > 0) {
    saida.push({
      id: "carga",
      tom: "warn",
      titulo: "Ainda estamos puxando os pedidos da Shopify",
      detalhe: `A primeira carga traz até 60 dias e completa nas próximas rodadas.${d.lojaIds.length > 1 ? ` Faltam: ${listar(carregando.map(nome))}.` : ""}`,
      acao: { rotulo: "Atualizar agora", sincronizar: true },
    });
  }

  const falharam = d.estados.filter((e) => e.ultimo_erro_tipo !== "negado" && e.ultimo_erro);
  if (falharam.length > 0) {
    saida.push({
      id: "falhou",
      tom: "warn",
      titulo:
        falharam.length === 1
          ? `Os pedidos de ${nome(falharam[0].store_id)} não atualizaram na última rodada`
          : `Os pedidos de ${falharam.length} lojas não atualizaram na última rodada`,
      detalhe: `${falharam.length > 1 ? `${listar(falharam.map((e) => nome(e.store_id)))}. ` : ""}Motivo: ${falharam[0].ultimo_erro}`,
      acao: { rotulo: "Tentar agora", sincronizar: true },
    });
  }

  if (d.contas.googleSemDado3h.length > 0) {
    saida.push({
      id: "google-3h",
      tom: "warn",
      titulo: `O gasto do Google está parado há mais de 3 h`,
      detalhe: `${listar(d.contas.googleSemDado3h)}: confira se o script está colado e agendado de hora em hora. O lucro de hoje pode estar alto demais.`,
      acao: { rotulo: "Contas de anúncio", href: ROTAS.anuncios },
    });
  }

  if (d.contas.total === 0) {
    saida.push({
      id: "sem-contas",
      tom: "warn",
      titulo: "Nenhuma conta de anúncio conectada",
      detalhe: "Sem o gasto, o lucro mostrado é o que sobra antes do anúncio.",
      acao: { rotulo: "Conectar contas", href: ROTAS.anuncios },
    });
  } else if (d.contas.semLoja > 0) {
    saida.push({
      id: "contas-sem-loja",
      tom: "warn",
      titulo:
        d.contas.semLoja === 1
          ? "1 conta de anúncio sem loja ligada"
          : `${d.contas.semLoja} contas de anúncio sem loja ligada`,
      detalhe: "O gasto delas não entra em nenhuma loja.",
      acao: { rotulo: "Ligar à loja", href: ROTAS.anuncios },
    });
  }

  if (d.avisos.lojasSemTaxa.length > 0) {
    saida.push({
      id: "taxa",
      tom: "warn",
      titulo: `Taxa de pagamento não configurada em ${d.avisos.lojasSemTaxa.length === 1 ? "1 loja" : `${d.avisos.lojasSemTaxa.length} lojas`}`,
      detalhe: `${listar(d.avisos.lojasSemTaxa)}. Sem ela, o lucro não desconta o que o gateway cobra de cada venda.`,
      acao: { rotulo: "Configurar taxa", href: ROTAS.custos },
    });
  }

  if (d.avisos.moedasSemCotacao.length > 0) {
    saida.push({
      id: "sem-cotacao",
      tom: "warn",
      titulo: `Valores em ${listar(d.avisos.moedasSemCotacao)} ficaram de fora`,
      detalhe:
        "Não há cotação para essa moeda. Preferimos um total menor e honesto a somar moedas diferentes como se fossem iguais.",
      acao: { rotulo: "Ver como calculamos", href: "#como-calculamos" },
    });
  }

  if (d.avisos.cambioAproximado) {
    saida.push({
      id: "cambio",
      tom: "info",
      titulo: "Câmbio aproximado em parte dos valores",
      detalhe:
        "Sem a cotação do dia, usamos uma tabela fixa. Os números se ajustam quando a cotação chegar.",
      acao: { rotulo: "Ver como calculamos", href: "#como-calculamos" },
      dispensavel: true,
    });
  }

  if (d.avisos.fusosDiferentes.length > 0) {
    saida.push({
      id: "fusos",
      tom: "info",
      titulo: "Fuso da conta de anúncio diferente do fuso da loja",
      detalhe: `${d.avisos.fusosDiferentes.map((f) => `${f.conta} (${f.fusoConta}) e ${f.loja} (${f.fusoLoja})`).join("; ")}. O gasto de um dia pode cair no dia vizinho do pedido.`,
      acao: { rotulo: "Contas de anúncio", href: ROTAS.anuncios },
      dispensavel: true,
    });
  }

  // Estavel: dentro do mesmo tom, a ordem acima (do que mais pesa no numero).
  return saida
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ORDEM_TOM[a.p.tom] - ORDEM_TOM[b.p.tom] || a.i - b.i)
    .map((x) => x.p);
}

// ---------------------------------------------------------------------------
// CSV (no navegador)
// ---------------------------------------------------------------------------

export type ValorCsv = string | number | null | undefined;

/**
 * Numero cru para planilha brasileira: virgula decimal, sem milhar, ate 4
 * casas. Texto vai entre aspas quando precisa.
 */
export function campoCsv(v: ValorCsv): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return "";
    return String(Number(v.toFixed(4))).replace(".", ",");
  }
  return /[";\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * CSV separado por ";" (o Excel em pt-BR abre direto), com o contexto
 * (tabela, loja, periodo, moeda) numa linha antes do cabecalho.
 */
export function montarCsv(contexto: string[], cabecalho: string[], linhas: ValorCsv[][]): string {
  const saida = [contexto.map(campoCsv).join(";"), "", cabecalho.map(campoCsv).join(";")];
  for (const l of linhas) saida.push(l.map(campoCsv).join(";"));
  return saida.join("\r\n") + "\r\n";
}
