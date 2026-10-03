import { lerConexaoDasLojas, type LojaConexao } from "@/lib/leitura/integracoes";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ErroLeitura } from "../erro-leitura";
import { ConteudoShopify } from "./conteudo-shopify";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Shopify: as lojas e se o xcart consegue ler os pedidos de
// cada uma. So leitura: conectar, reconectar e remover continuam em Lojas
// (/stores), que e onde o OAuth da Shopify volta.
// ============================================================================

export default async function ShopifyPage() {
  let lojas: LojaConexao[];
  try {
    lojas = await lerConexaoDasLojas();
  } catch (e) {
    return (
      <>
        <CabecalhoPlataforma titulo="Shopify" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura
          titulo="Não deu para carregar as lojas."
          detalhe={e instanceof Error ? e.message : String(e)}
        />
      </>
    );
  }

  return <ConteudoShopify lojas={lojas} agoraMs={Date.now()} />;
}
