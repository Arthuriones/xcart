"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Erro nao tratado numa tela do admin. O menu continua de pe (este arquivo
 * fica abaixo do layout); a mensagem e humana e a referencia vai recolhida.
 */
export default function AdminError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [tentando, iniciar] = useTransition();

  useEffect(() => {
    console.error("[admin] erro nao tratado:", error);
  }, [error]);

  return (
    <div role="alert" className="flex min-h-[60dvh] flex-col items-center justify-center gap-3 px-4 py-12 text-center">
      <span
        aria-hidden
        className="grid size-11 place-items-center rounded-full border border-err-border bg-err-bg text-err"
      >
        <TriangleAlert className="size-5" strokeWidth={1.75} />
      </span>
      <h1 className="text-page font-semibold text-ink">Esta tela do admin não abriu</h1>
      <p className="max-w-115 text-body text-t1">
        Nenhum dado de cliente foi alterado. Tente de novo; se repetir, volte para a visão geral.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button pending={tentando} onClick={() => iniciar(retry)}>
          Tentar de novo
        </Button>
        <Link
          href="/admin"
          className="inline-flex h-ctl-md items-center rounded-control border border-border-strong bg-surface px-4 text-dense font-medium text-ink hover:border-control-border hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          Ir para a visão geral
        </Link>
      </div>
      {error.digest || error.message ? (
        <details className="mt-2 text-label text-t2">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            Detalhes para o suporte
          </summary>
          <p className="mt-1.5 max-w-115 break-words font-mono">
            {error.digest ? `ref. ${error.digest}` : error.message}
          </p>
        </details>
      ) : null}
    </div>
  );
}
