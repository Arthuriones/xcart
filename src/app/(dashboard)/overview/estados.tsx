"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { OctagonAlert, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

// ============================================================================
// As partes de cliente que a Visao da rota e Vendas por rota dividem: o
// "Tentar de novo" do erro e o "Atualizar" ao lado do horario da leitura.
// Os dois so pedem a tela de novo ao servidor (router.refresh).
// ============================================================================

/**
 * A leitura falhou. Mensagem humana, "Tentar de novo" e o texto tecnico
 * recolhido para o suporte. Nunca vira zero nem "nada acontecendo".
 */
export function ErroLeitura({
  titulo,
  descricao,
  detalhe,
}: {
  titulo: string;
  descricao: string;
  detalhe?: string | null;
}) {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
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
      <p className="text-section text-ink">{titulo}</p>
      <p className="max-w-110 text-body text-t1 text-pretty">{descricao}</p>
      <Button pending={tentando} onClick={() => iniciar(() => router.refresh())} className="min-w-35">
        {tentando ? "Tentando…" : "Tentar de novo"}
      </Button>
      {detalhe ? (
        <details className="text-label text-t2">
          <summary className="cursor-pointer">Detalhes para o suporte</summary>
          <p className="mt-1.5 max-w-110 break-words font-mono">{detalhe}</p>
        </details>
      ) : null}
    </div>
  );
}

/** "Atualizado às 14:32" e o botao que le de novo. */
export function Atualizar({ texto, rotulo = "Atualizar" }: { texto: string; rotulo?: string }) {
  const router = useRouter();
  const [lendo, iniciar] = useTransition();
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-t2">
      <span className="num" aria-live="polite">
        {texto}
      </span>
      <Button
        size="sm"
        variant="ghost"
        pending={lendo}
        onClick={() => iniciar(() => router.refresh())}
        className="h-ctl-lg sm:h-ctl-sm"
      >
        {lendo ? null : <RefreshCw aria-hidden />}
        {rotulo}
      </Button>
    </span>
  );
}

/** "Tentar de novo" pequeno, para dentro de aviso e de bloco que falhou. */
export function TentarDeNovo({ rotulo = "Tentar de novo" }: { rotulo?: string }) {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <Button size="sm" variant="secondary" pending={tentando} onClick={() => iniciar(() => router.refresh())}>
      {rotulo}
    </Button>
  );
}
