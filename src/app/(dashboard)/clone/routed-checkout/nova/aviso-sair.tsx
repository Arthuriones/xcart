"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Pede confirmacao antes de sair da pagina com o processo rodando: fechar a
 * aba ou recarregar (aviso do navegador) e clicar em qualquer link do app
 * (dialogo nosso). A criacao roda no navegador -- sair no meio para tudo.
 */
export function AvisoAoSair({ ativo, aoSair }: { ativo: boolean; aoSair: () => void }) {
  const router = useRouter();
  const [destino, setDestino] = useState<string | null>(null);

  useEffect(() => {
    if (!ativo) return;
    const antesDeSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    // Captura no document: roda antes do onClick do <Link>, que mora na raiz
    // do React, e o impede de navegar.
    const clique = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]");
      if (!(a instanceof HTMLAnchorElement) || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setDestino(url.pathname + url.search + url.hash);
    };
    window.addEventListener("beforeunload", antesDeSair);
    document.addEventListener("click", clique, true);
    return () => {
      window.removeEventListener("beforeunload", antesDeSair);
      document.removeEventListener("click", clique, true);
    };
  }, [ativo]);

  return (
    <ConfirmDialog
      open={destino !== null}
      onOpenChange={(v) => {
        if (!v) setDestino(null);
      }}
      titulo="Sair no meio da criação?"
      descricao="O que já foi criado na loja de checkout fica salvo, mas o resto para aqui e a rota não é ativada. Dá para continuar depois, que o xcart pula o que já existe."
      confirmar="Sair mesmo assim"
      cancelar="Continuar aqui"
      onConfirmar={() => {
        const ir = destino;
        setDestino(null);
        aoSair();
        if (ir) router.push(ir);
      }}
    />
  );
}
