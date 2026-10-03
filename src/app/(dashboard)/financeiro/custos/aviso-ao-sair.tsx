"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { destinoInterno } from "./apresentar";

// ============================================================================
// Alteracao nao salva nao some calada. Enquanto ha algo por salvar:
// - fechar ou recarregar a aba pede confirmacao do navegador;
// - clicar num link do app (menu, atalhos da tela) abre a confirmacao daqui;
// - "Trocar loja" desta tela passa por `pedir`, que confirma antes.
//
// O clique e pego na fase de captura da janela, antes do <Link> do Next.
// Trocar de loja pela barra do topo e a busca (Ctrl K) nao passam por link e
// ficam de fora -- anotado para a casca. Para a casca poder perguntar um dia,
// a tela marca <html data-xc-alteracoes="1"> enquanto ha alteracao.
// ============================================================================

export function useAvisoAoSair(sujo: boolean, oQueSePerde: string): {
  pedir: (acao: () => void) => void;
  dialogo: ReactNode;
} {
  const router = useRouter();
  const [acao, setAcao] = useState<(() => void) | null>(null);

  useEffect(() => {
    if (!sujo) return;
    const raiz = document.documentElement;
    const antesDeSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Navegador antigo so pergunta com returnValue preenchido.
      e.returnValue = "";
    };
    const aoClicar = (e: MouseEvent) => {
      const alvo = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(alvo instanceof HTMLAnchorElement)) return;
      const destino = destinoInterno({
        href: alvo.href,
        target: alvo.getAttribute("target"),
        download: alvo.hasAttribute("download"),
        botao: e.button,
        modificador: e.metaKey || e.ctrlKey || e.shiftKey || e.altKey,
        atual: window.location.href,
      });
      if (!destino) return;
      e.preventDefault();
      e.stopPropagation();
      setAcao(() => () => router.push(destino));
    };
    raiz.dataset.xcAlteracoes = "1";
    window.addEventListener("beforeunload", antesDeSair);
    window.addEventListener("click", aoClicar, true);
    return () => {
      delete raiz.dataset.xcAlteracoes;
      window.removeEventListener("beforeunload", antesDeSair);
      window.removeEventListener("click", aoClicar, true);
    };
  }, [sujo, router]);

  function pedir(fn: () => void) {
    if (sujo) setAcao(() => fn);
    else fn();
  }

  const dialogo = (
    <ConfirmDialog
      open={acao !== null}
      onOpenChange={(aberto) => {
        if (!aberto) setAcao(null);
      }}
      titulo="Sair sem salvar?"
      descricao={`${oQueSePerde} Se sair agora, isso se perde.`}
      confirmar="Sair sem salvar"
      cancelar="Continuar editando"
      onConfirmar={() => {
        const fn = acao;
        setAcao(null);
        fn?.();
      }}
    />
  );

  return { pedir, dialogo };
}
