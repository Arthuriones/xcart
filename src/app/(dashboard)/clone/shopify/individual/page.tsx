import { TelaImportarShopify } from "../tela";

export const dynamic = "force-dynamic";

/** /clone/shopify/individual: o assistente abre com "Um produto" marcado. */
export default function ImportarProdutoPage() {
  return <TelaImportarShopify escopo="produto" />;
}
