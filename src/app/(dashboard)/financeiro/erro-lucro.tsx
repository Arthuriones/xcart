"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { OctagonAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O calculo nao abriu (erro de banco). Mensagem humana e "Tentar de novo";
 * o texto tecnico fica recolhido para o suporte. Nunca vira zero: zero diria
 * ao lojista que ele nao vendeu.
 */
export function ErroLucro({ detalhe }: { detalhe: string }) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <div
      role="alert"
      className="flex min-h-80 flex-col items-center justify-center gap-3 rounded-card border border-border bg-surface px-4 py-10 text-center"
    >
      <span
        aria-hidden
        className="grid size-11 place-items-center rounded-full border border-err-border bg-err-bg text-err"
      >
        <OctagonAlert className="size-5" strokeWidth={1.75} />
      </span>
      <p className="text-section text-ink">Não conseguimos calcular o lucro agora</p>
      <p className="max-w-110 text-body text-t1">
        Seus pedidos e custos continuam guardados. Tente de novo em alguns segundos; se repetir, fale com o
        suporte.
      </p>
      <Button pending={tentando} onClick={() => startTransition(() => router.refresh())} className="min-w-35">
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
      <details className="text-label text-t2">
        <summary className="cursor-pointer">Detalhes para o suporte</summary>
        <p className="mt-1.5 max-w-110 break-words font-mono">{detalhe}</p>
      </details>
    </div>
  );
}
