import { PageHeader } from "@/components/layout/page-header";

/** O mesmo cabecalho na pagina e no loading.tsx. */
export function CabecalhoUsuarios() {
  return (
    <PageHeader
      title="Usuários"
      description="Libere ou revogue o acesso de cada cliente e ajuste plano e créditos. Free sem liberação fica sem acesso."
    />
  );
}
