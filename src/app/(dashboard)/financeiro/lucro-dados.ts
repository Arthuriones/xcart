import type { BomQuando, FormatoVariacao } from "@/components/ui/variacao";
import type { CorSerie, SerieGrafico } from "@/components/ui/line-chart";
import type { TomStatus } from "@/components/ui/status-badge";
import { diaCurto } from "@/components/layout/contexto";
import {
  FUSO_RELATORIO_PADRAO,
  ROTAS,
  diaNoFuso,
  formatarDinheiro,
  type FinSyncStateRow,
  type LojaDoSeletor,
} from "@/lib/financeiro/tipos";
import { RE_DESINSTALADO, estadoConexao } from "@/lib/leitura/lojas-estado";
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

export type IdMetrica = "receita" | "gasto" | "custo" | "lucro" | "roas" | "pedidos" | "ticket" | "cpa" | "margem";

/** Sempre a vista: o Lucro em destaque e o que forma ele. */
export const KPIS_PRINCIPAIS: IdMetrica[] = ["lucro", "receita", "custo", "gasto", "roas"];
/** Atras do "+4 métricas". */
export const KPIS_MAIS: IdMetrica[] = ["pedidos", "ticket", "cpa", "margem"];

export interface DefinicaoMetrica {
  rotulo: string;
  bom: BomQuando;
  formatoVariacao: FormatoVariacao;
  tipo: "dinheiro" | "vezes" | "numero" | "pct";
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
    definicao:
      "Soma dos pedidos pagos, com o frete cobrado e sem impostos. Na Shopify, compare com “Vendas totais menos impostos”.",
    semDado: "Sem pedidos no período",
  },
  gasto: {
    rotulo: "Gasto em anúncios",
    bom: "neutro",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    definicao:
      "Gasto do Meta e do Google nas contas ligadas a cada loja, convertido pela cotação do dia.",
    semDado: "Sem gasto no período",
  },
  custo: {
    rotulo: "Custo de produto",
    bom: "neutro",
    formatoVariacao: "pct",
    tipo: "dinheiro",
    definicao:
      "Produto mais frete do fornecedor dos pedidos do período, pelo custo cadastrado em Custos.",
    semDado: "Sem pedidos no período",
  },
  lucro: {
    rotulo: "Lucro estimado",
    bom: "subir",
    formatoVariacao: "pct",
    tipo: "dinheiro",
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

/** Sempre o valor exato, com centavos: o lojista confere com a Shopify. */
export function formatarMetrica(id: IdMetrica, v: number | null, moeda: string): string {
  const d = METRICAS[id];
  if (d.tipo === "dinheiro") return dinheiro(v, moeda);
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
  /** Devolucao de contra entrega (ausente = 0). */
  devolucoes?: number;
  gastoMeta: number;
  gastoGoogle: number;
}

/**
 * As mesmas formulas de totaisDe (src/lib/financeiro/calculo.ts), para somar
 * dias em semana ou mes no grafico. Nunca inventa: sem base vira null.
 */
export function derivar(s: Soma): Record<IdMetrica, number | null> {
  const gasto = s.gastoMeta + s.gastoGoogle;
  const lucro = s.receita - s.cmv - s.taxas - (s.devolucoes ?? 0) - gasto;
  return {
    receita: s.receita,
    gasto,
    custo: s.cmv,
    lucro,
    roas: gasto > 0 ? s.receita / gasto : null,
    pedidos: s.pedidos,
    ticket: s.pedidos > 0 ? s.receita / s.pedidos : null,
    cpa: s.pedidos > 0 && gasto > 0 ? gasto / s.pedidos : null,
    margem: s.receita > 0 ? lucro / s.receita : null,
  };
}

function somar(lista: Soma[]): Soma {
  const t: Soma = { pedidos: 0, receita: 0, cmv: 0, taxas: 0, devolucoes: 0, gastoMeta: 0, gastoGoogle: 0 };
  for (const s of lista) {
    t.pedidos += s.pedidos;
    t.receita += s.receita;
    t.cmv += s.cmv;
    t.taxas += s.taxas;
    t.devolucoes = (t.devolucoes ?? 0) + (s.devolucoes ?? 0);
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
 * Valor do KPI para a tela: o sinal de menos tipografico ("−R$ 1,2 mil") e o
 * tom vermelho andam juntos, para o negativo nunca ser so cor.
 */
export function valorComSinal(texto: string, v: number | null): { texto: string; negativo: boolean } {
  const negativo = v !== null && Number.isFinite(v) && v < 0;
  return { texto: negativo ? texto.replace(/^-/, "−") : texto, negativo };
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
  /**
   * Pode sair da tela (fica guardado neste navegador). So o que pode ser de
   * proposito, como loja que vende sem anunciar.
   */
  dispensavel?: boolean;
}

type EstadoPendencia = Pick<
  FinSyncStateRow,
  "store_id" | "carga_inicial_ok" | "ultimo_erro" | "ultimo_erro_tipo" | "ultimo_sync_ok_em"
>;

export interface EntradaPendencias {
  lojas: LojaDoSeletor[];
  lojaIds: string[];
  estados: EstadoPendencia[];
  contas: ResumoContas;
  avisos: Avisos;
  coberturaCusto: number | null;
  /** Movimento por loja no periodo: loja sem acesso que vendeu vira critica. */
  porLoja: { storeId: string; receita: number; pedidos: number }[];
  /** stores.uninstalled_at, so das lojas marcadas (id -> ISO). */
  desinstaladas: Record<string, string>;
  /**
   * Lojas com conta de anuncio ativa ligada. null = nao deu para saber: fica
   * sem o aviso de "vendeu sem conta" em vez de inventar.
   */
  lojasComConta: string[] | null;
}

/** Como a loja esta para o Lucro: o que falta ler decide o aviso e a acao. */
export type SituacaoLoja = "desinstalada" | "sem-acesso" | "falhou" | "carregando" | "ok";

export interface SituacaoDaLoja {
  situacao: SituacaoLoja;
  /** "sem-acesso": o motivo em uma frase, nunca o erro cru. */
  motivo?: string;
  /** "desinstalada": quando o webhook marcou (ISO), se marcou. */
  desde?: string | null;
}

const MOTIVO_SEM_ACESSO = {
  semPermissao: "Falta a permissão de pedidos.",
  pausada: "A loja está pausada ou sem plano na Shopify.",
  tokenInvalido: "A credencial da loja não vale mais.",
} as const;

/**
 * Situacao de cada loja pelo que o banco ja sabe: a marca de desinstalacao e
 * o ultimo erro da busca de pedidos. Usa o estadoConexao da tela Lojas, para
 * as duas telas dizerem a mesma coisa.
 */
export function situacaoDasLojas(
  lojaIds: string[],
  estados: EstadoPendencia[],
  desinstaladas: Record<string, string>
): Map<string, SituacaoDaLoja> {
  const porLoja = new Map(estados.map((e) => [e.store_id, e]));
  const saida = new Map<string, SituacaoDaLoja>();
  for (const id of lojaIds) {
    const e = porLoja.get(id);
    const marcada = desinstaladas[id] ?? null;
    if (marcada || RE_DESINSTALADO.test(e?.ultimo_erro ?? "")) {
      saida.set(id, { situacao: "desinstalada", desde: marcada });
      continue;
    }
    const c = estadoConexao({
      desinstaladaEm: null,
      sync: e
        ? {
            ultimoErro: e.ultimo_erro,
            ultimoErroTipo: e.ultimo_erro_tipo,
            ultimoSyncOkEm: e.ultimo_sync_ok_em,
            cargaInicialOk: e.carga_inicial_ok,
          }
        : null,
    });
    if (c.chave === "semPermissao" || c.chave === "pausada" || c.chave === "tokenInvalido") {
      saida.set(id, { situacao: "sem-acesso", motivo: MOTIVO_SEM_ACESSO[c.chave] });
    } else if (c.chave === "falhaSync") {
      saida.set(id, { situacao: "falhou" });
    } else {
      saida.set(id, { situacao: !e || !e.carga_inicial_ok ? "carregando" : "ok" });
    }
  }
  return saida;
}

const ORDEM_TOM: Record<TomPendencia, number> = { err: 0, warn: 1, info: 2 };

/** Custos e taxas ja filtrado nos SKUs sem custo (a tela le ?situacao=). */
const CUSTOS_SEM_CUSTO = `${ROTAS.custos}?situacao=semCusto`;

/** Onde liga conta de anuncio a loja (Meta primeiro; o Google fica ao lado). */
const CONECTAR_CONTAS = "/integracoes/meta";

function listar(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

/** "12/09" no fuso do relatorio; null quando nao ha data valida. */
function diaDe(iso: string | null | undefined): string | null {
  const ms = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(ms) ? diaCurto(diaNoFuso(new Date(ms), FUSO_RELATORIO_PADRAO)) : null;
}

/**
 * Os avisos da tela, um por tipo (com as lojas listadas, nunca uma caixa por
 * loja), do mais grave para o menos. So entra o que pede uma acao: o que so
 * explica um numero vira Dica no indicador (montarDicas).
 */
export function montarPendencias(d: EntradaPendencias): Pendencia[] {
  const saida: Pendencia[] = [];
  const lojaPorId = new Map(d.lojas.map((l) => [l.id, l]));
  const nome = (id: string) => {
    const l = lojaPorId.get(id);
    return l ? nomeDaLoja(l) : "loja removida";
  };
  const situacoes = situacaoDasLojas(d.lojaIds, d.estados, d.desinstaladas);
  const comSituacao = (s: SituacaoLoja) => d.lojaIds.filter((id) => situacoes.get(id)?.situacao === s);
  const movimento = new Map(d.porLoja.map((l) => [l.storeId, l.receita > 0 || l.pedidos > 0]));
  const vendeu = (id: string) => movimento.get(id) === true;

  // Custo faltando sem custo padrao: o produto entrou como zero e o lucro
  // esta inflado. Com custo padrao e so estimativa: vira Dica.
  const cobertura = d.coberturaCusto;
  const semCusto = d.avisos.lojasSemCustoPadraoComFalta;
  if (cobertura !== null && cobertura < 0.95 && semCusto.length > 0) {
    saida.push({
      id: "custo-faltando",
      tom: "err",
      titulo: `Lucro inflado: ${porcento(1 - cobertura)} da receita vendeu sem custo cadastrado`,
      detalhe: `${listar(semCusto)} ${semCusto.length === 1 ? "vendeu" : "venderam"} SKU sem custo. O produto entrou como zero.`,
      acao: { rotulo: "Cadastrar custos", href: CUSTOS_SEM_CUSTO },
    });
  }

  // App fora da loja: "Tentar agora" nao resolve, so reconectar ou remover.
  // Critico se a loja vendeu no periodo (faltam vendas); parada so pede atencao.
  const desinstaladas = comSituacao("desinstalada");
  if (desinstaladas.length > 0) {
    const desde = desinstaladas.length === 1 ? diaDe(situacoes.get(desinstaladas[0])?.desde) : null;
    saida.push({
      id: "desinstalado",
      tom: desinstaladas.some(vendeu) ? "err" : "warn",
      titulo:
        desinstaladas.length === 1
          ? `App desinstalado em ${nome(desinstaladas[0])}`
          : `App desinstalado em ${desinstaladas.length} lojas`,
      detalhe:
        desinstaladas.length === 1
          ? `${desde ? `Desde ${desde}. ` : ""}Reconecte ou remova a loja.`
          : `${listar(desinstaladas.map(nome))}. Reconecte ou remova em Lojas.`,
      acao: { rotulo: "Abrir Lojas", href: "/stores" },
    });
  }

  // A Shopify nega ler pedidos (permissao, loja pausada, credencial vencida).
  const semAcesso = comSituacao("sem-acesso");
  if (semAcesso.length > 0) {
    saida.push({
      id: "negado",
      tom: semAcesso.some(vendeu) ? "err" : "warn",
      titulo:
        semAcesso.length === 1
          ? `A Shopify não deixa ler os pedidos de ${nome(semAcesso[0])}`
          : `A Shopify não deixa ler os pedidos de ${semAcesso.length} lojas`,
      detalhe:
        semAcesso.length === 1
          ? `${situacoes.get(semAcesso[0])?.motivo ?? ""} As vendas novas ficam de fora.`.trim()
          : `${listar(semAcesso.map(nome))}. As vendas novas ficam de fora.`,
      acao: { rotulo: "Abrir Lojas", href: "/stores" },
    });
  }

  for (const c of d.contas.comErro) {
    saida.push({
      id: `conta-erro-${c.nome}`,
      tom: "err",
      titulo: `O gasto de ${c.nome} não está sendo lido`,
      // O motivo cru fica na tela da conta, para onde o botao leva.
      detalhe: "O lucro pode estar alto demais.",
      // O nome vem de nomeConta (queries.ts): "Google ..." ou "Meta ...".
      acao: {
        rotulo: "Contas de anúncio",
        href: c.nome.startsWith("Google ") ? "/integracoes/google" : "/integracoes/meta",
      },
    });
  }

  const carregando = comSituacao("carregando");
  if (carregando.length > 0) {
    saida.push({
      id: "carga",
      tom: "warn",
      titulo: "Ainda estamos puxando os pedidos da Shopify",
      detalhe: `A primeira carga traz até 60 dias.${d.lojaIds.length > 1 ? ` Faltam: ${listar(carregando.map(nome))}.` : ""}`,
      acao: { rotulo: "Atualizar agora", sincronizar: true },
    });
  }

  // Falha passageira: aqui "Tentar agora" resolve. O erro cru fica em Lojas.
  const falharam = comSituacao("falhou");
  if (falharam.length > 0) {
    saida.push({
      id: "falhou",
      tom: "warn",
      titulo:
        falharam.length === 1
          ? `Os pedidos de ${nome(falharam[0])} não atualizaram na última rodada`
          : `Os pedidos de ${falharam.length} lojas não atualizaram na última rodada`,
      // O motivo nao cabe aqui; o caminho ate ele, sim (AvisoConexao da loja).
      detalhe:
        falharam.length > 1
          ? `${listar(falharam.map(nome))}. Se repetir, o motivo aparece em Lojas.`
          : "Se repetir, o motivo aparece na página da loja, em Lojas.",
      acao: { rotulo: "Tentar agora", sincronizar: true },
    });
  }

  if (d.contas.googleSemDado3h.length > 0) {
    saida.push({
      id: "google-3h",
      tom: "warn",
      titulo: "O gasto do Google está parado há mais de 3 h",
      detalhe: `${listar(d.contas.googleSemDado3h)}: confira se o script está agendado de hora em hora.`,
      acao: { rotulo: "Contas de anúncio", href: "/integracoes/google" },
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
  } else {
    if (d.contas.semLoja > 0) {
      saida.push({
        id: "contas-sem-loja",
        tom: "warn",
        titulo:
          d.contas.semLoja === 1
            ? "1 conta de anúncio sem loja ligada"
            : `${d.contas.semLoja} contas de anúncio sem loja ligada`,
        detalhe: `O gasto ${d.contas.semLoja === 1 ? "dela" : "delas"} não entra em nenhuma loja.`,
        acao: { rotulo: "Ligar à loja", href: ROTAS.anuncios },
      });
    }

    // Loja que vendeu e nao tem conta ligada: o lucro dela nao desconta
    // anuncio nenhum. Pode ser de proposito (loja sem anuncio): dispensavel. O
    // id leva as lojas, entao uma loja nova nessa situacao volta a avisar.
    if (d.lojasComConta) {
      const comConta = new Set(d.lojasComConta);
      const semConta = d.lojaIds.filter(
        (id) => vendeu(id) && !comConta.has(id) && situacoes.get(id)?.situacao !== "desinstalada"
      );
      if (semConta.length > 0) {
        saida.push({
          id: `sem-conta-anuncio:${[...semConta].sort().join(",")}`,
          tom: "warn",
          titulo:
            semConta.length === 1
              ? `${nome(semConta[0])} vendeu sem conta de anúncio ligada`
              : `${semConta.length} lojas venderam sem conta de anúncio ligada`,
          detalhe: `${semConta.length > 1 ? `${listar(semConta.map(nome))}. ` : ""}O lucro não desconta o anúncio ${semConta.length === 1 ? "dela" : "delas"}.`,
          acao: { rotulo: "Conectar contas", href: CONECTAR_CONTAS },
          dispensavel: true,
        });
      }
    }
  }

  if (d.avisos.lojasSemTaxa.length > 0) {
    saida.push({
      id: "taxa",
      tom: "warn",
      titulo: `Taxa de pagamento não configurada em ${d.avisos.lojasSemTaxa.length === 1 ? "1 loja" : `${d.avisos.lojasSemTaxa.length} lojas`}`,
      detalhe: `${listar(d.avisos.lojasSemTaxa)}. Sem ela, o lucro não desconta o gateway.`,
      acao: { rotulo: "Configurar taxa", href: ROTAS.custos },
    });
  }

  if (d.avisos.moedasSemCotacao.length > 0) {
    saida.push({
      id: "sem-cotacao",
      tom: "warn",
      titulo: `Valores em ${listar(d.avisos.moedasSemCotacao)} ficaram de fora`,
      detalhe: "Não há cotação para essa moeda.",
    });
  }

  // Estavel: dentro do mesmo tom, a ordem acima (do que mais pesa no numero).
  return saida
    .map((p, i) => ({ p, i }))
    .sort((a, b) => ORDEM_TOM[a.p.tom] - ORDEM_TOM[b.p.tom] || a.i - b.i)
    .map((x) => x.p);
}

/**
 * Avisos que so explicam um numero (custo padrao, cambio, fuso): viram Dica
 * no indicador que eles afetam, em vez de caixa na tela.
 */
export function montarDicas(
  avisos: Avisos,
  coberturaCusto: number | null,
  /**
   * Contra entrega: a cobertura e a do previsto (Totais.cod.coberturaCusto), e
   * o SKU sem custo tambem vira nota no Lucro previsto -- la nao ha o selo do
   * realizado para avisar que o produto entrou como zero.
   */
  contraEntrega = false
): Partial<Record<IdMetrica, string[]>> {
  const dicas: Partial<Record<IdMetrica, string[]>> = {};
  const juntar = (id: IdMetrica, texto: string) => {
    (dicas[id] ??= []).push(texto);
  };
  if (coberturaCusto !== null && coberturaCusto < 0.95 && avisos.lojasSemCustoPadraoComFalta.length === 0) {
    juntar("lucro", `${porcento(1 - coberturaCusto)} da receita usa o custo padrão da loja, não o do SKU.`);
  }
  if (contraEntrega && avisos.lojasSemCustoPadraoComFalta.length > 0) {
    juntar("lucro", `Produto sem custo cadastrado entrou como zero em ${listar(avisos.lojasSemCustoPadraoComFalta)}.`);
  }
  if (avisos.cambioAproximado) {
    juntar("lucro", "Parte dos valores usa câmbio aproximado: a cotação do dia ainda não chegou.");
  }
  if (avisos.fusosDiferentes.length > 0) {
    const pares = avisos.fusosDiferentes.map((f) => `${f.conta} (${f.fusoConta}) e ${f.loja} (${f.fusoLoja})`);
    juntar("gasto", `Fuso da conta diferente do da loja: ${pares.join("; ")}. O gasto pode cair no dia vizinho.`);
  }
  return dicas;
}

// ---------------------------------------------------------------------------
// "Atualizado ha X"
// ---------------------------------------------------------------------------

function maisNova(datas: (string | null | undefined)[]): number | null {
  let maior: number | null = null;
  for (const d of datas) {
    const ms = d ? Date.parse(d) : NaN;
    if (Number.isFinite(ms) && (maior === null || ms > maior)) maior = ms;
  }
  return maior;
}

/**
 * Ate quando os numeros estao em dia: a leitura mais nova de pedidos e a
 * mais nova de gasto, e vale a mais atrasada das duas -- "há 2 min" nunca
 * esconde um gasto parado ha 3 h. null = nada foi lido ainda.
 */
export function momentoAtualizado(
  pedidos: (string | null | undefined)[],
  gasto: (string | null | undefined)[]
): number | null {
  const p = maisNova(pedidos);
  const g = maisNova(gasto);
  if (p === null || g === null) return p ?? g;
  return Math.min(p, g);
}

/** "agora", "há 12 min", "há 3 h", "há 2 dias". */
export function haQuanto(momentoMs: number, agoraMs: number): string {
  const min = Math.floor(Math.max(0, agoraMs - momentoMs) / 60_000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  return `há ${dias} ${dias === 1 ? "dia" : "dias"}`;
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
