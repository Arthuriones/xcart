import * as React from "react"

import { cn } from "@/components/ui/cn"

type EmptyStateProps = Omit<React.ComponentProps<"div">, "title"> & {
  /** Diz o que falta: "Nenhuma loja conectada". */
  titulo: React.ReactNode
  /** Quando o dado aparece, em menos de 14 palavras. */
  descricao?: React.ReactNode
  /** Um unico CTA que espelha o titulo (Button ou Link). Informativo nao tem. */
  acao?: React.ReactNode
  /** Icone decorativo opcional (lucide, 20px). */
  icone?: React.ReactNode
  /** Selo pequeno acima do titulo, ex.: "Em breve". */
  selo?: React.ReactNode
  /**
   * "cartao": superficie com borda (bloco proprio).
   * "tracejado": borda tracejada, para o lugar de um grafico ou lista.
   * "simples": sem caixa, dentro de um cartao que ja existe.
   */
  variante?: "cartao" | "tracejado" | "simples"
}

/**
 * Estado vazio honesto. Vazio, "filtrado sem resultado" e erro sao tres
 * estados diferentes: para filtro sem resultado use titulo "Nenhum ... com
 * esses filtros" e acao "Limpar filtros"; para funcao sem backend, selo
 * "Em breve" e nenhuma acao.
 * Para manter a altura do grafico ou da tabela que ocupa, passe className
 * (ex.: "min-h-45").
 */
function EmptyState({
  titulo,
  descricao,
  acao,
  icone,
  selo,
  variante = "cartao",
  className,
  ...props
}: EmptyStateProps) {
  return (
    <div
      data-slot="empty-state"
      className={cn(
        "flex flex-col items-center justify-center gap-2 px-4 py-8 text-center",
        variante === "cartao" && "rounded-card border border-border bg-surface",
        variante === "tracejado" && "rounded-control border border-dashed border-border-strong",
        className
      )}
      {...props}
    >
      {icone ? (
        <span aria-hidden="true" className="mb-1 text-t3 [&_svg:not([class*='size-'])]:size-5">
          {icone}
        </span>
      ) : null}
      {selo ? (
        <span className="rounded-full border border-border-strong px-2 text-label font-medium text-t2">
          {selo}
        </span>
      ) : null}
      <p className="text-section text-ink text-balance">{titulo}</p>
      {descricao ? <p className="max-w-sm text-dense text-t2 text-pretty">{descricao}</p> : null}
      {acao ? <div className="mt-2 flex flex-wrap justify-center gap-2">{acao}</div> : null}
    </div>
  )
}

export { EmptyState }
export type { EmptyStateProps }
