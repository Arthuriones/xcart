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
import { cn } from "@/components/ui/cn"

/*
 * Toast: superficie solida (preto no claro, quase branco no escuro), titulo e
 * detalhe, uma acao ("Desfazer"). As quebras de linha do texto valem: antes o
 * "\n" colava tudo numa linha so (white-space: pre-line no titulo e detalhe).
 * Toast nunca e o unico lugar de um erro que exige acao: o erro aparece no
 * campo ou na tela tambem.
 *
 * Fica 6 s (o padrao do sonner, 4 s, sumia antes de ler a mensagem do
 * servidor) e tem o X para fechar. Quem chama pode pedir mais (toast.error
 * com duration). A casca do painel passa mobileOffset e className para o
 * toast nascer acima da barra de baixo do celular (layout.tsx do painel).
 */
const Toaster = ({ className, ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className={cn("toaster group", className)}
      containerAriaLabel="Notificações"
      closeButton
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
        duration: 6000,
        closeButtonAriaLabel: "Fechar notificação",
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
