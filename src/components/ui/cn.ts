import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * `cn` que conhece as escalas do design system.
 *
 * O tailwind-merge padrao nao sabe que `text-dense` e TAMANHO de fonte: para
 * ele e uma cor, igual a `text-t2`, e `cn("text-dense text-t2")` devolvia so
 * `text-t2` -- o tamanho sumia sem erro nenhum. O mesmo com `rounded-card`
 * contra `rounded-md` e `h-ctl-md` contra `h-10` (os dois ficavam, e quem
 * ganhava era a ordem do CSS).
 *
 * Use este `cn` em tudo que combina classes do redesign.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["kpi", "page", "overlay", "section", "body", "dense", "label"],
      radius: ["control", "card", "overlay"],
      spacing: ["ctl-sm", "ctl-md", "ctl-lg"],
      shadow: ["overlay", "sheet"],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
