import { Skeleton } from "@/components/ui/skeleton";

// Pecas de carregamento do admin, na geometria do conteudo: KPI, cartao de
// secao e tabela. Cada tela monta o seu esqueleto com elas.

export function EsqueletoKpis({ n = 4 }: { n?: number }) {
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {Array.from({ length: n }, (_, i) => (
        <div key={i} className="flex h-30 flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-3 w-1/2" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-3 w-2/5" />
        </div>
      ))}
    </div>
  );
}

export function EsqueletoSecao({ altura = "h-64", className }: { altura?: string; className?: string }) {
  return (
    <div className={`flex flex-col gap-4 rounded-card border border-border bg-surface p-4 ${className ?? ""}`}>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-56 max-w-full" />
      </div>
      <Skeleton className={`${altura} w-full rounded-control`} />
    </div>
  );
}

export function EsqueletoTabela({ linhas = 6, rotulo = "Carregando a tabela" }: { linhas?: number; rotulo?: string }) {
  return (
    <div aria-busy="true" aria-label={rotulo} className="min-w-0 rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
        <Skeleton className="h-8 w-64 max-w-full rounded-control" />
        <Skeleton className="hidden h-8 w-48 rounded-control sm:block" />
      </div>
      <div className="hidden flex-col px-4 py-2 sm:flex">
        {Array.from({ length: linhas }, (_, i) => (
          <div key={i} className="grid h-14 grid-cols-[2fr_1fr_1fr_1fr_1fr_64px] items-center gap-4">
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-5 w-22 rounded-full" />
            <Skeleton className="h-3" />
            <Skeleton className="h-3" />
            <Skeleton className="h-3" />
            <Skeleton className="h-6 rounded-control" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 p-3 sm:hidden">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex h-28 flex-col gap-3 rounded-card border border-border p-3">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </div>
    </div>
  );
}
