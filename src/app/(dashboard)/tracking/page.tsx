import { Suspense } from "react";
import { Callout } from "@/components/ui/callout";
import { Skeleton } from "@/components/ui/skeleton";
import { filtroResolvido } from "@/lib/filtro-global";
import { TODAS } from "@/lib/financeiro/tipos";
import { diagnosticarCadaLoja } from "@/lib/leitura/tracking-diagnostico";
import { getPainelTracking } from "@/lib/tracking/queries";
import { Rastreamento } from "./rastreamento";
import { TentarDeNovo } from "./tentar-de-novo";

export const dynamic = "force-dynamic";

// ============================================================================
// Rastreamento (/tracking).
//
// O diagnostico fala com a Shopify -- pedidos, aviso de pedidos e o tema -- e
// leva segundos: fica dentro do Suspense, com o esqueleto da tela no lugar.
//
// Ele existe porque "12 compras enviadas" sozinho nao diz nada: pode ser 12 de
// 12 ou 12 de 200. E a comparacao com os pedidos que revela que o envio
// quebrou.
//
// A loja vem da barra do topo (cookie, conferido contra as lojas do usuario).
// Com uma loja escolhida, so ela e consultada na Shopify. Cada loja e
// conferida separada: a que falhar vira aviso so nela.
//
// Detalhe da loja e Configurar sao a mesma pagina (?loja= e ?configurar=),
// trocados no cliente: ver rastreamento.tsx.
// ============================================================================

async function carregar() {
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
    lojaId: filtro.lojaId,
    geradoEm: Date.now(),
  };
}

function Titulo() {
  // No celular o titulo ja esta no topo da casca.
  return (
    <h1 className="mx-auto mb-5 hidden max-w-205 text-page font-semibold text-ink md:block">
      Rastreamento
    </h1>
  );
}

async function Conteudo() {
  let dados: Awaited<ReturnType<typeof carregar>>;
  try {
    dados = await carregar();
  } catch (e) {
    console.error("[tracking] falha ao ler a tela", e);
    const detalhe = e instanceof Error ? e.message.slice(0, 300) : "";
    return (
      <>
        <Titulo />
        <Callout tom="err" titulo="Não deu para ler o rastreamento agora" acao={<TentarDeNovo />}>
          As compras continuam saindo normalmente.
          {detalhe && (
            <details className="mt-1.5 text-label text-t1">
              <summary className="w-fit cursor-pointer rounded-sm hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                Ver detalhes
              </summary>
              <p className="mt-1 [overflow-wrap:anywhere]">{detalhe}</p>
            </details>
          )}
        </Callout>
      </>
    );
  }

  return (
    // key: trocar a loja na barra do topo recomeca a tela.
    <Rastreamento
      key={dados.lojaId}
      lojas={dados.lojas}
      diagnostico={dados.diagnostico}
      falharam={dados.falharam}
      ocultas={dados.ocultas}
      lojaEscolhida={dados.lojaEscolhida}
      geradoEm={dados.geradoEm}
    />
  );
}

/** O esqueleto da lista: titulo e um cartao por loja. */
function Esqueleto() {
  return (
    <div
      aria-busy="true"
      aria-label="Carregando o rastreamento"
      className="mx-auto flex w-full max-w-205 flex-col gap-5"
    >
      <h1 className="hidden text-page font-semibold text-ink md:block">Rastreamento</h1>
      <Skeleton className="h-ctl-md w-full rounded-card" />
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          className="flex h-16 items-center gap-3.5 rounded-card border border-border bg-surface px-4"
        >
          <Skeleton className="size-5 rounded-full" />
          <Skeleton className="h-3.5 w-48" />
          <Skeleton className="ml-auto h-6 w-10 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function RastreamentoPage() {
  return (
    <Suspense fallback={<Esqueleto />}>
      <Conteudo />
    </Suspense>
  );
}
