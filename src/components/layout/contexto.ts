import {
  diasNoIntervalo,
  ehPersonalizado,
  linhaDeCookie,
  type Intervalo,
  type Periodo,
  type PeriodoId,
} from "@/lib/financeiro/tipos";

// ============================================================================
// Contexto dos numeros (loja, periodo, comparacao, moeda, fuso): o que a barra
// do topo mostra e grava. Puro, sem React e sem "server-only": o servidor le
// os mesmos nomes de cookie que o navegador grava.
//
// Loja, periodo e moeda moram em src/lib/financeiro/tipos.ts (COOKIE_LOJA e
// cia.) e nao mudam de lugar. A comparacao e nova e fica aqui.
// ============================================================================

export const COOKIE_COMPARAR = "xc_comparar";

/**
 * So as comparacoes que o calculo ja sabe fazer: o periodo anterior de mesmo
 * tamanho (intervaloDoPeriodo) ou nenhuma. "Mesmo periodo do ano passado" pede
 * outra regra de anterior, que espera aprovacao (decisao 7). O periodo
 * "Personalizado" (datas do calendario) compara com os mesmos N dias antes;
 * alinhado ao mes, como "Este mes"/"Mes passado" (ver intervaloPersonalizado).
 */
export type Comparacao = "anterior" | "nenhum";
export const COMPARACAO_PADRAO: Comparacao = "anterior";

export function comparacaoDeCookie(valor?: string | null): Comparacao {
  return valor === "nenhum" ? "nenhum" : COMPARACAO_PADRAO;
}

/** Menu lateral recolhido: lido no servidor para a largura nao pular. */
export const COOKIE_MENU = "xc_menu";

/**
 * O que a barra de contexto mostra em cada tela.
 * - nenhum: tela sem numero do periodo (Lojas, Importar, Assinatura...).
 * - loja: tela que so filtra por loja, e diz isso (Custos, Eventos, Alertas).
 * - completo: loja, periodo, comparacao e moeda (Lucro). `semComparar`: a
 *   tela nao compara periodos (Pedidos) e o "Comparar com" some.
 * - fixo: loja e um periodo que a tela nao deixa trocar, escrito na barra.
 */
export type ModoContexto =
  | { tipo: "nenhum" }
  | { tipo: "loja" }
  | { tipo: "completo"; semComparar?: true }
  | { tipo: "fixo"; texto: string };

export const ROTULO_PERIODO: Record<PeriodoId, string> = {
  hoje: "Hoje",
  ontem: "Ontem",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  mes: "Este mês",
  mes_passado: "Mês passado",
};

export const ROTULO_COMPARACAO: Record<Comparacao, string> = {
  anterior: "Período anterior",
  nenhum: "Sem comparação",
};

/** O "Personalizado" da barra: datas fixas escolhidas no calendario. */
export const ROTULO_PERSONALIZADO = "Personalizado";

/** Meses abreviados, sem ponto: "15 out", e o grafico agrupado por mes. */
export const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export const MESES_LONGOS = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];

/** "2026-10-05" -> ["5", "out", "2026"]: dia sem zero a esquerda. */
function partesDoDia(dia: string): [string, string, string] {
  return [String(Number(dia.slice(8, 10))), MESES[Number(dia.slice(5, 7)) - 1] ?? "", dia.slice(0, 4)];
}

/**
 * Datas do personalizado, curtas. O ano so aparece quando nao e o de hoje.
 * - um dia: "15 out" ("15 out 2025");
 * - mesmo mes: "10–14 out";
 * - meses diferentes: "10 set – 14 out";
 * - anos diferentes: "28 dez 2025 – 3 jan 2026".
 */
export function rotuloDatas(i: Intervalo, hoje: string): string {
  const [d1, m1, a1] = partesDoDia(i.desde);
  const [d2, m2, a2] = partesDoDia(i.ate);
  const ano = (a: string) => (a !== hoje.slice(0, 4) ? ` ${a}` : "");
  if (i.desde === i.ate) return `${d2} ${m2}${ano(a2)}`;
  if (a1 !== a2) return `${d1} ${m1} ${a1} – ${d2} ${m2} ${a2}`;
  if (m1 === m2) return `${d1}–${d2} ${m2}${ano(a2)}`;
  return `${d1} ${m1} – ${d2} ${m2}${ano(a2)}`;
}

/** "5 dias", "1 dia". */
export function rotuloDias(i: Intervalo): string {
  const n = diasNoIntervalo(i);
  return n === 1 ? "1 dia" : `${n} dias`;
}

/**
 * O nome curto do periodo, para o botao do topo e o resumo do celular:
 * "Últimos 7 dias", ou as datas do personalizado ("10–14 out").
 * `intervalo` e o atual ja calculado (intervaloDoPeriodo).
 */
export function nomeDoPeriodo(p: Periodo, intervalo: Intervalo, hoje: string): string {
  return ehPersonalizado(p) ? rotuloDatas(intervalo, hoje) : ROTULO_PERIODO[p];
}

/**
 * O periodo por extenso, para titulos e leitor de tela: "Últimos 7 dias
 * (13/10–19/10)". O personalizado ja e as datas: so "10–14 out".
 */
export function rotuloDoPeriodo(p: Periodo, intervalo: Intervalo, hoje: string): string {
  return ehPersonalizado(p)
    ? rotuloDatas(intervalo, hoje)
    : `${ROTULO_PERIODO[p]} (${rotuloIntervalo(intervalo)})`;
}

/** "2026-10-02" -> "02/10". */
export function diaCurto(dia: string): string {
  return `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;
}

/** "03/09–02/10", ou so "02/10" quando o intervalo e um dia. */
export function rotuloIntervalo(i: Intervalo): string {
  return i.desde === i.ate ? diaCurto(i.desde) : `${diaCurto(i.desde)}–${diaCurto(i.ate)}`;
}

/** Fuso IANA em palavras: "horário de São Paulo", "horário de New York". */
export function rotuloFuso(fuso: string): string {
  if (fuso === "America/Sao_Paulo") return "horário de São Paulo";
  const cidade = fuso.split("/").pop()?.replace(/_/g, " ");
  return cidade ? `horário de ${cidade}` : "horário UTC";
}

/** "14:32" no fuso dado. Fuso invalido cai no do navegador, nunca lanca. */
export function horaNoFuso(instante: number, fuso: string): string {
  const opcoes: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat("pt-BR", { ...opcoes, timeZone: fuso }).format(instante);
  } catch {
    return new Intl.DateTimeFormat("pt-BR", opcoes).format(instante);
  }
}

/** Grava uma preferencia de tela. So no navegador. */
export function gravarCookie(nome: string, valor: string): void {
  document.cookie = linhaDeCookie(nome, valor);
}
