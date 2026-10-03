import { PageHeader } from "@/components/layout/page-header";
import { EsqueletoKpis, EsqueletoSecao } from "../esqueletos";

/** O mesmo cabecalho na pagina e no loading.tsx. */
export function CabecalhoUso() {
  return (
    <PageHeader
      title="Uso e custos"
      description="Quanto a IA custou por dia e por tipo de ação, e quanto sobra da receita do mês."
    />
  );
}

export function EsqueletoUso() {
  return (
    <div aria-busy="true" aria-label="Carregando uso e custos" className="flex flex-col gap-6">
      <EsqueletoKpis />
      <EsqueletoSecao altura="h-55" />
      <div className="grid gap-4 lg:grid-cols-2">
        <EsqueletoSecao altura="h-48" />
        <EsqueletoSecao altura="h-48" />
      </div>
    </div>
  );
}
