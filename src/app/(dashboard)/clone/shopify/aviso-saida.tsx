"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

/**
 * Aviso ao sair enquanto a importacao roda. Ela e um laco NESTE navegador:
 * fechar a aba, recarregar ou trocar de tela para no meio.
 *
 *  - fechar/recarregar: o "Sair do site?" do proprio navegador (beforeunload);
 *  - clicar num link do app (menu, topo): o clique e segurado ANTES de chegar
 *    ao Link do Next (escuta em window, fase de captura) e abre a confirmacao.
 *    Confirmou: interrompe e segue para onde ia.
 *
 * Fica de fora o "voltar" do navegador, que nao da para segurar, e a busca
 * Ctrl K, que navega sem link (anotado nas pendencias da casca).
 */
export function AvisoAoSair({ ativo, interromper }: { ativo: boolean; interromper: () => void }) {
  const router = useRouter();
  const [destino, setDestino] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!ativo) return;

    function aoDescarregar(e: BeforeUnloadEvent) {
      e.preventDefault();
      // Navegadores antigos so mostram o aviso com returnValue preenchido.
      e.returnValue = "";
    }

    function aoClicar(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const alvo = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(alvo instanceof HTMLAnchorElement)) return;
      if (alvo.target && alvo.target !== "_self") return;
      if (alvo.hasAttribute("download")) return;
      const url = new URL(alvo.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      // Ancora na mesma pagina nao sai da tela.
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;
      e.preventDefault();
      e.stopPropagation();
      setDestino(url.pathname + url.search + url.hash);
    }

    window.addEventListener("beforeunload", aoDescarregar);
    window.addEventListener("click", aoClicar, true);
    return () => {
      window.removeEventListener("beforeunload", aoDescarregar);
      window.removeEventListener("click", aoClicar, true);
    };
  }, [ativo]);

  return (
    <ConfirmDialog
      // Terminou com o aviso aberto: nada mais a interromper, o aviso fecha.
      open={ativo && destino !== null}
      onOpenChange={(v) => {
        if (!v) setDestino(null);
      }}
      titulo="Sair e interromper a importação?"
      descricao="A importação roda nesta aba. Os produtos criados até aqui continuam na loja; os que faltam não serão importados."
      confirmar="Sair e interromper"
      cancelar="Continuar aqui"
      onConfirmar={() => {
        const ir = destino;
        interromper();
        setDestino(null);
        if (ir) router.push(ir);
      }}
    />
  );
}
