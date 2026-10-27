import { Suspense } from "react";
import { lerFiltroGlobal } from "@/lib/filtro-global";
import { CabecalhoPlataforma } from "../cabecalho-plataforma";
import { carregarAnuncios } from "../dados-anuncios";
import { ErroLeitura } from "../erro-leitura";
import { EsqueletoContas } from "../esqueleto";
import { ConteudoGoogle } from "./conteudo-google";

export const dynamic = "force-dynamic";

// ============================================================================
// Integracoes -> Google. As conversoes saem do NAVEGADOR, pela tag do Google
// (gtag.js), com o AW- e os rotulos cadastrados no Rastreamento. O ID de
// cliente e o script so leem o gasto, e sao opcionais. Era a metade Google de
// /financeiro/anuncios.
// ============================================================================

async function Conteudo() {
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

export default async function GooglePage() {
  // So cookies (sem banco): key do Suspense. Trocar loja, periodo ou moeda na
  // barra do topo mostra o esqueleto de novo em vez do gasto velho.
  const filtro = await lerFiltroGlobal();
  return (
    <Suspense key={JSON.stringify(filtro)} fallback={<EsqueletoContas rotulo="Carregando as contas do Google" />}>
      <Conteudo />
    </Suspense>
  );
}
