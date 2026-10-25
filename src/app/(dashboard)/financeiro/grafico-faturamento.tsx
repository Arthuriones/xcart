import { useState, type KeyboardEvent, type MouseEvent } from "react";
import clsx from "clsx";
import { indicesRotulosX } from "@/components/ui/grafico";
import {
  ALTURA_LINHA,
  LARGURA_LINHA,
  caminhoLinha,
  escalaLinha,
  rotuloTick,
  tracarLinha,
  xDoPonto,
  yDoValor,
  type DefinicaoMetrica,
} from "./lucro-dados";

// ============================================================================
// O grafico de linha do destaque (mockup "design novo/Dashboard.dc.html"):
// o periodo atual em linha de 2px com a area a 6%, o anterior tracejado, o
// trecho de hoje pontilhado e o ponto final em anel. SVG a mao, sem lib: o
// viewBox 1000 x 240 estica (preserveAspectRatio none) e o traco nao
// (vector-effect). Mouse, toque e teclado (setas, Home, End) mostram o ponto.
//
// Sem "use client" de proposito: so o painel (client) usa este arquivo, e ele
// recebe funcoes (formatar, extras), que nao passariam da fronteira.
// ============================================================================

export interface LinhaExtra {
  rotulo: string;
  texto: string;
  negativo: boolean;
}

type Cor = "chart-1" | "chart-2" | "chart-3";

/** % do viewBox para posicionar os pontos em HTML por cima do SVG. */
const px = (x: number) => `${(x / LARGURA_LINHA) * 100}%`;
const py = (y: number) => `${(y / ALTURA_LINHA) * 100}%`;

