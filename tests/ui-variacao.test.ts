import { describe, expect, it } from "vitest"
import {
  calcularVariacao,
  descreverVariacao,
  direcaoVariacao,
  formatarVariacao,
  tomVariacao,
} from "@/components/ui/variacao"

// O delta do KPI e a primeira coisa que o lojista le. Errar o sinal, a cor ou
// inventar "+infinito%" quando o periodo anterior e zero e mentir na tela.

describe("calcularVariacao", () => {
  it("variacao relativa como fracao", () => {
    expect(calcularVariacao(110, 100)).toBeCloseTo(0.1)
    expect(calcularVariacao(90, 100)).toBeCloseTo(-0.1)
  })

  it("sem base: anterior zero, ausente ou nao finito vira null", () => {
    expect(calcularVariacao(50, 0)).toBeNull()
    expect(calcularVariacao(50, null)).toBeNull()
    expect(calcularVariacao(null, 50)).toBeNull()
    expect(calcularVariacao(50, undefined)).toBeNull()
    expect(calcularVariacao(Number.NaN, 50)).toBeNull()
    expect(calcularVariacao(50, Number.POSITIVE_INFINITY)).toBeNull()
  })

  it("prejuizo que diminui e subida (divisor em modulo)", () => {
    // de -100 para -50: o lucro melhorou 50%
    expect(calcularVariacao(-50, -100)).toBeCloseTo(0.5)
    expect(calcularVariacao(-150, -100)).toBeCloseTo(-0.5)
  })
})

describe("direcao e tom", () => {
  it("abaixo de 0,05% e estavel (o texto arredondaria para 0,0%)", () => {
    expect(direcaoVariacao(0.0004)).toBe("estavel")
    expect(direcaoVariacao(-0.0004)).toBe("estavel")
    expect(direcaoVariacao(0.001)).toBe("sobe")
    expect(direcaoVariacao(-0.001)).toBe("desce")
  })

  it("bom = subir: sobe e verde, desce e vermelho", () => {
    expect(tomVariacao(0.2, "subir")).toBe("ok")
    expect(tomVariacao(-0.2, "subir")).toBe("err")
  })

  it("bom = descer (CPA): a cor inverte", () => {
    expect(tomVariacao(0.2, "descer")).toBe("err")
    expect(tomVariacao(-0.2, "descer")).toBe("ok")
  })

  it("neutro, estavel e sem base nunca ganham cor de status", () => {
    expect(tomVariacao(0.5, "neutro")).toBe("neutral")
    expect(tomVariacao(0, "subir")).toBe("neutral")
    expect(tomVariacao(null, "subir")).toBe("neutral")
  })
})

describe("formatarVariacao", () => {
  it("pt-BR com uma casa, sem sinal por padrao", () => {
    expect(formatarVariacao(0.1234)).toBe("12,3%")
    expect(formatarVariacao(-0.041)).toBe("4,1%")
    expect(formatarVariacao(12.5)).toBe("1.250,0%")
  })

  it("com sinal usa o menos tipografico", () => {
    expect(formatarVariacao(0.1234, "pct", { sinal: true })).toBe("+12,3%")
    expect(formatarVariacao(-0.041, "pct", { sinal: true })).toBe("−4,1%")
  })

  it("estavel nao mostra sinal nem -0,0%", () => {
    expect(formatarVariacao(-0.0001, "pct", { sinal: true })).toBe("0,0%")
    expect(formatarVariacao(-0, "pct", { sinal: true })).toBe("0,0%")
  })

  it("margem em pontos percentuais", () => {
    expect(formatarVariacao(0.012, "pp")).toBe("1,2 p.p.")
  })

  it("sem base vira travessao, nunca zero", () => {
    expect(formatarVariacao(null)).toBe("—")
    expect(formatarVariacao(Number.NaN)).toBe("—")
  })

  it("frase para leitor de tela", () => {
    expect(descreverVariacao(0.1)).toBe("Aumento de 10,0% em relação ao período anterior")
    expect(descreverVariacao(-0.1)).toBe("Queda de 10,0% em relação ao período anterior")
    expect(descreverVariacao(null)).toBe("Sem base de comparação")
  })
})
