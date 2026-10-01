import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { getPainelTracking } from "@/lib/tracking/queries";
import { diagnosticar } from "@/lib/tracking/diagnostico";
import { TrackingScreen } from "./tracking-screen";

export const dynamic = "force-dynamic";

/**
 * O diagnostico fala com a Shopify -- pedidos, webhook e o tema -- e leva
 * segundos. Fica dentro do Suspense; o cabecalho fica FORA, para aparecer na hora.
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
  // Blocos parados, sem pulsar: a espera e de segundos e a frase diz o porque.
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true">
      <p className="flex items-center gap-2 text-[12px] text-t3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Conferindo pedidos e o tema na Shopify…
      </p>
      <div aria-hidden className="h-[74px] rounded-xl border border-border bg-surface" />
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden
          className="h-[168px] rounded-xl border border-border bg-surface"
        />
      ))}
    </div>
  );
}

export default function TrackingPage() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Rastreamento
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          Se as vendas das suas lojas estão chegando no Google e no Meta — e o que
          fazer quando não estão.
        </p>
      </div>
      <Suspense fallback={<Esqueleto />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
