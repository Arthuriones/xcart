"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** A leitura falhou: erro nunca vira "nada aconteceu". Diz que nada se perdeu. */
export function ErroAtividade() {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para carregar a atividade"
      descricao="Nada foi perdido: foi a leitura que falhou. Tente de novo em instantes."
      acao={
        <Button pending={tentando} onClick={() => iniciar(() => router.refresh())}>
          Tentar de novo
        </Button>
      }
      className="min-h-60 py-12"
    />
  );
}
