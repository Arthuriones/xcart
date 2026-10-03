import { lerConexaoDasLojas } from "@/lib/leitura/integracoes";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { ErroLeitura } from "../erro-leitura";
import { ConteudoShopify } from "./conteudo-shopify";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Shopify: as lojas e se o xcart consegue ler os pedidos de
// cada uma. So leitura: conectar, reconectar e remover continuam em Lojas
// (/stores), que e onde o OAuth da Shopify volta.
// ============================================================================

/**
 * Fora do componente: o relogio e lido junto com os dados, uma vez, e vai
 * como prop -- "pedidos lidos às 14:32" sai igual no HTML e na hidratacao.
 */
async function carregar() {
  try {
    const lojas = await lerConexaoDasLojas();
    return { ok: true as const, lojas, agoraMs: Date.now() };
  } catch (e) {
    return { ok: false as const, erro: e instanceof Error ? e.message : String(e) };
  }
}

export default async function ShopifyPage() {
  const r = await carregar();
  if (!r.ok) {
    return (
      <>
        <CabecalhoPlataforma titulo="Shopify" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura titulo="Não deu para carregar as lojas." detalhe={r.erro} />
      </>
    );
  }
  return <ConteudoShopify lojas={r.lojas} agoraMs={r.agoraMs} />;
}
