import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/ui/cn"
import { Spinner } from "@/components/ui/spinner"

/*
 * Um botao so, 3 alturas (28 / 36 / 44) e estas variantes:
 *   primary  -- preto solido, a acao principal do bloco (uma por bloco)
 *   secondary-- contorno, acao comum
 *   ghost    -- sem contorno, acao terciaria e botao de icone
 *   danger   -- vermelho solido, so na confirmacao de algo destrutivo
 *   destructive -- vermelho suave, para abrir a confirmacao ("Remover loja")
 *   link     -- texto terracota sublinhado
 * "default" e "outline" continuam existindo porque as telas antigas usam:
 * default = primary, outline = secondary.
 *
 * `pending` mostra o spinner, poe aria-busy e bloqueia novo clique sem tirar
 * o foco do botao (duplo envio nao passa).
 */
const buttonVariants = cva(
  "group/button relative inline-flex shrink-0 items-center justify-center gap-2 rounded-control border border-transparent bg-clip-padding text-dense font-medium whitespace-nowrap transition-colors duration-150 select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus data-disabled:cursor-not-allowed aria-busy:cursor-progress [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        primary:
          "bg-solid text-on-solid hover:bg-solid-hover data-disabled:not-aria-busy:bg-track data-disabled:not-aria-busy:text-t2",
        default:
          "bg-solid text-on-solid hover:bg-solid-hover data-disabled:not-aria-busy:bg-track data-disabled:not-aria-busy:text-t2",
        secondary:
          "border-border-strong bg-surface text-ink hover:border-control-border hover:bg-hover aria-expanded:bg-hover data-disabled:not-aria-busy:text-t3 data-disabled:not-aria-busy:hover:border-border-strong data-disabled:not-aria-busy:hover:bg-surface",
        outline:
          "border-border-strong bg-surface text-ink hover:border-control-border hover:bg-hover aria-expanded:bg-hover data-disabled:not-aria-busy:text-t3 data-disabled:not-aria-busy:hover:border-border-strong data-disabled:not-aria-busy:hover:bg-surface",
        ghost:
          "bg-transparent text-ink hover:bg-hover aria-expanded:bg-hover data-disabled:not-aria-busy:text-t3 data-disabled:not-aria-busy:hover:bg-transparent",
        danger:
          "bg-err font-semibold text-surface hover:brightness-95 data-disabled:not-aria-busy:bg-track data-disabled:not-aria-busy:text-t2",
        destructive:
          "border-err-border bg-err-bg text-err hover:border-err data-disabled:not-aria-busy:text-t3",
        link: "h-auto! px-1! text-brand underline underline-offset-4 hover:text-ink data-disabled:not-aria-busy:text-t3",
      },
      size: {
        sm: "h-ctl-sm gap-1.5 px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        md: "h-ctl-md px-4",
        default: "h-ctl-md px-4",
        lg: "h-ctl-lg px-5 text-body",
        // legado: "xs" virou o pequeno (28)
        xs: "h-ctl-sm gap-1.5 px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        "icon-sm": "size-ctl-sm [&_svg:not([class*='size-'])]:size-3.5",
        "icon-xs": "size-ctl-sm [&_svg:not([class*='size-'])]:size-3.5",
        icon: "size-ctl-md",
        "icon-md": "size-ctl-md",
        "icon-lg": "size-ctl-lg",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props &
  VariantProps<typeof buttonVariants> & {
    /** Acao em andamento: spinner, aria-busy e clique bloqueado. */
    pending?: boolean
  }

function Button({
  className,
  variant = "primary",
  size = "md",
  pending = false,
  disabled,
  focusableWhenDisabled,
  children,
  ...props
}: ButtonProps) {
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled || pending}
      // Pendente continua focavel: o foco nao pula para o <body> no meio do envio.
      focusableWhenDisabled={pending || focusableWhenDisabled}
      aria-busy={pending || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {pending ? <Spinner size={size === "sm" || size === "xs" ? 12 : 14} /> : null}
      {children}
    </ButtonPrimitive>
  )
}

export { Button, buttonVariants }
export type { ButtonProps }
