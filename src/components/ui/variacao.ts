/**
 * Variacao entre periodos: calculo e texto. Puro, sem React -- usado pelo
 * <Delta> e pelo <KpiCard>, e testado em tests/ui-variacao.test.ts.
 */

/** O que e "bom" para a metrica: faturamento quer subir, CPA quer descer. */
export type BomQuando = "subir" | "descer" | "neutro"
export type DirecaoVariacao = "sobe" | "desce" | "estavel"
export type TomVariacao = "ok" | "err" | "neutral"
/** "pct": variacao relativa (0,123 = 12,3%). "pp": diferenca de pontos percentuais (margem). */
export type FormatoVariacao = "pct" | "pp"

/** Abaixo disto o numero arredonda para 0,0% e a seta mente. */
const LIMIAR_ESTAVEL = 0.0005

function finito(n: number | null | undefined): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

/**
 * Variacao relativa de `anterior` para `atual`, como fracao (0,1 = +10%).
 * Devolve null quando nao ha base honesta: valor ausente, nao finito ou
 * anterior igual a zero (de 0 para 50 nao e "+infinito%").
 * Usa |anterior| no divisor para que sair de -100 para -50 seja subida.
 */
export function calcularVariacao(
  atual: number | null | undefined,
  anterior: number | null | undefined
): number | null {
  if (!finito(atual) || !finito(anterior) || anterior === 0) return null
  return (atual - anterior) / Math.abs(anterior)
}

export function direcaoVariacao(v: number): DirecaoVariacao {
  if (!Number.isFinite(v) || Math.abs(v) < LIMIAR_ESTAVEL) return "estavel"
  return v > 0 ? "sobe" : "desce"
}

/** Cor da variacao: verde quando foi para o lado bom, vermelho no ruim. */
export function tomVariacao(v: number | null, bom: BomQuando): TomVariacao {
  if (v === null || bom === "neutro") return "neutral"
  const d = direcaoVariacao(v)
  if (d === "estavel") return "neutral"
  const melhorou = bom === "subir" ? d === "sobe" : d === "desce"
  return melhorou ? "ok" : "err"
}

const fmt1 = new Intl.NumberFormat("pt-BR", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
})

/**
 * Texto da variacao. Sem sinal por padrao (a seta ja diz a direcao);
 * `sinal: true` escreve "+12,3%" / "−4,1%" com o menos tipografico.
 * null vira "—": sem base nao se inventa numero.
 */
export function formatarVariacao(
  v: number | null,
  formato: FormatoVariacao = "pct",
  opcoes: { sinal?: boolean } = {}
): string {
  if (v === null || !Number.isFinite(v)) return "—"
  const estavel = direcaoVariacao(v) === "estavel"
  const abs = estavel ? 0 : Math.abs(v) * 100
  const corpo = formato === "pp" ? `${fmt1.format(abs)} p.p.` : `${fmt1.format(abs)}%`
  if (!opcoes.sinal || estavel) return corpo
  return `${v > 0 ? "+" : "−"}${corpo}`
}

/** Frase para leitor de tela: "Aumento de 12,3% em relação ao período anterior". */
export function descreverVariacao(v: number | null, formato: FormatoVariacao = "pct"): string {
  if (v === null || !Number.isFinite(v)) return "Sem base de comparação"
  const d = direcaoVariacao(v)
  if (d === "estavel") return "Sem variação em relação ao período anterior"
  const texto = formatarVariacao(v, formato)
  return `${d === "sobe" ? "Aumento" : "Queda"} de ${texto} em relação ao período anterior`
}
