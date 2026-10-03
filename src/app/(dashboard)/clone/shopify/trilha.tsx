"use client";

import { CheckIcon } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { PASSOS, indiceDoPasso, passoSeAplica, type Escopo, type IdPasso } from "./regras";

/**
 * A trilha dos seis passos. Sempre seis: no produto unico a Selecao fica na
 * lista como "não se aplica" e e pulada. Passo feito volta com um clique;
 * passo a frente e texto, nao botao -- depende do que ainda falta preencher.
 * No celular vira "Passo 3 de 6 · Origem" com uma barra.
 */
export function Trilha({
  passo,
  escopo,
  concluida,
  bloqueada,
  irPara,
}: {
  passo: IdPasso;
  escopo: Escopo;
  /** A importacao ja comecou: tudo marcado como feito, nada clicavel. */
  concluida: boolean;
  /** Importando agora: nao da para voltar. */
  bloqueada: boolean;
  irPara: (p: IdPasso) => void;
}) {
  const atual = indiceDoPasso(passo);
  const rotuloAtual = PASSOS[atual]?.rotulo ?? "";

  return (
    <>
      {/* celular e tablet */}
      <div className="flex flex-col gap-2 lg:hidden">
        <p className="text-label text-t2" aria-live="polite">
          {concluida ? (
            "Importação"
          ) : (
            <>
              Passo <span className="num">{atual + 1}</span> de <span className="num">{PASSOS.length}</span> ·{" "}
              <span className="font-semibold text-ink">{rotuloAtual}</span>
            </>
          )}
        </p>
        <div aria-hidden className="grid grid-cols-6 gap-1">
          {PASSOS.map((p, i) => (
            <span
              key={p.id}
              className={cn(
                "h-1 rounded-full",
                concluida || i < atual ? "bg-ok" : i === atual ? "bg-solid" : "bg-track"
              )}
            />
          ))}
        </div>
      </div>

      {/* desktop */}
      <nav aria-label="Passos da importação" className="hidden lg:block">
        <ol className="flex flex-col gap-1 rounded-card border border-border bg-surface-2 p-3">
          {PASSOS.map((p, i) => {
            const aplica = passoSeAplica(p.id, escopo);
            const feito = concluida || (i < atual && aplica);
            const eAtual = !concluida && i === atual;
            const pulado = !aplica;
            const clicavel = feito && !concluida && !bloqueada;
            const marca = (
              <span
                aria-hidden
                className={cn(
                  "grid size-5.5 shrink-0 place-items-center rounded-full border text-label font-semibold",
                  eAtual
                    ? "border-transparent bg-solid text-on-solid"
                    : feito
                      ? "border-transparent bg-ok text-on-solid"
                      : "border-border-strong text-t2"
                )}
              >
                {feito ? <CheckIcon className="size-3" strokeWidth={3} /> : pulado ? "–" : i + 1}
              </span>
            );
            const texto = (
              <span className="flex min-w-0 flex-col">
                <span>{p.rotulo}</span>
                {pulado ? <span className="text-label font-normal text-t2">Não se aplica</span> : null}
              </span>
            );
            return (
              <li key={p.id} aria-current={eAtual ? "step" : undefined}>
                {clicavel ? (
                  <button
                    type="button"
                    onClick={() => irPara(p.id)}
                    className="flex min-h-9 w-full items-center gap-2.5 rounded-control px-1.5 text-left text-dense text-t1 transition-colors hover:bg-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    {marca}
                    {texto}
                    <span className="sr-only">, feito. Voltar para este passo</span>
                  </button>
                ) : (
                  <span
                    className={cn(
                      "flex min-h-9 items-center gap-2.5 px-1.5 text-dense",
                      eAtual ? "font-semibold text-ink" : feito ? "text-t1" : "text-t2"
                    )}
                  >
                    {marca}
                    {texto}
                    {feito ? <span className="sr-only">, feito</span> : null}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </nav>
    </>
  );
}
