import { Suspense } from "react";
import { getSales, type SalesPeriod } from "@/lib/sales/queries";
import { SalesScreen } from "./sales-screen";

export const dynamic = "force-dynamic";

function periodoValido(v: string | undefined): SalesPeriod {
  return v === "7" || v === "60" ? v : "30";
}

/**
 * As vendas vem da Shopify, uma chamada por loja de checkout. Isso pode levar
 * segundos, entao a consulta fica dentro do Suspense: o cabecalho e o esqueleto
 * aparecem na hora e a tabela chega quando as lojas responderem.
 */
async function Conteudo({ periodo }: { periodo: SalesPeriod }) {
  return <SalesScreen dados={await getSales(periodo)} />;
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-[18px]" aria-hidden>
      <div className="h-[27px] w-[220px] rounded-md bg-surface-2" />
      <div className="h-[86px] rounded-lg border border-border bg-surface" />
      <div className="h-[240px] rounded-lg border border-border bg-surface" />
    </div>
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  const periodo = periodoValido((await searchParams).periodo);
  return (
    <Suspense key={periodo} fallback={<Esqueleto />}>
      <Conteudo periodo={periodo} />
    </Suspense>
  );
}
