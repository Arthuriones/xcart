import * as React from "react"

import { cn } from "@/components/ui/cn"

/** Cor da barra: as series fixas do grafico, erro (prejuizo) ou cinza (custo). */
export type CorBarra = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "err" | "t4"

const COR: Record<CorBarra, string> = {
  "chart-1": "bg-chart-1",
  "chart-2": "bg-chart-2",
  "chart-3": "bg-chart-3",
  "chart-4": "bg-chart-4",
  "chart-5": "bg-chart-5",
  err: "bg-err",
  t4: "bg-t4",
}

export type ItemBarra = {
  /** Chave estavel (React key). */
  id: string
  rotulo: React.ReactNode
  /** Valor numerico que define o comprimento. null = sem dado (barra vazia, texto "—"). */
  valor: number | null
  /** Valor ja formatado para mostrar ("R$ 12.430,00"). */
  valorTexto?: React.ReactNode
  /** Texto menor ao lado do valor ("· 23%"). */
  detalhe?: React.ReactNode
  /** Onde a barra comeca, na mesma unidade de `valor` (cascata). Padrao 0. */
  inicio?: number
  cor?: CorBarra
  /** Linha de total/resultado: texto em negrito. */
  destaque?: boolean
}

type BarListProps = {
  itens: ItemBarra[]
  /** Valor que vale 100% da barra. Padrao: o maior (inicio + valor). */
  maximo?: number
  /** Nome da lista para leitor de tela. */
  rotulo?: string
  className?: string
}

/**
 * Barras horizontais: total por loja, produto ou campanha; com `inicio`, vira
 * a cascata da composicao do lucro (cada custo "tira" um pedaco do
 * faturamento). Valor e rotulo sao texto de verdade; a barra e decorativa.
 */
function BarList({ itens, maximo, rotulo, className }: BarListProps) {
  const fim = (i: ItemBarra) => (i.inicio ?? 0) + Math.max(0, i.valor ?? 0)
  const max = maximo ?? Math.max(0, ...itens.map(fim))
  const pct = (n: number) => (max > 0 ? Math.min(100, Math.max(0, (n / max) * 100)) : 0)

  return (
    <ol data-slot="bar-list" aria-label={rotulo} className={cn("flex flex-col gap-3.5", className)}>
      {itens.map((i) => {
        const esquerda = pct(i.inicio ?? 0)
        const largura = Math.min(100 - esquerda, pct(Math.max(0, i.valor ?? 0)))
        return (
          <li key={i.id} className="flex flex-col gap-1.5">
            <div className="num flex items-baseline justify-between gap-2 text-dense">
              <span className={cn("min-w-0 truncate", i.destaque ? "font-semibold text-ink" : "text-t1")}>
                {i.rotulo}
              </span>
              <span className={cn("shrink-0 text-ink", i.destaque && "font-semibold")}>
                {i.valor === null ? "—" : (i.valorTexto ?? i.valor)}
                {i.detalhe ? <span className="ml-1 font-normal text-t2">{i.detalhe}</span> : null}
              </span>
            </div>
            <div aria-hidden="true" className="relative h-2.5 overflow-hidden rounded-xs bg-track">
              <span
                className={cn("absolute inset-y-0 rounded-xs", COR[i.cor ?? "chart-2"])}
                style={{ left: `${esquerda}%`, width: `${largura}%` }}
              />
            </div>
          </li>
        )
      })}
    </ol>
  )
}

export { BarList }
export type { BarListProps }
