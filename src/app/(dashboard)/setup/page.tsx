import { Suspense } from "react";
import { lerFotoGuia, lerGuiaDaConta, type GuiaDaConta } from "@/lib/leitura/guia-configuracao";
import { resumoDoFluxo } from "@/lib/leitura/guia-passos";
import { CabecalhoGuia } from "./cabecalho";
import { ErroGuia } from "./erro-guia";
import { EsqueletoGuia } from "./esqueleto";
import { FluxoDireto, FluxoVitrine } from "./fluxo";
import { GuiaTela } from "./guia-tela";

export const dynamic = "force-dynamic";

/**
 * /setup: o guia de configuracao, com os dois caminhos -- anuncio direto na
 * loja (conectar loja, rastreamento, contas de anuncio, custos e a primeira
 * venda rastreada) e com vitrine (os passos da rota antes dos mesmos quatro).
 *
 * Cada passo e conferido no banco a cada abertura (lerFotoGuia); nada e
 * marcado a mao. O caminho vem de ?caminho=, senao da ultima escolha (cookie),
 * senao de a conta ter rota. O cabecalho sai na hora; o guia, por Suspense.
 */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const caminho = typeof sp.caminho === "string" ? sp.caminho : null;
  return (
    <>
      <CabecalhoGuia />
      <Suspense fallback={<EsqueletoGuia />}>
        <Conteudo caminho={caminho} />
      </Suspense>
    </>
  );
}

async function Conteudo({ caminho }: { caminho: string | null }) {
  let guia: GuiaDaConta;
  let foto: Awaited<ReturnType<typeof lerFotoGuia>>;
  try {
    [guia, foto] = await Promise.all([lerGuiaDaConta(caminho), lerFotoGuia()]);
  } catch (erro) {
    console.error("[setup] falha ao montar o guia", erro);
    return <ErroGuia />;
  }
  const resumo = resumoDoFluxo(foto);

  return (
    <GuiaTela
      guias={guia.guias}
      caminhoInicial={guia.caminho}
      dispensadoInicial={guia.dispensado}
      fluxo={{
        direto: <FluxoDireto resumo={resumo} />,
        vitrine: <FluxoVitrine resumo={resumo} />,
      }}
    />
  );
}
