"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/components/ui/cn";
import { Spinner } from "@/components/ui/spinner";
import { respostaJson } from "./resposta";

// ============================================================================
// O codigo do pixel do checkout, para colar na Shopify.
//
// Copiar e colar, nao um botao que instala: `webPixelCreate` pela Admin API so
// funciona para app com Web Pixel Extension publicada pelo Shopify CLI. Depois
// de colado, o pixel se anuncia no primeiro evento e passa sozinho para
// "Instalado" -- por isso nao ha botao de "ja instalei".
// ============================================================================

export function CodigoDoPixel({ storeId }: { storeId: string }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const [aberto, setAberto] = useState(false);
  const [copiado, setCopiado] = useState(false);

  useEffect(() => {
    let vivo = true;
    fetch(`/api/tracking/pixel?storeId=${encodeURIComponent(storeId)}`)
      .then((r) => respostaJson(r, "Não deu para gerar o código."))
      .then((j) => {
        if (!vivo) return;
        if (typeof j.codigo !== "string") throw new Error("Não deu para gerar o código.");
        setCodigo(j.codigo);
        setErro(null);
      })
      .catch((e) => vivo && setErro(e instanceof Error ? e.message : "Não deu para gerar o código."));
    return () => {
      vivo = false;
    };
  }, [storeId, tentativa]);

  useEffect(() => {
    if (!copiado) return;
    const id = setTimeout(() => setCopiado(false), 1800);
    return () => clearTimeout(id);
  }, [copiado]);

  async function copiar() {
    if (!codigo) return;
    try {
      await navigator.clipboard.writeText(codigo);
      setCopiado(true);
    } catch {
      toast.error("Não deu para copiar. Selecione o código e copie na mão.");
    }
  }

  if (erro) {
    return (
      <p role="alert" className="flex flex-wrap items-center gap-2 text-dense text-err">
        {erro}
        <Button size="sm" variant="secondary" onClick={() => setTentativa((t) => t + 1)}>
          Tentar de novo
        </Button>
      </p>
    );
  }
  if (!codigo) {
    return (
      <p className="flex items-center gap-2 text-dense text-t2">
        <Spinner size={14} /> Gerando o código…
      </p>
    );
  }
  return (
    <div className="relative overflow-hidden rounded-control border border-border bg-surface-2">
      <pre
        aria-label="Código do pixel do checkout"
        tabIndex={0}
        className={cn(
          "m-0 px-3 py-2.5 font-mono sm:pr-48 text-label text-t1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
          aberto ? "max-h-100 overflow-auto whitespace-pre-wrap break-all" : "max-h-9.5 overflow-hidden whitespace-pre"
        )}
      >
        {codigo}
      </pre>
      <div className="flex gap-1.5 border-t border-border px-2 py-1.5 sm:absolute sm:top-1.5 sm:right-2 sm:border-0 sm:p-0">
        <Button size="sm" variant="secondary" aria-expanded={aberto} onClick={() => setAberto(!aberto)}>
          {aberto ? "Mostrar menos" : "Mostrar tudo"}
        </Button>
        <Button size="sm" variant="secondary" onClick={copiar}>
          {copiado ? "Copiado" : "Copiar"}
        </Button>
      </div>
      <span role="status" className="sr-only">
        {copiado ? "Código copiado" : ""}
      </span>
    </div>
  );
}
