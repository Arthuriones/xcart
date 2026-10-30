import { PageHeader } from "@/components/layout/page-header";
import { Skeleton } from "@/components/ui/skeleton";

/** A linha do topo, igual na pagina e no loading.tsx. */
export const DESCRICAO_REGRAS =
  "As regras usam o gasto e os ICs do Meta (atualizados a cada 15 min) e as compras do Panda Track, e agem no Meta no intervalo escolhido. Valores na moeda da conta de anúncio.";

export const TITULO_REGRAS = "Regras automáticas";

/** A forma da tela enquanto a lista nao chega: dois cartoes de regra e o historico. */
export function EsqueletoRegras() {
  return (
    <div aria-busy="true" aria-label="Carregando regras" className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-44 rounded-card" />
        <Skeleton className="h-44 rounded-card" />
      </div>
      <Skeleton className="h-64 rounded-card" />
    </div>
  );
}

export function CarregandoRegras() {
  return (
    <>
      <PageHeader title={TITULO_REGRAS} description={DESCRICAO_REGRAS} />
      <EsqueletoRegras />
    </>
  );
}
