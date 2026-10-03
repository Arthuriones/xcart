import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregando a Assinatura, na geometria da tela: plano ao lado dos creditos,
 * os pacotes e o historico. So aparece depois de 300 ms.
 */
export function EsqueletoAssinatura() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando assinatura e créditos"
      className="flex animate-xc-in flex-col gap-4 [animation-delay:300ms]"
    >
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex h-56 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="h-3.5 w-3/4" />
          <Skeleton className="mt-auto h-ctl-md w-40 rounded-control" />
        </div>
        <div className="flex h-44 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-28" />
          <div className="grid grid-cols-2 gap-3">
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
          <Skeleton className="h-3 w-4/5" />
        </div>
      </div>
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-4 w-36" />
        <div className="grid gap-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-16 rounded-card" />
          ))}
        </div>
        <Skeleton className="h-ctl-md w-44 rounded-control" />
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-4 w-40" />
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    </div>
  );
}
