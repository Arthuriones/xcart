import Link from "next/link";
import { cn } from "@/components/ui/cn";

// ============================================================================
// As origens do Importar como abas: a mesma tela com outra origem escolhida.
// Cada aba e uma URL que ja existia (/clone/shopify, /bulk, /multi-site), e a
// central (/clone) mostra as tres com a explicacao de cada uma.
// ============================================================================

export type IdOrigem = "shopify" | "links" | "sites";

export const ORIGENS: { id: IdOrigem; href: string; rotulo: string }[] = [
  { id: "shopify", href: "/clone/shopify", rotulo: "Loja Shopify" },
  { id: "links", href: "/bulk", rotulo: "AliExpress e links" },
  { id: "sites", href: "/multi-site", rotulo: "Outros sites" },
];

export function NavOrigem({ atual }: { atual: IdOrigem }) {
  return (
    <nav
      aria-label="De onde importar"
      className="-mx-4 flex gap-5 overflow-x-auto border-b border-border px-4 [scrollbar-width:none] md:mx-0 md:px-0"
    >
      {ORIGENS.map((o) => {
        const ativa = o.id === atual;
        return (
          <Link
            key={o.id}
            href={o.href}
            aria-current={ativa ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex h-ctl-lg shrink-0 items-center border-b-2 text-dense font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus",
              ativa ? "border-ink text-ink" : "border-transparent text-t2 hover:text-ink"
            )}
          >
            {o.rotulo}
          </Link>
        );
      })}
    </nav>
  );
}
