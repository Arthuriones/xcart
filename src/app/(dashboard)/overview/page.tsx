import { Suspense } from "react";
import { lerDetalheRota, lerRotas, type DetalheRota, type LeituraRotas } from "@/lib/leitura/visao-rota";
import { escolherRota } from "./apresentar";
import { CabecalhoVisao } from "./cabecalho";
import { EsqueletoVisao } from "./esqueleto";
import { ErroLeitura } from "./estados";
import { SemRota } from "./sem-rota";
import { TelaVisao } from "./tela-visao";

export const dynamic = "force-dynamic";

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * /overview: a Visao da rota. O cabecalho sai na hora; a rota chega por
 * Suspense. ?rota=<id> escolhe a rota (sem ele, a primeira ligada); o link
 * antigo, sem parametro, continua abrindo.
 *
 * Erro de banco aparece como erro, com "Tentar de novo" -- nunca como "nada
 * acontecendo", que era o que a tela antiga dizia com lojas vendendo.
 */
async function Conteudo({ pedida }: { pedida: string | null }) {
  let base: LeituraRotas;
  try {
    base = await lerRotas();
  } catch (e) {
    console.error("[visao-rota] rotas", e);
    return (
      <ErroLeitura
        titulo="Não conseguimos carregar suas rotas"
        descricao="As rotas continuam funcionando na vitrine: foi a leitura que falhou. Tente de novo em instantes."
        detalhe={mensagem(e)}
      />
    );
  }

  const rota = escolherRota(base.rotas, pedida);
  if (!rota) return <SemRota tela="visao" />;

  let detalhe: DetalheRota;
  try {
    detalhe = await lerDetalheRota(rota, base.lojas);
  } catch (e) {
    console.error("[visao-rota] detalhe", e);
    return (
      <ErroLeitura
        titulo="Não conseguimos carregar esta rota"
        descricao="A rota continua funcionando na vitrine: foi a leitura que falhou. Tente de novo em instantes."
        detalhe={mensagem(e)}
      />
    );
  }

  return <TelaVisao rotas={base.rotas} rota={rota} detalhe={detalhe} />;
}

export default async function OverviewPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const pedida = typeof sp.rota === "string" ? sp.rota : null;
  return (
    <>
      <CabecalhoVisao />
      <Suspense key={pedida ?? ""} fallback={<EsqueletoVisao />}>
        <Conteudo pedida={pedida} />
      </Suspense>
    </>
  );
}
