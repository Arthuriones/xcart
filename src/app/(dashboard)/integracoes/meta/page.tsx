import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { carregarAnuncios } from "../dados-anuncios";
import { ErroLeitura } from "../erro-leitura";
import { ConteudoMeta } from "./conteudo-meta";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Meta. Lado a lado o que LE o gasto (token de leitura, por
// conta de anuncio) e o que ENVIA as compras (token de conversoes, por pixel,
// configurado em Saude dos pixels). Embaixo, as contas com loja, gasto e
// situacao. Era a metade Meta de /financeiro/anuncios.
// ============================================================================

export default async function MetaPage() {
  const r = await carregarAnuncios("meta");
  if (!r.ok) {
    return (
      <>
        <CabecalhoPlataforma titulo="Meta Ads" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura titulo="Não deu para carregar as contas do Meta." detalhe={r.erro} />
      </>
    );
  }
  return <ConteudoMeta d={r.dados} />;
}
