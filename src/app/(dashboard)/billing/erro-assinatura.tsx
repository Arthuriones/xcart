"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Tenta ler de novo (refaz a leitura do servidor, sem recarregar a pagina). */
export function BotaoTentarDeNovo({ variante = "primary" }: { variante?: "primary" | "secondary" }) {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <Button variant={variante} pending={tentando} onClick={() => iniciar(() => router.refresh())}>
      Tentar de novo
    </Button>
  );
}

/**
 * O perfil nao veio. Antes a tela mostrava "Plano Free" e 0 creditos como se
 * fosse verdade; agora diz que a leitura falhou e que nada mudou na conta.
 */
export function ErroAssinatura({ detalhe }: { detalhe: string | null }) {
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para carregar sua assinatura"
      descricao="Seu plano e seus créditos continuam como estavam: foi a leitura que falhou."
      acao={
        <div className="flex flex-col items-center gap-2">
          <BotaoTentarDeNovo />
          {detalhe ? (
            <details className="text-label text-t2">
              <summary className="cursor-pointer">Detalhes para o suporte</summary>
              <p className="mt-1 max-w-110 break-words font-mono">{detalhe}</p>
            </details>
          ) : null}
        </div>
      }
      className="min-h-60 py-12"
    />
  );
}
