"use client"

import { Tabs as TabsPrimitive } from "@base-ui/react/tabs"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/components/ui/cn"

/*
 * Abas. "default" e o trilho com a aba ativa em superficie (como o controle
 * segmentado); "line" e a aba sublinhada, para "Detalhar por" e detalhe de
 * loja/rota. Setas do teclado trocam de aba (Base UI).
 */

function Tabs({ className, orientation = "horizontal", ...props }: TabsPrimitive.Root.Props) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      className={cn("group/tabs flex gap-3 data-horizontal:flex-col", className)}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  "group/tabs-list inline-flex w-fit items-center text-t2 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col group-data-vertical/tabs:items-stretch",
  {
    variants: {
      variant: {
        default: "gap-0.5 rounded-control bg-track p-0.5",
        line: "max-w-full gap-4 border-b border-border group-data-vertical/tabs:border-r group-data-vertical/tabs:border-b-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: TabsPrimitive.List.Props & VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({ className, ...props }: TabsPrimitive.Tab.Props) {
  return (
    <TabsPrimitive.Tab
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap text-t2 transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:pointer-events-none disabled:text-t4 aria-disabled:pointer-events-none aria-disabled:text-t4 data-active:text-ink group-data-vertical/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        // trilho
        "group-data-[variant=default]/tabs-list:h-6 group-data-[variant=default]/tabs-list:rounded-sm group-data-[variant=default]/tabs-list:px-3 group-data-[variant=default]/tabs-list:text-label group-data-[variant=default]/tabs-list:data-active:bg-surface group-data-[variant=default]/tabs-list:data-active:font-semibold group-data-[variant=default]/tabs-list:data-active:ring-1 group-data-[variant=default]/tabs-list:data-active:ring-border",
        // sublinhada: 2px de tinta embaixo da ativa
        "group-data-[variant=line]/tabs-list:-mb-px group-data-[variant=line]/tabs-list:h-10 group-data-[variant=line]/tabs-list:border-b-2 group-data-[variant=line]/tabs-list:border-transparent group-data-[variant=line]/tabs-list:text-dense group-data-[variant=line]/tabs-list:font-medium group-data-[variant=line]/tabs-list:data-active:border-ink",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({ className, ...props }: TabsPrimitive.Panel.Props) {
  return (
    <TabsPrimitive.Panel
      data-slot="tabs-content"
      className={cn(
        "flex-1 text-dense focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        className
      )}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
