import { PageHeader } from "@/components/layout/page-header";
import { NavOrigem } from "./nav-origem";
import type { Origem } from "./regras";

const DESCRICAO: Record<Origem, string> = {
  links:
    "Cole até 20 links do AliExpress, de lojas Shopify ou de outros sites. Eles entram numa fila e viram produtos na loja que você escolher.",
  sites:
    "Cole até 20 links de Nuvemshop, WooCommerce, lojas próprias e páginas de produto com dados públicos. Eles entram numa fila e viram produtos na loja que você escolher.",
};

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoLote({ origem }: { origem: Origem }) {
  return (
    <>
      <PageHeader title="Importar" description={DESCRICAO[origem]} />
      <div className="mb-6">
        <NavOrigem atual={origem} />
      </div>
    </>
  );
}
