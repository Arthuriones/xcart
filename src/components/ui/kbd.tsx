import * as React from "react"

import { cn } from "@/components/ui/cn"

/** Tecla de atalho: <Kbd>⌘K</Kbd>, <Kbd>Esc</Kbd>. */
function Kbd({ className, ...props }: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-sm border border-border bg-surface-2 px-1 font-mono text-label text-t2",
        className
      )}
      {...props}
    />
  )
}

export { Kbd }
