import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoConsole } from "./estados";

/** Rotas carregando: o cabecalho e o console com a geometria de verdade. */
export default function CarregandoRotas() {
  return (
    <div className="flex flex-col gap-6">
      {/* O titulo fica na barra do topo; aqui so a descricao. */}
      <div className="hidden flex-col gap-2 md:flex" aria-hidden>
        <Skeleton className="h-3.5 w-[min(520px,80%)]" />
      </div>
      <EsqueletoConsole />
    </div>
  );
}
