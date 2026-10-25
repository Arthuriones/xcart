import clsx from "clsx";
import { Skeleton } from "@/components/ui/skeleton";
import { vaoDaCelula } from "./lucro-dados";

// ============================================================================
// Carregando do Dashboard, com a geometria da tela (mockup "design novo/
// Dashboard.dc.html"): o destaque com o grafico ao lado da composicao, a
// faixa de KPIs e a tabela. Nada pula quando os numeros chegam.
// ============================================================================

const LARGURAS = ["w-[72%]", "w-[58%]", "w-[46%]", "w-[64%]", "w-[40%]", "w-[54%]"];

/** As 10 celulas da loja online, o caso mais comum (contra entrega tem 12). */
const CELULAS = 10;

export function EsqueletoLucro() {
  return (
    <div
      aria-busy="true"
      data-largura="total"
      className="@container mx-auto flex w-full max-w-330 flex-col gap-4 min-[760px]:gap-6"
    >
      <span className="sr-only">Carregando o Dashboard</span>
      <div className="grid gap-4 min-[760px]:gap-6 @min-[1032px]:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-5">
          <Skeleton className="h-3 w-28" />
          <Skeleton className="h-9 w-60 max-w-[80%] rounded-control" />
          <Skeleton className="h-3 w-44" />
          {/* As linhas de grade do grafico, no lugar dele. */}
          <div
            aria-hidden
            className="mt-3 h-[200px] rounded-control min-[760px]:h-60"
            style={{
              background:
                "linear-gradient(var(--skeleton), var(--skeleton)) bottom/100% 1px no-repeat, repeating-linear-gradient(to bottom, transparent 0 59px, var(--chart-grid) 59px 60px)",
            }}
          />
        </div>
        <div className="flex flex-col gap-4.5 rounded-card border border-border bg-surface p-5">
          <Skeleton className="h-3.5 w-36" />
          {LARGURAS.map((w) => (
            <span key={w} className="flex flex-col gap-2">
              <Skeleton className={`h-2.5 ${w}`} />
              <Skeleton className="h-2 rounded-xs" />
            </span>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border @min-[912px]:grid-cols-4">
        {Array.from({ length: CELULAS }, (_, i) => (
          <div
            key={i}
            className={clsx(
              "flex flex-col gap-2.5 bg-surface px-3.5 py-3 min-[760px]:px-5 min-[760px]:py-4",
              // A mesma regra da faixa: a ultima linha divide a largura.
              vaoDaCelula(i, CELULAS, 4) === 2 && "@min-[912px]:col-span-2"
            )}
          >
            <Skeleton className="h-2.5 w-22" />
            <Skeleton className="h-5.5 w-35 max-w-full rounded-control" />
            <Skeleton className="h-2.5 w-18" />
          </div>
        ))}
      </div>
      <div className="flex flex-col gap-3.5 rounded-card border border-border bg-surface px-5 py-4">
        <Skeleton className="h-3.5 w-65 max-w-full" />
        {LARGURAS.map((w) => (
          <Skeleton key={w} className="h-3.5" />
        ))}
      </div>
    </div>
  );
}
