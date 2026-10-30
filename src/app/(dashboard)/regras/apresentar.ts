import { diaCurto, horaNoFuso } from "@/components/layout/contexto";
import { FUSO_RELATORIO_PADRAO, diaNoFuso, formatarDinheiro } from "@/lib/financeiro/tipos";
import type {
  AcaoRegra,
  CampoEdicao,
  JanelaRegra,
  MetricaRegra,
  NivelEdicao,
  OperadorRegra,
  RegraAnuncio,
} from "@/lib/ads/gerenciar-regras";
import type { AcaoPassada, OpcaoEscopo, RegraEntrada, RegraTela, ResultadoPassada, TipoEscopo } from "@/lib/ads/regras-tipos";

// ============================================================================
// Regras automaticas: o que a tela escreve (rotulos, numeros, tempo) e o
// formulario em texto <-> RegraEntrada. Puro: sem React, sem I/O.
// ============================================================================

export const ROTULO_NIVEL: Record<NivelEdicao, string> = {
  campanha: "Campanha",
  grupo: "Conjunto",
  anuncio: "Anúncio",
};

export const ROTULO_METRICA: Record<MetricaRegra, string> = {
  custo_por_ic: "Custo por IC",
  custo_por_compra: "Custo por compra",
  gasto: "Gasto",
  cpc: "CPC",
  ctr: "CTR",
  cpm: "CPM",
  roas: "ROAS",
};

export const ROTULO_OPERADOR: Record<OperadorRegra, string> = {
  maior: "passar de",
  menor: "ficar abaixo de",
};

export const ROTULO_JANELA: Record<JanelaRegra, string> = {
  hoje: "Hoje",
  "3d": "Últimos 3 dias",
  "7d": "Últimos 7 dias",
};

export const ROTULO_ACAO: Record<AcaoRegra, string> = {
  pausar: "Pausar",
  diminuir_orcamento: "Diminuir orçamento",
  aumentar_orcamento: "Aumentar orçamento",
  avisar: "Só avisar",
};

export const ROTULO_CAMPO: Record<CampoEdicao, string> = {
  status: "Status",
  orcamento_diario: "Orçamento diário",
  orcamento_total: "Orçamento total",
  lance: "Lance",
  roas_minimo: "ROAS mínimo",
};

export const ROTULO_TIPO_ESCOPO: Record<TipoEscopo, string> = {
  loja: "Lojas",
  checkout: "Checkouts",
  conta: "Contas de anúncio",
};

export function ehDeOrcamento(acao: AcaoRegra): boolean {
  return acao === "diminuir_orcamento" || acao === "aumentar_orcamento";
}

