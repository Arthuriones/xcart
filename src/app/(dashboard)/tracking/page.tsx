import { Suspense } from "react";
import { getPainelTracking } from "@/lib/tracking/queries";
import { diagnosticar } from "@/lib/tracking/diagnostico";
import { TrackingScreen } from "./tracking-screen";

export const dynamic = "force-dynamic";

/**
 * O diagnostico fala com a Shopify -- pedidos, webhook e o tema -- e leva
 * segundos. Fica dentro do Suspense para o cabecalho aparecer na hora.
 *
 * Ele existe porque "12 conversoes enviadas" sozinho nao diz nada: pode ser 12
 * de 12 ou 12 de 200. E a comparacao que revela que o envio quebrou -- o
 * endpoint do Google responde 200 mesmo quando ignora o conteudo, entao nao ha
 * erro para observar, so ausencia.
 */
async function Conteudo() {
  const painel = await getPainelTracking();
  const ligadas = painel.lojas.filter((l) => l.ligado).map((l) => l.storeId);

  // So para loja ligada: perguntar a Shopify sobre loja que nem usa
  // rastreamento gastaria 4 chamadas por loja a toa.
  const diag = ligadas.length ? await diagnosticar(ligadas) : new Map();

  return (
    <TrackingScreen
      lojas={painel.lojas}
      diagnostico={Object.fromEntries(diag)}
    />
  );
}

function Esqueleto() {
  return (
    <div className="space-y-5">
      <div className="h-8 w-48 animate-pulse rounded bg-muted" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-40 animate-pulse rounded-lg bg-muted" />
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
