import { Suspense } from "react";
import Link from "next/link";
import { PlusIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import {
  PARAM_DE,
  ROTA_CONECTAR_OPERACAO,
  ROTULO_CONECTAR_OPERACAO,
  voltarParaEscolha,
} from "@/lib/conectar-operacao";
import { lerResumoLojas, type ResumoLojas } from "@/lib/leitura/resumo-lojas";
import { AvisoRetorno } from "./aviso-retorno";
import { CheckoutsDaConta } from "./checkouts-da-conta";
import { ConectarLojaProvider } from "./conectar-loja";
import { ErroLista, EsqueletoLista } from "./estados-lista";
import { ListaLojas } from "./lista-lojas";

export const dynamic = "force-dynamic";

/**
 * Lojas: todas as lojas Shopify conectadas, a saude de cada conexao e o que
 * fazer com as que nao se usa mais -- e, embaixo, os checkouts externos, so
 * para ver (quem gere e Integracoes > Checkouts). O cabecalho e o "Conectar
 * operação" saem na hora; a lista (faturamento, lucro e rastreamento por loja)
 * e os checkouts chegam por Suspense, cada um no seu.
 *
 * URLs que continuam valendo: ?installed=1 e ?error= (volta do OAuth da
 * Shopify) e ?conectar=1&dominio=... (abre o "Conectar loja" ja com o
 * dominio, para o "Reconectar" de outras telas). Com &de=conectar (veio de
 * /conectar), o Voltar do primeiro passo devolve a escolha.
 */
export default async function StoresPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);
  const conectar = texto(sp.conectar) === "1";
  const inicial = conectar
    ? { dominio: texto(sp.dominio) ?? "", reconectar: Boolean(sp.dominio), voltar: voltarParaEscolha(sp[PARAM_DE]) }
    : null;

  return (
    <ConectarLojaProvider inicial={inicial}>
      <PageHeader title="Lojas">
        <Link href={ROTA_CONECTAR_OPERACAO} className={buttonVariants()}>
          <PlusIcon aria-hidden />
          {ROTULO_CONECTAR_OPERACAO}
        </Link>
      </PageHeader>
      <AvisoRetorno instalado={texto(sp.installed) === "1"} erro={texto(sp.error)} />
      <Suspense fallback={<EsqueletoLista />}>
        <Lista />
      </Suspense>
      <Suspense fallback={null}>
        <CheckoutsDaConta />
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
