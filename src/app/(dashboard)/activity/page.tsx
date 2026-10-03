import { Suspense } from "react";
import { FUSO_RELATORIO_PADRAO } from "@/lib/financeiro/tipos";
import { lerAtividade, type LeituraAtividade } from "@/lib/leitura/atividade";
import { tipoDe, type TipoAtividade } from "@/lib/leitura/atividade-regras";
import { CabecalhoAtividade } from "./cabecalho";
import { EsqueletoAtividade } from "./esqueleto";
import { ErroAtividade } from "./estados";
import { LinhaDoTempo } from "./linha-do-tempo";

export const dynamic = "force-dynamic";

/**
 * /activity: a linha do tempo da conta. O cabecalho sai na hora; a lista
 * chega por Suspense. O tipo (?tipo=) e a busca (?q=) ficam na URL; a loja e
 * a do filtro global (cookie), a mesma da barra do topo. "Carregar mais" pede
 * a proxima pagina a /api/leitura/atividade.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const texto = (v: string | string[] | undefined) => (typeof v === "string" ? v : null);

  return (
    <>
      <CabecalhoAtividade />
      <Suspense fallback={<EsqueletoAtividade />}>
        <Conteudo tipo={tipoDe(texto(sp.tipo))} q={(texto(sp.q) ?? "").slice(0, 100)} />
      </Suspense>
    </>
  );
}

async function Conteudo({ tipo, q }: { tipo: TipoAtividade | null; q: string }) {
  let dados: LeituraAtividade;
  try {
    dados = await lerAtividade({ tipo, antes: null });
  } catch (erro) {
    console.error("[activity] falha ao ler", erro);
    return <ErroAtividade />;
  }
  // Nada veio e alguma fonte falhou: e erro, nao "nada aconteceu".
  if (dados.itens.length === 0 && dados.falhas.length > 0) return <ErroAtividade />;

  // A chave muda a cada leitura do servidor: trocar filtro ou "Tentar de novo"
  // recomeca do mais recente, sem paginas velhas penduradas.
  return <LinhaDoTempo key={dados.agora} dados={dados} qInicial={q} fuso={FUSO_RELATORIO_PADRAO} />;
}
