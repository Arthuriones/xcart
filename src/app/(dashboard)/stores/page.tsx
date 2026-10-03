import { Suspense } from "react";
import { PageHeader } from "@/components/layout/page-header";
import { lerResumoLojas, type ResumoLojas } from "@/lib/leitura/resumo-lojas";
import { AvisoRetorno } from "./aviso-retorno";
import { BotaoConectar, ConectarLojaProvider } from "./conectar-loja";
import { ErroLista, EsqueletoLista } from "./estados-lista";
import { ListaLojas } from "./lista-lojas";

export const dynamic = "force-dynamic";

/**
 * Lojas: todas as lojas Shopify conectadas, a saude de cada conexao e o que
 * fazer com as que nao se usa mais. O cabecalho e o "Conectar loja" saem na
 * hora; a lista (faturamento, lucro e rastreamento por loja) chega por Suspense.
 *
 * URLs que continuam valendo: ?installed=1 e ?error= (volta do OAuth da
 * Shopify) e, novo, ?conectar=1&dominio=... (abre o "Conectar loja" ja com o
 * dominio, para o "Reconectar" de outras telas).
 */
export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const conectar = texto(sp.conectar) === "1";

  return (
    <ConectarLojaProvider inicial={conectar ? { dominio: texto(sp.dominio) ?? "", reconectar: Boolean(sp.dominio) } : null}>
      <PageHeader
        title="Lojas"
        description="As lojas Shopify conectadas, a saúde de cada conexão e o que fazer com as que você não usa mais."
      >
        <BotaoConectar />
      </PageHeader>
      <AvisoRetorno instalado={texto(sp.installed) === "1"} erro={texto(sp.error)} />
      <Suspense fallback={<EsqueletoLista />}>
        <Lista />
      </Suspense>
    </ConectarLojaProvider>
  );
}

async function Lista() {
  // Falha de banco NAO vira "nenhuma loja conectada": ja aconteceu de uma
  // coluna faltando derrubar a consulta e a tela dizer que a conta estava
  // vazia para quem tinha nove lojas.
  let resumo: ResumoLojas;
  try {
    resumo = await lerResumoLojas();
  } catch (erro) {
    console.error("[stores] falha ao listar", erro);
    return <ErroLista />;
  }
  return <ListaLojas resumo={resumo} />;
}
