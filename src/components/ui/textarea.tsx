import * as React from "react"

import { cn } from "@/components/ui/cn"
import { campoBase } from "@/components/ui/input"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(campoBase, "flex min-h-24 resize-y px-3 py-2", className)}
      {...props}
    />
  )
}

export { Textarea }
