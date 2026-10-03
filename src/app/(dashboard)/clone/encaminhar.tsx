"use client";

import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import type { StoreOption } from "./clone-shared";

// O assistente da loja Shopify so baixa quando alguem abre /clone/shopify.
const CloneScreen = dynamic(() => import("./clone-screen").then((m) => m.CloneScreen));

/**
 * /clone/shopify (e /individual, /bulk, /configuracao) reexportam esta
 * pagina (`export { default } from "../page"`). Entao a mesma page.tsx
 * serve a central e o assistente: em /clone, a central; no resto, o
 * assistente de sempre, com as mesmas lojas que ele recebia.
 *
 * Quando /clone/shopify tiver page propria, isto vira so a central.
 */
export function EncaminharClone({ central, lojas }: { central: ReactNode; lojas: StoreOption[] }) {
  const caminho = usePathname();
  if (caminho === "/clone" || caminho === "/clone/") return <>{central}</>;
  return <CloneScreen initialStores={lojas} />;
}
