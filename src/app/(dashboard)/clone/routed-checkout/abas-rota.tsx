"use client";

import type { ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { ABAS, abaDe, hrefRota, type AbaRota } from "./logica";

/**
 * As abas da rota trocam sem ida ao servidor: o conteudo das quatro ja veio
 * pronto do servidor junto com o grafo. A aba mora na URL (?aba=), como o
 * filtro da lista, para o link continuar servindo para abrir em outra aba ou
 * mandar para alguem. So a aba aberta e montada: o Diagnostico testa a rota
 * ao abrir quando veio do "Conferir agora", e nao pode testar escondido.
 */
export function AbasRota({ rotaId, conteudo }: { rotaId: string; conteudo: Record<AbaRota, ReactNode> }) {
  const params = useSearchParams();
  const aba = abaDe(params.get("aba"));

  return (
    <>
      <nav aria-label="Seções da rota" className="flex gap-4 overflow-x-auto border-b border-border [scrollbar-width:none]">
        {ABAS.map((a) => {
          const ativa = a.id === aba;
          const href = hrefRota(rotaId, a.id);
          return (
            <a
              key={a.id}
              href={href}
              aria-current={ativa ? "page" : undefined}
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                window.history.replaceState(null, "", href);
              }}
              className={cn(
                "-mb-px inline-flex h-10 shrink-0 items-center border-b-2 text-dense font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
                ativa ? "border-ink text-ink" : "border-transparent text-t2 hover:text-ink"
              )}
            >
              {a.rotulo}
            </a>
          );
        })}
      </nav>
      {conteudo[aba]}
    </>
  );
}
