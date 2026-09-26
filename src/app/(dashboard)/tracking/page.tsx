import { Suspense } from "react";
import { getPainelTracking, getPedidosDaSemana } from "@/lib/tracking/queries";
import { TrackingScreen } from "./tracking-screen";

export const dynamic = "force-dynamic";

/**
 * A contagem de pedidos vem da Shopify, uma chamada por loja, e pode levar
 * segundos. Fica dentro do Suspense para o cabecalho aparecer na hora.
 *
 * Ela existe porque "12 conversoes enviadas" sozinho nao diz nada: pode ser 12
 * de 12 ou 12 de 200. E a comparacao que revela que o envio quebrou -- o
 * endpoint do Google responde 200 mesmo quando ignora o conteudo, entao nao ha
 * erro para observar, so ausencia.
 */
async function Conteudo() {
  const painel = await getPainelTracking();
  const ligadas = painel.lojas.filter((l) => l.ligado).map((l) => l.storeId);

  // So para loja ligada: perguntar pedido de loja que nem usa rastreamento
  // gastaria chamada da Shopify a toa.
  const pedidos = ligadas.length ? await getPedidosDaSemana(ligadas) : new Map();

  return (
    <TrackingScreen
      lojas={painel.lojas}
      pedidos={Object.fromEntries(pedidos)}
    />
  );
}

function Esqueleto() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-lg bg-muted" />
        ))}
      </div>
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Suspense fallback={<Esqueleto />}>
      <Conteudo />
    </Suspense>
  );
}
