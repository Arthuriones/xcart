"use client"

import * as React from "react"

import { cn } from "@/components/ui/cn"
import { EmptyState } from "@/components/ui/empty-state"
import {
  caminhoSerie,
  escalaY,
  indiceMaisProximo,
  indicesRotulosX,
  lacunas,
} from "@/components/ui/grafico"

/** Cor fixa por significado: chart-1 lucro, chart-2 faturamento, chart-3 gasto. */
export type CorSerie = "chart-1" | "chart-2" | "chart-3" | "chart-4" | "chart-5" | "comparacao"

export type SerieGrafico = {
  id: string
  rotulo: string
  /** Um valor por rotulo do eixo X. null = sem dado (lacuna, nunca zero). */
  valores: Array<number | null>
  cor?: CorSerie
  /** Linha mais grossa para a metrica principal. */
  destaque?: boolean
}

type LineChartProps = {
  /** Rotulos do eixo X ja formatados ("12/09", "set"), um por ponto. */
  rotulos: string[]
  /** 1 a 3 series, mais a de comparacao (cor "comparacao", sempre tracejada). */
  series: SerieGrafico[]
  /** Resumo para leitor de tela: "Lucro por dia de 03/09 a 02/10". */
  descricao: string
  /** Altura da area do grafico em px: 180 em cartao, 320 em destaque. */
  altura?: number
  /** Formato dos valores no tooltip, ex.: { style: "currency", currency: "BRL" }. */
  formato?: Intl.NumberFormatOptions
  /** Formato do eixo Y. Padrao: o mesmo, compacto ("R$ 12 mil"). */
  formatoEixo?: Intl.NumberFormatOptions
  /** O ultimo ponto e o dia em curso: trecho final tracejado e "hoje · parcial". */
  parcialUltimo?: boolean
  /** Texto da lacuna sem historico ("Sem dado antes de 03/08"). */
  rotuloLacuna?: string
  /** Legenda clicavel para mostrar/ocultar series. Padrao: com mais de uma serie. */
  legenda?: boolean
  /** O que mostrar quando nao ha nenhum ponto (mesma altura). */
  vazio?: React.ReactNode
  className?: string
}

const TRACO: Record<CorSerie, string> = {
  "chart-1": "stroke-chart-1",
  "chart-2": "stroke-chart-2",
  "chart-3": "stroke-chart-3",
  "chart-4": "stroke-chart-4",
  "chart-5": "stroke-chart-5",
  comparacao: "stroke-t3",
}
const BORDA: Record<CorSerie, string> = {
  "chart-1": "border-chart-1",
  "chart-2": "border-chart-2",
  "chart-3": "border-chart-3",
  "chart-4": "border-chart-4",
  "chart-5": "border-chart-5",
  comparacao: "border-t3",
}

// Largura logica do SVG. A altura e 1:1 em px, entao so o X estica
// (preserveAspectRatio="none"); o traco nao deforma por causa do
// vector-effect, e pontos/rotulos sao HTML posicionado em %.
const W = 1000
const PAD_T = 8
const PAD_B = 4

/**
 * Grafico de linha em SVG, sem biblioteca: 1-3 series, comparacao tracejada,
 * eixo de datas, tooltip no hover e nas setas do teclado, lacuna hachurada
 * onde nao ha dado. Responsivo pela largura do pai.
 */
