"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * A lista de abertos nao veio. O cron e o Telegram nao dependem desta tela,
 * e a mensagem diz isso; o erro cru fica recolhido para o suporte.
 */
export function ErroAlertas({ detalhe }: { detalhe: string }) {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <div
      role="alert"
      className="flex min-h-60 flex-col items-center justify-center gap-2.5 rounded-card border border-border bg-surface px-4 py-8 text-center"
    >
      <p className="text-section text-ink">Não conseguimos carregar os alertas</p>
      <p className="max-w-110 text-dense text-t1">
        A verificação continua rodando e os avisos pelo Telegram não param.
      </p>
      <Button pending={tentando} onClick={() => iniciar(() => router.refresh())} className="mt-1">
        Tentar de novo
      </Button>
      <details className="mt-1 text-label text-t2">
        <summary className="cursor-pointer">Detalhes para o suporte</summary>
        <p className="mt-1 max-w-110 break-words font-mono">{detalhe}</p>
      </details>
    </div>
  );
}
