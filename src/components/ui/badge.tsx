import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/ui/cn"

/*
 * Etiqueta curta (plano, tag, contagem). Para ESTADO (Conectada, Erro,
 * Pausada) use <StatusBadge>, que traz o ponto e o mapa unico de tons.
 * As variantes antigas (default, secondary, destructive, outline, ghost, link)
 * continuam; ok/warn/err/info/neutral sao os tons do redesign.
 */
const badgeVariants = cva(
  "group/badge inline-flex h-5.5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-control border border-transparent px-2 text-label font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-solid text-on-solid [a]:hover:bg-solid-hover",
        secondary: "border-neutral-border bg-neutral-bg text-neutral [a]:hover:bg-hover",
        destructive: "border-err-border bg-err-bg text-err",
        outline: "border-border-strong text-t1 [a]:hover:bg-hover",
        ghost: "text-t1 hover:bg-hover",
        link: "text-brand underline underline-offset-4 hover:text-ink",
        ok: "border-ok-border bg-ok-bg text-ok",
        warn: "border-warn-border bg-warn-bg text-warn",
        err: "border-err-border bg-err-bg text-err",
        info: "border-info-border bg-info-bg text-info",
        neutral: "border-neutral-border bg-neutral-bg text-neutral",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
