import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoKpis } from "../esqueletos";
import type { PeriodoFaturamento } from "../formato";
import { SeletorPeriodo } from "./seletor-periodo";

/** O mesmo cabecalho na pagina e no loading.tsx. */
export function CabecalhoFaturamento({ periodo }: { periodo: PeriodoFaturamento }) {
  return (
    <PageHeader
      title="Faturamento"
      description="Pedidos pagos nas lojas de checkout dos clientes, por cliente e por loja."
    >
      <SeletorPeriodo valor={periodo} />
    </PageHeader>
  );
}

/** Enquanto as lojas respondem: 3 numeros e a tabela, na mesma geometria. */
export function EsqueletoFaturamento() {
  return (
    <div aria-busy="true" aria-label="Perguntando a cada loja de checkout" className="flex flex-col gap-6">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-64 max-w-full" />
      </div>
      <EsqueletoKpis n={3} />
      <div className="min-w-0 rounded-card border border-border bg-surface">
        <div className="flex flex-col gap-2 px-4 py-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-72 max-w-full" />
        </div>
        <div className="flex flex-col px-4 pb-3">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="grid h-14 grid-cols-[3fr_1fr_1fr_1fr] items-center gap-4 border-t border-border-subtle">
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3" />
              <Skeleton className="h-3" />
              <Skeleton className="h-3" />
            </div>
          ))}
        </div>
      </div>
      <p className="text-label text-t2">Perguntando a cada loja de checkout na Shopify. Leva alguns segundos.</p>
    </div>
  );
}
