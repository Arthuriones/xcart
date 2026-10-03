import { Suspense } from "react";
import { CabecalhoLote } from "./cabecalho";
import { ConteudoLote, lojaDaUrl } from "./conteudo";
import { EsqueletoLote } from "./esqueleto";

export const dynamic = "force-dynamic";

/**
 * /bulk: importar por link (AliExpress, lojas Shopify e links soltos), ate 20
 * por vez, numa fila do servidor. O cabecalho sai na hora; o formulario chega
 * quando as lojas forem lidas.
 */
export default async function BulkPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <CabecalhoLote origem="links" />
      <Suspense fallback={<EsqueletoLote />}>
        <ConteudoLote origem="links" lojaPedida={lojaDaUrl(sp)} />
      </Suspense>
    </>
  );
}
