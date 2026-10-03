import { TelaImportarShopify } from "../tela";

export const dynamic = "force-dynamic";

/** /clone/shopify/bulk: o assistente abre com "Loja inteira" marcado. */
export default function ImportarEmMassaPage() {
  return <TelaImportarShopify escopo="loja" />;
}
