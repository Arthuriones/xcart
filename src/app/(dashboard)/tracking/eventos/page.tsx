import { Suspense } from "react";
import Link from "next/link";
import { filtroResolvido } from "@/lib/filtro-global";
import { SoLojasShopify } from "@/components/layout/so-lojas-shopify";
import { lerFeed } from "@/lib/tracking/feed";
import { fusoDaTela, nomesDosPedidos } from "@/lib/leitura/eventos";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { CabecalhoEventos } from "./cabecalho";
import { ErroEventos } from "./erro";
import { EsqueletoEventos } from "./esqueleto";
import { EventosScreen } from "./eventos-screen";
import { filtroDaUrl } from "./logica";

export const dynamic = "force-dynamic";

type Busca = Promise<Record<string, string | string[] | undefined>>;

/**
 * A primeira pagina de eventos vem do servidor, para a tela abrir cheia; o
 * resto chega pelo polling da tela (GET /api/leitura/eventos).
 *
 * A loja vem do seletor global (cookie). filtroResolvido() ja confere contra
 * as lojas do usuario: cookie com loja alheia vira "todas", nunca evento de
 * outro. O filtro dos chips vem da URL (?status=falhou&evento=purchase), para
 * outra tela poder mandar o lojista direto as falhas.
 */
async function carregar(searchParams: Busca) {
  const [busca, { filtro, lojas, lojaIds, checkout }] = await Promise.all([searchParams, filtroResolvido()]);
  if (checkout) return { lojas, vazio: true as const, checkout: checkout.nome };
  if (!lojas.length) return { lojas, vazio: true as const, checkout: null };
  const [inicial, fuso] = await Promise.all([lerFeed(lojaIds, null), fusoDaTela(filtro.lojaId)]);
  const pedidos = await nomesDosPedidos(inicial);
  return {
    vazio: false as const,
    lojas,
    lojaId: filtro.lojaId,
    inicial,
    pedidos,
    fuso,
    filtroInicial: filtroDaUrl(busca),
    geradoEm: Date.now(),
  };
}

async function Conteudo({ searchParams }: { searchParams: Busca }) {
  let dados: Awaited<ReturnType<typeof carregar>>;
  try {
    dados = await carregar(searchParams);
  } catch (e) {
    console.error("[tracking/eventos]", e);
    return <ErroEventos detalhe={e instanceof Error ? e.message.slice(0, 300) : undefined} />;
  }

  if (dados.vazio && dados.checkout) {
    return (
      <>
        <CabecalhoEventos />
        <SoLojasShopify checkout={dados.checkout} />
      </>
    );
  }

  if (dados.vazio) {
    return (
      <>
        <CabecalhoEventos />
        <EmptyState
          className="min-h-65"
          titulo="Nenhuma loja conectada"
          descricao="Conecte uma loja e ligue o rastreamento para ver os eventos chegando aqui."
          acao={
            <Link href="/stores?conectar=1" className={buttonVariants()}>
              Conectar loja
            </Link>
          }
        />
      </>
    );
  }

  return (
    // key: trocar a loja no seletor (ou "Atualizar" no topo) remonta a tela --
    // lista, paginacao e polling recomecam da primeira pagina lida agora. O
    // filtro sobrevive porque mora na URL.
    <EventosScreen
      key={`${dados.lojaId}:${dados.geradoEm}`}
      inicial={dados.inicial}
      pedidosIniciais={dados.pedidos}
      lojas={dados.lojas}
      lojaId={dados.lojaId}
      geradoEm={dados.geradoEm}
      fuso={dados.fuso}
      filtroInicial={dados.filtroInicial}
    />
  );
}

export default function EventosAoVivoPage({ searchParams }: { searchParams: Busca }) {
  return (
    <Suspense fallback={<EsqueletoEventos />}>
      <Conteudo searchParams={searchParams} />
    </Suspense>
  );
}
