import { Store } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";

/**
 * A tela so faz sentido para loja Shopify (custos por SKU, rastreamento,
 * eventos do pixel) e a barra do topo esta num checkout externo (069). Nao e
 * "conecte uma loja": a loja pode existir, so nao esta escolhida.
 */
export function SoLojasShopify({ checkout, className }: { checkout: string; className?: string }) {
  return (
    <EmptyState
      icone={<Store />}
      titulo="Esta tela é das lojas Shopify."
      descricao={`${checkout} é um checkout externo. Escolha uma loja ou “Todas as lojas” na barra do topo.`}
      className={className ?? "min-h-65"}
    />
  );
}
