"use client"

import * as React from "react"
import { Switch as SwitchPrimitive } from "@base-ui/react/switch"

import { cn } from "@/components/ui/cn"

type SwitchProps = SwitchPrimitive.Root.Props & {
  /** md = 40x24 (padrao) · lg = 48x28 (alvo de toque no celular). */
  tamanho?: "md" | "lg"
  /** Texto ao lado. Sem ele, passe aria-label. */
  rotulo?: React.ReactNode
  /** Uma linha de ajuda embaixo do rotulo. */
  descricao?: React.ReactNode
}

/**
 * Liga/desliga (role="switch", Espaco alterna). Trilho verde ligado, cinza
 * desligado; o estado tambem esta na posicao da bolinha, nao so na cor.
 *   <Switch rotulo="Usar no lucro" checked={x} onCheckedChange={setX} />
 *
 * O controle e um <span role="switch">, e span nao herda o nome do <label>
 * que o envolve: o rotulo e a descricao entram por aria-labelledby e
 * aria-describedby. Um aria-label ou aria-labelledby passado por quem usa
 * continua valendo.
 */
function Switch({ tamanho = "md", rotulo, descricao, className, ...props }: SwitchProps) {
  const id = React.useId()
  const idRotulo = `${id}-rotulo`
  const idDescricao = `${id}-descricao`
  const nomeProprio = props["aria-label"] !== undefined || props["aria-labelledby"] !== undefined
  const descritoPor =
    [props["aria-describedby"], rotulo && descricao ? idDescricao : null].filter(Boolean).join(" ") ||
    undefined

  const controle = (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer items-center rounded-full bg-t4 transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-checked:bg-ok data-disabled:cursor-not-allowed data-disabled:opacity-50",
        tamanho === "lg" ? "h-7 w-12" : "h-6 w-10",
        className
      )}
      {...props}
      aria-labelledby={rotulo && !nomeProprio ? idRotulo : props["aria-labelledby"]}
      aria-describedby={descritoPor}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "block translate-x-0.75 rounded-full bg-surface shadow-xs transition-transform duration-150 ease-xc",
          tamanho === "lg" ? "size-5.5 data-checked:translate-x-5.75" : "size-4.5 data-checked:translate-x-4.75"
        )}
      />
    </SwitchPrimitive.Root>
  )

  if (!rotulo) return controle

  return (
    <label className="inline-flex cursor-pointer items-start gap-2.5 text-dense text-ink has-data-disabled:cursor-not-allowed">
      {controle}
      <span className={cn("flex flex-col gap-0.5", tamanho === "lg" ? "pt-1" : "pt-0.5")}>
        <span id={idRotulo}>{rotulo}</span>
        {descricao ? (
          <span id={idDescricao} className="text-label text-t2">
            {descricao}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export { Switch }
export type { SwitchProps }
