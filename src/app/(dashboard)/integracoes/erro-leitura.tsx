"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/callout";

/**
 * Falha de leitura de um bloco: diz o que nao abriu e tenta de novo no
 * servidor (router.refresh), sem pedir para recarregar a pagina.
 */
export function ErroLeitura({
  titulo,
  detalhe,
  tom = "err",
}: {
  titulo: string;
  detalhe?: string | null;
  tom?: "err" | "warn";
}) {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  return (
    <Callout
      tom={tom}
      role="alert"
      titulo={titulo}
      acao={
        <Button
          size="sm"
          variant="secondary"
          pending={pendente}
          onClick={() => startTransition(() => router.refresh())}
        >
          Tentar de novo
        </Button>
      }
    >
      {detalhe ? <span className="break-words text-t1">{detalhe}</span> : null}
    </Callout>
  );
}
