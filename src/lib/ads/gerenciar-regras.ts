import { arredondar, paraNumero } from "@/lib/financeiro/tipos";
import { MOEDAS_SEM_CENTAVOS, orcamentoEmUnidades } from "@/lib/ads/meta-granular";

// ============================================================================
// Gerenciar anuncios do Meta pelo Panda Track (plano-de-acao/03): as regras
// PURAS -- sem I/O, sem "server-only". Quem fala com a Graph e meta-graph.ts;
// quem le o banco, grava o historico e aplica e gerenciar.ts.
//
// Duas partes:
// 1. Edicao a mao: o estado AO VIVO do objeto (lido do Meta na hora, nunca do
//    sync de 15 min) e a validacao do que o lojista quer mudar -- ligar/pausar,
//    orcamento diario ou total de quem o tem (campanha em CBO, conjunto em
//    ABO), lance (bid cap / cost cap) e ROAS minimo, sempre DENTRO da
//    estrategia que ja existe. Criar campanha e trocar estrategia ficam de fora.
// 2. Regras automaticas: dado o que cada objeto fez na janela (gasto e IC do
//    Meta, compras do Panda Track), decide quem pausar, quem tem o orcamento
//    mudado e quem so gera aviso.
// ============================================================================

export type NivelEdicao = "campanha" | "grupo" | "anuncio";
export type CampoEdicao = "status" | "orcamento_diario" | "orcamento_total" | "lance" | "roas_minimo";

export const NIVEIS_EDICAO: readonly NivelEdicao[] = ["campanha", "grupo", "anuncio"];
export const CAMPOS_EDICAO: readonly CampoEdicao[] = [
  "status",
  "orcamento_diario",
  "orcamento_total",
  "lance",
  "roas_minimo",
];

/** Estrategias em que o lance (bid_amount) e um valor que se muda. */
export const ESTRATEGIAS_COM_LANCE: ReadonlySet<string> = new Set(["LOWEST_COST_WITH_BID_CAP", "COST_CAP"]);
export const ESTRATEGIA_ROAS_MINIMO = "LOWEST_COST_WITH_MIN_ROAS";

/**
 * bid_constraints.roas_average_floor vem multiplicado por 10.000: 10000 =
 * ROAS 1,00 (100%). Na tela o lojista ve e digita o ROAS (1,5).
 */
export const ESCALA_ROAS_MINIMO = 10_000;

/** Campos que a Graph aceita ler em cada nivel (campo que o nivel nao tem = erro 100). */
export const CAMPOS_LEITURA: Record<NivelEdicao, string> = {
  campanha: "id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,account_id",
  grupo:
    "id,name,status,effective_status,daily_budget,lifetime_budget,bid_strategy,bid_amount,bid_constraints,campaign_id,account_id",
  anuncio: "id,name,status,effective_status,adset_id,campaign_id,account_id",
};

export interface ObjetoAoVivo {
  id: string;
  nome: string;
  nivel: NivelEdicao;
  /** status configurado no proprio objeto (ACTIVE, PAUSED, ARCHIVED, DELETED). */
  status: string;
  /** effective_status (ACTIVE, CAMPAIGN_PAUSED, ADSET_PAUSED, DISAPPROVED...). */
  efetivo: string;
  /** Unidades da moeda da conta; null = o objeto nao tem esse orcamento. */
  diario: number | null;
  total: number | null;
  estrategia: string | null;
  lance: number | null;
  roasMinimo: number | null;
  /** Conta de anuncio do objeto, so digitos (confere que e a conta pedida). */
  conta: string | null;
  moeda: string;
}

