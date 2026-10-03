import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoKpis, EsqueletoSecao } from "../../esqueletos";

/** Detalhe do cliente carregando: caminho, titulo, numeros, lojas e o cartao de gerenciar. */
export default function Loading() {
  return (
    <div aria-busy="true" aria-label="Carregando o cliente" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-6 w-72 max-w-full" />
        <Skeleton className="h-5 w-56 rounded-full" />
      </div>
      <EsqueletoKpis n={4} />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <EsqueletoSecao altura="h-48" />
        <EsqueletoSecao altura="h-80" />
      </div>
    </div>
  );
}
