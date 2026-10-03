import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregando: a barra de filtros e dois dias de linhas, na geometria da
 * linha do tempo (icone de 32px, titulo, descricao e hora). So aparece
 * depois de 300 ms -- carregamento rapido nao pisca.
 */
export function EsqueletoAtividade() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando a atividade"
      className="min-w-0 animate-xc-in rounded-card border border-border bg-surface [animation-delay:300ms]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
        <Skeleton className="h-ctl-lg w-20 rounded-full sm:h-ctl-sm" />
        <Skeleton className="h-ctl-lg w-20 rounded-full sm:h-ctl-sm" />
        <Skeleton className="h-ctl-md w-full rounded-control sm:ml-auto sm:w-64" />
      </div>
      <div className="divide-y divide-border-subtle">
        {[4, 3].map((n, g) => (
          <div key={g}>
            <div className="border-b border-border-subtle bg-surface-2 px-4 py-2.5">
              <Skeleton className="h-3.5 w-32" />
            </div>
            <div className="divide-y divide-border-subtle">
              {Array.from({ length: n }, (_, i) => (
                <div key={i} className="flex items-start gap-3 px-4 py-3">
                  <Skeleton className="size-8 shrink-0 rounded-control" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                    <Skeleton className="h-3.5 w-2/5" />
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="hidden h-3 w-14 sm:block" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
