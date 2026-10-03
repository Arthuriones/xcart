import { Suspense } from "react";
import { horaNoFuso, rotuloFuso } from "@/components/layout/contexto";
import { getRouteGraph } from "@/lib/checkout-routes/graph";
import { filtroResolvido, lerFiltroGlobal } from "@/lib/filtro-global";
import { FUSO_RELATORIO_PADRAO, TODAS } from "@/lib/financeiro/tipos";
import { getSales, type Sales, type SalesPeriod } from "@/lib/sales/queries";
import { ErroLeitura } from "../overview/estados";
import { RotaSemCheckout, SemRota } from "../overview/sem-rota";
import { periodoValido } from "./apresentar";
import { BarraPeriodo, CabecalhoVendas } from "./cabecalho";
import { EsqueletoVendas } from "./esqueleto";
import { TelaVendas, type LojaFora } from "./tela-vendas";

export const dynamic = "force-dynamic";

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** As vendas e a hora da consulta (o relogio fica fora do componente). */
async function lerVendas(periodo: SalesPeriod): Promise<{ dados: Sales; em: number }> {
  const dados = await getSales(periodo);
  return { dados, em: Date.now() };
}

/**
 * A loja do filtro global, se houver. Falha aqui nao derruba a tela: sem o
 * nome da loja, ela so abre com todas.
 */
async function lojaDoFiltro(): Promise<{ id: string; nome: string } | null> {
  try {
    const { filtro, lojas } = await filtroResolvido();
    if (filtro.lojaId === TODAS) return null;
    const loja = lojas.find((l) => l.id === filtro.lojaId);
    return loja ? { id: loja.id, nome: loja.nome } : null;
  } catch (e) {
    console.error("[vendas] filtro de loja", e);
    return null;
  }
}

/**
 * As vendas vem da Shopify, uma chamada por loja de checkout. Isso pode levar
 * segundos, entao a consulta fica dentro do Suspense: o cabecalho e o periodo
 * aparecem na hora e o resto chega quando as lojas responderem.
 */
async function Conteudo({ periodo }: { periodo: SalesPeriod }) {
  let leitura: { dados: Sales; em: number };
  let loja: { id: string; nome: string } | null;
  try {
    [leitura, loja] = await Promise.all([lerVendas(periodo), lojaDoFiltro()]);
  } catch (e) {
    console.error("[vendas] leitura", e);
    return (
      <ErroLeitura
        titulo="Não conseguimos consultar as vendas agora"
        descricao="Seus pedidos continuam nas lojas: foi a consulta que falhou. Tente de novo em instantes."
        detalhe={mensagem(e)}
      />
    );
  }

  const { dados, em } = leitura;
  if (!dados.hasRoute) return <SemRota tela="vendas" />;
  if (dados.rows.length === 0) return <RotaSemCheckout />;

  // A loja do filtro so vira foco quando e loja de checkout: e nela que a
  // venda acontece. Vitrine ou loja fora de rota mostram todas, com aviso.
  // getRouteGraph ja foi lido por getSales nesta requisicao (cache).
  const foco = loja && dados.rows.some((r) => r.storeId === loja.id) ? loja : null;
  let fora: LojaFora | null = null;
  if (loja && !foco) {
    const grafo = await getRouteGraph().catch(() => null);
    const vitrine = grafo?.routes.some((r) => r.sourceStoreId === loja.id) ?? false;
    fora = { nome: loja.nome, tipo: vitrine ? "vitrine" : "fora" };
  }

  return (
    <TelaVendas
      dados={dados}
      hora={`${horaNoFuso(em, FUSO_RELATORIO_PADRAO)} (${rotuloFuso(FUSO_RELATORIO_PADRAO)})`}
      foco={foco}
      fora={fora}
    />
  );
}

export default async function SalesPage({
  searchParams,
}: {
  searchParams: Promise<{ periodo?: string }>;
}) {
  // A loja do filtro (cookie, sem banco) entra na chave: trocar a loja mostra
  // o esqueleto de novo em vez de deixar o numero da outra na tela.
  const [sp, filtro] = await Promise.all([searchParams, lerFiltroGlobal()]);
  const periodo = periodoValido(sp.periodo);
  return (
    <>
      <CabecalhoVendas />
      <BarraPeriodo periodo={periodo} />
      <Suspense key={`${periodo}:${filtro.lojaId}`} fallback={<EsqueletoVendas />}>
        <Conteudo periodo={periodo} />
      </Suspense>
    </>
  );
}
