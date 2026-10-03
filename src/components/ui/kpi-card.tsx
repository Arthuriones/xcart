import * as React from "react"
import Link from "next/link"

import { cn } from "@/components/ui/cn"
import { Delta } from "@/components/ui/delta"
import { Dica } from "@/components/ui/dica"
import { caminhoSparkline } from "@/components/ui/grafico"
import { Skeleton } from "@/components/ui/skeleton"
import { StatusBadge, type TomStatus } from "@/components/ui/status-badge"
import type { BomQuando, FormatoVariacao } from "@/components/ui/variacao"

type KpiCardProps = {
  rotulo: string
  /** Valor ja formatado ("R$ 48,7 mil"). null = nao se sabe: mostra "—". */
  valor: React.ReactNode | null
  /**
   * Variacao contra o periodo anterior, como fracao (use calcularVariacao).
   * undefined = a tela nao compara; null = compara, mas sem base.
   */
  variacao?: number | null
  /** O que e bom para a metrica: subir (faturamento), descer (CPA), neutro (gasto). */
  bom?: BomQuando
  /** "pp" para margem (diferenca em pontos percentuais). */
  formatoVariacao?: FormatoVariacao
  /** Valor do periodo anterior ja formatado: vira "vs. R$ 41,2 mil". */
  anterior?: string
  /** Substitui o texto de comparacao inteiro. */
  comparacao?: React.ReactNode
  /** Palavra de estado ao lado do valor ("Lucro", "Prejuízo"). */
  estado?: { tom: TomStatus; texto: string }
  /** Linha de apoio embaixo ("Meta R$ 3,1 mil · Google R$ 900"). */
  detalhe?: React.ReactNode
  /** Definicao da metrica, aberta pelo (i). */
  definicao?: React.ReactNode
  /** Serie do periodo para a sparkline (null = dia sem dado). */
  serie?: Array<number | null>
  carregando?: boolean
  /** Quando valor e null: por que ("Sem pedidos no período"). */
  motivoSemDado?: string
  /** O cartao todo leva ao detalhe. */
  href?: string
  /** O cartao todo seleciona a metrica (ex.: mostrar no grafico). So em client component. */
  onSelecionar?: () => void
  /** Borda forte e aria-pressed/aria-current: e a metrica escolhida. */
  selecionado?: boolean
  /** Botoes no canto (ex.: fixar). Ficam acima do clique do cartao. */
  acoes?: React.ReactNode
  className?: string
}

/**
 * KPI: rotulo, valor tabular, variacao com seta e cor pela definicao de "bom",
 * comparacao com o periodo anterior e sparkline. Carregando e sem dado tem a
 * mesma geometria. Numero nunca e inventado: null vira "—".
 *
 *   <KpiCard rotulo="CPA" valor="R$ 38,20" variacao={-0.08} bom="descer"
 *     anterior="R$ 41,50" serie={cpaPorDia} definicao="Gasto dividido por pedidos." />
 */
function KpiCard({
  rotulo,
  valor,
  variacao,
  bom = "subir",
  formatoVariacao = "pct",
  anterior,
  comparacao,
  estado,
  detalhe,
  definicao,
  serie,
  carregando = false,
  motivoSemDado,
  href,
  onSelecionar,
  selecionado = false,
  acoes,
  className,
}: KpiCardProps) {
  const caixa = cn(
    "relative flex min-w-0 flex-col gap-1.5 rounded-card border bg-surface p-3 sm:p-4",
    selecionado ? "border-ink" : "border-border",
    (href || onSelecionar) && !carregando && "transition-colors hover:border-border-strong",
    "has-[[data-kpi-alvo]:focus-visible]:outline-2 has-[[data-kpi-alvo]:focus-visible]:outline-offset-2 has-[[data-kpi-alvo]:focus-visible]:outline-focus",
    className
  )

  if (carregando) {
    return (
      <div data-slot="kpi-card" aria-busy="true" className={caixa}>
        <span className="text-label font-medium text-t1">{rotulo}</span>
        <span className="sr-only">Carregando</span>
        <Skeleton className="mt-1 h-6 w-3/5" />
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="mt-auto h-8 w-full" />
      </div>
    )
  }

  const semDado = valor === null || valor === undefined
  const mostraDelta = !semDado && variacao !== undefined && variacao !== null

  let textoComparacao: React.ReactNode = comparacao
  if (textoComparacao === undefined) {
    if (semDado) textoComparacao = motivoSemDado ?? "Sem dado no período"
    else if (variacao === null) textoComparacao = "sem comparação"
    else if (anterior) textoComparacao = `vs. ${anterior}`
    else if (variacao !== undefined) textoComparacao = "vs. período anterior"
  }

  // O alvo do clique cobre o cartao inteiro (after:inset-0); o resto do
  // conteudo interativo (dica, acoes) fica acima com z-10.
  const alvo = "text-left after:absolute after:inset-0 after:rounded-card focus-visible:outline-none"
  let titulo: React.ReactNode = <span>{rotulo}</span>
  if (href) {
    titulo = (
      <Link
        href={href}
        data-kpi-alvo=""
        aria-current={selecionado ? "true" : undefined}
        className={cn(alvo, "text-t1 hover:text-t1")}
      >
        {rotulo}
      </Link>
    )
  } else if (onSelecionar) {
    titulo = (
      <button
        type="button"
        data-kpi-alvo=""
        aria-pressed={selecionado}
        onClick={onSelecionar}
        className={cn(alvo, "cursor-pointer")}
      >
        {rotulo}
      </button>
    )
  }

  return (
    <div data-slot="kpi-card" role="group" aria-label={rotulo} className={caixa}>
      <div className="flex min-h-6 items-center gap-1">
        <span className="text-label font-medium text-t1">{titulo}</span>
        {definicao ? (
          <Dica rotulo={`O que é ${rotulo}`} className="relative z-10">
            {definicao}
          </Dica>
        ) : null}
        {acoes ? <div className="relative z-10 ml-auto flex items-center gap-1">{acoes}</div> : null}
      </div>

      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="num text-page text-ink sm:text-kpi">{semDado ? "—" : valor}</span>
        {estado && !semDado ? <StatusBadge tom={estado.tom} texto={estado.texto} /> : null}
      </div>

      {mostraDelta || textoComparacao ? (
        <div className="num flex flex-wrap items-center gap-x-1.5 text-label">
          {mostraDelta ? <Delta valor={variacao ?? null} bom={bom} formato={formatoVariacao} /> : null}
          {textoComparacao ? <span className="text-t2">{textoComparacao}</span> : null}
        </div>
      ) : null}

      {detalhe ? <div className="num text-label text-t2">{detalhe}</div> : null}

      {serie && serie.length > 1 ? (
        <svg
          viewBox="0 0 200 32"
          preserveAspectRatio="none"
          aria-hidden="true"
          className="mt-auto block h-8 w-full overflow-visible"
        >
          <path
            d={semDado ? "M0 29 L200 29" : caminhoSparkline(serie, 200, 32)}
            fill="none"
            className="stroke-t2"
            strokeWidth={1.5}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      ) : null}
    </div>
  )
}

export { KpiCard }
export type { KpiCardProps }
