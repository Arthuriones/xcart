"use client"

import * as React from "react"
import { AlertDialog as AlertDialogPrimitive } from "@base-ui/react/alert-dialog"

import { Button } from "@/components/ui/button"

type ConfirmDialogProps = {
  /** Pergunta direta: "Remover Brisa Pet do xcart?" */
  titulo: React.ReactNode
  /** O que se perde ou muda. Concreto: "Os pedidos de 12/09 a 27/09 passam a usar..." */
  descricao: React.ReactNode
  /** O botao nomeia a acao ("Remover loja", "Apagar versão"), nunca "OK". */
  confirmar: string
  cancelar?: string
  /** "perigo" (padrao) = botao vermelho solido; "normal" = primario preto. */
  tom?: "perigo" | "normal"
  /**
   * A acao. Se devolver uma Promise, o botao fica pendente ate ela terminar;
   * se ela lancar, o dialog continua aberto e mostra `mensagemErro`.
   */
  onConfirmar: () => void | Promise<unknown>
  /** Mensagem quando a acao falha (em portugues, sem codigo tecnico). */
  mensagemErro?: string
  /** Botao que abre (ex.: <Button variant="destructive">Remover loja</Button>). */
  gatilho?: React.ReactElement
  /** Uso controlado (abrir a partir de um item de menu, por exemplo). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * Confirmacao de acao destrutiva. Substitui o window.confirm: diz o que se
 * perde, o foco comeca em "Cancelar", Esc cancela, e o botao fica pendente
 * enquanto a acao roda (sem duplo envio).
 */
function ConfirmDialog({
  titulo,
  descricao,
  confirmar,
  cancelar = "Cancelar",
  tom = "perigo",
  onConfirmar,
  mensagemErro = "Não deu para concluir agora. Tente de novo.",
  gatilho,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  const controlado = open !== undefined
  const [abertoInterno, setAbertoInterno] = React.useState(false)
  const [pendente, setPendente] = React.useState(false)
  const [falhou, setFalhou] = React.useState(false)
  const aberto = controlado ? open : abertoInterno

  function definirAberto(v: boolean) {
    if (!controlado) setAbertoInterno(v)
    onOpenChange?.(v)
    if (v) setFalhou(false)
  }

  async function executar() {
    setPendente(true)
    setFalhou(false)
    try {
      await onConfirmar()
      setPendente(false)
      definirAberto(false)
    } catch {
      setPendente(false)
      setFalhou(true)
    }
  }

  return (
    <AlertDialogPrimitive.Root
      open={aberto}
      onOpenChange={(v) => {
        // No meio da acao nao fecha (nem Esc nem Cancelar).
        if (!pendente) definirAberto(v)
      }}
    >
      {gatilho ? <AlertDialogPrimitive.Trigger render={gatilho} /> : null}
      <AlertDialogPrimitive.Portal>
        <AlertDialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-scrim duration-150 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0" />
        <AlertDialogPrimitive.Popup
          data-slot="confirm-dialog"
          className="fixed top-1/2 left-1/2 z-50 flex w-[calc(100%-2rem)] max-w-[440px] -translate-x-1/2 -translate-y-1/2 flex-col gap-3 rounded-overlay border border-border bg-surface p-5 text-ink shadow-overlay duration-150 outline-none data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0"
        >
          <AlertDialogPrimitive.Title className="text-section text-ink">{titulo}</AlertDialogPrimitive.Title>
          <AlertDialogPrimitive.Description className="text-dense text-t1 text-pretty">
            {descricao}
          </AlertDialogPrimitive.Description>
          {falhou ? (
            <p role="alert" className="text-dense font-medium text-err">
              {mensagemErro}
            </p>
          ) : null}
          <div className="mt-1 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <AlertDialogPrimitive.Close render={<Button variant="secondary" disabled={pendente} />}>
              {cancelar}
            </AlertDialogPrimitive.Close>
            <Button variant={tom === "perigo" ? "danger" : "primary"} pending={pendente} onClick={executar}>
              {confirmar}
            </Button>
          </div>
        </AlertDialogPrimitive.Popup>
      </AlertDialogPrimitive.Portal>
    </AlertDialogPrimitive.Root>
  )
}

export { ConfirmDialog }
export type { ConfirmDialogProps }
