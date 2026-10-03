"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * A leitura de um bloco falhou: diz o que nao veio, que nada foi alterado, e
 * deixa tentar de novo. O detalhe cru (status e mensagem da rota) fica
 * recolhido, para o suporte.
 */
export function ErroAdmin({
  titulo,
  descricao = "Nada foi alterado: foi só a leitura que falhou. Tente de novo em instantes.",
  detalhe,
  compacto = false,
}: {
  titulo: string;
  descricao?: string;
  detalhe?: string;
  /** Dentro de um cartao que ja existe (sem borda propria, menos altura). */
  compacto?: boolean;
}) {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <div
      role="alert"
      className={
        compacto
          ? "flex min-h-40 flex-col items-center justify-center gap-2 px-4 py-6 text-center"
          : "flex min-h-60 flex-col items-center justify-center gap-2.5 rounded-card border border-border bg-surface px-4 py-8 text-center"
      }
    >
      <p className="text-section text-ink">{titulo}</p>
      <p className="max-w-110 text-dense text-t1 text-pretty">{descricao}</p>
      <Button
        variant={compacto ? "secondary" : "primary"}
        size={compacto ? "sm" : "md"}
        pending={tentando}
        onClick={() => iniciar(() => router.refresh())}
        className="mt-1"
      >
        Tentar de novo
      </Button>
      {detalhe ? (
        <details className="mt-1 text-label text-t2">
          <summary className="cursor-pointer rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
            Detalhes para o suporte
          </summary>
          <p className="mt-1 max-w-110 break-words font-mono">{detalhe}</p>
        </details>
      ) : null}
    </div>
  );
}

/** Busca de novo no servidor, sem recarregar a pagina. */
export function BotaoAtualizar({ rotulo = "Atualizar" }: { rotulo?: string }) {
  const router = useRouter();
  const [atualizando, iniciar] = useTransition();
  return (
    <Button
      variant="secondary"
      size="sm"
      pending={atualizando}
      onClick={() => iniciar(() => router.refresh())}
    >
      {atualizando ? null : <RefreshCw aria-hidden strokeWidth={1.75} />}
      {atualizando ? "Atualizando…" : rotulo}
    </Button>
  );
}
