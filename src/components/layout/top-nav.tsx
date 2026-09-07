"use client";

import { usePathname } from "next/navigation";
import { textos } from "@/lib/textos";

// Onde cada rota aparece na trilha do topo. Chave de traducao do namespace nav.
const TRILHA: { prefixo: string; chave: string }[] = [
  { prefixo: "/setup", chave: "setup" },
  { prefixo: "/overview", chave: "overview" },
  { prefixo: "/stores", chave: "connectedStores" },
  { prefixo: "/sales", chave: "sales" },
  { prefixo: "/clone/routed-checkout", chave: "routing" },
  { prefixo: "/clone/shopify", chave: "importProducts" },
  { prefixo: "/clone", chave: "importProducts" },
  { prefixo: "/billing", chave: "billing" },
  { prefixo: "/claude", chave: "claude" },
];

export function TopNav() {
  const pathname = usePathname();
  const t = textos("nav");

  // O prefixo mais longo ganha: /clone/routed-checkout antes de /clone.
  const atual = TRILHA.filter((item) => pathname.startsWith(item.prefixo)).sort(
    (a, b) => b.prefixo.length - a.prefixo.length
  )[0];

  return (
    <header className="fixed inset-x-0 top-0 z-30 h-[52px] border-b border-border bg-[var(--header-bg)] backdrop-blur-md md:left-[216px]">
      <div className="flex h-full items-center gap-2.5 px-4 sm:px-5">
        {atual && (
          <span className="text-[13px] font-semibold tracking-[-0.005em] text-ink">
            {t(atual.chave)}
          </span>
        )}
      </div>
    </header>
  );
}
