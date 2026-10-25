"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * O calculo nao abriu (erro de banco). Mensagem humana e "Tentar de novo";
 * o texto tecnico fica recolhido para o suporte. Nunca vira zero: zero diria
 * ao lojista que ele nao vendeu. Estilo do erro do mockup ("design novo/
 * Dashboard.dc.html").
 */
export function ErroLucro({
  detalhe,
  titulo = "Não conseguimos calcular o lucro agora",
}: {
  detalhe: string;
  /** A tela Pedidos usa o mesmo aviso com o proprio titulo. */
  titulo?: string;
}) {
  const router = useRouter();
  const [tentando, startTransition] = useTransition();
  return (
    <div
      role="alert"
      className="flex min-h-105 flex-col items-center justify-center gap-2.5 rounded-card border border-border bg-surface px-4 py-12 text-center"
    >
      <TriangleAlert aria-hidden className="size-6 text-err" strokeWidth={1.75} />
      <h2 className="text-overlay text-ink">{titulo}</h2>
      <p className="max-w-[48ch] text-body text-t2 text-pretty">
        Seus pedidos e custos continuam guardados. Nenhum número foi trocado por zero.
      </p>
      <Button
        variant="secondary"
        pending={tentando}
        onClick={() => startTransition(() => router.refresh())}
        className="mt-1.5 min-w-35"
      >
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
      <details className="text-label text-t3">
        <summary className="cursor-pointer">Ver detalhes</summary>
        <p className="mt-1.5 max-w-110 break-words font-mono">{detalhe}</p>
      </details>
    </div>
  );
}
