import { Suspense } from "react";
import Link from "next/link";
import { Plug } from "lucide-react";
import { lerCampanhas, type DadosCampanhas } from "@/lib/leitura/campanhas";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErroLucro } from "../financeiro/erro-lucro";
import { CampanhasTela } from "./campanhas-tela";
import { MAPA_COLUNAS } from "./colunas-config";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Campanhas | xcart",
  description: "Dashboard analítico de campanhas, conjuntos e anúncios de tráfego pago.",
};

export default async function CampanhasPage() {
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

  return (
    <div className="flex flex-col gap-6" data-largura="total">
      {/* Cabeçalho da Tela */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-overlay font-bold text-ink tracking-tight">Campanhas</h1>
          <p className="text-dense text-t2">
            Métricas de performance de tráfego pago por conta, campanha, conjunto e criativo.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/integracoes"
            className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-t1 hover:bg-surface-2 hover:text-ink transition"
          >
            <Plug className="h-3.5 w-3.5" />
            <span>Gerenciar integrações</span>
          </Link>
        </div>
      </div>

      {erro || !dados ? (
        <ErroLucro titulo="Não conseguimos abrir as campanhas agora" detalhe={erro ?? "Sem resposta do banco."} />
      ) : dados.contas.length === 0 || !dados.resultado ? (
        <EmptyState
          icone={<Plug className="h-8 w-8 text-t3" />}
          titulo="Nenhuma conta de anúncio conectada"
          descricao="Conecte seu Meta Ads ou Google Ads em Integrações com 1 clique para acompanhar suas campanhas em tempo real."
          acao={
            <Link href="/integracoes" className={buttonVariants()}>
              Conectar conta de anúncios
            </Link>
          }
          className="min-h-80"
        />
      ) : (
        <Suspense fallback={<div className="text-t2 text-xs py-8">Carregando painel de campanhas...</div>}>
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
          />
        </Suspense>
      )}
    </div>
  );
}
