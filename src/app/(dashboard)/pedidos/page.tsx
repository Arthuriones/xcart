import { Suspense } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { lerFiltroGlobal } from "@/lib/filtro-global";
import { rotuloLoja } from "@/lib/financeiro/calculo";
import { TODAS } from "@/lib/financeiro/tipos";
import { lerPedidos } from "@/lib/leitura/pedidos-banco";
import { ErroLucro } from "../financeiro/erro-lucro";
import { PedidosTela } from "./pedidos-tela";

export const dynamic = "force-dynamic";

// ============================================================================
// Pedidos: um pedido por linha, com lucro, origem e se a compra chegou na
// plataforma. Le a loja, o periodo e a moeda da barra do topo, como o
// Dashboard. A leitura mora em src/lib/leitura/pedidos-banco.ts.
// ============================================================================

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

async function Conteudo() {
  let dados: Awaited<ReturnType<typeof lerPedidos>>;
  try {
    dados = await lerPedidos();
  } catch (e) {
    console.error("[pedidos]", e);
    return (
      <ErroLucro
        titulo="Não conseguimos abrir os pedidos agora"
        detalhe={e instanceof Error ? e.message : String(e)}
      />
    );
  }

  if (dados.vazio) {
    return (
      <EmptyState
        icone={<Store />}
        titulo="Conecte uma loja para ver os pedidos"
        descricao="Os pedidos da Shopify aparecem aqui com o lucro de cada um."
        acao={
          <Link href="/stores?conectar=1" className={buttonVariants({})}>
            Conectar loja
          </Link>
        }
        className="min-h-80"
      />
    );
  }

  const { filtro, lojas, intervalo } = dados;
  const loja = lojas.find((l) => l.id === filtro.lojaId);
  const nomeLoja = filtro.lojaId === TODAS || !loja ? "Todas as lojas" : rotuloLoja(loja);

  return (
    <PedidosTela
      pedidos={dados.pedidos}
      resumo={dados.resumo}
      moeda={filtro.moeda}
      contextoCsv={["Pedidos", nomeLoja, `${dataBr(intervalo.desde)} a ${dataBr(intervalo.ate)}`, `Valores em ${filtro.moeda}`]}
      arquivoCsv={`pedidos-${intervalo.desde}-a-${intervalo.ate}.csv`}
    />
  );
}

function EsqueletoPedidos() {
  return (
    <div aria-busy="true" data-largura="total" className="flex flex-col gap-3.5">
      <span className="sr-only">Carregando os pedidos</span>
      <div className="hidden h-9 md:block" />
      <div className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="flex min-h-20 items-center gap-3.5 rounded-overlay border border-border bg-surface p-4.5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-5 w-3/4" />
            </div>
          </div>
        ))}
      </div>
      <div className="rounded-overlay border border-border bg-surface">
        <div className="flex gap-2 border-b border-border-subtle px-4 py-3.5">
          <Skeleton className="h-9 w-60" />
          <Skeleton className="h-9 flex-1" />
        </div>
        <div className="flex flex-col px-4 py-2">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="grid h-13 grid-cols-[90px_1fr_1fr_100px_100px_90px] items-center gap-4">
              {Array.from({ length: 6 }, (_, j) => (
                <Skeleton key={j} className="h-3" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default async function PedidosPage() {
  // So cookies (sem banco): key do Suspense. Trocar loja, periodo ou moeda
  // mostra o esqueleto de novo em vez de deixar a lista velha na tela.
  const filtro = await lerFiltroGlobal();
  return (
    <Suspense key={JSON.stringify(filtro)} fallback={<EsqueletoPedidos />}>
      <Conteudo />
    </Suspense>
  );
}
