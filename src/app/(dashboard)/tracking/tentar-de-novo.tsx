"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/** Busca a tela de novo no servidor. Fica pendente ate os numeros chegarem. */
export function TentarDeNovo() {
  const router = useRouter();
  const [pendente, startTransition] = useTransition();
  return (
    <Button
      size="sm"
      variant="secondary"
      pending={pendente}
      onClick={() => startTransition(() => router.refresh())}
    >
      Tentar de novo
    </Button>
  );
}
