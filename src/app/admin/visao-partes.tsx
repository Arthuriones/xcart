import { PageHeader } from "@/components/layout/page-header";
import { EsqueletoKpis, EsqueletoSecao } from "./esqueletos";

// O cabecalho e o esqueleto da visao geral ficam fora do page.tsx para o
// loading.tsx usar os mesmos: nada pula quando os dados chegam.

export function CabecalhoVisao() {
  return (
    <PageHeader
      title="Visão geral"
      description="Quanto o xcart fatura e gasta com IA no mês, a base de clientes e quanto os clientes vendem."
    />
  );
}

export function EsqueletoVisao() {
  return (
    <div aria-busy="true" aria-label="Carregando a visão geral" className="flex flex-col gap-6">
      <EsqueletoKpis />
      <EsqueletoKpis />
      <div className="grid gap-4 lg:grid-cols-2">
        <EsqueletoSecao altura="h-56" />
        <EsqueletoSecao altura="h-56" />
      </div>
    </div>
  );
}

