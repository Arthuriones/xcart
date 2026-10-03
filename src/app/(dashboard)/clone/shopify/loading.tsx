import { CabecalhoImportar } from "./tela";
import { EsqueletoAssistente } from "./estados";

/** Importar da Shopify carregando: o cabecalho de verdade e o assistente em esqueleto. */
export default function CarregandoImportar() {
  return (
    <>
      <CabecalhoImportar />
      <EsqueletoAssistente />
    </>
  );
}
