import { formatarDinheiro } from "@/lib/financeiro/tipos";
import type { Semaforo } from "@/lib/financeiro/calculo";

// Formatos do detalhe da loja. Os mesmos cortes da tela Lucro: KPI grande sem
// centavo a partir de mil, linha sem centavo a partir de 10 mil.

export function dinheiro(v: number, moeda: string): string {
  return formatarDinheiro(v, moeda, Math.abs(v) >= 10000 ? 0 : 2);
}

export function dinheiroKpi(v: number, moeda: string): string {
  return formatarDinheiro(v, moeda, Math.abs(v) >= 1000 ? 0 : 2);
}

export function vezes(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 2 })}×`;
}

export function porcento(v: number | null): string | null {
  if (v === null || !Number.isFinite(v)) return null;
  return `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}

export function numero(n: number): string {
  return n.toLocaleString("pt-BR");
}

/** Palavra do semaforo do lucro, com os tons de STATUS.lucro. */
export const ESTADO_LUCRO: Record<Semaforo, { tom: "ok" | "warn" | "err" | "neutral"; texto: string }> = {
  verde: { tom: "ok", texto: "Lucro" },
  amarelo: { tom: "warn", texto: "No limite" },
  vermelho: { tom: "err", texto: "Prejuízo" },
  cinza: { tom: "neutral", texto: "Sem gasto" },
};
