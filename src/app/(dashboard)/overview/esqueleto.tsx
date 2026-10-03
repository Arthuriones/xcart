import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregando, com a geometria da tela: barra da rota, 4 numeros, o caminho
 * do comprador e a atividade. Aparece depois de 300 ms (carga rapida nao pisca).
 */
export function EsqueletoVisao() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando a visão da rota"
      className="flex animate-xc-in flex-col gap-6 [animation-delay:300ms]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-9 w-72 max-w-full rounded-control" />
        <Skeleton className="h-4 w-40" />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-28 flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:p-4">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6.5 w-2/5" />
            <Skeleton className="h-3 w-3/5" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-4 w-48" />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,2fr)]">
          <Skeleton className="h-28 rounded-card" />
          <Skeleton className="h-28 rounded-card" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-24 rounded-card" />
            <Skeleton className="h-24 rounded-card" />
          </div>
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-4 w-40" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  );
}
