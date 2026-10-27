import Link from "next/link";
import { Plug } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

// ============================================================================
// O que Campanhas mostra antes dos dados. O cabecalho e fixo (sem banco): sai
// igual no loading.tsx e na pagina, entao a troca nao pisca. O esqueleto tem a
// forma do CampanhasTela: a barra (niveis e os cinco filtros) e a tabela.
// ============================================================================

export function CabecalhoCampanhas() {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <p className="text-dense text-t2">
          Métricas de performance de tráfego pago por conta, campanha, conjunto e criativo.
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* Direto no Meta: /integracoes so redireciona, e o clique pagava duas idas ao servidor. */}
        <Link
          href="/integracoes/meta"
          className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surface-2 hover:text-ink transition"
        >
          <Plug className="h-3.5 w-3.5" />
          <span>Gerenciar integrações</span>
        </Link>
      </div>
    </div>
  );
}

// Selecao, status, nome e os valores. No celular so dois valores (a tabela de
// verdade rola de lado); do md para cima, seis.
const COLUNAS =
  "grid items-center gap-3 px-3 grid-cols-[16px_64px_minmax(0,2fr)_repeat(2,minmax(0,1fr))] md:gap-4 md:grid-cols-[16px_72px_minmax(0,2fr)_repeat(6,minmax(0,1fr))]";

function Valores({ altura }: { altura: string }) {
  return (
    <>
      {Array.from({ length: 6 }, (_, j) => (
        <Skeleton key={j} className={`${altura} w-3/4 justify-self-end ${j >= 2 ? "hidden md:block" : ""}`} />
      ))}
    </>
  );
}

export function EsqueletoCampanhas() {
  return (
    <div aria-busy="true" aria-label="Carregando as campanhas" className="flex flex-col gap-5">
      {/* Barra: os niveis e a hora da sincronizacao, depois os filtros */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-surface p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-3">
          <Skeleton className="h-ctl-md w-[min(340px,100%)] rounded-control" />
          <Skeleton className="hidden h-3 w-44 md:block" />
        </div>
        <div className="grid grid-cols-1 gap-2.5 pt-1 sm:grid-cols-2 md:grid-cols-6">
          {["", "md:col-span-2", "", "", ""].map((largura, i) => (
            <div key={i} className={`flex min-w-0 flex-col gap-1 ${largura}`}>
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-ctl-md rounded-control" />
            </div>
          ))}
        </div>
      </div>

      {/* Tabela: cabecalho, total, linhas e o rodape */}
      <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
        <div className={`${COLUNAS} h-10 border-b border-border/80 bg-surface-2`}>
          <Skeleton className="size-3.5" />
          <Skeleton className="h-2.5 w-12" />
          <Skeleton className="h-2.5 w-20" />
          <Valores altura="h-2.5" />
        </div>
        <div className={`${COLUNAS} h-9 border-b border-border bg-surface-2`}>
          <span />
          <Skeleton className="h-3 w-10" />
          <Skeleton className="h-3 w-24" />
          <Valores altura="h-3" />
        </div>
        <div className="flex flex-col divide-y divide-border/40">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className={`${COLUNAS} h-14`}>
              <Skeleton className="size-3.5" />
              <Skeleton className="h-5 w-full rounded-full" />
              <div className="flex min-w-0 flex-col gap-1.5">
                <Skeleton className="h-3 w-4/5" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
              <Valores altura="h-3" />
            </div>
          ))}
        </div>
        <div className="flex h-10 items-center justify-between border-t border-border/80 bg-surface-2 px-4">
          <Skeleton className="h-3 w-44" />
          <Skeleton className="h-3 w-24" />
        </div>
      </div>
    </div>
  );
}
