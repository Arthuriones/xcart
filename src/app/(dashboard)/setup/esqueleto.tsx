import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregando: o cartao do guia (titulo, escolha do caminho, barra e cinco
 * passos de 56px) e a coluna do fluxo, na geometria de verdade.
 */
export function EsqueletoGuia() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o guia"
      className="grid animate-xc-in gap-6 [animation-delay:300ms] lg:grid-cols-[minmax(0,1fr)_300px]"
    >
      <div className="rounded-card border border-border bg-surface">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:justify-between">
          <div className="flex flex-col gap-2">
            <Skeleton className="h-4.5 w-44" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-9 w-72 max-w-full rounded-control" />
        </div>
        <div className="flex items-center gap-3 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-1.5 flex-1 rounded-full" />
          <Skeleton className="h-3 w-8" />
        </div>
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex h-14 items-center gap-3 border-b border-border-subtle px-4 last:border-b-0">
            <Skeleton className="size-5 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
            <Skeleton className="hidden h-5.5 w-16 rounded-full sm:block" />
          </div>
        ))}
      </div>
      <div className="hidden flex-col gap-2 lg:flex">
        <Skeleton className="h-3 w-40" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-14 rounded-card" />
        ))}
      </div>
    </div>
  );
}
