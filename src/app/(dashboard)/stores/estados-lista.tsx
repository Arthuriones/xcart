"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";

/** A tabela enquanto carrega: mesma geometria (barra de filtros + linhas de 56px). */
export function EsqueletoLista() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando lojas"
      className="min-w-0 animate-xc-in rounded-card border border-border bg-surface [animation-delay:300ms]"
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <Skeleton className="h-8 w-72 max-w-full rounded-control" />
        <Skeleton className="hidden h-9 w-60 rounded-control sm:block" />
      </div>
      <div className="hidden px-4 py-2 sm:block">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="grid h-14 grid-cols-[2fr_1fr_1fr_1fr_1fr_64px] items-center gap-4">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-5 w-22 rounded-full" />
            <Skeleton className="h-3" />
            <Skeleton className="h-3" />
            <Skeleton className="h-5 w-24 rounded-full" />
            <Skeleton className="h-6 rounded-control" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-3 sm:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-30 flex-col gap-3 rounded-card border border-border p-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A leitura falhou: diz que as lojas continuam conectadas e deixa tentar de novo. */
export function ErroLista() {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para carregar suas lojas"
      descricao="Suas lojas continuam conectadas: foi a leitura que falhou. Tente de novo em instantes."
      acao={
        <Button pending={tentando} onClick={() => startTransition(() => router.refresh())}>
          Tentar de novo
        </Button>
      }
      className="py-12"
    />
  );
}
