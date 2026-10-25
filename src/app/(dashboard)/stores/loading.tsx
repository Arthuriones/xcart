import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoLista } from "./estados-lista";

/** Lojas carregando: o cabecalho e a tabela com a geometria de verdade. */
export default function CarregandoLojas() {
  return (
    <div className="flex flex-col gap-6">
      {/* O titulo fica na barra do topo; aqui so o botao de conectar. */}
      <div className="hidden justify-end md:flex" aria-hidden>
        <Skeleton className="h-ctl-md w-44 rounded-control" />
      </div>
      <EsqueletoLista />
    </div>
  );
}
