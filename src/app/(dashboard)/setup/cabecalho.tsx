import { PageHeader } from "@/components/layout/page-header";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoGuia() {
  return <PageHeader title="Guia de configuração" description="Os passos para deixar sua operação no ar." />;
}
