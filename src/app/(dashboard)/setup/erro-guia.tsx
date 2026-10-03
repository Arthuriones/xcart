"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** A leitura inteira falhou: nada foi desfeito, e da para tentar de novo. */
export function ErroGuia() {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para conferir os passos agora"
      descricao="Nada da sua configuração mudou: foi a leitura que falhou. Tente de novo em instantes."
      acao={
        <Button pending={tentando} onClick={() => iniciar(() => router.refresh())}>
          Tentar de novo
        </Button>
      }
      className="py-12"
    />
  );
}
