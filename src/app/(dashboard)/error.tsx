"use client";

import { useEffect } from "react";
import { TelaComErro } from "@/components/layout/estados";

/**
 * Erro de uma tela do painel: o menu e o topo continuam de pe (este arquivo
 * fica abaixo do layout), a mensagem e humana e o detalhe tecnico fica
 * recolhido para o suporte. `retry` busca a tela de novo no servidor.
 */
export default function DashboardError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error("[painel] erro nao tratado:", error);
  }, [error]);

  return <TelaComErro onTentar={retry} referencia={error.digest} detalhe={error.message} />;
}
