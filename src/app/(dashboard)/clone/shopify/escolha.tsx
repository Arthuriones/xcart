"use client";

import * as React from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";

// ============================================================================
// Pecas de escolha do assistente: cartoes de escolha unica (radiogroup) e a
// caixa de marcar. A fundacao ainda nao tem RadioGroup nem Checkbox (anotado
// nas pendencias); estas ficam aqui, com a semantica certa -- role, aria-
// checked, setas no grupo, foco visivel -- e sem input nativo.
// ============================================================================

const FOCO = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus";

/** A bolinha do radio, so visual (o estado esta no aria-checked do cartao). */
export function Bolinha({ marcada }: { marcada: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-full border",
        marcada ? "border-transparent bg-solid" : "border-control-border bg-surface"
      )}
    >
      {marcada ? <span className="size-1.5 rounded-full bg-on-solid" /> : null}
    </span>
  );
}

/** A caixa de marcar, so visual: marcada, desmarcada ou parcial. */
export function Caixa({ estado }: { estado: boolean | "mixed" }) {
  const cheia = estado !== false;
  return (
    <span
      aria-hidden
      className={cn(
        "grid size-4 shrink-0 place-items-center rounded-sm border",
        cheia ? "border-transparent bg-solid text-on-solid" : "border-control-border bg-surface"
      )}
    >
      {estado === true ? <CheckIcon className="size-3" strokeWidth={3} /> : null}
      {estado === "mixed" ? <MinusIcon className="size-3" strokeWidth={3} /> : null}
    </span>
  );
}

export interface OpcaoEscolha<V extends string> {
  valor: V;
  titulo: React.ReactNode;
  descricao?: React.ReactNode;
  /** Selo ou numero a direita (ex.: estado da conexao). */
  extra?: React.ReactNode;
  desabilitado?: boolean;
}

/**
 * Escolha unica em cartoes. E um radiogroup: Tab entra no marcado, as setas
 * trocam (e marcam), Espaco marca. "lista" empilha; "grade" poe lado a lado
 * a partir do sm.
 */
export function GrupoEscolha<V extends string>({
  rotulo,
  rotuloId,
  valor,
  onValor,
  opcoes,
  arranjo = "lista",
  className,
}: {
  /** Nome do grupo para leitor de tela (ou use rotuloId). */
  rotulo?: string;
  /** id do titulo visivel que nomeia o grupo. */
  rotuloId?: string;
  valor: V | "";
  onValor: (v: V) => void;
  opcoes: ReadonlyArray<OpcaoEscolha<V>>;
  arranjo?: "lista" | "grade";
  className?: string;
}) {
  const refs = React.useRef<Array<HTMLButtonElement | null>>([]);
  const habilitadas = opcoes.map((o, i) => (o.desabilitado ? -1 : i)).filter((i) => i >= 0);
  const marcado = opcoes.findIndex((o) => o.valor === valor && !o.desabilitado);
  const focavel = marcado >= 0 ? marcado : (habilitadas[0] ?? -1);

  function mover(de: number, passo: number) {
    const pos = habilitadas.indexOf(de);
    if (pos < 0 || habilitadas.length === 0) return;
    const i = habilitadas[(pos + passo + habilitadas.length) % habilitadas.length];
    onValor(opcoes[i].valor);
    refs.current[i]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={rotuloId ? undefined : rotulo}
      aria-labelledby={rotuloId}
      className={cn(
        arranjo === "grade" ? "grid grid-cols-1 gap-2 sm:grid-cols-3" : "flex flex-col gap-2",
        className
      )}
    >
      {opcoes.map((o, i) => {
        const on = i === marcado;
        return (
          <button
            key={o.valor}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-disabled={o.desabilitado || undefined}
            tabIndex={i === focavel ? 0 : -1}
            onClick={() => !o.desabilitado && onValor(o.valor)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowRight") {
                e.preventDefault();
                mover(i, 1);
              } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                mover(i, -1);
              }
            }}
            className={cn(
              "flex min-h-11 w-full min-w-0 items-start gap-3 rounded-card border px-3.5 py-3 text-left transition-colors",
              FOCO,
              on ? "border-ink bg-surface-2" : "border-border bg-surface hover:border-border-strong hover:bg-hover",
              o.desabilitado && "cursor-not-allowed opacity-60 hover:border-border hover:bg-surface"
            )}
          >
            <span className="pt-0.5">
              <Bolinha marcada={on} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="text-dense font-semibold text-ink">{o.titulo}</span>
              {o.descricao ? <span className="text-label text-t2">{o.descricao}</span> : null}
            </span>
            {o.extra ? <span className="shrink-0 self-center">{o.extra}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
