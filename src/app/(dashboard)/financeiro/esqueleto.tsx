import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// Carregando do Dashboard, com a geometria da tela: 5 cartoes de resumo,
// grafico ao lado dos custos, a grade de KPIs e a tabela. Nada pula quando os
// numeros chegam.
// ============================================================================

function Cartao({ className = "" }: { className?: string }) {
  return (
    <div className={`flex min-h-24 items-center gap-3 rounded-overlay border border-border bg-surface p-4 ${className}`}>
      <Skeleton className="size-9 shrink-0 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-5 w-3/4" />
      </div>
    </div>
  );
}

export function EsqueletoLucro() {
  return (
    <div aria-busy="true" data-largura="total" className="flex flex-col gap-3.5">
      <span className="sr-only">Carregando o dashboard</span>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <Cartao key={i} className={i === 0 ? "col-span-2 lg:col-span-1" : ""} />
        ))}
      </div>
      <div className="grid gap-3.5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="flex h-90 flex-col gap-3 rounded-overlay border border-border bg-surface p-5">
          <Skeleton className="h-5 w-1/4" />
          <Skeleton className="w-full flex-1" />
        </div>
        <div className="flex h-90 flex-col gap-4 rounded-overlay border border-border bg-surface p-5">
          <Skeleton className="h-8 w-1/2" />
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, i) => (
          <Cartao key={i} />
        ))}
      </div>
    </div>
  );
}
