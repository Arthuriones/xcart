"use client";

import { useRef } from "react";
import { cn } from "@/components/ui/cn";

/**
 * Escolha unica em cartoes (titulo + uma linha de explicacao). E um
 * radiogroup: Tab entra no marcado, setas trocam -- como o Segmented da
 * fundacao, que nao cabe texto longo. Fica aqui ate a fundacao ganhar um
 * RadioGroup de cartoes.
 */
export function CartoesEscolha<V extends string>({
  rotulo,
  valor,
  onValorChange,
  opcoes,
  colunas = 3,
  desabilitado = false,
}: {
  rotulo: string;
  valor: V;
  onValorChange: (v: V) => void;
  opcoes: ReadonlyArray<{ valor: V; rotulo: string; descricao: string }>;
  colunas?: 2 | 3;
  desabilitado?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  function teclar(e: React.KeyboardEvent<HTMLButtonElement>, i: number) {
    const passo = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!passo) return;
    e.preventDefault();
    const j = (i + passo + opcoes.length) % opcoes.length;
    onValorChange(opcoes[j].valor);
    refs.current[j]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={rotulo}
      aria-disabled={desabilitado || undefined}
      className={cn("grid gap-2", colunas === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}
    >
      {opcoes.map((o, i) => {
        const marcado = o.valor === valor;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={marcado}
            tabIndex={marcado ? 0 : -1}
            disabled={desabilitado}
            onClick={() => onValorChange(o.valor)}
            onKeyDown={(e) => teclar(e, i)}
            className={cn(
              "flex min-h-11 flex-col gap-1 rounded-card border p-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-60",
              marcado ? "border-ink bg-nav-active" : "border-border bg-surface hover:bg-hover"
            )}
          >
            <span className="flex items-center gap-2 text-dense font-semibold text-ink">
              <span
                aria-hidden
                className={cn(
                  "grid size-4 shrink-0 place-items-center rounded-full border",
                  marcado ? "border-ink" : "border-control-border"
                )}
              >
                {marcado ? <span className="size-2 rounded-full bg-ink" /> : null}
              </span>
              {o.rotulo}
            </span>
            <span className="text-label text-t2 text-pretty">{o.descricao}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Barra de progresso acessivel (a fundacao ainda nao tem Progress). */
export function Progresso({ valor, rotulo }: { valor: number; rotulo: string }) {
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={valor}
      className="h-2 w-full overflow-hidden rounded-full bg-track"
    >
      <div className="h-full rounded-full bg-solid transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${valor}%` }} />
    </div>
  );
}
