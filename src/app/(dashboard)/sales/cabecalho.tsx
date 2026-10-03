import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { SALES_PERIODS, type SalesPeriod } from "@/lib/sales/types";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoVendas() {
  return (
    <PageHeader
      title="Vendas por rota"
      description="Quanto cada loja de checkout faturou, ao lado da fatia do tráfego que o rodízio manda para ela."
    >
      <Link href="/overview" className={buttonVariants({ variant: "secondary" })}>
        Ver a visão da rota
      </Link>
    </PageHeader>
  );
}

/**
 * O periodo desta tela (7, 30 ou 60 dias), na URL (?periodo=). Sao links: da
 * para abrir em outra aba e mandar o link, e o leitor de tela ouve qual e o
 * atual (aria-current). Fica a parte da barra do topo porque a consulta ao
 * vivo da Shopify tem teto de 60 dias.
 */
export function BarraPeriodo({ periodo }: { periodo: SalesPeriod | null }) {
  return (
    <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2">
      <nav aria-label="Período desta tela" className="inline-flex w-fit gap-0.5 rounded-control bg-track p-0.5">
        {SALES_PERIODS.map((p) => {
          const ativo = p.id === periodo;
          return (
            <Link
              key={p.id}
              href={`/sales?periodo=${p.id}`}
              scroll={false}
              aria-current={ativo ? "page" : undefined}
              className={cn(
                "inline-flex h-ctl-lg items-center justify-center rounded-sm px-3 text-dense whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus sm:h-8",
                ativo ? "bg-surface font-semibold text-ink ring-1 ring-border" : "text-t2 hover:text-ink"
              )}
            >
              {p.label}
            </Link>
          );
        })}
      </nav>
      <p className="text-label text-t2">Período só desta tela: a Shopify libera até 60 dias de pedidos.</p>
    </div>
  );
}
