import { Suspense, type ReactNode } from "react";
import Link from "next/link";
import { Store } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { filtroResolvido, lerFiltroGlobal } from "@/lib/filtro-global";
import { rotuloLoja } from "@/lib/financeiro/calculo";
import { TODAS } from "@/lib/financeiro/tipos";
import { lerPedidos } from "@/lib/leitura/pedidos-banco";
import { lerPedidosExternos } from "@/lib/leitura/pedidos-externos";
import { ErroLucro } from "../financeiro/erro-lucro";
import { PedidosCheckout } from "./pedidos-checkout";
import { PedidosTela } from "./pedidos-tela";

export const dynamic = "force-dynamic";

// ============================================================================
// Pedidos: um pedido por linha, com lucro, origem e se a compra chegou na
// plataforma. Le a loja, o periodo e a moeda da barra do topo, como o
// Dashboard. A leitura mora em src/lib/leitura/pedidos-banco.ts.
//
// Checkout externo (069): com um checkout na barra, ou so checkouts, a tabela
// e a da comissao (src/lib/leitura/pedidos-externos.ts). Com "Todas" e os dois
// tipos, as abas "Lojas | Checkouts" (?origem=).
// ============================================================================

const dataBr = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;

type Origem = "lojas" | "checkouts";

/** "Lojas | Checkouts": so quando o usuario tem os dois e o filtro e Todas. */
function AbasOrigem({ atual }: { atual: Origem }) {
  const abas: { id: Origem; rotulo: string }[] = [
    { id: "lojas", rotulo: "Lojas" },
    { id: "checkouts", rotulo: "Checkouts" },
  ];
  return (
    <nav
      aria-label="Origem dos pedidos"
      className="flex gap-0.5 rounded-card border border-border bg-surface-2 p-0.75"
    >
      {abas.map((a) => (
        <Link
          key={a.id}
          href={`/pedidos?origem=${a.id}`}
          aria-current={a.id === atual ? "page" : undefined}
          className={
            a.id === atual
              ? "flex h-7 items-center rounded-control bg-surface px-2.5 text-label font-semibold text-ink shadow-[0_0_0_1px_var(--border)]"
              : "flex h-7 items-center rounded-control px-2.5 text-label text-t2 hover:text-ink"
          }
        >
          {a.rotulo}
        </Link>
      ))}
    </nav>
  );
}

/** Pedidos de checkout externo (Sphere): comissao no lugar do lucro. */
async function ConteudoCheckouts({ abas }: { abas: ReactNode }) {
  let dados: Awaited<ReturnType<typeof lerPedidosExternos>>;
  try {
    dados = await lerPedidosExternos();
  } catch (e) {
    console.error("[pedidos] checkouts", e);
    return (
      <ErroLucro
        titulo="Não conseguimos abrir os pedidos agora"
        detalhe={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  if (dados.vazio) return <SemNada />;
  const { filtro, intervalo, checkouts } = dados;
  const nome = checkouts.length === 1 ? checkouts[0].nome : "Todos os checkouts";
  return (
    <PedidosCheckout
      linhas={dados.linhas}
      resumo={dados.resumo}
      moeda={filtro.moeda}
      mostrarCheckout={checkouts.length > 1}
      abas={abas}
      contextoCsv={["Pedidos", nome, `${dataBr(intervalo.desde)} a ${dataBr(intervalo.ate)}`, `Comissão em ${filtro.moeda}`]}
      arquivoCsv={`pedidos-checkout-${intervalo.desde}-a-${intervalo.ate}.csv`}
    />
  );
}

function SemNada() {
  return (
    <EmptyState
      icone={<Store />}
      titulo="Conecte uma loja ou um checkout para ver os pedidos"
      descricao="Os pedidos aparecem aqui com o lucro (loja) ou a comissão (checkout) de cada um."
      acao={
        <span className="flex flex-wrap justify-center gap-2">
          <Link href="/stores?conectar=1" className={buttonVariants({})}>
            Conectar loja
          </Link>
          <Link href="/integracoes/checkouts" className={buttonVariants({ variant: "secondary" })}>
            Adicionar checkout
          </Link>
        </span>
      }
      className="min-h-80"
    />
  );
}

async function Conteudo({ origem }: { origem: Origem | null }) {
  let filtroLojas: Awaited<ReturnType<typeof filtroResolvido>>;
  try {
    filtroLojas = await filtroResolvido();
  } catch (e) {
    console.error("[pedidos] filtro", e);
    return (
      <ErroLucro
        titulo="Não conseguimos abrir os pedidos agora"
        detalhe={e instanceof Error ? e.message : String(e)}
      />
    );
  }
  // Checkout escolhido, so checkouts no filtro, ou a aba Checkouts com Todas.
  const temLojas = filtroLojas.lojaIds.length > 0;
  const temCheckouts = filtroLojas.checkoutIds.length > 0;
  const deCheckout = temCheckouts && (!temLojas || origem === "checkouts");
  const abas = temLojas && temCheckouts ? <AbasOrigem atual={deCheckout ? "checkouts" : "lojas"} /> : null;
  if (deCheckout) return <ConteudoCheckouts abas={abas} />;

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

  if (dados.vazio) return <SemNada />;

  const { filtro, lojas, intervalo } = dados;
  const loja = lojas.find((l) => l.id === filtro.lojaId);
  const nomeLoja = filtro.lojaId === TODAS || !loja ? "Todas as lojas" : rotuloLoja(loja);

  return (
    <PedidosTela
      pedidos={dados.pedidos}
      resumo={dados.resumo}
      moeda={filtro.moeda}
      abas={abas}
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

export default async function PedidosPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // So cookies e URL (sem banco): key do Suspense. Trocar loja, periodo,
  // moeda ou a aba mostra o esqueleto de novo em vez da lista velha.
  const [filtro, busca] = await Promise.all([lerFiltroGlobal(), searchParams]);
  const origem: Origem | null =
    busca.origem === "checkouts" ? "checkouts" : busca.origem === "lojas" ? "lojas" : null;
  return (
    <Suspense key={JSON.stringify({ filtro, origem })} fallback={<EsqueletoPedidos />}>
      <Conteudo origem={origem} />
    </Suspense>
  );
}
