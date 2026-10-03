"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/** Carregando: a trilha dos passos ao lado e o cartao do passo, na geometria real. */
export function EsqueletoAssistente() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o assistente de importação"
      className="grid animate-xc-in gap-4 [animation-delay:300ms] lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-6"
    >
      <div className="flex flex-col gap-2 lg:hidden">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-1 w-full rounded-full" />
      </div>
      <div className="hidden flex-col gap-3 rounded-card border border-border bg-surface-2 p-3 lg:flex">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex h-9 items-center gap-2.5 px-1.5">
            <Skeleton className="size-5.5 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 sm:p-5">
        <Skeleton className="h-4.5 w-56" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 rounded-card" />
        ))}
        <Skeleton className="mt-2 h-9 w-28 rounded-control" />
      </div>
    </div>
  );
}

/** A lista de lojas nao veio: nao e "nenhuma loja conectada". */
export function ErroAssistente() {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para abrir o assistente"
      descricao="Suas lojas continuam conectadas: foi a leitura que falhou. Tente de novo em instantes."
      acao={
        <Button pending={tentando} onClick={() => iniciar(() => router.refresh())}>
          Tentar de novo
        </Button>
      }
      className="py-12"
    />
  );
}
