import * as React from "react"

import { cn } from "@/components/ui/cn"

type SectionProps = Omit<React.ComponentProps<"section">, "title"> & {
  /** Titulo do bloco (15px, 600). Vira o nome acessivel da secao. */
  titulo: React.ReactNode
  /** Uma linha de apoio: periodo, fonte do numero, "Estimado, nao contabil". */
  descricao?: React.ReactNode
  /** Controles do bloco a direita do titulo (segmentado, exportar, link). */
  acoes?: React.ReactNode
  /** Nivel do titulo. Padrao h2 (a pagina tem um h1 so, no PageHeader). */
  nivel?: 2 | 3
  /**
   * Padding do corpo. "nenhum" para tabela encostada nas bordas do cartao
   * (o cabecalho continua com padding).
   */
  espaco?: "normal" | "nenhum"
}

/**
 * Cartao de secao: titulo, descricao e acoes em cima, conteudo embaixo.
 * Valor em cima, grafico embaixo; uma acao primaria por bloco.
 */
function Section({
  titulo,
  descricao,
  acoes,
  nivel = 2,
  espaco = "normal",
  className,
  children,
  ...props
}: SectionProps) {
  const id = React.useId()
  const Titulo = nivel === 3 ? "h3" : "h2"
  return (
    <section
      data-slot="section"
      aria-labelledby={`${id}-t`}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-card border border-border bg-surface",
        espaco === "normal" ? "p-4" : "pt-4",
        className
      )}
      {...props}
    >
      <div
        className={cn(
          "flex flex-wrap items-start justify-between gap-x-3 gap-y-2",
          espaco === "nenhum" && "px-4"
        )}
      >
        <div className="flex min-w-0 flex-col gap-0.5">
          <Titulo id={`${id}-t`} className="text-section text-ink">
            {titulo}
          </Titulo>
          {descricao ? <p className="text-label text-t2">{descricao}</p> : null}
        </div>
        {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
      </div>
      {children}
    </section>
  )
}

export { Section }
export type { SectionProps }
