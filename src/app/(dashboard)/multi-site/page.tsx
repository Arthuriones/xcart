import { Suspense } from "react";
import { CabecalhoLote } from "../bulk/cabecalho";
import { ConteudoLote, lojaDaUrl } from "../bulk/conteudo";
import { EsqueletoLote } from "../bulk/esqueleto";

export const dynamic = "force-dynamic";

/**
 * /multi-site: a mesma importacao em lote de /bulk com a origem "outros
 * sites" (Nuvemshop, WooCommerce, lojas proprias). Nao e outra tela: o
 * formulario e a fila sao os de bulk/, so o texto e o corpo do POST mudam.
 */
export default async function MultiSitePage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <CabecalhoLote origem="sites" />
      <Suspense fallback={<EsqueletoLote />}>
        <ConteudoLote origem="sites" lojaPedida={lojaDaUrl(sp)} />
      </Suspense>
    </>
  );
}
