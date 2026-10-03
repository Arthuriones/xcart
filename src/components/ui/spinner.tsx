import { cn } from "@/components/ui/cn"

const TAMANHO = {
  12: "size-3 border-[1.5px]",
  14: "size-3.5 border-2",
  16: "size-4 border-2",
  20: "size-5 border-2",
} as const

type SpinnerProps = {
  /** 12, 14, 16 ou 20 px (os tamanhos de icone). */
  size?: keyof typeof TAMANHO
  /**
   * Texto para leitor de tela ("Carregando pedidos"). Sem ele o spinner e
   * decorativo (aria-hidden): use quando o texto ao lado ja diz o que acontece.
   */
  rotulo?: string
  className?: string
}

/**
 * Anel girando na cor do texto (currentColor). Com "reduzir movimento" vira um
 * anel parado. So para espera curta: carregamento de tela usa <Skeleton>.
 */
function Spinner({ size = 16, rotulo, className }: SpinnerProps) {
  return (
    <span
      data-slot="spinner"
      role={rotulo ? "status" : undefined}
      aria-label={rotulo}
      aria-hidden={rotulo ? undefined : true}
      className={cn(
        "inline-block shrink-0 animate-xc-spin rounded-full border-current border-r-transparent",
        TAMANHO[size],
        className
      )}
    />
  )
}

export { Spinner }
export type { SpinnerProps }
