import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregando: o cartao do guia (titulo, barra e cinco passos de 56px), na
 * geometria do caminho padrao (anuncio direto, sem escolha nem desenho).
 */
export function EsqueletoGuia() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o guia"
      className="grid animate-xc-in gap-6 [animation-delay:300ms]"
    >
      <div className="rounded-card border border-border bg-surface">
        <div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:justify-between">
          <Skeleton className="h-4.5 w-44" />
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
    </div>
  );
}
