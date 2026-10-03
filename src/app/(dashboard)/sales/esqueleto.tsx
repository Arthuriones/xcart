import { Skeleton } from "@/components/ui/skeleton";

/**
 * Carregando, com a geometria da tela: linha da fonte, 4 numeros, o grafico
 * de receita e trafego e a tabela por loja. As lojas respondem a Shopify uma
 * por uma, entao pode levar alguns segundos.
 */
export function EsqueletoVendas() {
  return (
    <div aria-busy="true" aria-label="Consultando as vendas na Shopify" className="flex flex-col gap-6">
      <Skeleton className="h-4 w-64 max-w-full" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex h-28 flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:p-4">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6.5 w-3/5" />
            <Skeleton className="h-3 w-2/5" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-4 w-48" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex flex-col gap-1.5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="h-2.5 w-full" />
            <Skeleton className="h-2.5 w-full" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4">
        <Skeleton className="h-4 w-40" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
  );
}
