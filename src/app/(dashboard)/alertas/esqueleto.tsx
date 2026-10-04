import { Skeleton } from "@/components/ui/skeleton";

/** Carregando: as duas abas e tres cartoes de alerta, na geometria da lista. */
export function EsqueletoAlertas() {
  return (
    <div aria-busy="true" aria-label="Carregando alertas" className="flex flex-col gap-6">
      <div className="flex gap-6 border-b border-border pb-3">
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-4 w-20" />
      </div>
      <div className="flex flex-col gap-3">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex h-30 flex-col gap-3 rounded-card border border-border bg-surface p-4"
          >
            <Skeleton className="h-5.5 w-20 rounded-full" />
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-[70%]" />
          </div>
        ))}
      </div>
    </div>
  );
}
