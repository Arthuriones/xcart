import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "@/components/ui/cn"

/*
 * Campo de texto. Contorno control-border (3:1), foco verde, erro por
 * aria-invalid (ligue a mensagem com aria-describedby, abaixo do campo).
 * Numero: inputMode="decimal" e className="num text-right".
 * Tamanho: 32px (h-ctl-md); use className="h-ctl-sm" na tabela ou "h-ctl-lg" no celular.
 * Fonte: 16px abaixo de md (max-md:text-base). O Safari do iPhone da zoom na
 * pagina ao focar campo com fonte menor que 16px; a variante vem depois no
 * CSS, entao vence tambem o text-dense que a tela passa (Custos, Pedidos).
 */
const campoBase =
  "w-full min-w-0 max-w-full rounded-control border border-control-border bg-surface text-body max-md:text-base text-ink transition-colors placeholder:text-t3 focus-visible:border-focus focus-visible:outline-1 focus-visible:outline-offset-0 focus-visible:outline-focus disabled:cursor-not-allowed disabled:bg-track disabled:text-t3 aria-invalid:border-err aria-invalid:focus-visible:outline-err read-only:bg-surface-2"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        campoBase,
        "h-ctl-md px-3 file:mr-2 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-dense file:font-medium file:text-ink",
        className
      )}
      {...props}
    />
  )
}

export { Input, campoBase }
