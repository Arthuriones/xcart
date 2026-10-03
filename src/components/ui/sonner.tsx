"use client"

import type * as React from "react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react"

/*
 * Toast: superficie solida (preto no claro, quase branco no escuro), titulo e
 * detalhe, uma acao ("Desfazer"). As quebras de linha do texto valem: antes o
 * "\n" colava tudo numa linha so (white-space: pre-line no titulo e detalhe).
 * Toast nunca e o unico lugar de um erro que exige acao: o erro aparece no
 * campo ou na tela tambem.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      containerAriaLabel="Notificações"
      icons={{
        success: <CircleCheckIcon aria-hidden className="size-4" />,
        info: <InfoIcon aria-hidden className="size-4" />,
        warning: <TriangleAlertIcon aria-hidden className="size-4" />,
        error: <OctagonXIcon aria-hidden className="size-4" />,
        loading: <Loader2Icon aria-hidden className="size-4 animate-xc-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--solid)",
          "--normal-text": "var(--on-solid)",
          "--normal-border": "var(--solid)",
          "--border-radius": "var(--radius-card)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast gap-3! shadow-overlay! font-sans! text-dense!",
          title: "whitespace-pre-line font-semibold",
          description: "whitespace-pre-line text-on-solid! opacity-90",
          actionButton:
            "h-ctl-sm! rounded-control! border! border-current! bg-transparent! px-2.5! text-dense! font-semibold! text-on-solid!",
          cancelButton: "h-ctl-sm! rounded-control! bg-transparent! px-2.5! text-dense! text-on-solid!",
          closeButton: "border-border! bg-surface! text-ink!",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
