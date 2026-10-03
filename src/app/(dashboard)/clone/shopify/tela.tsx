import { Suspense } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { lerImportarShopify, type DadosImportar } from "@/lib/leitura/importar-shopify";
import { Assistente } from "./assistente";
import { ErroAssistente, EsqueletoAssistente } from "./estados";
import type { Escopo } from "./regras";

/**
 * /clone/shopify (e /individual, /bulk, /configuracao): copiar produtos de
 * uma loja Shopify publica para uma loja conectada. O cabecalho sai na hora;
 * as lojas e o saldo chegam por Suspense. A sub-rota so muda o escopo que
 * abre marcado (/individual = um produto).
 */
export function TelaImportarShopify({ escopo }: { escopo: Escopo }) {
  return (
    <>
      <CabecalhoImportar />
      <Suspense fallback={<EsqueletoAssistente />}>
        <Conteudo escopo={escopo} />
      </Suspense>
    </>
  );
}

/** O mesmo cabecalho na pagina e no loading.tsx: nada pula quando os dados chegam. */
export function CabecalhoImportar() {
  return (
    <PageHeader
      title="Importar de uma loja Shopify"
      description="Copie um produto, uma coleção ou a loja inteira de uma Shopify pública para uma das suas lojas, com tradução e troca de marca se quiser."
    >
      <Link href="/clone" className={buttonVariants({ variant: "secondary" })}>
        Outras origens
      </Link>
    </PageHeader>
  );
}

async function Conteudo({ escopo }: { escopo: Escopo }) {
  let dados: DadosImportar;
  try {
    dados = await lerImportarShopify();
  } catch (erro) {
    // Falha de banco NAO vira "Nenhuma loja conectada".
    console.error("[clone/shopify] falha ao ler as lojas", erro);
    return <ErroAssistente />;
  }
  return <Assistente dados={dados} escopoInicial={escopo} />;
}
