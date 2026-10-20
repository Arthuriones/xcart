import {
  TETO_PERSONALIZADO_DIAS,
  VOLTA_MAXIMA_DIAS,
  diasNoIntervalo,
  somarDias,
  type Intervalo,
} from "@/lib/financeiro/tipos";

// ============================================================================
// As regras do calendario do "Personalizado" (calendario.tsx), puras e
// testadas em tests/periodo-personalizado.test.ts. Dias sempre "AAAA-MM-DD",
// meses "AAAA-MM", contas em UTC: o dia e de calendario, o fuso ja entrou no
// "hoje" que chega do servidor.
// ============================================================================

export interface LimitesCalendario {
  /** O dia mais antigo que da para escolher. */
  min: string;
  /** Hoje, no fuso do relatorio: depois dele nao ha dado. */
  max: string;
}

export function limitesDoCalendario(hoje: string): LimitesCalendario {
  return { min: somarDias(hoje, -VOLTA_MAXIMA_DIAS), max: hoje };
}

/** "2026-10-19" -> "2026-10". */
export function mesDo(dia: string): string {
  return dia.slice(0, 7);
}

/** "2026-10" + n meses. */
export function somarMeses(mes: string, n: number): string {
  const d = new Date(Date.UTC(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)) - 1 + n, 1));
  return d.toISOString().slice(0, 7);
}

/** O mesmo dia noutro mes, sem estourar: 31/03 menos um mes e 28/02. */
export function somarMesesAoDia(dia: string, n: number): string {
  const mes = somarMeses(mesDo(dia), n);
  const ultimo = Number(somarDias(`${somarMeses(mes, 1)}-01`, -1).slice(8, 10));
  const d = Math.min(Number(dia.slice(8, 10)), ultimo);
  return `${mes}-${String(d).padStart(2, "0")}`;
}

/** 0 = domingo. */
function diaDaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/**
 * A grade do mes: 6 semanas de domingo a sabado, null fora do mes. Sempre 6
 * linhas, para a altura nao pular ao trocar de mes.
 */
export function semanasDoMes(mes: string): (string | null)[][] {
  const primeiro = `${mes}-01`;
  const inicio = somarDias(primeiro, -diaDaSemana(primeiro));
  return Array.from({ length: 6 }, (_, s) =>
    Array.from({ length: 7 }, (_, d) => {
      const dia = somarDias(inicio, s * 7 + d);
      return mesDo(dia) === mes ? dia : null;
    })
  );
}

export function ordenar(a: string, b: string): Intervalo {
  return a <= b ? { desde: a, ate: b } : { desde: b, ate: a };
}

export function limitarDia(dia: string, l: LimitesCalendario): string {
  return dia < l.min ? l.min : dia > l.max ? l.max : dia;
}

/**
 * O dia nao pode ser escolhido: depois de hoje, antes do minimo, ou -- com o
 * inicio ja marcado -- longe dele demais para caber no teto.
 */
export function diaBloqueado(dia: string, l: LimitesCalendario, inicio: string | null): boolean {
  if (dia < l.min || dia > l.max) return true;
  return inicio !== null && diasNoIntervalo(ordenar(inicio, dia)) > TETO_PERSONALIZADO_DIAS;
}

/**
 * Um clique (ou Enter) num dia. Sem inicio marcado, o dia vira o inicio e a
 * escolha ja vale esse dia so (Aplicar agora aplica um dia). Com inicio, fecha
 * o intervalo: as pontas trocam se o segundo vier antes, e o mesmo dia de novo
 * escolhe so ele.
 */
export function escolherDia(
  inicio: string | null,
  dia: string
): { inicio: string | null; intervalo: Intervalo } {
  if (inicio === null) return { inicio: dia, intervalo: { desde: dia, ate: dia } };
  return { inicio: null, intervalo: ordenar(inicio, dia) };
}

/**
 * Para onde a tecla leva o foco (antes de limitar). null = tecla que o
 * calendario nao usa. Setas: 1 e 7 dias; Home/End: comeco e fim da semana;
 * PageUp/PageDown: um mes (com Shift, um ano).
 */
export function moverFoco(dia: string, tecla: string, shift: boolean): string | null {
  switch (tecla) {
    case "ArrowLeft":
      return somarDias(dia, -1);
    case "ArrowRight":
      return somarDias(dia, 1);
    case "ArrowUp":
      return somarDias(dia, -7);
    case "ArrowDown":
      return somarDias(dia, 7);
    case "Home":
      return somarDias(dia, -diaDaSemana(dia));
    case "End":
      return somarDias(dia, 6 - diaDaSemana(dia));
    case "PageUp":
      return somarMesesAoDia(dia, shift ? -12 : -1);
    case "PageDown":
      return somarMesesAoDia(dia, shift ? 12 : 1);
    default:
      return null;
  }
}
