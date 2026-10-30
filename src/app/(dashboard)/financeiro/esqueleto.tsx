import clsx from "clsx";
import { Skeleton } from "@/components/ui/skeleton";
import { vaoDaCelula } from "./lucro-dados";

// ============================================================================
// Carregando do Dashboard, com a geometria da tela (design "design novo/Panda
// Track - App.dc.html"): o destaque (abas das metricas e grafico) ao lado da
// composicao, a faixa de KPIs e a tabela. Nada pula quando os numeros chegam.
// ============================================================================

const LARGURAS = ["w-[72%]", "w-[58%]", "w-[46%]", "w-[64%]", "w-[40%]", "w-[54%]"];

/**
 * As 7 celulas da faixa da loja online, o caso mais comum: Faturamento, Gasto
 * e ROAS viraram aba do destaque (painel-lucro.tsx).
 */
const CELULAS = 7;

/** Lucro, Faturamento, Gasto e ROAS. */
const ABAS = 4;

/**
 * `umDia`: Hoje, Ontem ou personalizado de um dia. No celular o painel esconde
 * a area do grafico nesses periodos, e o esqueleto tambem -- senao a tela
 * subia ~160px quando os numeros chegavam.
 */
export function EsqueletoLucro({ umDia = false }: { umDia?: boolean }) {
  return (
    <div
      aria-busy="true"
      data-largura="total"
      className="@container mx-auto flex w-full max-w-330 flex-col gap-4 min-[760px]:gap-6"
    >
      <span className="sr-only">Carregando o Dashboard</span>
      {/* A ordem do painel: no celular a faixa de KPIs vem antes da composicao. */}
      <div className="contents max-[759px]:flex max-[759px]:flex-col max-[759px]:gap-4">
        <div className="grid gap-4 max-[759px]:contents min-[760px]:gap-6 @min-[1032px]:grid-cols-[minmax(0,1fr)_380px]">
          <div className="@container flex flex-col overflow-hidden rounded-card border border-border bg-surface max-[759px]:order-first">
            {/* As abas: 2 x 2 no cartao estreito, lado a lado a partir de 640px. */}
            <div className="grid grid-cols-2 gap-px border-b border-border bg-border @min-[640px]:grid-cols-4">
              {Array.from({ length: ABAS }, (_, i) => (
                <div key={i} className="flex flex-col gap-2 bg-surface-2 px-4 pt-3.5 pb-3 min-[760px]:pt-4 min-[760px]:pb-3.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-5.5 w-28 max-w-full rounded-control" />
                  <Skeleton className="h-3 w-24 max-w-full" />
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3 px-5 pt-4 pb-4">
              <Skeleton className="h-3.5 w-72 max-w-[80%]" />
              {/* As linhas de grade do grafico, no lugar dele. */}
              <div
                aria-hidden
                className={clsx("mt-1 h-[200px] rounded-control min-[760px]:h-60", umDia && "hidden min-[760px]:block")}
                style={{
                  background:
                    "linear-gradient(var(--skeleton), var(--skeleton)) bottom/100% 1px no-repeat, repeating-linear-gradient(to bottom, transparent 0 59px, var(--chart-grid) 59px 60px)",
                }}
              />
            </div>
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
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-card border border-border bg-border max-[759px]:-order-1 @min-[912px]:grid-cols-4">
          {Array.from({ length: CELULAS }, (_, i) => (
            <div
              key={i}
              className={clsx(
                "flex flex-col gap-2.5 bg-surface px-3.5 py-3 min-[760px]:px-5 min-[760px]:py-4",
                // A mesma regra da faixa: a ultima linha divide a largura.
                vaoDaCelula(i, CELULAS, 2) === 2 && "col-span-2",
                vaoDaCelula(i, CELULAS, 4) === 2 && "@min-[912px]:col-span-2"
              )}
            >
              <Skeleton className="h-2.5 w-22" />
              <Skeleton className="h-5.5 w-35 max-w-full rounded-control" />
              <Skeleton className="h-2.5 w-18" />
            </div>
          ))}
        </div>
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
