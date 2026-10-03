import { Skeleton } from "@/components/ui/skeleton";

/** Carregando: formulario a esquerda, resumo a direita e a fila embaixo. */
export function EsqueletoLote() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando a importação"
      className="flex animate-xc-in flex-col gap-6 [animation-delay:300ms]"
    >
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
            <Skeleton className="h-4 w-36" />
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_200px]">
              <Skeleton className="h-ctl-md rounded-control" />
              <Skeleton className="h-ctl-md rounded-control" />
            </div>
            <Skeleton className="h-40 rounded-control" />
          </div>
          <div className="flex h-96 flex-col gap-4 rounded-card border border-border bg-surface p-4">
            <Skeleton className="h-4 w-24" />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-6 w-10 rounded-full" />
                <Skeleton className="h-3.5 w-1/2" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex h-72 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-auto h-ctl-lg rounded-control" />
        </div>
      </div>
    </div>
  );
}
