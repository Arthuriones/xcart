import { Skeleton } from "@/components/ui/skeleton";
import { CabecalhoEventos } from "./cabecalho";

const LINHAS = [0, 1, 2, 3, 4, 5, 6, 7];

/**
 * Carregando: a geometria da tela de verdade (barra ao vivo, visoes, chips e
 * oito linhas). O cabecalho aparece na hora; o resto so depois de 300 ms,
 * para carregamento rapido nao piscar.
 */
export function EsqueletoEventos() {
  return (
    <>
      <CabecalhoEventos />
      <section
        aria-busy="true"
        aria-label="Carregando eventos"
        className="min-w-0 animate-xc-in rounded-card border border-border bg-surface [animation-delay:300ms]"
      >
        <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-4 py-3">
          <Skeleton className="h-ctl-md w-28 rounded-full" />
          <Skeleton className="h-3 w-44" />
          <div className="flex-1" />
          <Skeleton className="h-ctl-sm w-64 max-w-full" />
        </div>
        <div className="flex items-center gap-4 border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-12" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
        <div className="flex flex-wrap gap-2 px-4 py-3">
          {[24, 20, 24, 20, 28].map((w, i) => (
            <Skeleton key={i} className="h-ctl-sm rounded-full" style={{ width: w * 4 }} />
          ))}
        </div>
        <div className="hidden border-t border-border px-4 py-2 md:block">
          {LINHAS.map((i) => (
            <div
              key={i}
              className="grid h-11 grid-cols-[80px_1fr_1fr_1fr_1.4fr_90px_70px_1.4fr] items-center gap-4"
            >
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-4.5 rounded-full" />
              <Skeleton className="h-2.5" />
              <Skeleton className="h-2.5" />
            </div>
          ))}
        </div>
        <div className="flex flex-col gap-2 border-t border-border p-3 md:hidden">
          {LINHAS.slice(0, 5).map((i) => (
            <div key={i} className="flex flex-col gap-2 rounded-card border border-border p-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-3 w-3/4" />
              <Skeleton className="h-3 w-2/5" />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
