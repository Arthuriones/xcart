import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoLista } from "./estados-lista";

/** Lojas carregando: o cabecalho e a tabela com a geometria de verdade. */
export default function CarregandoLojas() {
  return (
    <div className="flex flex-col gap-6">
      <div className="hidden flex-col gap-2 md:flex" aria-hidden>
        <Skeleton className="h-5.5 w-28" />
        <Skeleton className="h-3.5 w-[min(520px,80%)]" />
      </div>
      <EsqueletoLista />
    </div>
  );
}
