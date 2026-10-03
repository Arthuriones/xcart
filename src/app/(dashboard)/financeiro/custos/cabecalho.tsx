import { PageHeader } from "@/components/layout/page-header";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoCustos() {
  return (
    <PageHeader
      title="Custos e taxas"
      description="O que sai de cada venda além do anúncio: produto, frete do fornecedor e taxa de pagamento. É com isso que o xcart calcula o lucro."
    />
  );
}
