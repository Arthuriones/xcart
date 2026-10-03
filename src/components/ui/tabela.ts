/**
 * Ordenacao da DataTable, no cliente. Pura, testada em
 * tests/ui-tabela.test.ts.
 */

export type DirecaoOrdem = "asc" | "desc"
export type CriterioOrdem = { chave: string; direcao: DirecaoOrdem }

const colator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" })

/** Valor comparavel ou null ("sem valor" vai sempre para o fim). */
function normalizar(v: unknown): number | string | null {
  if (v === null || v === undefined) return null
  if (typeof v === "number") return Number.isFinite(v) ? v : null
  if (typeof v === "boolean") return v ? 1 : 0
  if (v instanceof Date) {
    const t = v.getTime()
    return Number.isFinite(t) ? t : null
  }
  if (typeof v === "string") return v.trim() === "" ? null : v
  return null
}

function comparar(a: number | string, b: number | string): number {
  if (typeof a === "number" && typeof b === "number") return a - b
  return colator.compare(String(a), String(b))
}

/**
 * Ordena por varios criterios (o primeiro manda, os outros desempatam).
 * Estavel, nao muta a lista, e celula sem valor ("—") fica no fim nas duas
 * direcoes: ordenar por lucro nao pode jogar as lojas sem dado no topo.
 */
export function ordenarLinhas<T>(
  linhas: readonly T[],
  criterios: readonly CriterioOrdem[],
  valor: (linha: T, chave: string) => unknown
): T[] {
  if (!criterios.length) return [...linhas]
  return linhas
    .map((linha, i) => ({ linha, i }))
    .sort((x, y) => {
      for (const c of criterios) {
        const a = normalizar(valor(x.linha, c.chave))
        const b = normalizar(valor(y.linha, c.chave))
        if (a === null && b === null) continue
        if (a === null) return 1
        if (b === null) return -1
        const r = comparar(a, b)
        if (r !== 0) return c.direcao === "asc" ? r : -r
      }
      return x.i - y.i
    })
    .map((x) => x.linha)
}

/**
 * Clique no cabecalho. Sem Shift: ordena so por essa coluna (segundo clique
 * inverte). Com Shift: acrescenta a coluna como desempate, ou inverte a que
 * ja estava na lista.
 */
export function alternarCriterio(
  criterios: readonly CriterioOrdem[],
  chave: string,
  multiplo: boolean,
  direcaoInicial: DirecaoOrdem = "desc"
): CriterioOrdem[] {
  const inverter = (d: DirecaoOrdem): DirecaoOrdem => (d === "desc" ? "asc" : "desc")
  const atual = criterios.find((c) => c.chave === chave)
  if (multiplo) {
    if (!atual) return [...criterios, { chave, direcao: direcaoInicial }]
    return criterios.map((c) => (c.chave === chave ? { chave, direcao: inverter(c.direcao) } : c))
  }
  if (atual && criterios.length === 1) return [{ chave, direcao: inverter(atual.direcao) }]
  return [{ chave, direcao: direcaoInicial }]
}
