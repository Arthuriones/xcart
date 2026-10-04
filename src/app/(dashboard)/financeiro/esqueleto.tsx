import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// Carregando do Lucro, com a geometria da tela: pendencias, 4 KPIs, grafico
// ao lado da cascata e a tabela. Mesma altura do conteudo -- nada pula quando
// os numeros chegam.
// ============================================================================

export function EsqueletoLucro() {
  return (
    <div aria-busy="true" className="flex flex-col gap-6">
      <span className="sr-only">Carregando o lucro</span>
      <Skeleton className="h-12 w-full rounded-card" />
      <div className="flex flex-col gap-2">
        <div className="flex h-8 items-center">
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <div
              key={i}
              className={
                i === 0
                  ? "col-span-2 flex h-39 flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:col-span-3 sm:p-4 lg:col-span-1"
                  : i === 3
                    ? "hidden h-39 flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:flex sm:p-4"
                    : "flex h-39 flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:p-4"
              }
            >
              <Skeleton className="h-3 w-2/5" />
              <Skeleton className="h-6.5 w-3/5" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="mt-auto h-8 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex h-90 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="w-full flex-1" />
        </div>
        <div className="flex h-90 flex-col gap-4 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-1/2" />
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-2.5 w-full" />
            </div>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-5 w-1/3" />
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
