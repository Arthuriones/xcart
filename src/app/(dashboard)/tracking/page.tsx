import { Suspense } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { PageHeader } from "@/components/layout/page-header";
import { filtroResolvido } from "@/lib/filtro-global";
import { TODAS } from "@/lib/financeiro/tipos";
import { diagnosticarCadaLoja } from "@/lib/leitura/tracking-diagnostico";
import { getPainelTracking } from "@/lib/tracking/queries";
import { ComoFunciona } from "./como-funciona";
import { SaudeScreen } from "./saude-screen";
import { TentarDeNovo } from "./tentar-de-novo";

export const dynamic = "force-dynamic";

// ============================================================================
// Saude dos pixels (/tracking).
//
// O diagnostico fala com a Shopify -- pedidos, aviso de pedidos e o tema -- e
// leva segundos. Fica dentro do Suspense; o cabecalho fica FORA, para aparecer
// na hora.
//
// Ele existe porque "12 compras enviadas" sozinho nao diz nada: pode ser 12 de
// 12 ou 12 de 200. E a comparacao com os pedidos que revela que o envio
// quebrou.
//
// A loja vem da barra do topo (cookie, conferido contra as lojas do usuario).
// Com uma loja escolhida, so ela e consultada na Shopify. Cada loja e
// conferida separada: a que falhar vira aviso so nela.
// ============================================================================

async function carregar(abrir: string | null) {
  const [{ filtro, lojas: doUsuario }, painel] = await Promise.all([
    filtroResolvido(),
    getPainelTracking(),
  ]);
  const escolhida = filtro.lojaId === TODAS ? null : filtro.lojaId;
  const lojas = escolhida ? painel.lojas.filter((l) => l.storeId === escolhida) : painel.lojas;

  // So loja ligada: perguntar a Shopify sobre loja que nem envia compra
  // gastaria 4 chamadas por loja a toa.
  const { porLoja, falharam } = await diagnosticarCadaLoja(
    lojas.filter((l) => l.ligado).map((l) => l.storeId)
  );

  // O painel esconde a loja com o app desinstalado e o envio desligado: nao
  // ha nada a fazer nela por aqui. A tela diz quantas ficaram de fora.
  const naTela = new Set(painel.lojas.map((l) => l.storeId));
  const ocultas = escolhida
    ? naTela.has(escolhida)
      ? 0
      : 1
    : doUsuario.filter((l) => !naTela.has(l.id)).length;

  return {
    lojas,
    diagnostico: porLoja,
    falharam,
    ocultas,
    lojaEscolhida: Boolean(escolhida),
    abrir,
    lojaId: filtro.lojaId,
    geradoEm: Date.now(),
  };
}

async function Conteudo({ abrir }: { abrir: string | null }) {
  let dados: Awaited<ReturnType<typeof carregar>>;
  try {
    dados = await carregar(abrir);
  } catch (e) {
    console.error("[tracking] falha ao ler a tela", e);
    return (
      <Callout
        tom="err"
        titulo="Não deu para ler o rastreamento agora"
        acao={<TentarDeNovo />}
      >
        As compras continuam saindo normalmente; só a leitura desta tela falhou. Tente de novo em
        instantes.
      </Callout>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* key: trocar a loja na barra do topo recomeca a tela (painel fechado). */}
      <SaudeScreen
        key={dados.lojaId}
        lojas={dados.lojas}
        diagnostico={dados.diagnostico}
        falharam={dados.falharam}
        ocultas={dados.ocultas}
        lojaEscolhida={dados.lojaEscolhida}
        geradoEm={dados.geradoEm}
        abrirInicial={dados.abrir}
      />
      {dados.lojas.length > 0 && <ComoFunciona />}
    </div>
  );
}

function Esqueleto() {
  return (
    <div aria-busy="true" aria-label="Carregando a saúde dos pixels" className="flex flex-col gap-4">
      <p className="flex items-center gap-2 text-dense text-t2">
        <Spinner size={14} />
        Conferindo pedidos e o tema na Shopify…
      </p>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-26 flex-col gap-3 rounded-card border border-border bg-surface p-4"
          >
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-6.5 w-2/5" />
          </div>
        ))}
      </div>
      <div className="flex flex-col overflow-hidden rounded-card border border-border bg-surface">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="flex h-19 items-center gap-6 border-b border-border-subtle px-4 last:border-b-0"
          >
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="hidden h-2 flex-1 md:block" />
            <Skeleton className="hidden h-2 flex-1 md:block" />
            <Skeleton className="ml-auto h-7 w-30 rounded-control" />
          </div>
        ))}
      </div>
    </div>
  );
}

export default async function SaudeDosPixelsPage({
  searchParams,
}: {
  searchParams: Promise<{ [chave: string]: string | string[] | undefined }>;
}) {
  const { loja } = await searchParams;
  const abrir = typeof loja === "string" && loja ? loja : null;

  return (
    <>
      <PageHeader
        title="Saúde dos pixels"
        description="Se as compras de cada loja estão chegando ao Meta e ao Google pelo servidor, e o que consertar quando não estão."
      >
        <Link href="/tracking/eventos" className={buttonVariants({ variant: "secondary" })}>
          Ver eventos ao vivo
        </Link>
      </PageHeader>
      <Suspense fallback={<Esqueleto />}>
        <Conteudo abrir={abrir} />
      </Suspense>
    </>
  );
}
