import { useState, type KeyboardEvent, type MouseEvent } from "react";
import clsx from "clsx";
import { indicesRotulosX } from "@/components/ui/grafico";
import {
  calcularVariacao,
  formatarVariacao,
  tomVariacao,
  type BomQuando,
  type FormatoVariacao,
} from "@/components/ui/variacao";
import { escalaLinha, rotuloTick, type DefinicaoMetrica, type Granularidade } from "./lucro-dados";

// ============================================================================
// O grafico do destaque (design do Panda Track, "design novo/Panda Track -
// App.dc.html"): uma barra por dia (ou semana, ou mes) na cor da metrica,
// vermelha abaixo de zero, a de hoje hachurada (parcial), e o mesmo ponto do
// periodo anterior como um traco sobre cada barra. HTML com flex, sem lib: a
// hachura e um gradiente. Mouse, toque e teclado (setas, Home, End) mostram o
// ponto, e as outras barras esmaecem.
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

const COR_TOM = { ok: "text-ok", err: "text-err", neutral: "text-t2" } as const;

function finito(v: number | null | undefined): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

/** A hachura da barra parcial: listras da cor sobre o fundo. */
export function hachura(cor: string): string {
  return `repeating-linear-gradient(135deg, ${cor} 0 2px, transparent 2px 5px)`;
}

