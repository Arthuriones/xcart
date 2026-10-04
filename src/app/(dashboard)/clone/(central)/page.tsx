import { lerLojasDestino, type LojaDestino } from "@/lib/leitura/importar";
import { CentralImportacao } from "../central-importacao";

export const dynamic = "force-dynamic";

/** Le as lojas; falha vira null (a tela mostra erro, nao "nenhuma loja"). */
async function carregarLojas(): Promise<LojaDestino[] | null> {
  try {
    return await lerLojasDestino();
  } catch (e) {
    console.error("[importar] falha ao ler lojas", e);
    return null;
  }
}

/**
 * /clone: a central do Importar (de onde importar + a fila). O assistente da
 * loja Shopify tem pagina propria em /clone/shopify.
 */
export default async function ClonePage() {
  const lojas = await carregarLojas();
  return <CentralImportacao lojas={lojas} />;
}
