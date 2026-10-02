import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import { getAlertas } from "@/lib/alertas/queries";
import { AlertasScreen } from "./alertas-screen";

export const dynamic = "force-dynamic";

/**
 * Leitura so de banco (alertas, config, lojas): rapida, mas fica no Suspense
 * para o cabecalho aparecer na hora, como nas outras telas.
 */
async function Conteudo() {
  const dados = await getAlertas();
  return <AlertasScreen dados={dados} />;
}

function Esqueleto() {
  return (
    <div className="flex flex-col gap-[18px]" aria-busy="true">
      <p className="flex items-center gap-2 text-[12px] text-t3">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Lendo os alertas…
      </p>
      {[0, 1].map((i) => (
        <div
          key={i}
          aria-hidden
          className="h-[140px] rounded-xl border border-border bg-surface"
        />
      ))}
    </div>
  );
}

export default function AlertasPage() {
  return (
    <div className="flex flex-col gap-[18px]">
      <div>
        <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-ink">
          Alertas
        </h1>
        <p className="mt-1 max-w-[62ch] text-[13px] leading-relaxed text-t2">
          O que quebrou nas vendas, no rastreamento ou no gasto — e o aviso no Telegram.
        </p>
      </div>
      <Suspense fallback={<Esqueleto />}>
        <Conteudo />
      </Suspense>
    </div>
  );
}