function LineChart({
  rotulos,
  series,
  descricao,
  altura = 180,
  formato,
  formatoEixo,
  parcialUltimo = false,
  rotuloLacuna = "sem dado",
  legenda,
  vazio,
  className,
}: LineChartProps) {
  const idPadrao = React.useId()
  const [ocultas, setOcultas] = React.useState<ReadonlySet<string>>(() => new Set())
  const [idx, setIdx] = React.useState<number | null>(null)
  const [viaTeclado, setViaTeclado] = React.useState(false)

  const n = rotulos.length
  const visiveis = series.filter((s) => !ocultas.has(s.id))
  const temDado = series.some((s) => s.valores.some((v) => typeof v === "number" && Number.isFinite(v)))

  const fmtValor = React.useMemo(
    () => new Intl.NumberFormat("pt-BR", formato ?? { maximumFractionDigits: 2 }),
    [formato]
  )
  const fmtEixo = React.useMemo(
    () =>
      new Intl.NumberFormat(
        "pt-BR",
        formatoEixo ?? { ...formato, notation: "compact", minimumFractionDigits: 0, maximumFractionDigits: 1 }
      ),
    [formato, formatoEixo]
  )

  if (n === 0 || !temDado) {
    return (
      <div className={className} style={{ minHeight: altura }}>
        {vazio ?? (
          <EmptyState
            variante="tracejado"
            titulo="Sem dados no período"
            descricao="O gráfico aparece quando houver o primeiro registro."
            style={{ minHeight: altura }}
          />
        )}
      </div>
    )
  }

  const escala = escalaY(visiveis.flatMap((s) => s.valores))
  const alturaUtil = altura - PAD_T - PAD_B
  const y = (v: number) => PAD_T + (1 - (v - escala.min) / (escala.max - escala.min)) * alturaUtil
  const x = (i: number) => (n <= 1 ? W / 2 : (i * W) / (n - 1))
  const pctX = (i: number) => (x(i) / W) * 100

  // Lacunas da serie principal (a primeira que nao e comparacao).
  const principal = series.find((s) => s.cor !== "comparacao") ?? series[0]
  const buracos = lacunas(principal.valores).map(([a, b]) => {
    const x0 = a > 0 ? x(a - 1) : 0
    const x1 = b < n - 1 ? x(b + 1) : W
    // Lacuna no comeco (antes do historico) ancora o rotulo na esquerda; no fim,
    // na direita; no meio, centraliza. Assim o texto nunca sai do grafico.
    const ancora = a === 0 ? "esq" : b === n - 1 ? "dir" : "centro"
    return { x0, x1, ancora, rotulo: x1 - x0 >= 100 }
  })

  const mostrarLegenda = legenda ?? series.length > 1
  // Sem medir a largura: 6 rotulos no desktop, 3 no celular (os demais somem
  // abaixo de sm). Datas "12/09" tem uns 40px.
  const ticksX = indicesRotulosX(n, 6)
  const ticksCelular = new Set(indicesRotulosX(n, 3))
  const ticksTodos = [...new Set([...ticksX, ...ticksCelular])].sort((a, b) => a - b)
  const parcial = parcialUltimo && n > 1
  const ativo = idx !== null && idx < n ? idx : null

  function aoMover(e: React.PointerEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect()
    setViaTeclado(false)
    setIdx(indiceMaisProximo((e.clientX - r.left) / Math.max(1, r.width), n))
  }

  function aoTeclar(e: React.KeyboardEvent<HTMLDivElement>) {
    const atual = ativo ?? n - 1
    let prox: number | null = null
    if (e.key === "ArrowRight") prox = Math.min(n - 1, atual + 1)
    else if (e.key === "ArrowLeft") prox = Math.max(0, atual - 1)
    else if (e.key === "Home") prox = 0
    else if (e.key === "End") prox = n - 1
    else if (e.key === "Escape") {
      setIdx(null)
      return
    }
    if (prox === null) return
    e.preventDefault()
    setViaTeclado(true)
    setIdx(prox)
  }

  function alternar(id: string) {
    setOcultas((atual) => {
      const novo = new Set(atual)
      if (novo.has(id)) novo.delete(id)
      else if (series.length - novo.size > 1) novo.add(id)
      return novo
    })
  }

  const linhasTooltip =
    ativo === null
      ? []
      : visiveis.map((s) => {
          const v = s.valores[ativo]
          return {
            id: s.id,
            rotulo: s.rotulo,
            cor: s.cor ?? "chart-1",
            texto: typeof v === "number" && Number.isFinite(v) ? fmtValor.format(v) : "sem dado",
          }
        })
  const tituloTooltip =
    ativo === null ? "" : `${rotulos[ativo]}${parcial && ativo === n - 1 ? " · parcial" : ""}`

  return (
    <div data-slot="line-chart" className={cn("flex min-w-0 flex-col gap-3", className)}>
      {mostrarLegenda ? (
        <div role="group" aria-label="Legenda: mostrar ou ocultar séries" className="flex flex-wrap gap-1.5">
          {series.map((s) => {
            const ligada = !ocultas.has(s.id)
            const cor = s.cor ?? "chart-1"
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={ligada}
                onClick={() => alternar(s.id)}
                className={cn(
                  "inline-flex h-6 items-center gap-1.5 rounded-sm border border-border px-2 text-label transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
                  ligada ? "bg-surface text-ink" : "bg-track text-t2"
                )}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-4 border-t-[2.5px]",
                    BORDA[cor],
                    cor === "comparacao" ? "border-dashed" : "",
                    !ligada && "opacity-40"
                  )}
                />
                {s.rotulo}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="flex min-w-0">
        {/* eixo Y */}
        <div aria-hidden="true" className="relative w-12 shrink-0 sm:w-16" style={{ height: altura }}>
          {escala.ticks.map((t) => (
            <span
              key={t}
              className="num absolute right-2 -translate-y-1/2 text-label whitespace-nowrap text-t2"
              style={{ top: y(t) }}
            >
              {fmtEixo.format(t)}
            </span>
          ))}
        </div>

        <div className="relative min-w-0 flex-1">
          <div
            role="group"
            tabIndex={0}
            aria-label={`${descricao}. Use as setas para ler cada ponto.`}
            className="relative cursor-crosshair touch-pan-y rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            style={{ height: altura }}
            onPointerMove={aoMover}
            onPointerDown={aoMover}
            // No toque o "leave" vem logo depois do toque: o ponto fica ate tocar fora (blur).
            onPointerLeave={(e) => e.pointerType !== "touch" && setIdx(null)}
            onKeyDown={aoTeclar}
            onFocus={() => {
              setViaTeclado(true)
              setIdx((i) => i ?? n - 1)
            }}
            onBlur={() => setIdx(null)}
          >
            <svg
              viewBox={`0 0 ${W} ${altura}`}
              preserveAspectRatio="none"
              aria-hidden="true"
              className="absolute inset-0 block size-full overflow-visible"
            >
              <defs>
                <pattern
                  id={`${idPadrao}-hach`}
                  width="6"
                  height="6"
                  patternUnits="userSpaceOnUse"
                  patternTransform="rotate(45)"
                >
                  <line x1="0" y1="0" x2="0" y2="6" className="stroke-border-strong" strokeWidth="2" />
                </pattern>
              </defs>
              {buracos.map((b, i) => (
                <rect
                  key={i}
                  x={b.x0}
                  y={PAD_T}
                  width={Math.max(0, b.x1 - b.x0)}
                  height={alturaUtil}
                  fill={`url(#${idPadrao}-hach)`}
                  opacity={0.6}
                />
              ))}
              {escala.ticks.map((t) => (
                <line
                  key={t}
                  x1={0}
                  x2={W}
                  y1={y(t)}
                  y2={y(t)}
                  className={t === 0 ? "stroke-border-strong" : "stroke-chart-grid"}
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              {visiveis.map((s) => {
                const cor = s.cor ?? "chart-1"
                const comparacao = cor === "comparacao"
                const { d, dParcial } = caminhoSerie(s.valores, x, y, parcial && !comparacao)
                const largura = s.destaque ? 2.75 : 2
                return (
                  <g key={s.id} className={TRACO[cor]} fill="none" strokeLinecap="round" strokeLinejoin="round">
                    {d ? (
                      <path
                        d={d}
                        strokeWidth={largura}
                        strokeDasharray={comparacao ? "5 4" : undefined}
                        vectorEffect="non-scaling-stroke"
                      />
                    ) : null}
                    {dParcial ? (
                      <path d={dParcial} strokeWidth={largura} strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />
                    ) : null}
                  </g>
                )
              })}
              {ativo !== null ? (
                <line
                  x1={x(ativo)}
                  x2={x(ativo)}
                  y1={PAD_T}
                  y2={altura - PAD_B}
                  className="stroke-border-strong"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              ) : null}
            </svg>

            {buracos
              .filter((b) => b.rotulo)
              .map((b, i) => (
                <span
                  key={i}
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute top-1/2 max-w-full -translate-y-1/2 truncate rounded-sm border border-border bg-surface px-2 py-0.5 text-label text-t1",
                    b.ancora === "esq" && "left-1",
                    b.ancora === "dir" && "right-1",
                    b.ancora === "centro" && "-translate-x-1/2"
                  )}
                  style={
                    b.ancora === "centro" ? { left: `${((b.x0 + b.x1) / 2 / W) * 100}%` } : undefined
                  }
                >
                  {rotuloLacuna}
                </span>
              ))}

            {parcial ? (
              <span aria-hidden="true" className="pointer-events-none absolute top-0 right-0 text-label text-t2">
                hoje · parcial
              </span>
            ) : null}

            {ativo !== null
              ? visiveis.map((s) => {
                  const v = s.valores[ativo]
                  if (typeof v !== "number" || !Number.isFinite(v)) return null
                  return (
                    <span
                      key={s.id}
                      aria-hidden="true"
                      className={cn(
                        "pointer-events-none absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-surface",
                        BORDA[s.cor ?? "chart-1"]
                      )}
                      style={{ left: `${pctX(ativo)}%`, top: y(v) }}
                    />
                  )
                })
              : null}

            {ativo !== null ? (
              <div
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute top-2 z-10 flex min-w-44 flex-col gap-1.5 rounded-control border border-border bg-surface px-3 py-2.5 shadow-overlay",
                  ativo > (n - 1) / 2 ? "-translate-x-full -ml-3" : "ml-3"
                )}
                style={{ left: `${pctX(ativo)}%` }}
              >
                <span className="text-label font-semibold text-ink">{tituloTooltip}</span>
                {linhasTooltip.map((l) => (
                  <span key={l.id} className="num flex items-center gap-2 text-label">
                    <span
                      aria-hidden="true"
                      className={cn("w-2.5 border-t-2", BORDA[l.cor], l.cor === "comparacao" && "border-dashed")}
                    />
                    <span className="flex-1 text-t1">{l.rotulo}</span>
                    <strong className="font-semibold text-ink">{l.texto}</strong>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {/* eixo X */}
          <div aria-hidden="true" className="relative mt-1.5 h-4">
            {ticksTodos.map((i) => (
              <span
                key={i}
                className={cn(
                  "num absolute top-0 text-label whitespace-nowrap text-t2",
                  i === 0 ? "" : i === n - 1 ? "-translate-x-full" : "-translate-x-1/2",
                  !ticksCelular.has(i) && "hidden sm:inline",
                  !ticksX.includes(i) && "sm:hidden"
                )}
                style={{ left: `${pctX(i)}%` }}
              >
                {rotulos[i]}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Leitura pelo teclado: anuncia o ponto escolhido com as setas. */}
      <p role="status" className="sr-only">
        {viaTeclado && ativo !== null
          ? `${tituloTooltip}: ${linhasTooltip.map((l) => `${l.rotulo} ${l.texto}`).join("; ")}`
          : ""}
      </p>
    </div>
  )
}

export { LineChart }
export type { LineChartProps }