export function GraficoBarras({
  valores,
  anteriores,
  comparavel,
  rotulos,
  titulos,
  parcialUltimo,
  cor,
  tipo,
  bom,
  formato,
  gran,
  rotuloSerie,
  formatar,
  extras,
  ariaLabel,
}: {
  /** Periodo atual, um valor por ponto (null = sem dado ou sem base). */
  valores: (number | null)[];
  /** Periodo anterior alinhado por posicao. null = sem os tracos. */
  anteriores: (number | null)[] | null;
  /** Ponto com o mesmo numero de dias no anterior (montarSerieLinha). Sem ele, o tooltip nao da a variacao. */
  comparavel: boolean[] | null;
  rotulos: string[];
  titulos: string[];
  parcialUltimo: boolean;
  cor: Cor;
  tipo: DefinicaoMetrica["tipo"];
  /** Para que lado a variacao do tooltip e boa (verde) ou ruim (vermelha). */
  bom: BomQuando;
  /** "pp" na margem: a variacao sai em pontos percentuais. */
  formato?: FormatoVariacao;
  gran: Granularidade;
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
  // % a partir de baixo. A escala sempre tem o zero dentro (escalaLinha).
  const pos = (v: number) => ((v - escala.min) / (escala.max - escala.min)) * 100;
  const zero = pos(0);
  const corVar = `var(--${cor})`;
  // 3px entre dias; com mais de 45 barras, 1px (senao a barra some). Semana e
  // mes tem poucas barras e ganham folga.
  const vao = gran !== "dia" ? "gap-2 min-[760px]:gap-4" : n > 45 ? "gap-px" : "gap-0.5 min-[760px]:gap-[3px]";

  function mover(e: MouseEvent<HTMLDivElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.max(0, Math.min(n - 1, Math.floor(((e.clientX - r.left) / r.width) * n)));
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
  // Margem (pp): a diferenca; o resto, a variacao relativa. So entre grupos
  // com o mesmo numero de dias: 3 dias contra 2 nao e +50%.
  const variacao =
    hv !== null && comparavel?.[hv] && finito(vAt) && finito(vAn)
      ? formato === "pp"
        ? vAt - vAn
        : calcularVariacao(vAt, vAn)
      : null;
  const parcialHov = hv !== null && parcialUltimo && hv === n - 1;
  // Centro da barra em % da largura, e para que lado o tooltip abre.
  const xPct = hv !== null ? ((hv + 0.5) / n) * 100 : 0;
  const tipAEsquerda = hv !== null && hv > n * 0.55;

  const linhasTip =
    hv === null
      ? []
      : [
          ...(finito(vAt)
            ? [{ chave: "atual", rotulo: rotuloSerie, texto: formatar(vAt), classe: vAt < 0 ? "text-err font-semibold" : "text-ink font-semibold" }]
            : [{ chave: "atual", rotulo: rotuloSerie, texto: "sem dado", classe: "text-t2" }]),
          ...(ant
            ? [
                { chave: "anterior", rotulo: "Período anterior", texto: finito(vAn) ? formatar(vAn) : "sem dado", classe: "text-t1" },
                ...(variacao !== null
                  ? [
                      {
                        chave: "variacao",
                        rotulo: "Variação",
                        texto: formatarVariacao(variacao, formato, { sinal: true }),
                        // Hoje ainda vai mudar: a variacao sai sem verde nem vermelho.
                        classe: clsx("font-semibold", COR_TOM[tomVariacao(variacao, parcialHov ? "neutro" : bom)]),
                      },
                    ]
                  : []),
              ]
            : []),
          ...extras(hv).map((x) => ({ chave: `extra-${x.rotulo}`, rotulo: x.rotulo, texto: x.texto, classe: x.negativo ? "text-err" : "text-t1" })),
        ];

  const rotulosX = (max: number) =>
    indicesRotulosX(rotulos.length, max).map((i) => ({ i, left: `${((i + 0.5) / rotulos.length) * 100}%` }));

  return (
    <div className="relative pt-3 pl-[44px] min-[760px]:pl-12">
      <div
        role="img"
        aria-label={ariaLabel}
        tabIndex={0}
        onMouseMove={mover}
        onMouseLeave={() => setHov(null)}
        onKeyDown={teclar}
        onBlur={() => setHov(null)}
        className="relative h-[200px] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus min-[760px]:h-60"
      >
        {escala.ticks.map((t) => {
          const bottom = `${pos(t)}%`;
          return (
            <span key={t} aria-hidden>
              <span
                className={clsx(
                  "absolute inset-x-0 h-px",
                  t === 0 && escala.min < 0 ? "bg-border-strong" : "bg-chart-grid"
                )}
                style={{ bottom }}
              />
              <span
                className="num absolute right-[calc(100%+8px)] translate-y-1/2 whitespace-nowrap text-label text-t3"
                style={{ bottom }}
              >
                {rotuloTick(t, tipo, escala.passo)}
              </span>
            </span>
          );
        })}

        <div aria-hidden className={clsx("absolute inset-0 flex", vao)}>
          {valores.map((v, i) => {
            const parcial = parcialUltimo && i === n - 1;
            const neg = finito(v) && v < 0;
            const c = neg ? "var(--err)" : corVar;
            const p = ant ? ant[i] : null;
            const apagada = hv !== null && hv !== i;
            return (
              <div key={i} className="relative min-w-0 flex-1">
                {finito(v) && (
                  <div
                    className="absolute inset-x-0 rounded-[3px] transition-opacity duration-150"
                    style={{
                      bottom: `${neg ? pos(v) : zero}%`,
                      // Zero ainda aparece: um fio de 0,6% em cima da linha do zero.
                      height: `${Math.max(Math.abs(pos(v) - zero), 0.6)}%`,
                      background: parcial ? hachura(c) : c,
                      border: parcial ? `1px solid ${c}` : undefined,
                      opacity: apagada ? 0.35 : 1,
                    }}
                  />
                )}
                {finito(p) && (
                  <div
                    className="absolute -inset-x-px h-0.5 rounded-[1px] bg-ink transition-opacity duration-150"
                    style={{ bottom: `calc(${pos(p)}% - 1px)`, opacity: apagada ? 0.2 : 0.55 }}
                  />
                )}
              </div>
            );
          })}
        </div>

        {hv !== null && (
          // O tooltip nunca sai da area do grafico: a faixa tem a largura dela,
          // e o vao ate o tooltip encolhe quando nao cabe (ver o de linha antigo).
          <div
            aria-hidden
            className={clsx(
              "pointer-events-none absolute inset-x-0 -top-2 z-[5] flex",
              tipAEsquerda ? "flex-row-reverse" : "flex-row"
            )}
          >
            <span className="min-w-0 shrink" style={{ flexBasis: `calc(${tipAEsquerda ? 100 - xPct : xPct}% + 10px)` }} />
            <div className="flex min-w-[min(13rem,100%)] max-w-full shrink-0 flex-col gap-1 rounded-card border border-border bg-surface px-3 py-2.5 shadow-overlay">
              <span className="text-label text-t3">{titulos[hv]}</span>
              {linhasTip.map((l) => (
                <span key={l.chave} className="num flex items-center justify-between gap-3 text-label">
                  <span className="flex items-center gap-1.5 text-t2">
                    {l.chave === "atual" ? (
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: finito(vAt) && vAt < 0 ? "var(--err)" : corVar }}
                      />
                    ) : l.chave === "anterior" ? (
                      <span className="h-0.5 w-2 shrink-0 rounded-[1px] bg-ink opacity-55" />
                    ) : (
                      <span className="w-2 shrink-0" />
                    )}
                    {l.rotulo}
                  </span>
                  <span className={l.classe}>{l.texto.replace(/^-/, "−")}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
      {/* O tooltip fica dentro do role="img" (que nao e lido): aqui o leitor de
          tela ouve o ponto escolhido pelas setas. */}
      <span className="sr-only" aria-live="polite">
        {hv !== null ? `${titulos[hv]}: ${linhasTip.map((l) => `${l.rotulo} ${l.texto}`).join(", ")}` : ""}
      </span>
      <div aria-hidden className="relative h-7">
        {/* indicesRotulosX sempre soma o ultimo ponto: ~6 rotulos no desktop,
            ~4 no celular. Centrados embaixo da barra. */}
        {(
          [
            [rotulosX(5), "hidden min-[760px]:block"],
            [rotulosX(3), "min-[760px]:hidden"],
          ] as const
        ).map(([lista, classe]) =>
          lista.map((r) => (
            <span
              key={`${classe}-${r.i}`}
              className={clsx("num absolute top-2 -translate-x-1/2 whitespace-nowrap text-label text-t3", classe)}
              style={{ left: r.left }}
            >
              {rotulos[r.i]}
            </span>
          ))
        )}
      </div>
    </div>
  );
}
