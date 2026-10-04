import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// Carregando de Custos, com a geometria da tela da loja: a linha da loja, o
// bloco da taxa (tres campos) e a tabela de produtos. Mesma altura
// do conteudo -- nada pula quando os dados chegam.
// ============================================================================

export function EsqueletoCustos() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando custos e taxas"
      className="flex animate-xc-in flex-col gap-6 [animation-delay:300ms]"
    >
      <div className="flex items-center gap-3">
        <div className="flex flex-col gap-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="ml-auto h-ctl-sm w-28 rounded-control" />
      </div>

      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
        <div className="flex justify-between gap-3">
          <Skeleton className="h-4.5 w-48" />
          <Skeleton className="h-5.5 w-24 rounded-full" />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-ctl-md w-full rounded-control" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col rounded-card border border-border bg-surface">
        <div className="flex flex-col gap-2 p-4">
          <Skeleton className="h-4.5 w-40" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex flex-wrap gap-3 border-b border-border-subtle px-4 pb-3">
          <Skeleton className="h-8 w-72 max-w-full rounded-control" />
          <Skeleton className="h-ctl-md w-60 rounded-control" />
        </div>
        <div className="hidden px-4 py-2 sm:block">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid h-11 grid-cols-[2fr_1fr_1fr_1fr_80px_1fr_1fr] items-center gap-4">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3" />
              <Skeleton className="h-ctl-sm rounded-control" />
              <Skeleton className="h-ctl-sm rounded-control" />
              <Skeleton className="h-ctl-sm rounded-control" />
              <Skeleton className="h-3" />
              <Skeleton className="h-5.5 w-20 rounded-full" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 p-3 sm:hidden">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex h-40 flex-col gap-3 rounded-card border border-border p-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-ctl-lg w-full rounded-control" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
