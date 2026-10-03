import * as React from "react"

import { cn } from "@/components/ui/cn"

/** Rotulo de campo, sempre visivel (placeholder nao substitui rotulo). */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      className={cn(
        "flex items-center gap-2 text-dense font-medium text-ink select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-60 peer-disabled:cursor-not-allowed peer-disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
}

export { Label }
