"use client"

import * as React from "react"
import { CheckIcon, MinusIcon } from "lucide-react"

import { cn } from "@/components/ui/cn"

/**
 * A caixa de marcar, so visual: marcada, desmarcada ou parcial ("mixed").
 * Para quando a linha inteira ja e o botao role="checkbox" (lista de
 * produtos): o estado fica no aria-checked de quem a envolve.
 */
function Caixa({ estado }: { estado: boolean | "mixed" }) {
  const cheia = estado !== false
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm border",
        cheia ? "border-transparent bg-solid text-on-solid" : "border-control-border bg-surface"
      )}
    >
      {estado === true ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
      {estado === "mixed" ? <MinusIcon className="size-3" strokeWidth={3} /> : null}
    </span>
  )
}

type CheckboxProps = Omit<
  React.ComponentProps<"button">,
  "type" | "role" | "aria-checked" | "children" | "onChange"
> & {
  /** true, false ou "mixed" (parte de um grupo marcada). */
  checked: boolean | "mixed"
  /** Recebe o proximo estado: "mixed" vira true. */
  onCheckedChange?: (marcado: boolean) => void
  /** Texto ao lado, dentro do alvo de clique. Sem ele, passe aria-label ou aria-labelledby. */
  rotulo?: React.ReactNode
  /** Uma linha de ajuda embaixo do rotulo. */
  descricao?: React.ReactNode
}

/**
 * Caixa de marcar sem input nativo: um <button role="checkbox"> (Espaco
 * alterna, foco visivel), com rotulo e descricao ligados por
 * aria-labelledby/aria-describedby.
 *   <Checkbox rotulo="Criar a rota" checked={x} onCheckedChange={setX} />
 * Sem rotulo, um <label htmlFor={id}> ao lado tambem marca ao clicar.
 */
function Checkbox({
  checked,
  onCheckedChange,
  rotulo,
  descricao,
  className,
  onClick,
  ...props
}: CheckboxProps) {
  const id = React.useId()
  const idRotulo = `${id}-rotulo`
  const idDescricao = `${id}-descricao`
  const nomeProprio = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined

  return (
    <button
      type="button"
      role="checkbox"
      data-slot="checkbox"
      aria-checked={checked}
      {...props}
      aria-labelledby={rotulo && !nomeProprio ? idRotulo : props["aria-labelledby"]}
      aria-describedby={
        [props["aria-describedby"], rotulo && descricao ? idDescricao : null].filter(Boolean).join(" ") ||
        undefined
      }
      onClick={(e) => {
        onClick?.(e)
        if (!e.defaultPrevented) onCheckedChange?.(checked !== true)
      }}
      className={cn(
        "inline-flex items-start gap-2.5 rounded-control text-left text-dense text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-50",
        rotulo ? "min-h-6" : "shrink-0",
        className
      )}
    >
      <span className={cn("flex", rotulo && "pt-0.5")}>
        <Caixa estado={checked} />
      </span>
      {rotulo ? (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span id={idRotulo}>{rotulo}</span>
          {descricao ? (
            <span id={idDescricao} className="text-label text-t2">
              {descricao}
            </span>
          ) : null}
        </span>
      ) : null}
    </button>
  )
}

export { Checkbox, Caixa }
export type { CheckboxProps }
