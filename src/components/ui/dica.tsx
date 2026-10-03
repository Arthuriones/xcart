"use client"

import * as React from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { InfoIcon } from "lucide-react"

import { cn } from "@/components/ui/cn"

type DicaProps = {
  /** Nome do botao para leitor de tela: "O que é ROAS real". */
  rotulo: string
  /** A explicacao (definicao da metrica, "como calculamos"). */
  children: React.ReactNode
  lado?: "top" | "bottom" | "left" | "right"
  className?: string
}

/**
 * Dica acessivel por toque, teclado e mouse: o botao (i) abre um balao com a
 * explicacao. Substitui o title=, que nao abre no celular nem no teclado.
 * Esc fecha. A area de toque passa de 44px mesmo com o icone de 24px.
 */
function Dica({ rotulo, children, lado = "bottom", className }: DicaProps) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger
        openOnHover
        delay={150}
        aria-label={rotulo}
        className={cn(
          "relative inline-grid size-6 shrink-0 place-items-center rounded-sm text-t3 transition-colors after:absolute after:-inset-2.5 hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-popup-open:text-ink",
          className
        )}
      >
        <InfoIcon aria-hidden className="size-3.5" strokeWidth={1.75} />
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Positioner side={lado} sideOffset={6} className="z-50">
          <PopoverPrimitive.Popup
            data-slot="dica"
            className="max-w-72 rounded-control bg-solid px-2.5 py-2 text-label text-on-solid shadow-overlay outline-none text-pretty data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
          >
            {children}
          </PopoverPrimitive.Popup>
        </PopoverPrimitive.Positioner>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  )
}

export { Dica }
export type { DicaProps }
