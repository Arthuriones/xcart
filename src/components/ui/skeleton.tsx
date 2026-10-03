import * as React from "react"

import { cn } from "@/components/ui/cn"

/**
 * Bloco de carregamento com brilho correndo, visivel nos dois temas.
 * Desenhe a geometria do conteudo (mesma altura do grafico, da linha, do KPI)
 * e marque a regiao que carrega com aria-busy e um rotulo, por exemplo:
 *
 *   <div aria-busy="true" aria-label="Carregando indicadores">
 *     <Skeleton className="h-3 w-2/5" /> <Skeleton className="h-6 w-3/5" />
 *   </div>
 */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      aria-hidden="true"
      className={cn("skeleton h-4 w-full rounded-sm", className)}
      {...props}
    />
  )
}

export { Skeleton }
