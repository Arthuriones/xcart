import { Suspense } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { lerComparacao, lerFiltroGlobal } from "@/lib/filtro-global";
import { TODAS } from "@/lib/financeiro/tipos";
import { getFinanceiro } from "@/lib/financeiro/queries";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { montarPorCampanha } from "@/lib/leitura/por-campanha";
import { montarPorProduto } from "@/lib/leitura/por-produto";
import { montarSerieDiaria } from "@/lib/leitura/serie-diaria";
import { ErroLucro } from "./erro-lucro";
import { EsqueletoLucro } from "./esqueleto";
import { FinanceiroScreen, type ExtrasLucro } from "./financeiro-screen";

export const dynamic = "force-dynamic";

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Le tudo no servidor, numa ida so: o calculo de sempre (getFinanceiro) e, em
 * paralelo, as linhas cruas para as leituras novas (serie do periodo anterior,
 * produto, campanha). Se as novas falharem, a tela abre igual e so as partes
 * que dependem delas mostram o erro.
 */
async function Conteudo() {
  const comparacao = await lerComparacao();
  const [principal, base] = await Promise.allSettled([getFinanceiro(), lerBaseLucro()]);

  if (principal.status === "rejected") {
    console.error("[lucro] calculo", principal.reason);
    // Erro de banco aparece; nunca vira zero. Zero diria "nao vendeu".
    return <ErroLucro detalhe={mensagem(principal.reason)} />;
  }
  const dados = principal.value;
  if (dados.vazio) return <SemLojas />;

  let extras: ExtrasLucro | null = null;
  let erroExtras: string | null = null;
  if (base.status === "rejected") {
    console.error("[lucro] leituras novas", base.reason);
    erroExtras = mensagem(base.reason);
  } else if (base.value) {
    try {
      const b = base.value;
      extras = {
        serie: montarSerieDiaria(b.entrada, {
          porLoja: dados.filtro.lojaId === TODAS && dados.lojaIds.length >= 2,
        }),
        produtos: montarPorProduto(b.entrada),
        // Falha so no gasto por campanha: so a aba Campanha mostra o erro.
        campanhas: b.erroCampanha
          ? null
          : montarPorCampanha({
              contas: b.contas,
              gastos: b.gastosCampanha,
              cambio: b.entrada.cambio,
              moeda: b.entrada.moeda,
              intervalo: b.entrada.intervalos.atual,
              lojaIds: b.lojaIds,
            }),
      };
      if (b.erroCampanha) erroExtras = b.erroCampanha;
    } catch (e) {
      console.error("[lucro] montagem", e);
      erroExtras = mensagem(e);
    }
  }

  return <FinanceiroScreen dados={dados} comparacao={comparacao} extras={extras} erroExtras={erroExtras} />;
}

function SemLojas() {
  return (
    <EmptyState
      icone={<Store />}
      titulo="Conecte uma loja para ver o lucro"
      descricao="O xcart lê os pedidos da Shopify e cruza com o gasto do Meta e do Google. O lucro de cada dia aparece aqui."
      acao={
        <Link href="/stores" className={buttonVariants({})}>
          Conectar loja
        </Link>
      }
      className="min-h-80"
    />
  );
}

export default async function FinanceiroPage() {
  // So cookies (sem banco): servem de key para o Suspense. Trocar loja,
  // periodo, moeda ou comparacao mostra o esqueleto de novo em vez de deixar o
  // numero velho na tela.
  const [filtro, comparacao] = await Promise.all([lerFiltroGlobal(), lerComparacao()]);
  return (
    <>
      <PageHeader
        title="Lucro"
        description="Lucro estimado por loja, já descontados produto, frete do fornecedor, taxa de pagamento e anúncios."
      />
      <Suspense key={JSON.stringify({ filtro, comparacao })} fallback={<EsqueletoLucro />}>
        <Conteudo />
      </Suspense>
    </>
  );
}
