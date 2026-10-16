"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { PARAMETROS_URL, type PlataformaAnuncio } from "@/lib/tracking/utm";

// ============================================================================
// "Parametros de URL" para colar no anuncio: e o que grava a campanha, o
// conjunto e o anuncio em cada pedido (origem do pedido, migration 071).
//
// So ids (src/lib/tracking/utm.ts): curtos, porque a Shopify corta a URL de
// chegada em 255, e estaveis, porque renomear o anuncio nao divide o
// relatorio. Os nomes vem do sync de gasto.
// ============================================================================

const ONDE: Record<PlataformaAnuncio, string> = {
  meta: "No Gerenciador: anúncio › Rastreamento › Parâmetros de URL. Dá para editar vários anúncios de uma vez.",
  google: "Na conta ou na campanha: Configurações › Opções de URL › Sufixo do URL final.",
  tiktok: "No anúncio: Destino › Parâmetros de URL.",
};

/** Por plataforma, o que muda: no Meta o campo e opcional. */
const NOTA: Partial<Record<PlataformaAnuncio, string>> = {
  meta: "Opcional no Meta: com o campo vazio, ele já manda os ids da campanha, do conjunto e do anúncio.",
};

export function ParametrosUrl({
  plataforma,
  embutido = false,
}: {
  plataforma: PlataformaAnuncio;
  /** Dentro de um cartao que ja tem borda (o bloco do TikTok no Rastreamento). */
  embutido?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const texto = PARAMETROS_URL[plataforma];
  const id = `parametros-${plataforma}`;

  useEffect(() => {
    if (!copiado) return;
    const t = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(t);
  }, [copiado]);

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
    } catch {
      toast.error("Não deu para copiar. Selecione o texto e copie na mão.");
    }
  }

  return (
    <section
      aria-labelledby={id}
      className={cn(
        "flex min-w-0 flex-col gap-2.5",
        embutido ? "border-t border-border-subtle px-4 py-3.5" : "rounded-card border border-border bg-surface p-4"
      )}
    >
      <span className="text-label font-semibold text-t2">Campanha em cada pedido</span>
      <h3 id={id} className="text-section text-ink">
        Parâmetros de URL
      </h3>
      <p className="text-dense text-t1 text-pretty">{ONDE[plataforma]}</p>
      <div className="flex min-w-0 items-center gap-2 rounded-control border border-border bg-surface-2 py-1.5 pr-2 pl-3">
        <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-label text-t1">{texto}</code>
        <Button size="sm" variant="secondary" onClick={copiar}>
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copiado ? "Parâmetros copiados" : ""}
      </span>
      <p className="text-label text-t2 text-pretty">
        {NOTA[plataforma] ? `${NOTA[plataforma]} ` : ""}Vale para os pedidos daqui para frente.
      </p>
    </section>
  );
}
