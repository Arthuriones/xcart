import { describe, expect, it } from "vitest"
import { alternarCriterio, ordenarLinhas } from "@/components/ui/tabela"

// Ordenacao da DataTable no cliente. O que importa para o lojista: numero
// ordena como numero, nome ordena como em portugues, e linha sem dado ("—")
// nunca sobe para o topo -- nem em ordem crescente.

type Linha = { nome: string; lucro: number | null; pedidos: number }
const linhas: Linha[] = [
  { nome: "Orla Wear", lucro: 14865.07, pedidos: 210 },
  { nome: "alto Fit", lucro: -310.07, pedidos: 40 },
  { nome: "Lumen Casa", lucro: 31528.15, pedidos: 720 },
  { nome: "Kova Home", lucro: null, pedidos: 210 },
  { nome: "Ábaco", lucro: 120, pedidos: 9 },
]
const valor = (l: Linha, k: string) => l[k as keyof Linha]
const nomes = (ls: Linha[]) => ls.map((l) => l.nome)

describe("ordenarLinhas", () => {
  it("numero desc, sem dado no fim", () => {
    const r = ordenarLinhas(linhas, [{ chave: "lucro", direcao: "desc" }], valor)
    expect(nomes(r)).toEqual(["Lumen Casa", "Orla Wear", "Ábaco", "alto Fit", "Kova Home"])
  })

  it("numero asc, sem dado continua no fim", () => {
    const r = ordenarLinhas(linhas, [{ chave: "lucro", direcao: "asc" }], valor)
    expect(nomes(r)[0]).toBe("alto Fit")
    expect(nomes(r)[4]).toBe("Kova Home")
  })

  it("texto em pt-BR: acento e caixa nao bagunçam", () => {
    const r = ordenarLinhas(linhas, [{ chave: "nome", direcao: "asc" }], valor)
    expect(nomes(r)).toEqual(["Ábaco", "alto Fit", "Kova Home", "Lumen Casa", "Orla Wear"])
  })

  it("segundo criterio desempata; empate total mantem a ordem original", () => {
    const r = ordenarLinhas(
      linhas,
      [
        { chave: "pedidos", direcao: "desc" },
        { chave: "nome", direcao: "asc" },
      ],
      valor
    )
    expect(nomes(r).slice(0, 3)).toEqual(["Lumen Casa", "Kova Home", "Orla Wear"])
    const estavel = ordenarLinhas(linhas, [{ chave: "pedidos", direcao: "desc" }], valor)
    expect(nomes(estavel).slice(1, 3)).toEqual(["Orla Wear", "Kova Home"])
  })

  it("nao muta a lista nem ordena sem criterio", () => {
    const copia = [...linhas]
    ordenarLinhas(linhas, [{ chave: "lucro", direcao: "desc" }], valor)
    expect(linhas).toEqual(copia)
    expect(ordenarLinhas(linhas, [], valor)).toEqual(linhas)
  })

  it("string vazia conta como sem valor", () => {
    const ls = [{ v: "" }, { v: "b" }, { v: "a" }]
    const r = ordenarLinhas(ls, [{ chave: "v", direcao: "asc" }], (l, k) => l[k as "v"])
    expect(r.map((l) => l.v)).toEqual(["a", "b", ""])
  })
})

describe("alternarCriterio", () => {
  it("clique simples: ordena so por ela, e o segundo clique inverte", () => {
    const a = alternarCriterio([], "lucro", false)
    expect(a).toEqual([{ chave: "lucro", direcao: "desc" }])
    expect(alternarCriterio(a, "lucro", false)).toEqual([{ chave: "lucro", direcao: "asc" }])
  })

  it("clique simples em outra coluna descarta as anteriores", () => {
    const a = [
      { chave: "lucro", direcao: "desc" as const },
      { chave: "nome", direcao: "asc" as const },
    ]
    expect(alternarCriterio(a, "nome", false, "asc")).toEqual([{ chave: "nome", direcao: "asc" }])
  })

  it("Shift acrescenta desempate e inverte quem ja esta na lista", () => {
    const a = alternarCriterio([{ chave: "lucro", direcao: "desc" }], "nome", true, "asc")
    expect(a).toEqual([
      { chave: "lucro", direcao: "desc" },
      { chave: "nome", direcao: "asc" },
    ])
    expect(alternarCriterio(a, "lucro", true)).toEqual([
      { chave: "lucro", direcao: "asc" },
      { chave: "nome", direcao: "asc" },
    ])
  })
})
