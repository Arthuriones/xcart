import { redirect } from "next/navigation";

/**
 * Contas de anuncio mudou para Integracoes: Meta e Google, cada um com o que
 * le o gasto e o que envia as compras. A URL antiga continua valendo (links
 * salvos, avisos do Lucro) e cai no Meta.
 */
export default function AnunciosPage() {
  redirect("/integracoes/meta");
}