function texto(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function maiusculo(v: unknown): string {
  return texto(v).toUpperCase().slice(0, 40);
}

function orcamentoOuNulo(bruto: unknown, moeda: string): number | null {
  const v = orcamentoEmUnidades(bruto, moeda);
  return v > 0 ? v : null;
}

function roasDasRestricoes(bruto: unknown): number | null {
  let r: unknown = bruto;
  if (typeof r === "string") {
    try {
      r = JSON.parse(r);
    } catch {
      return null;
    }
  }
  if (!r || typeof r !== "object") return null;
  const piso = paraNumero((r as Record<string, unknown>).roas_average_floor);
  return piso > 0 ? arredondar(piso / ESCALA_ROAS_MINIMO, 4) : null;
}

/** Resposta do GET /{id} -> estado ao vivo. Sem id na resposta: null. */
export function objetoAoVivoDaResposta(json: unknown, nivel: NivelEdicao, moeda: string): ObjetoAoVivo | null {
  if (!json || typeof json !== "object") return null;
  const r = json as Record<string, unknown>;
  const id = texto(r.id);
  if (!/^[0-9]{5,25}$/.test(id)) return null;
  const temOrcamento = nivel !== "anuncio";
  const temLance = nivel === "grupo";
  return {
    id,
    nome: texto(r.name) || id,
    nivel,
    status: maiusculo(r.status),
    efetivo: maiusculo(r.effective_status),
    diario: temOrcamento ? orcamentoOuNulo(r.daily_budget, moeda) : null,
    total: temOrcamento ? orcamentoOuNulo(r.lifetime_budget, moeda) : null,
    estrategia: temOrcamento ? maiusculo(r.bid_strategy) || null : null,
    lance: temLance ? orcamentoOuNulo(r.bid_amount, moeda) : null,
    roasMinimo: temLance ? roasDasRestricoes(r.bid_constraints) : null,
    conta: texto(r.account_id).replace(/\D/g, "") || null,
    moeda,
  };
}

/** Unidades da moeda -> o inteiro que a Graph espera (centavos, ou a unidade nas moedas sem centavo). */
export function paraUnidadeMeta(valor: number, moeda: string): string {
  const fator = MOEDAS_SEM_CENTAVOS.has(moeda) ? 1 : 100;
  return String(Math.round(valor * fator));
}

export type ResultadoValidacao =
  | {
      ok: true;
      /** Corpo do POST /{id}. */
      campos: Record<string, string>;
      antes: string;
      depois: string;
    }
  | { ok: false; erro: string };

/** Teto de sanidade: digito a mais no orcamento (50 -> 5000) nao passa. */
export const MULTIPLICADOR_MAXIMO = 10;

function numeroValido(valor: unknown): number | null {
  const n = typeof valor === "number" ? valor : typeof valor === "string" ? Number(valor.replace(",", ".")) : NaN;
  return Number.isFinite(n) ? n : null;
}

function formatarValor(n: number): string {
  return String(arredondar(n, 2));
}

/**
 * O que o lojista pediu, contra o estado AO VIVO do objeto -> corpo do POST.
 * Recusa o que muda a estrategia (lance numa campanha sem cap, orcamento num
 * objeto que nao o tem) e o que nao mudaria nada.
 */
export function validarAlteracao(obj: ObjetoAoVivo, campo: CampoEdicao, valorPedido: unknown): ResultadoValidacao {
  if (obj.status === "ARCHIVED" || obj.status === "DELETED") {
    return { ok: false, erro: "Objeto arquivado ou apagado no Meta: não dá para editar." };
  }

  if (campo === "status") {
    const alvo = maiusculo(valorPedido);
    if (alvo !== "ACTIVE" && alvo !== "PAUSED") return { ok: false, erro: "Status deve ser ACTIVE ou PAUSED." };
    if (obj.status === alvo) {
      return { ok: false, erro: alvo === "ACTIVE" ? "Já está ativo no Meta." : "Já está pausado no Meta." };
    }
    return { ok: true, campos: { status: alvo }, antes: obj.status, depois: alvo };
  }

  const n = numeroValido(valorPedido);
  if (n === null || n <= 0) return { ok: false, erro: "Informe um valor maior que zero." };
  const valor = arredondar(n, campo === "roas_minimo" ? 4 : 2);

  const mudanca = (atual: number | null, chave: string, corpo: string): ResultadoValidacao => {
    if (atual === null) return { ok: false, erro: "Este objeto não tem esse campo no Meta." };
    if (valor === atual) return { ok: false, erro: "O valor é o mesmo de agora." };
    if (valor > atual * MULTIPLICADOR_MAXIMO) {
      return { ok: false, erro: `O novo valor é mais de ${MULTIPLICADOR_MAXIMO} vezes o atual. Confira os dígitos.` };
    }
    return { ok: true, campos: { [chave]: corpo }, antes: formatarValor(atual), depois: formatarValor(valor) };
  };

  if (campo === "orcamento_diario") {
    if (obj.nivel === "anuncio") return { ok: false, erro: "Anúncio não tem orçamento: mude o do conjunto ou da campanha." };
    if (obj.diario === null) {
      return {
        ok: false,
        erro:
          obj.total !== null
            ? "Este objeto usa orçamento total, não diário."
            : obj.nivel === "campanha"
              ? "O orçamento fica nos conjuntos (ABO): mude no conjunto."
              : "O orçamento fica na campanha (CBO): mude na campanha.",
      };
    }
    return mudanca(obj.diario, "daily_budget", paraUnidadeMeta(valor, obj.moeda));
  }

  if (campo === "orcamento_total") {
    if (obj.nivel === "anuncio") return { ok: false, erro: "Anúncio não tem orçamento." };
    if (obj.total === null) return { ok: false, erro: "Este objeto não usa orçamento total." };
    return mudanca(obj.total, "lifetime_budget", paraUnidadeMeta(valor, obj.moeda));
  }

  if (campo === "lance") {
    if (obj.nivel !== "grupo") return { ok: false, erro: "O lance fica no conjunto de anúncios." };
    if (!obj.estrategia || !ESTRATEGIAS_COM_LANCE.has(obj.estrategia)) {
      return { ok: false, erro: "A estratégia deste conjunto não usa lance (só limite de lance ou de custo)." };
    }
    if (obj.lance === null) return { ok: false, erro: "O Meta não informou o lance deste conjunto." };
    return mudanca(obj.lance, "bid_amount", paraUnidadeMeta(valor, obj.moeda));
  }

  // roas_minimo
  if (obj.nivel !== "grupo") return { ok: false, erro: "O ROAS mínimo fica no conjunto de anúncios." };
  if (obj.estrategia !== ESTRATEGIA_ROAS_MINIMO) {
    return { ok: false, erro: "A estratégia deste conjunto não usa ROAS mínimo." };
  }
  return mudanca(
    obj.roasMinimo,
    "bid_constraints",
    JSON.stringify({ roas_average_floor: Math.round(valor * ESCALA_ROAS_MINIMO) })
  );
}

// ============================================================================
// Regras automaticas
// ============================================================================

export type MetricaRegra = "custo_por_ic" | "custo_por_compra" | "gasto" | "cpc" | "ctr" | "cpm" | "roas";
export type OperadorRegra = "maior" | "menor";
export type JanelaRegra = "hoje" | "3d" | "7d";
export type AcaoRegra = "pausar" | "diminuir_orcamento" | "aumentar_orcamento" | "avisar";

export const METRICAS_REGRA: readonly MetricaRegra[] = ["custo_por_ic", "custo_por_compra", "gasto", "cpc", "ctr", "cpm"];
export const JANELAS_REGRA: readonly JanelaRegra[] = ["hoje", "3d", "7d"];
export const ACOES_REGRA: readonly AcaoRegra[] = ["pausar", "diminuir_orcamento", "aumentar_orcamento", "avisar"];
export const INTERVALOS_REGRA: readonly number[] = [30, 60, 120, 180, 360, 720, 1440];

/** Dias da janela, contando hoje (no fuso da conta). */
export const DIAS_DA_JANELA: Record<JanelaRegra, number> = { hoje: 1, "3d": 3, "7d": 7 };

/** Quantos objetos uma passada da regra mexe, no maximo: erro de regra nao derruba a conta inteira. */
export const MAX_ACOES_POR_PASSADA = 25;

export interface RegraAnuncio {
  id: string;
  nome: string;
  nivel: NivelEdicao;
  filtroNome: string | null;
  metrica: MetricaRegra;
  operador: OperadorRegra;
  valor: number;
  gastoMinimo: number;
  janela: JanelaRegra;
  acao: AcaoRegra;
  acaoPercentual: number | null;
  orcamentoLimite: number | null;
  intervaloMinutos: number;
}

/** O que um objeto fez na janela (moeda da conta) e como esta agora. */
export interface ObjetoNaJanela {
  contaId: string;
  objetoId: string;
  nome: string;
  nivel: NivelEdicao;
  /** effective_status do sync mais recente. */
  status: string;
  gasto: number;
  impressoes: number;
  cliques: number;
  /** IC do Meta (pixel + CAPI deduplicados: o nosso servidor entra aqui). */
  ic: number;
  /** Pedidos do Panda Track atribuidos ao objeto; null = sem como contar (sem loja). */
  compras: number | null;
  /** Orcamento diario PROPRIO; 0 = nao tem (anuncio, ou o orcamento e do outro nivel). */
  orcamentoDiario: number;
}

export interface DecisaoRegra {
  objeto: ObjetoNaJanela;
  /** O valor da metrica (null = sem resultado: ex. custo por IC sem IC). */
  valorMetrica: number | null;
  acao: AcaoRegra;
  /** Orcamento novo (so nas acoes de orcamento). */
  orcamentoNovo: number | null;
}

export interface ResultadoRegra {
  decisoes: DecisaoRegra[];
  /** Objetos julgados (passaram no filtro, no status e no gasto minimo). */
  julgados: number;
  /** Bateram a condicao mas nao viram acao (sem orcamento proprio, no limite...). */
  ignorados: { objetoId: string; nome: string; motivo: string }[];
  /** Bateram e ficaram de fora pelo teto de acoes por passada. */
  cortados: number;
}

function semAcento(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

export function passaNoFiltro(nome: string, filtro: string | null): boolean {
  if (!filtro || !filtro.trim()) return true;
  return semAcento(nome).includes(semAcento(filtro.trim()));
}

/**
 * Metrica do objeto. Divisao por zero (custo por IC sem IC) devolve
 * `semResultado`: quem compara decide (gastou 25 sem nenhum IC = o custo por
 * IC ja e maior que 20; mas nunca e "menor que").
 */
export function valorDaMetrica(
  metrica: MetricaRegra,
  o: ObjetoNaJanela
): { valor: number | null; piso: number | null; indisponivel: boolean } {
  const razao = (num: number, den: number, mult = 1) =>
    den > 0
      ? { valor: arredondar((num / den) * mult, 4), piso: null, indisponivel: false }
      : { valor: null, piso: num * mult, indisponivel: false };
  switch (metrica) {
    case "gasto":
      return { valor: arredondar(o.gasto, 2), piso: null, indisponivel: false };
    case "custo_por_ic":
      return razao(o.gasto, o.ic);
    case "custo_por_compra":
      if (o.compras === null) return { valor: null, piso: null, indisponivel: true };
      return razao(o.gasto, o.compras);
    case "cpc":
      return razao(o.gasto, o.cliques);
    case "cpm":
      return o.impressoes > 0
        ? { valor: arredondar((o.gasto / o.impressoes) * 1000, 4), piso: null, indisponivel: false }
        : { valor: null, piso: null, indisponivel: false };
    case "ctr":
      return o.impressoes > 0
        ? { valor: arredondar((o.cliques / o.impressoes) * 100, 4), piso: null, indisponivel: false }
        : { valor: null, piso: null, indisponivel: false };
    case "roas":
      // Receita por anuncio ainda nao e lida pela regra (plano-de-acao/03).
      return { valor: null, piso: null, indisponivel: true };
  }
}

export function bateCondicao(
  operador: OperadorRegra,
  limite: number,
  m: { valor: number | null; piso: number | null; indisponivel: boolean }
): boolean {
  if (m.indisponivel) return false;
  if (m.valor !== null) return operador === "maior" ? m.valor > limite : m.valor < limite;
  // Sem resultado: o custo ja passou do que foi gasto; nunca e "menor".
  return operador === "maior" && m.piso !== null && m.piso > limite;
}

/** Orcamento novo da acao, ou o motivo de nao mexer. */
export function orcamentoDaAcao(
  regra: Pick<RegraAnuncio, "acao" | "acaoPercentual" | "orcamentoLimite">,
  atual: number
): { novo: number } | { motivo: string } {
  if (atual <= 0) return { motivo: "sem orçamento diário próprio (fica no outro nível)" };
  const p = regra.acaoPercentual ?? 0;
  if (!(p > 0)) return { motivo: "percentual da ação não definido" };
  if (regra.acao === "diminuir_orcamento") {
    const piso = regra.orcamentoLimite ?? 0;
    const novo = Math.max(piso, arredondar(atual * (1 - p / 100), 2));
    if (novo <= 0) return { motivo: "o orçamento chegaria a zero" };
    if (novo >= atual) return { motivo: "já está no piso definido" };
    return { novo };
  }
  const teto = regra.orcamentoLimite ?? Number.POSITIVE_INFINITY;
  const novo = Math.min(teto, arredondar(atual * (1 + p / 100), 2));
  if (novo <= atual) return { motivo: "já está no teto definido" };
  return { novo };
}

/**
 * Quem a regra pega agora. So objeto ATIVO (o efetivo: anuncio de conjunto
 * pausado nao gasta e nao e julgado), do nivel da regra, com o nome no filtro
 * e com o gasto minimo na janela.
 */
export function avaliarRegra(regra: RegraAnuncio, objetos: readonly ObjetoNaJanela[]): ResultadoRegra {
  const decisoes: DecisaoRegra[] = [];
  const ignorados: ResultadoRegra["ignorados"] = [];
  let julgados = 0;
  let cortados = 0;

  // Quem mais gastou primeiro: com o teto de acoes, o que mais queima vem antes.
  const ordenados = [...objetos].sort((a, b) => b.gasto - a.gasto);
  for (const o of ordenados) {
    if (o.nivel !== regra.nivel) continue;
    if (o.status !== "ACTIVE") continue;
    if (!passaNoFiltro(o.nome, regra.filtroNome)) continue;
    if (o.gasto < regra.gastoMinimo) continue;
    julgados += 1;

    const m = valorDaMetrica(regra.metrica, o);
    if (!bateCondicao(regra.operador, regra.valor, m)) continue;

    let orcamentoNovo: number | null = null;
    if (regra.acao === "diminuir_orcamento" || regra.acao === "aumentar_orcamento") {
      const r = orcamentoDaAcao(regra, o.orcamentoDiario);
      if ("motivo" in r) {
        ignorados.push({ objetoId: o.objetoId, nome: o.nome, motivo: r.motivo });
        continue;
      }
      orcamentoNovo = r.novo;
    }

    if (decisoes.length >= MAX_ACOES_POR_PASSADA) {
      cortados += 1;
      continue;
    }
    decisoes.push({ objeto: o, valorMetrica: m.valor ?? m.piso, acao: regra.acao, orcamentoNovo });
  }

  return { decisoes, julgados, ignorados, cortados };
}

/** Confere o que vem da tela antes de gravar. Devolve o motivo do erro, ou null. */
export function erroDaRegra(r: RegraAnuncio): string | null {
  if (!r.nome.trim() || r.nome.trim().length > 80) return "Dê um nome à regra (até 80 caracteres).";
  if (!NIVEIS_EDICAO.includes(r.nivel)) return "Nível inválido.";
  if (!METRICAS_REGRA.includes(r.metrica)) return "Métrica inválida.";
  if (r.operador !== "maior" && r.operador !== "menor") return "Condição inválida.";
  if (!Number.isFinite(r.valor) || r.valor < 0) return "Informe o valor da condição.";
  if (!Number.isFinite(r.gastoMinimo) || r.gastoMinimo < 0) return "Gasto mínimo inválido.";
  if (!JANELAS_REGRA.includes(r.janela)) return "Período inválido.";
  if (!ACOES_REGRA.includes(r.acao)) return "Ação inválida.";
  if (!INTERVALOS_REGRA.includes(r.intervaloMinutos)) return "Intervalo inválido.";
  if (r.filtroNome !== null && r.filtroNome.length > 80) return "Filtro de nome muito longo.";
  const deOrcamento = r.acao === "diminuir_orcamento" || r.acao === "aumentar_orcamento";
  if (deOrcamento) {
    if (r.nivel === "anuncio") return "Anúncio não tem orçamento: use a regra no conjunto ou na campanha.";
    if (r.acaoPercentual === null || !(r.acaoPercentual > 0) || r.acaoPercentual > 100) {
      return "Informe o percentual da mudança de orçamento (1 a 100).";
    }
    if (r.acao === "diminuir_orcamento" && r.acaoPercentual >= 100) return "Para zerar, use a ação Pausar.";
    if (r.orcamentoLimite !== null && !(r.orcamentoLimite > 0)) return "O limite do orçamento deve ser maior que zero.";
  }
  if (r.metrica === "ctr" && r.valor > 100) return "CTR é uma porcentagem (0 a 100).";
  return null;
}

/** A proxima passada: agora + intervalo, no minuto cheio. */
export function proximaExecucao(agoraMs: number, intervaloMinutos: number): string {
  const ms = agoraMs + intervaloMinutos * 60_000;
  return new Date(Math.floor(ms / 60_000) * 60_000).toISOString();
}

/** Frase curta do que a regra faz, para lista e historico. */
export function descreverRegra(r: Pick<RegraAnuncio, "metrica" | "operador" | "valor" | "acao" | "acaoPercentual" | "janela" | "nivel">): string {
  const metrica: Record<MetricaRegra, string> = {
    custo_por_ic: "custo por IC",
    custo_por_compra: "custo por compra",
    gasto: "gasto",
    cpc: "CPC",
    ctr: "CTR",
    cpm: "CPM",
    roas: "ROAS",
  };
  const nivel: Record<NivelEdicao, string> = { campanha: "a campanha", grupo: "o conjunto", anuncio: "o anúncio" };
  const janela: Record<JanelaRegra, string> = { hoje: "hoje", "3d": "nos últimos 3 dias", "7d": "nos últimos 7 dias" };
  const valor = r.metrica === "ctr" ? `${r.valor}%` : String(r.valor);
  const acao =
    r.acao === "pausar"
      ? `pausar ${nivel[r.nivel]}`
      : r.acao === "avisar"
        ? "só avisar"
        : `${r.acao === "diminuir_orcamento" ? "diminuir" : "aumentar"} o orçamento em ${r.acaoPercentual}%`;
  return `Se ${metrica[r.metrica]} ${janela[r.janela]} ${r.operador === "maior" ? "passar de" : "ficar abaixo de"} ${valor}: ${acao}.`;
}

function isoLocal(ms: number, fuso: string): string {
  const partes = new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ms));
  const p = (t: string) => partes.find((x) => x.type === t)?.value ?? "00";
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}:${p("second")}`;
}

/**
 * Instante (ms) da meia-noite do `dia` no fuso da conta: o "hoje" da regra e o
 * dia da conta, o mesmo do Insights. Fuso invalido cai em UTC.
 */
export function inicioDoDiaNoFuso(dia: string, fuso: string | null | undefined): number {
  const alvo = Date.parse(`${dia}T00:00:00Z`);
  let tz = fuso || "UTC";
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: tz });
  } catch {
    tz = "UTC";
  }
  let t = alvo;
  // Duas voltas acertam o horario de verao (o deslocamento muda perto da virada).
  for (let i = 0; i < 2; i += 1) {
    const local = Date.parse(`${isoLocal(t, tz)}Z`);
    t += alvo - local;
  }
  return t;
}
