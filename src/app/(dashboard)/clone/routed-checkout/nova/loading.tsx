import { Skeleton } from "@/components/ui/skeleton";

/** Nova rota carregando: caminho, titulo, trilha e os cartoes de modo. */
export default function CarregandoNovaRota() {
  return (
    <div aria-busy="true" aria-label="Carregando o assistente" className="flex max-w-4xl animate-xc-in flex-col gap-5 [animation-delay:300ms]">
      <Skeleton className="h-3.5 w-32" />
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-80 max-w-full" />
        <Skeleton className="h-3.5 w-[min(520px,90%)]" />
      </div>
      <div className="flex gap-4">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-6 w-28" />
        ))}
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-20 rounded-card" />
        ))}
      </div>
      <Skeleton className="h-36 rounded-card" />
    </div>
  );
}