/** 30 -> "30 min", 60 -> "1 h", 1440 -> "24 h". */
export function rotuloIntervalo(minutos: number): string {
  return minutos < 60 ? `${minutos} min` : `${minutos / 60} h`;
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** "24/10 07:30" no fuso do relatorio (o mesmo da aba Campanhas). */
export function quando(iso: string): string {
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return "";
  return `${diaCurto(diaNoFuso(instante, FUSO_RELATORIO_PADRAO))} ${horaNoFuso(instante.getTime(), FUSO_RELATORIO_PADRAO)}`;
}

/** "há 12 min", "em 40 min", "há 2 dias". `agora` vem de fora: o render nao le o relogio. */
export function relativo(iso: string | null, agora: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "";
  const dif = t - agora;
  const min = Math.round(Math.abs(dif) / 60_000);
  if (min < 1) return dif <= 0 ? "agora há pouco" : "em instantes";
  const texto = min < 60 ? `${min} min` : min < 48 * 60 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} dias`;
  return dif <= 0 ? `há ${texto}` : `em ${texto}`;
}

function numero(v: number, casas = 2): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

/** Dinheiro na moeda da conta; sem moeda unica (escopo com contas em moedas diferentes), so o numero. */
export function dinheiro(v: number | null, moeda: string | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return moeda ? formatarDinheiro(v, moeda) : numero(v);
}

/** Valor da metrica de uma acao: CTR em %, o resto em dinheiro. */
export function valorDaMetricaTexto(metrica: MetricaRegra, v: number | null, moeda: string | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (metrica === "ctr") return `${numero(v)}%`;
  if (metrica === "roas") return numero(v);
  return dinheiro(v, moeda);
}

/** "8 julgados · 1 ação · 1 com erro". */
export function resumoDaPassada(r: ResultadoPassada): string {
  const partes = [plural(r.julgados, "julgado", "julgados"), plural(r.acoes.length, "ação", "ações")];
  const erros = r.acoes.filter((a) => a.ok === false).length;
  if (erros > 0) partes.push(`${erros} com erro`);
  if (r.cortados > 0) partes.push(`${r.cortados} para a próxima`);
  return partes.join(" · ");
}

/** O que a acao fez (ou faria, na simulacao). */
export function textoDaAcao(a: AcaoPassada, moeda: string | null, simulacao: boolean): string {
  if (a.acao === "pausar") return simulacao ? "Pausaria" : "Pausado";
  if (a.acao === "avisar") return simulacao ? "Só avisaria" : "Aviso";
  const verbo =
    a.acao === "diminuir_orcamento"
      ? simulacao
        ? "Diminuiria o orçamento"
        : "Orçamento diminuído"
      : simulacao
        ? "Aumentaria o orçamento"
        : "Orçamento aumentado";
  return `${verbo} de ${dinheiro(a.orcamentoAtual, moeda)} para ${dinheiro(a.orcamentoNovo, moeda)}`;
}

/** Valor de um campo do historico ("ACTIVE" -> "Ativo", "50.5" -> "50,50"). */
export function valorDoHistorico(campo: CampoEdicao, v: string | null): string {
  if (v === null || v === "") return "—";
  if (campo === "status") {
    const mapa: Record<string, string> = {
      ACTIVE: "Ativo",
      PAUSED: "Pausado",
      ARCHIVED: "Arquivado",
      DELETED: "Apagado",
    };
    return mapa[v.toUpperCase()] ?? v;
  }
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return numero(n);
}

// ---------------------------------------------------------------------------
// Formulario: tudo em texto (o lojista digita "20,5"), convertido so ao salvar.
// ---------------------------------------------------------------------------

export interface FormRegra {
  nome: string;
  /** "tipo:id" da opcao de escopo; "" = nada escolhido. */
  escopo: string;
  nivel: NivelEdicao;
  filtroNome: string;
  metrica: MetricaRegra;
  operador: OperadorRegra;
  valor: string;
  gastoMinimo: string;
  janela: JanelaRegra;
  acao: AcaoRegra;
  acaoPercentual: string;
  orcamentoLimite: string;
  intervaloMinutos: number;
}

export function chaveEscopo(e: { tipo: TipoEscopo; id: string }): string {
  return `${e.tipo}:${e.id}`;
}

export function escopoDaChave(chave: string): { tipo: TipoEscopo; id: string } | null {
  const i = chave.indexOf(":");
  if (i <= 0) return null;
  const tipo = chave.slice(0, i);
  const id = chave.slice(i + 1);
  if ((tipo !== "loja" && tipo !== "checkout" && tipo !== "conta") || !id) return null;
  return { tipo, id };
}

/** O primeiro escopo onde a regra teria onde agir (com conta do Meta). */
export function escopoPadrao(escopos: readonly OpcaoEscopo[]): string {
  const e = escopos.find((x) => x.contasMeta > 0);
  return e ? chaveEscopo(e) : "";
}

/** "20,5" e "1.234,50" -> numero; vazio ou lixo -> NaN. */
export function lerNumero(s: string): number {
  let t = s.trim().replace(/\s/g, "");
  if (!t) return NaN;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  return /^-?\d*\.?\d+$/.test(t) ? Number(t) : NaN;
}

function paraCampo(n: number | null): string {
  return n === null || !Number.isFinite(n) ? "" : String(n).replace(".", ",");
}

export function formEmBranco(escopos: readonly OpcaoEscopo[]): FormRegra {
  return {
    nome: "",
    escopo: escopoPadrao(escopos),
    nivel: "anuncio",
    filtroNome: "",
    metrica: "custo_por_ic",
    operador: "maior",
    valor: "",
    gastoMinimo: "",
    janela: "hoje",
    acao: "pausar",
    acaoPercentual: "",
    orcamentoLimite: "",
    intervaloMinutos: 60,
  };
}

/** O exemplo do estado vazio: o caso que o lojista mais pede. */
export function formExemplo(escopos: readonly OpcaoEscopo[]): FormRegra {
  return {
    ...formEmBranco(escopos),
    nome: "Pausar anúncio com custo por IC acima de 20",
    valor: "20",
    gastoMinimo: "20",
  };
}

export function formDaRegra(r: RegraTela): FormRegra {
  return {
    nome: r.nome,
    escopo: chaveEscopo(r.escopo),
    nivel: r.nivel,
    filtroNome: r.filtroNome ?? "",
    metrica: r.metrica,
    operador: r.operador,
    valor: paraCampo(r.valor),
    gastoMinimo: paraCampo(r.gastoMinimo),
    janela: r.janela,
    acao: r.acao,
    acaoPercentual: paraCampo(r.acaoPercentual),
    orcamentoLimite: paraCampo(r.orcamentoLimite),
    intervaloMinutos: r.intervaloMinutos,
  };
}

/** O formulario no formato que erroDaRegra e descreverRegra leem. Gasto minimo vazio = 0. */
export function regraDoForm(f: FormRegra): RegraAnuncio {
  const orcamento = ehDeOrcamento(f.acao);
  const limite = lerNumero(f.orcamentoLimite);
  const filtro = f.filtroNome.trim();
  return {
    id: "",
    nome: f.nome.trim(),
    nivel: f.nivel,
    filtroNome: filtro ? filtro : null,
    metrica: f.metrica,
    operador: f.operador,
    valor: lerNumero(f.valor),
    gastoMinimo: f.gastoMinimo.trim() ? lerNumero(f.gastoMinimo) : 0,
    janela: f.janela,
    acao: f.acao,
    acaoPercentual: orcamento ? (f.acaoPercentual.trim() ? lerNumero(f.acaoPercentual) : null) : null,
    orcamentoLimite: orcamento && f.orcamentoLimite.trim() ? limite : null,
    intervaloMinutos: f.intervaloMinutos,
  };
}

/** Corpo do POST/PATCH. null = escopo invalido (quem chama ja validou). */
export function entradaDoForm(f: FormRegra): Omit<RegraEntrada, "ativa"> | null {
  const escopo = escopoDaChave(f.escopo);
  if (!escopo) return null;
  const r = regraDoForm(f);
  return {
    nome: r.nome,
    escopo,
    nivel: r.nivel,
    filtroNome: r.filtroNome,
    metrica: r.metrica,
    operador: r.operador,
    valor: r.valor,
    gastoMinimo: r.gastoMinimo,
    janela: r.janela,
    acao: r.acao,
    acaoPercentual: r.acaoPercentual,
    orcamentoLimite: r.orcamentoLimite,
    intervaloMinutos: r.intervaloMinutos,
  };
}
