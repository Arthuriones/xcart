"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";

/** Le a tela de novo no servidor, com o botao em "pendente" enquanto isso. */
export function BotaoTentarDeNovo({ variante = "primary" }: { variante?: "primary" | "secondary" }) {
  const router = useRouter();
  const [tentando, iniciar] = useTransition();
  return (
    <Button
      variant={variante}
      size={variante === "secondary" ? "sm" : "md"}
      pending={tentando}
      onClick={() => iniciar(() => router.refresh())}
    >
      Tentar de novo
    </Button>
  );
}

/** A leitura das lojas falhou: diz que nada se perdeu e deixa tentar de novo. */
export function ErroLojas() {
  return (
    <EmptyState
      role="alert"
      titulo="Não deu para carregar suas lojas"
      descricao="Suas lojas e a fila de importação continuam como estavam: foi a leitura que falhou."
      acao={<BotaoTentarDeNovo />}
      className="py-12"
    />
  );
}
