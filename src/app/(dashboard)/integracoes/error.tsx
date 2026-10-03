"use client";

import { useEffect, useTransition } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Erro numa plataforma: o titulo e o menu de Integracoes continuam de pe
 * (o layout fica acima deste limite) e so o conteudo da direita vira o erro.
 * Titulo em h2: o h1 da tela e o do PageHeader.
 */
export default function IntegracoesError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [tentando, startTransition] = useTransition();
  useEffect(() => {
    console.error("[integracoes] erro nao tratado:", error);
  }, [error]);

  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 rounded-card border border-border bg-surface px-4 py-12 text-center"
    >
      <span
        aria-hidden
        className="grid size-11 place-items-center rounded-full border border-err-border bg-err-bg text-err"
      >
        <TriangleAlert className="size-5" strokeWidth={1.75} />
      </span>
      <h2 className="text-overlay text-ink">Esta parte não abriu</h2>
      <p className="max-w-115 text-body text-t1">
        Nenhuma configuração foi perdida: as contas, o gasto e os alertas continuam como estavam.
        Tente de novo.
      </p>
      <Button pending={tentando} onClick={() => startTransition(retry)}>
        Tentar de novo
      </Button>
      <details className="mt-2 text-label text-t2">
        <summary className="cursor-pointer">Detalhes para o suporte</summary>
        {error.digest ? <p className="mt-1.5 font-mono">ref. {error.digest}</p> : null}
        {error.message ? <p className="mt-1 max-w-115 break-words font-mono">{error.message}</p> : null}
      </details>
    </div>
  );
}
