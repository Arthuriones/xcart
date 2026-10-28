import { PageHeader } from "@/components/layout/page-header";

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoAssinatura() {
  return (
    <PageHeader
      title="Assinatura"
      description="Seu plano e as compras feitas por Pix."
    />
  );
}
