/**
 * Matematica dos graficos (LineChart, sparkline do KpiCard). Pura, sem React,
 * testada em tests/ui-grafico.test.ts. Nenhuma lib: escala linear, ticks
 * "bonitos" (1, 2, 2,5, 5, 10 x 10^n) e caminho SVG com lacuna onde falta dado.
 */

export type Valor = number | null | undefined

function finito(n: Valor): n is number {
  return typeof n === "number" && Number.isFinite(n)
}

/** Arredonda um passo para 1, 2, 2,5, 5 ou 10 vezes uma potencia de 10. */
export function passoBom(x: number): number {
  if (!Number.isFinite(x) || x <= 0) return 1
  const e = Math.pow(10, Math.floor(Math.log10(x)))
  const f = x / e
  const m = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10
  return m * e
}

/** Tira o ruido de ponto flutuante (0,30000000000000004). */
function limpo(n: number): number {
  return Number(n.toPrecision(12))
}

export type EscalaY = { min: number; max: number; passo: number; ticks: number[] }

/**
 * Dominio do eixo Y com o zero sempre dentro (linha de base honesta: barra e
 * linha nao "comecam" num valor arbitrario) e ticks redondos.
 */
export function escalaY(valores: Valor[], divisoes = 4): EscalaY {
  const v = valores.filter(finito)
  let mn = Math.min(0, ...v)
  let mx = Math.max(0, ...v)
  if (mx === mn) mx = mn + 1
  const passo = passoBom((mx - mn) / Math.max(1, divisoes))
  mn = limpo(Math.floor(mn / passo) * passo)
  mx = limpo(Math.ceil(mx / passo) * passo)
  const n = Math.round((mx - mn) / passo)
  const ticks: number[] = []
  for (let k = 0; k <= n; k++) ticks.push(limpo(mn + k * passo))
  return { min: mn, max: mx, passo, ticks }
}

/**
 * Quais rotulos do eixo X mostrar: no maximo `max`, igualmente espacados,
 * sempre o ultimo, e sem um penultimo encostado nele.
 */
export function indicesRotulosX(n: number, max = 6): number[] {
  if (n <= 0) return []
  if (n <= max) return Array.from({ length: n }, (_, i) => i)
  const passo = Math.ceil(n / max)
  const out: number[] = []
  for (let i = 0; i < n - 1; i += passo) {
    if (n - 1 - i >= passo / 2) out.push(i)
  }
  out.push(n - 1)
  return out
}

/** Posicao do ponto mais perto de uma fracao (0..1) da largura. */
export function indiceMaisProximo(fracao: number, n: number): number {
  if (n <= 1 || !Number.isFinite(fracao)) return 0
  return Math.min(n - 1, Math.max(0, Math.round(fracao * (n - 1))))
}

const f1 = (n: number) => n.toFixed(1)

/**
 * Caminho SVG de uma serie. `null` quebra a linha (lacuna, nunca zero).
 * Ponto isolado vira um traco minimo, que com stroke-linecap="round" aparece
 * como um ponto. Com `parcialUltimo`, o ultimo trecho (dia em curso) sai em
 * `dParcial`, para ser desenhado tracejado.
 */
export function caminhoSerie(
  valores: Valor[],
  x: (i: number) => number,
  y: (v: number) => number,
  parcialUltimo = false
): { d: string; dParcial: string } {
  const n = valores.length
  const ultimo = n - 1
  const separaUltimo =
    parcialUltimo && n > 1 && finito(valores[ultimo]) && finito(valores[ultimo - 1])
  let d = ""
  let dParcial = ""
  let noTrecho = 0
  for (let i = 0; i < n; i++) {
    const v = valores[i]
    if (!finito(v)) {
      if (noTrecho === 1) d += "l0.01 0 "
      noTrecho = 0
      continue
    }
    if (separaUltimo && i === ultimo) {
      dParcial = `M${f1(x(i - 1))} ${f1(y(valores[i - 1] as number))} L${f1(x(i))} ${f1(y(v))}`
      break
    }
    d += `${noTrecho ? "L" : "M"}${f1(x(i))} ${f1(y(v))} `
    noTrecho++
  }
  if (noTrecho === 1 && !dParcial) d += "l0.01 0"
  return { d: d.trim(), dParcial }
}

/** Trechos sem dado, como pares [inicio, fim] inclusivos. */
export function lacunas(valores: Valor[]): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let ini = -1
  valores.forEach((v, i) => {
    if (!finito(v)) {
      if (ini < 0) ini = i
    } else if (ini >= 0) {
      out.push([ini, i - 1])
      ini = -1
    }
  })
  if (ini >= 0) out.push([ini, valores.length - 1])
  return out
}

/**
 * Sparkline sem eixo, para dentro do KPI. Escala pelo minimo e maximo da
 * propria serie (mostra forma, nao grandeza). Menos de 2 pontos: linha reta.
 */
export function caminhoSparkline(valores: Valor[], largura = 200, altura = 32, margem = 3): string {
  const v = valores.filter(finito)
  const meio = f1(altura / 2)
  if (v.length < 2) return `M0 ${meio} L${largura} ${meio}`
  const mn = Math.min(...v)
  const mx = Math.max(...v)
  const rg = mx - mn
  const n = valores.length
  const x = (i: number) => (n <= 1 ? largura / 2 : (i / (n - 1)) * largura)
  const y = (val: number) =>
    rg === 0 ? altura / 2 : altura - margem - ((val - mn) / rg) * (altura - 2 * margem)
  return caminhoSerie(valores, x, y).d
}
