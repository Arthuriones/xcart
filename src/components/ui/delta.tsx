import { ArrowDownIcon, ArrowUpIcon, MinusIcon } from "lucide-react"

import { cn } from "@/components/ui/cn"
import {
  descreverVariacao,
  direcaoVariacao,
  formatarVariacao,
  tomVariacao,
  type BomQuando,
  type FormatoVariacao,
} from "@/components/ui/variacao"

const COR = { ok: "text-ok", err: "text-err", neutral: "text-t1" } as const

type DeltaProps = {
  /** Variacao como fracao (0,12 = 12%), ou diferenca em pontos com formato "pp". null = sem base. */
  valor: number | null
  /** O que e bom para a metrica. Padrao: subir. Gasto e "neutro", CPA e "descer". */
  bom?: BomQuando
  formato?: FormatoVariacao
  className?: string
}

/**
 * Variacao com seta, cor e texto. Nunca so cor: a seta e a frase escondida
 * para leitor de tela dizem a direcao. Sem base, mostra "—".
 *   <Delta valor={calcularVariacao(atual, anterior)} bom="descer" />
 */
function Delta({ valor, bom = "subir", formato = "pct", className }: DeltaProps) {
  const semBase = valor === null || !Number.isFinite(valor)
  const direcao = semBase ? "estavel" : direcaoVariacao(valor)
  const Icone = direcao === "sobe" ? ArrowUpIcon : direcao === "desce" ? ArrowDownIcon : MinusIcon
  return (
    <span
      data-slot="delta"
      className={cn(
        "num inline-flex items-center gap-0.5 font-semibold",
        semBase ? "text-t2" : COR[tomVariacao(valor, bom)],
        className
      )}
    >
      {semBase ? null : <Icone aria-hidden className="size-3" strokeWidth={2.25} />}
      <span aria-hidden="true">{formatarVariacao(semBase ? null : valor, formato)}</span>
      <span className="sr-only">{descreverVariacao(semBase ? null : valor, formato)}</span>
    </span>
  )
}

export { Delta }
export type { DeltaProps }
