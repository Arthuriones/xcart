import * as React from "react"
import { CircleCheckIcon, InfoIcon, OctagonAlertIcon, TriangleAlertIcon } from "lucide-react"

import { cn } from "@/components/ui/cn"

type TomCallout = "err" | "warn" | "info" | "ok"

const TOM: Record<TomCallout, { caixa: string; texto: string; Icone: typeof InfoIcon }> = {
  err: { caixa: "border-err-border bg-err-bg", texto: "text-err", Icone: OctagonAlertIcon },
  warn: { caixa: "border-warn-border bg-warn-bg", texto: "text-warn", Icone: TriangleAlertIcon },
  info: { caixa: "border-info-border bg-info-bg", texto: "text-info", Icone: InfoIcon },
  ok: { caixa: "border-ok-border bg-ok-bg", texto: "text-ok", Icone: CircleCheckIcon },
}

type CalloutProps = Omit<React.ComponentProps<"div">, "title"> & {
  tom: TomCallout
  /** O que aconteceu, em uma linha: "Lucro inflado em 2 lojas". */
  titulo: React.ReactNode
  /** Uma acao que resolve ou leva a tela certa (Link ou Button). */
  acao?: React.ReactNode
  /** Botao de dispensar (so para o que e informativo). */
  dispensar?: React.ReactNode
}

/**
 * Aviso acionavel: icone, titulo, detalhe e UMA acao. Um por vez na tela;
 * varios do mesmo tipo viram um aviso so, com as lojas listadas.
 * O detalhe vai em children.
 */
function Callout({ tom, titulo, acao, dispensar, className, children, ...props }: CalloutProps) {
  const t = TOM[tom]
  return (
    <div
      data-slot="callout"
      data-tom={tom}
      className={cn(
        "flex flex-wrap items-start gap-x-2.5 gap-y-2 rounded-card border px-3.5 py-3 text-dense sm:flex-nowrap",
        t.caixa,
        className
      )}
      {...props}
    >
      <t.Icone aria-hidden className={cn("mt-px size-4 shrink-0", t.texto)} strokeWidth={1.75} />
      <div className="flex min-w-0 flex-1 basis-48 flex-col gap-0.5">
        <p className={cn("font-semibold", t.texto)}>{titulo}</p>
        {children ? <div className="text-ink text-pretty">{children}</div> : null}
      </div>
      {acao || dispensar ? (
        <div className="ml-6.5 flex shrink-0 items-center gap-1 sm:ml-0">
          {acao}
          {dispensar}
        </div>
      ) : null}
    </div>
  )
}

export { Callout }
export type { CalloutProps, TomCallout }
