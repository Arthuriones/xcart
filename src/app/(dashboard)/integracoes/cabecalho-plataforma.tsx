import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import type { Estado } from "./regras";

/**
 * Cabecalho de uma plataforma: nome, estado e o botao de login (OAuth, #11)
 * como "Em breve" -- o backend ainda nao existe, o modo manual abaixo e o
 * caminho de hoje.
 */
export function CabecalhoPlataforma({
  titulo,
  estado,
  login,
  nota,
}: {
  titulo: string;
  estado: Estado;
  /** "Conectar com Facebook". Sem ele, a plataforma nao tem login. */
  login?: string;
  /** Uma linha embaixo do botao. */
  nota?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-overlay text-ink">{titulo}</h2>
        <StatusBadge tom={estado.tom}>{estado.texto}</StatusBadge>
      </div>
      {login ? (
        <div className="flex max-w-xs flex-col gap-1 sm:items-end sm:text-right">
          <Button variant="secondary" disabled>
            {login}
            <span className="rounded-sm border border-border px-1 text-label font-normal text-t2">
              Em breve
            </span>
          </Button>
          {nota ? <p className="text-label text-t2 text-pretty">{nota}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
