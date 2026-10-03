"use client"

import * as React from "react"

import { cn } from "@/components/ui/cn"

type OpcaoSegmented<V extends string> = {
  valor: V
  rotulo: React.ReactNode
  desabilitado?: boolean
  /** Motivo de estar desabilitado, para leitor de tela ("Ano mostra só por mês"). */
  motivo?: string
}

type SegmentedProps<V extends string> = {
  /** Nome do grupo para leitor de tela: "Agrupar por". */
  rotulo: string
  valor: V
  onValorChange: (valor: V) => void
  opcoes: ReadonlyArray<OpcaoSegmented<V>>
  /** sm = 28 (padrao, em cabecalho de bloco) · md = 36. */
  tamanho?: "sm" | "md"
  className?: string
}

/**
 * Controle segmentado: escolha unica entre 2 a 5 opcoes curtas (Dia / Semana
 * / Mes, Compacta / Confortavel). E um radiogroup: Tab entra no item marcado,
 * setas trocam. Para mais opcoes ou texto longo, use Select.
 */
function Segmented<V extends string>({
  rotulo,
  valor,
  onValorChange,
  opcoes,
  tamanho = "sm",
  className,
}: SegmentedProps<V>) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([])

  function mover(de: number, passo: number) {
    const n = opcoes.length
    for (let k = 1; k <= n; k++) {
      const i = (de + passo * k + n * k) % n
      if (!opcoes[i].desabilitado) {
        onValorChange(opcoes[i].valor)
        refs.current[i]?.focus()
        return
      }
    }
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault()
      mover(i, 1)
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault()
      mover(i, -1)
    }
  }

  const marcadoExiste = opcoes.some((o) => o.valor === valor && !o.desabilitado)

  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      data-slot="segmented"
      className={cn("inline-flex w-fit gap-0.5 rounded-control bg-track p-0.5", className)}
    >
      {opcoes.map((o, i) => {
        const marcado = o.valor === valor
        const focavel = marcado || (!marcadoExiste && i === opcoes.findIndex((x) => !x.desabilitado))
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role="radio"
            aria-checked={marcado}
            aria-disabled={o.desabilitado || undefined}
            tabIndex={focavel ? 0 : -1}
            onClick={() => !o.desabilitado && onValorChange(o.valor)}
            onKeyDown={(e) => aoTeclar(e, i)}
            className={cn(
              "inline-flex items-center justify-center rounded-sm px-3 whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus",
              tamanho === "md" ? "h-8 text-dense" : "h-6 text-label",
              marcado
                ? "bg-surface font-semibold text-ink ring-1 ring-border"
                : "text-t2 hover:text-ink",
              o.desabilitado && "cursor-not-allowed text-t4 hover:text-t4"
            )}
          >
            {o.rotulo}
            {o.desabilitado && o.motivo ? <span className="sr-only">{`, ${o.motivo}`}</span> : null}
          </button>
        )
      })}
    </div>
  )
}

export { Segmented }
export type { SegmentedProps, OpcaoSegmented }
