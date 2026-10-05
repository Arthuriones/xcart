import { linhaDeCookie, type Intervalo, type PeriodoId } from "@/lib/financeiro/tipos";

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
 * tamanho (intervaloDoPeriodo) ou nenhuma. "Mesmo periodo do ano passado" e
 * "personalizado" pedem intervalo livre, que espera aprovacao (decisao 7).
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
