import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// Carregando de cada plataforma, com a geometria do conteudo dela: cabecalho,
// os dois cartoes (ler o gasto / enviar as compras) e as linhas da tabela.
// ============================================================================

function Cabecalho() {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-5.5 w-40 rounded-full" />
      </div>
      <Skeleton className="h-ctl-md w-52 rounded-control" />
    </div>
  );
}

function Cartao({ altura = "h-36" }: { altura?: string }) {
  return (
    <div className={`flex flex-col gap-3 rounded-card border border-border bg-surface p-4 ${altura}`}>
      <Skeleton className="h-3 w-24" />
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

/** Meta e Google: cabecalho, dois cartoes e a tabela de contas. */
export function EsqueletoContas({ rotulo }: { rotulo: string }) {
  return (
    <div aria-busy="true" aria-label={rotulo} className="flex flex-col gap-5">
      <Cabecalho />
      <Skeleton className="h-12 w-full rounded-card" />
      <div className="grid gap-3 md:grid-cols-2">
        <Cartao />
        <Cartao />
      </div>
      <div className="rounded-card border border-border bg-surface">
        <div className="flex flex-col gap-2 border-b border-border-subtle p-4">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-2/3" />
        </div>
        <div className="flex flex-col px-4 py-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="grid h-13 grid-cols-[2fr_1.4fr_1fr_1fr_1fr] items-center gap-4">
              <Skeleton className="h-3" />
              <Skeleton className="h-ctl-sm rounded-control" />
              <Skeleton className="h-3" />
              <Skeleton className="h-3" />
              <Skeleton className="h-5 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Shopify, Notificacoes e Avancado: cabecalho e blocos. */
export function EsqueletoBlocos({ rotulo, blocos = 2 }: { rotulo: string; blocos?: number }) {
  return (
    <div aria-busy="true" aria-label={rotulo} className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-2/3" />
      </div>
      {Array.from({ length: blocos }, (_, i) => (
        <Cartao key={i} altura={i === 0 ? "h-56" : "h-36"} />
      ))}
    </div>
  );
}
