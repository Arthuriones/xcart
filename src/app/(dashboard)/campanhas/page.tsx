import { Suspense } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { lerCampanhas, type DadosCampanhas } from "@/lib/leitura/campanhas";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErroLucro } from "../financeiro/erro-lucro";
import { CampanhasTela } from "./campanhas-tela";
import { MAPA_COLUNAS } from "./colunas-config";
import { CabecalhoCampanhas, EsqueletoCampanhas } from "./esqueleto";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campanhas | Panda Track",
  description: "Dashboard analítico de campanhas, conjuntos e anúncios de tráfego pago.",
};

/** A leitura toda, dentro do Suspense: o cabecalho sai na hora e a tabela vira esqueleto ate chegar. */
async function Conteudo() {
  // Periodo, loja/checkout e moeda sao os da barra do topo (cookie), lidos no
  // servidor como no Lucro. Erro de banco aparece -- nunca vira tela vazia.
  let dados: DadosCampanhas | null = null;
  let erro: string | null = null;
  try {
    dados = await lerCampanhas();
  } catch (e) {
    console.error("[campanhas]", e);
    erro = e instanceof Error ? e.message : String(e);
  }
  // Coluna salva que saiu do catalogo (o padrao antigo trazia "status" e "nome") nao vira cabecalho cru.
  const colunasSalvas = (dados?.colunasSalvas ?? []).filter((c) => MAPA_COLUNAS.has(c));

  return erro || !dados ? (
    <ErroLucro titulo="Não conseguimos abrir as campanhas agora" detalhe={erro ?? "Sem resposta do banco."} />
  ) : dados.contas.length === 0 || !dados.resultado ? (
    <EmptyState
      icone={<Plug className="h-8 w-8 text-t3" />}
      titulo="Nenhuma conta de anúncio conectada"
      descricao="Conecte seu Meta Ads ou Google Ads em Integrações com 1 clique para acompanhar suas campanhas em tempo real."
      acao={
        <Link href="/integracoes/meta" className={buttonVariants()}>
          Conectar conta de anúncios
        </Link>
      }
      className="min-h-80"
    />
  ) : (
    <CampanhasTela
      linhas={dados.resultado.linhas}
      contas={dados.contas}
      colunasSalvas={colunasSalvas}
      moeda={dados.moeda}
      periodo={dados.periodo}
      atribuicao={dados.resultado.atribuicao}
      semDetalhe={dados.resultado.semDetalhe}
      diasNoPeriodo={dados.resultado.diasNoPeriodo}
      sincronizadoEm={dados.resultado.sincronizadoEm}
      moedasSemCotacao={dados.resultado.moedasSemCotacao}
      contraEntrega={dados.resultado.contraEntrega}
    />
  );
}

export default function CampanhasPage() {
  // Suspense SEM key de proposito: a key do filtro remontaria o CampanhasTela a
  // cada troca de loja, periodo ou moeda, e o lojista perderia nivel, busca,
  // status, plataforma e conta -- comparar o mesmo recorte em periodos
  // diferentes e o uso da tela. Na troca o numero velho fica esmaecido pelo
  // topo (layout.tsx, data-contexto-pendente) ate o servidor responder; o
  // esqueleto vale na navegacao (este fallback e o loading.tsx).
  return (
    <div className="flex flex-col gap-6" data-largura="total">
      <CabecalhoCampanhas />
      <Suspense fallback={<EsqueletoCampanhas />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
