"use client"

import * as React from "react"
import { Dialog as SheetPrimitive } from "@base-ui/react/dialog"
import { XIcon } from "lucide-react"

import { cn } from "@/components/ui/cn"
import { Button } from "@/components/ui/button"

/*
 * Painel lateral (detalhe de evento, detalhe da loja, filtros) e folha de
 * baixo (menu "Mais" e barra de contexto no celular). No celular o painel
 * lateral ocupa a largura toda; a folha de baixo vai ate 88% da altura.
 */

function Sheet({ ...props }: SheetPrimitive.Root.Props) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({ ...props }: SheetPrimitive.Trigger.Props) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({ ...props }: SheetPrimitive.Close.Props) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({ ...props }: SheetPrimitive.Portal.Props) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({ className, ...props }: SheetPrimitive.Backdrop.Props) {
  return (
    <SheetPrimitive.Backdrop
      data-slot="sheet-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-scrim transition-opacity duration-200 data-ending-style:opacity-0 data-starting-style:opacity-0",
        className
      )}
      {...props}
    />
  )
}

/** Largura do painel lateral no desktop: sm 384 (menu) · md 520 (detalhe) · lg 600. */
const LARGURA = {
  sm: "sm:max-w-sm",
  md: "sm:max-w-[520px]",
  lg: "sm:max-w-[600px]",
} as const

function SheetContent({
  className,
  children,
  side = "right",
  size = "md",
  showCloseButton = true,
  ...props
}: SheetPrimitive.Popup.Props & {
  side?: "top" | "right" | "bottom" | "left"
  size?: keyof typeof LARGURA
  showCloseButton?: boolean
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Popup
        data-slot="sheet-content"
        data-side={side}
        className={cn(
          "fixed z-50 flex flex-col bg-surface text-dense text-ink outline-none transition duration-200 ease-xc data-ending-style:opacity-0 data-starting-style:opacity-0",
          // direita / esquerda: largura toda no celular, size no desktop
          "data-[side=left]:inset-y-0 data-[side=left]:left-0 data-[side=left]:h-full data-[side=left]:w-full data-[side=left]:border-r data-[side=left]:shadow-sheet data-[side=left]:data-ending-style:-translate-x-6 data-[side=left]:data-starting-style:-translate-x-6",
          "data-[side=right]:inset-y-0 data-[side=right]:right-0 data-[side=right]:h-full data-[side=right]:w-full data-[side=right]:border-l data-[side=right]:shadow-sheet data-[side=right]:data-ending-style:translate-x-6 data-[side=right]:data-starting-style:translate-x-6",
          side === "left" || side === "right" ? LARGURA[size] : "",
          // baixo / cima: folha com cantos arredondados e altura limitada
          "data-[side=bottom]:inset-x-0 data-[side=bottom]:bottom-0 data-[side=bottom]:max-h-[88dvh] data-[side=bottom]:rounded-t-overlay data-[side=bottom]:border-t data-[side=bottom]:shadow-overlay data-[side=bottom]:data-ending-style:translate-y-6 data-[side=bottom]:data-starting-style:translate-y-6",
          "data-[side=top]:inset-x-0 data-[side=top]:top-0 data-[side=top]:max-h-[88dvh] data-[side=top]:rounded-b-overlay data-[side=top]:border-b data-[side=top]:shadow-overlay data-[side=top]:data-ending-style:-translate-y-6 data-[side=top]:data-starting-style:-translate-y-6",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label="Fechar"
            render={<Button variant="ghost" className="absolute top-3 right-3" size="icon-md" />}
          >
            <XIcon aria-hidden />
          </SheetPrimitive.Close>
        )}
      </SheetPrimitive.Popup>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1 border-b border-border-subtle py-4 pr-14 pl-4", className)}
      {...props}
    />
  )
}

/** Miolo rolavel do painel: cabecalho e rodape ficam parados. */
function SheetBody({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-body"
      className={cn("min-h-0 flex-1 overflow-y-auto p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn(
        "mt-auto flex flex-col-reverse gap-2 border-t border-border-subtle p-4 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function SheetTitle({ className, ...props }: SheetPrimitive.Title.Props) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("text-overlay text-ink", className)}
      {...props}
    />
  )
}

function SheetDescription({ className, ...props }: SheetPrimitive.Description.Props) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("text-dense text-t2", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetBody,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
