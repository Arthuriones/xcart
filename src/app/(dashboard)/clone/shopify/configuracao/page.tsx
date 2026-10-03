import { TelaImportarShopify } from "../tela";

export const dynamic = "force-dynamic";

/** /clone/shopify/configuracao: endereco antigo, o mesmo assistente em massa. */
export default function ImportarConfiguracaoPage() {
  return <TelaImportarShopify escopo="loja" />;
}
