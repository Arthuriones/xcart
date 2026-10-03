import { describe, expect, it } from "vitest"
import {
  caminhoSerie,
  caminhoSparkline,
  escalaY,
  indiceMaisProximo,
  indicesRotulosX,
  lacunas,
  passoBom,
} from "@/components/ui/grafico"

// O grafico e SVG escrito a mao (sem lib). Estes testes travam o que nao pode
// mentir: o zero dentro do eixo, ticks redondos, e falta de dado virando
// lacuna -- nunca uma linha caindo para zero.

describe("passoBom", () => {
  it("arredonda para 1, 2, 2,5, 5 ou 10 x 10^n", () => {
    expect(passoBom(0.8)).toBe(1)
    expect(passoBom(1.7)).toBe(2)
    expect(passoBom(2.3)).toBe(2.5)
    expect(passoBom(3)).toBe(5)
    expect(passoBom(7)).toBe(10)
    expect(passoBom(1300)).toBe(2000)
    expect(passoBom(0.03)).toBeCloseTo(0.05)
  })

  it("entrada invalida nao quebra", () => {
    expect(passoBom(0)).toBe(1)
    expect(passoBom(-5)).toBe(1)
    expect(passoBom(Number.NaN)).toBe(1)
  })
})

describe("escalaY", () => {
  it("inclui o zero e fecha em ticks redondos", () => {
    const e = escalaY([1200, 3400, 2900])
    expect(e.min).toBe(0)
    expect(e.max).toBeGreaterThanOrEqual(3400)
    expect(e.ticks[0]).toBe(0)
    expect(e.ticks[e.ticks.length - 1]).toBe(e.max)
    for (let i = 1; i < e.ticks.length; i++) {
      expect(e.ticks[i] - e.ticks[i - 1]).toBeCloseTo(e.passo)
    }
  })

  it("valores negativos (prejuizo) descem abaixo do zero", () => {
    const e = escalaY([-310, 500, 1200])
    expect(e.min).toBeLessThan(0)
    expect(e.ticks).toContain(0)
  })

  it("ignora null e serie toda zerada nao divide por zero", () => {
    const e = escalaY([null, 0, 0, undefined])
    expect(e.min).toBe(0)
    expect(e.max).toBeGreaterThan(0)
  })

  it("sem ruido de ponto flutuante nos ticks", () => {
    const e = escalaY([0.1, 0.3])
    for (const t of e.ticks) expect(String(t).length).toBeLessThan(8)
  })
})

describe("indicesRotulosX", () => {
  it("mostra tudo quando cabe", () => {
    expect(indicesRotulosX(5, 6)).toEqual([0, 1, 2, 3, 4])
  })

  it("no maximo `max` rotulos, sempre com o ultimo", () => {
    const r = indicesRotulosX(30, 6)
    expect(r.length).toBeLessThanOrEqual(7)
    expect(r[0]).toBe(0)
    expect(r[r.length - 1]).toBe(29)
  })

  it("nao encosta um rotulo no ultimo", () => {
    const r = indicesRotulosX(31, 6)
    const ultimo = r[r.length - 1]
    const penultimo = r[r.length - 2]
    expect(ultimo - penultimo).toBeGreaterThanOrEqual(3)
  })

  it("vazio", () => {
    expect(indicesRotulosX(0)).toEqual([])
  })
})

describe("indiceMaisProximo", () => {
  it("arredonda e prende nas bordas", () => {
    expect(indiceMaisProximo(0, 10)).toBe(0)
    expect(indiceMaisProximo(1, 10)).toBe(9)
    expect(indiceMaisProximo(0.5, 11)).toBe(5)
    expect(indiceMaisProximo(-0.2, 10)).toBe(0)
    expect(indiceMaisProximo(1.4, 10)).toBe(9)
    expect(indiceMaisProximo(0.5, 1)).toBe(0)
  })
})

describe("caminhoSerie", () => {
  const x = (i: number) => i * 10
  const y = (v: number) => 100 - v

  it("linha continua", () => {
    expect(caminhoSerie([0, 50, 100], x, y).d).toBe("M0.0 100.0 L10.0 50.0 L20.0 0.0")
  })

  it("null quebra a linha em vez de cair para zero", () => {
    const { d } = caminhoSerie([10, 20, null, 40, 50], x, y)
    expect(d).toBe("M0.0 90.0 L10.0 80.0 M30.0 60.0 L40.0 50.0")
    expect(d).not.toContain("100.0")
  })

  it("ponto isolado ainda aparece (traco minimo)", () => {
    const { d } = caminhoSerie([null, 20, null], x, y)
    expect(d).toBe("M10.0 80.0 l0.01 0")
  })

  it("dia em curso sai separado para ser tracejado", () => {
    const r = caminhoSerie([10, 20, 30], x, y, true)
    expect(r.d).toBe("M0.0 90.0 L10.0 80.0")
    expect(r.dParcial).toBe("M10.0 80.0 L20.0 70.0")
  })

  it("parcial sem ponto anterior nao inventa ligacao", () => {
    const r = caminhoSerie([10, null, 30], x, y, true)
    expect(r.dParcial).toBe("")
  })
})

describe("lacunas", () => {
  it("trechos sem dado, inclusive no comeco e no fim", () => {
    expect(lacunas([null, null, 1, 2, null, 3, null])).toEqual([
      [0, 1],
      [4, 4],
      [6, 6],
    ])
    expect(lacunas([1, 2, 3])).toEqual([])
  })
})

describe("caminhoSparkline", () => {
  it("menos de dois pontos vira linha reta no meio", () => {
    expect(caminhoSparkline([5], 200, 32)).toBe("M0 16.0 L200 16.0")
    expect(caminhoSparkline([], 200, 32)).toBe("M0 16.0 L200 16.0")
  })

  it("ocupa a largura toda e respeita a margem", () => {
    const d = caminhoSparkline([1, 3, 2], 200, 32, 3)
    expect(d.startsWith("M0.0 29.0")).toBe(true)
    expect(d).toContain("L100.0 3.0")
    expect(d.endsWith("L200.0 16.0")).toBe(true)
  })
})
