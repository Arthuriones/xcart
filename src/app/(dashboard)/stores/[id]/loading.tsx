import { Skeleton } from "@/components/ui/skeleton";
import { EsqueletoAba } from "./esqueleto";

/** Detalhe da loja carregando: caminho, titulo, abas e a visao geral. */
export default function CarregandoLoja() {
  return (
    <div aria-busy="true" aria-label="Carregando a loja" className="flex flex-col">
      <Skeleton className="mb-3 h-3.5 w-32" />
      <div className="mb-5 flex flex-col gap-2">
        <Skeleton className="h-6 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      <div className="flex gap-4 border-b border-border pb-3">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-4 w-20" />
        ))}
      </div>
      <div className="pt-5">
        <EsqueletoAba aba="visao" />
      </div>
    </div>
  );
}