export function GraficoLinha({
  valores,
  anteriores,
  rotulos,
  titulos,
  parcialUltimo,
  cor,
  tipo,
  rotuloSerie,
  formatar,
  extras,
  ariaLabel,
}: {
  /** Periodo atual, um valor por ponto (null = sem dado ou sem base). */
  valores: (number | null)[];
  /** Periodo anterior alinhado por posicao. null = sem a linha tracejada. */
  anteriores: (number | null)[] | null;
  rotulos: string[];
  titulos: string[];
  parcialUltimo: boolean;
  cor: Cor;
  tipo: DefinicaoMetrica["tipo"];
  /** "Lucro estimado": a primeira linha do tooltip. */
  rotuloSerie: string;
  formatar: (v: number) => string;
  /** As outras metricas do ponto, no tooltip. */
  extras: (i: number) => LinhaExtra[];
  ariaLabel: string;
}) {
  const [hov, setHov] = useState<number | null>(null);
  const n = Math.max(valores.length, 1);
  const ant = anteriores ? anteriores.slice(0, n) : null;
  const escala = escalaLinha([...valores, ...(ant ?? [])]);
  const tracado = tracarLinha(valores, escala, parcialUltimo);
  const linhaAnterior = ant ? caminhoLinha(ant, n, escala) : "";
  const corVar = `var(--${cor})`;
  const ok = (v: number | null | undefined): v is number => typeof v === "number" && Number.isFinite(v);

  function mover(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left) / r.width) * (n - 1))));
    if (i !== hov) setHov(i);
  }

  function teclar(e: KeyboardEvent<HTMLDivElement>) {
    const atual = hov ?? n - 1;
    const proximo =
      e.key === "ArrowLeft"
        ? Math.max(0, atual - 1)
        : e.key === "ArrowRight"
          ? Math.min(n - 1, atual + 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (proximo === null) return;
    e.preventDefault();
    setHov(proximo);
  }

  const hv = hov !== null && hov < n ? hov : null;
  const vAt = hv !== null ? valores[hv] : null;
  const vAn = hv !== null && ant ? ant[hv] : null;
  // Posicao do ponto em % da largura, e para que lado o tooltip abre.
  const xPct = hv !== null ? (xDoPonto(hv, n) / LARGURA_LINHA) * 100 : 0;
  const tipAEsquerda = hv !== null && hv > n * 0.55;
  const linhasTip =
    hv === null
      ? []
      : [
          ...(ok(vAt) ? [{ rotulo: rotuloSerie, texto: formatar(vAt), negativo: vAt < 0, tipo: "atual" as const }] : []),
          ...(ant
            ? [{ rotulo: "Período anterior", texto: ok(vAn) ? formatar(vAn) : "sem dado", negativo: false, tipo: "anterior" as const }]
            : []),
          ...extras(hv).map((x) => ({ ...x, tipo: "extra" as const })),
        ];

  const rotulosX = (max: number) =>
    indicesRotulosX(rotulos.length, max).map((i) => ({
      i,
      left: rotulos.length === 1 ? "50%" : px(xDoPonto(i, rotulos.length)),
      transform:
        rotulos.length === 1
          ? "translateX(-50%)"
          : i === 0
            ? "none"
            : i === rotulos.length - 1
              ? "translateX(-100%)"
              : "translateX(-50%)",
    }));

  return (
    <div className="relative pt-5 pr-5 pl-[52px] min-[760px]:pl-16">
      <div
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onMouseMove={mover}
        onMouseLeave={() => setHov(null)}
        onKeyDown={teclar}
        onBlur={() => setHov(null)}
        className="relative h-[200px] cursor-crosshair focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus min-[760px]:h-60"
      >
        {escala.ticks.map((t) => {
          const top = py(yDoValor(t, escala));
          return (
            <span key={t} aria-hidden>
              <span
                className={clsx(
                  "absolute inset-x-0 h-px",
                  t === 0 && escala.min < 0 ? "bg-border-strong" : "bg-chart-grid"
                )}
                style={{ top }}
              />
              <span
                className="num absolute right-[calc(100%+10px)] -translate-y-1/2 whitespace-nowrap text-label text-t3"
                style={{ top }}
              >
                {rotuloTick(t, tipo, escala.passo)}
              </span>
            </span>
          );
        })}
        <svg
          viewBox={`0 0 ${LARGURA_LINHA} ${ALTURA_LINHA}`}
          preserveAspectRatio="none"
          aria-hidden
          className="absolute inset-0 size-full overflow-visible"
        >
          {tracado.area && <path d={tracado.area} style={{ fill: corVar, fillOpacity: 0.06, stroke: "none" }} />}
          {linhaAnterior && (
            <path
              d={linhaAnterior}
              fill="none"
              strokeWidth={1.5}
              strokeDasharray="4 4"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: "var(--t4)" }}
            />
          )}
          <path
            d={tracado.linha}
            fill="none"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            style={{ stroke: corVar }}
          />
          {tracado.parcial && (
            <path
              d={tracado.parcial}
              fill="none"
              strokeWidth={2}
              strokeDasharray="2 4"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ stroke: corVar }}
            />
          )}
        </svg>
        {tracado.fim && hv === null && (
          <span
            aria-hidden
            className="absolute -mt-1 -ml-1 size-2 rounded-full bg-surface"
            style={{ left: px(tracado.fim.x), top: py(tracado.fim.y), boxShadow: `0 0 0 2px ${corVar}` }}
          />
        )}
        {hv !== null && (
          <>
            <span aria-hidden className="absolute inset-y-0 w-px bg-border-strong" style={{ left: px(xDoPonto(hv, n)) }} />
            {ok(vAt) && (
              <span
                aria-hidden
                className="absolute -mt-[4.5px] -ml-[4.5px] size-[9px] rounded-full shadow-[0_0_0_2px_var(--surface)]"
                style={{ left: px(xDoPonto(hv, n)), top: py(yDoValor(vAt, escala)), background: corVar }}
              />
            )}
            {ok(vAn) && (
              <span
                aria-hidden
                className="absolute -mt-[4.5px] -ml-[4.5px] size-[9px] rounded-full bg-t4 shadow-[0_0_0_2px_var(--surface)]"
                style={{ left: px(xDoPonto(hv, n)), top: py(yDoValor(vAn, escala)) }}
              />
            )}
            {/* O tooltip nunca sai da area do grafico: a faixa tem a largura
                dela, e o vao entre a borda e o tooltip (12px depois do ponto,
                ou antes dele depois de 55%) encolhe quando nao cabe. Com left
                em % e translate, no celular ele passava da tela. */}
            <div
              aria-hidden
              className={clsx(
                "pointer-events-none absolute inset-x-0 -top-1.5 z-[5] flex",
                tipAEsquerda ? "flex-row-reverse" : "flex-row"
              )}
            >
              <span className="min-w-0 shrink" style={{ flexBasis: `calc(${tipAEsquerda ? 100 - xPct : xPct}% + 12px)` }} />
              <div className="flex min-w-[min(14rem,100%)] max-w-full shrink-0 flex-col gap-1.5 rounded-card border border-border bg-surface px-3 py-2.5 shadow-overlay">
                <span className="text-label font-semibold text-ink">{titulos[hv]}</span>
                {linhasTip.map((l) => (
                  <span key={`${l.tipo}-${l.rotulo}`} className="num flex items-center gap-2 text-label">
                    {l.tipo === "anterior" ? (
                      <span className="w-2.5 shrink-0 border-t-2 border-dashed border-t4" />
                    ) : (
                      <span
                        className="h-0.5 w-2.5 shrink-0 rounded-[1px]"
                        style={{ background: l.tipo === "atual" ? corVar : "transparent" }}
                      />
                    )}
                    <span className="flex-1 text-t2">{l.rotulo}</span>
                    <span
                      className={clsx(
                        l.tipo === "atual" ? "font-semibold" : "font-normal",
                        l.negativo ? "text-err" : l.tipo === "atual" ? "text-ink" : "text-t1"
                      )}
                    >
                      {l.texto.replace(/^-/, "−")}
                    </span>
                  </span>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
      {/* O tooltip fica dentro do role="img" (que nao e lido): aqui o leitor de
          tela ouve o ponto escolhido pelas setas. */}
      <span className="sr-only" aria-live="polite">
        {hv !== null ? `${titulos[hv]}: ${linhasTip.map((l) => `${l.rotulo} ${l.texto}`).join(", ")}` : ""}
      </span>
      <div aria-hidden className="relative h-7">
        {/* indicesRotulosX sempre soma o ultimo dia: 5 + 1 = ~6 rotulos no
            desktop, 3 + 1 = ~4 no celular. */}
        {(
          [
            [rotulosX(5), "hidden min-[760px]:block"],
            [rotulosX(3), "min-[760px]:hidden"],
          ] as const
        ).map(([lista, classe]) =>
          lista.map((r) => (
            <span
              key={`${classe}-${r.i}`}
              className={clsx("num absolute top-2 whitespace-nowrap text-label text-t3", classe)}
              style={{ left: r.left, transform: r.transform }}
            >
              {rotulos[r.i]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
