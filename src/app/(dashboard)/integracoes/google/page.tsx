import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { carregarAnuncios } from "../dados-anuncios";
import { ErroLeitura } from "../erro-leitura";
import { ConteudoGoogle } from "./conteudo-google";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Google. As conversoes saem do NAVEGADOR, pela tag do Google
// (gtag.js), com o AW- e os rotulos cadastrados no Rastreamento. O ID de
// cliente e o script so leem o gasto, e sao opcionais. Era a metade Google de
// /financeiro/anuncios.
// ============================================================================

export default async function GooglePage() {
  const r = await carregarAnuncios("google");
  if (!r.ok) {
    return (
      <>
        <CabecalhoPlataforma titulo="Google Ads" estado={{ tom: "neutral", texto: "Sem leitura" }} />
        <ErroLeitura titulo="Não deu para carregar as contas do Google." detalhe={r.erro} />
      </>
    );
  }
  return <ConteudoGoogle d={r.dados} />;
}
