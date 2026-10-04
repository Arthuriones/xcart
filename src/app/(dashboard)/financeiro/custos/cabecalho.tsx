import { PageHeader } from "@/components/layout/page-header";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoCustos() {
  return <PageHeader title="Custos e taxas" description="Custo do produto e taxa de pagamento, por loja." />;
}
