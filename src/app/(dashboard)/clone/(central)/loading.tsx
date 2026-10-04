import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoFila } from "../../bulk/fila";
import { CabecalhoCentral } from "../central-importacao";

/**
 * Importar carregando: o cabecalho de verdade, as tres origens e a fila em
 * esqueleto. Mora no grupo (central) para envolver so /clone: em
 * clone/loading.tsx ele tambem embrulharia /clone/shopify e Rotas.
 */
export default function CarregandoCentral() {
  return (
    <>
      <CabecalhoCentral />
      <div
        aria-busy="true"
        aria-label="Carregando a importação"
        className="flex animate-xc-in flex-col gap-6 [animation-delay:300ms]"
      >
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <Skeleton className="h-4 w-32" />
          <div className="grid gap-3 md:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex h-40 flex-col gap-3 rounded-card border border-border bg-surface p-4">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-9 rounded-control" />
                  <Skeleton className="h-4 w-28" />
                </div>
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface pt-4">
          <Skeleton className="mx-4 h-4 w-40" />
          <EsqueletoFila />
        </div>
      </div>
    </>
  );
}
