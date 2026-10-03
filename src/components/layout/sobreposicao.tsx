"use client";

import type { ReactElement, ReactNode, RefObject } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Popover } from "@base-ui/react/popover";
import { X } from "lucide-react";
import clsx from "clsx";

// ============================================================================
// As tres sobreposicoes da casca, sobre o Base UI (que ja e dependencia):
// - Pop: popover ancorado num botao (loja, periodo, conta, sino);
// - Folha: painel que sobe do rodape no celular (menu "Mais", contexto);
// - Janela: dialogo centrado (busca Ctrl K, atalhos).
// Foco preso, Esc fecha e o foco volta ao gatilho: tudo vem do Base UI.
// ============================================================================

const CAIXA =
  "rounded-overlay border border-border bg-surface text-ink shadow-overlay outline-none";

export function Pop({
  gatilho,
  rotulo,
  aberto,
  aoMudar,
  alinhar = "start",
  lado = "bottom",
  className,
  children,
}: {
  /** O botao que abre. Recebe aria-expanded e o clique do Base UI. */
  gatilho: ReactElement;
  /** Nome acessivel do popover. */
  rotulo: string;
  aberto?: boolean;
  aoMudar?: (aberto: boolean) => void;
  alinhar?: "start" | "center" | "end";
  lado?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={aberto} onOpenChange={aoMudar}>
      <Popover.Trigger render={gatilho} />
      <Popover.Portal>
        <Popover.Positioner
          side={lado}
          align={alinhar}
          sideOffset={6}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            aria-label={rotulo}
            className={clsx(
              CAIXA,
              "max-w-[calc(100vw-16px)] animate-xc-in overflow-hidden",
              className
            )}
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** Botao de fechar das sobreposicoes: 44px no toque, rotulo em portugues. */
function Fechar({ rotulo }: { rotulo: string }) {
  return (
    <Dialog.Close
      aria-label={rotulo}
      className="grid size-ctl-lg shrink-0 place-items-center rounded-control text-t1 hover:bg-hover hover:text-ink"
    >
      <X className="size-5" strokeWidth={1.75} aria-hidden />
    </Dialog.Close>
  );
}

export function Folha({
  aberto,
  aoMudar,
  titulo,
  subtitulo,
  rotuloFechar = "Fechar",
  rodape,
  children,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: string;
  subtitulo?: string;
  rotuloFechar?: string;
  rodape?: ReactNode;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={aberto} onOpenChange={aoMudar}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Popup
          className={clsx(
            CAIXA,
            "fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col rounded-b-none border-x-0 border-b-0 animate-xc-up"
          )}
        >
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border py-2 pl-4 pr-2">
            <div className="min-w-0">
              <Dialog.Title className="text-section font-semibold">{titulo}</Dialog.Title>
              {subtitulo && (
                <Dialog.Description className="text-label text-t2">{subtitulo}</Dialog.Description>
              )}
            </div>
            <Fechar rotulo={rotuloFechar} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {rodape && <div className="shrink-0 border-t border-border p-3">{rodape}</div>}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function Janela({
  aberto,
  aoMudar,
  titulo,
  tituloVisivel = true,
  focoInicial,
  className,
  children,
}: {
  aberto: boolean;
  aoMudar: (aberto: boolean) => void;
  titulo: string;
  /** false: o titulo vai so para o leitor de tela (a busca abre direto no campo). */
  tituloVisivel?: boolean;
  focoInicial?: RefObject<HTMLElement | null>;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root open={aberto} onOpenChange={aoMudar}>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-scrim" />
        <Dialog.Popup
          initialFocus={focoInicial}
          className={clsx(
            CAIXA,
            "fixed left-1/2 top-2 z-50 flex max-h-[calc(100dvh-16px)] w-[calc(100vw-16px)] max-w-160 -translate-x-1/2 flex-col overflow-hidden md:top-22 animate-xc-in",
            className
          )}
        >
          {tituloVisivel ? (
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-border py-2 pl-4 pr-2">
              <Dialog.Title className="text-section font-semibold">{titulo}</Dialog.Title>
              <Fechar rotulo="Fechar" />
            </div>
          ) : (
            <Dialog.Title className="sr-only">{titulo}</Dialog.Title>
          )}
          {children}
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
