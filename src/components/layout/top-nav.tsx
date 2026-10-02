"use client";

import type { ReactNode } from "react";
import { usePathname } from "next/navigation";
import { textos } from "@/lib/textos";
import { hrefAtivo } from "@/components/layout/nav-ativo";

// Onde cada rota aparece na trilha do topo. Chave de traducao do namespace nav.
const TRILHA: { prefixo: string; chave: string }[] = [
  { prefixo: "/financeiro", chave: "profit" },
  { prefixo: "/financeiro/custos", chave: "costs" },
  { prefixo: "/financeiro/anuncios", chave: "adAccounts" },
  { prefixo: "/setup", chave: "setup" },
  { prefixo: "/overview", chave: "routeOverview" },
  { prefixo: "/stores", chave: "connectedStores" },
  { prefixo: "/sales", chave: "salesByRoute" },
  { prefixo: "/tracking", chave: "trackingHealth" },
  { prefixo: "/tracking/eventos", chave: "liveEvents" },
  { prefixo: "/alertas", chave: "alerts" },
  { prefixo: "/activity", chave: "activity" },
  { prefixo: "/clone/routed-checkout", chave: "routing" },
  { prefixo: "/clone/shopify", chave: "importProducts" },
  { prefixo: "/clone", chave: "importProducts" },
  { prefixo: "/billing", chave: "billing" },
  { prefixo: "/claude", chave: "claude" },
];

const PREFIXOS = TRILHA.map((item) => item.prefixo);

/**
 * `acoes` vem do layout (servidor): o seletor global de loja/periodo/moeda,
 * ja dentro de Suspense. Chega pronto como prop porque este componente e
 * client e nao pode buscar as lojas sozinho.
 */
export function TopNav({ acoes }: { acoes?: ReactNode } = {}) {
  const pathname = usePathname();
  const t = textos("nav");

  // O prefixo mais longo ganha, e so casa com fronteira de "/": /tracking/eventos
  // antes de /tracking, e /clonex nao vira "Importar produtos".
  const prefixo = hrefAtivo(pathname, PREFIXOS);
  const atual = prefixo ? TRILHA.find((item) => item.prefixo === prefixo) : undefined;

  return (
    <header className="fixed inset-x-0 top-0 z-30 h-[52px] border-b border-border bg-[var(--header-bg)] backdrop-blur-md md:left-[216px]">
      <div className="flex h-full items-center gap-2.5 px-4 sm:px-5">
        {atual && (
          <span className="min-w-0 truncate text-[13px] font-semibold tracking-[-0.005em] text-ink">
            {t(atual.chave)}
          </span>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1.5">{acoes}</div>
      </div>
    </header>
  );
}
