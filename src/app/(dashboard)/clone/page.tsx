import { lerLojasDestino, type LojaDestino } from "@/lib/leitura/importar";
import { CentralImportacao } from "./central-importacao";
import { EncaminharClone } from "./encaminhar";

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
 * /clone: a central do Importar (de onde importar + a fila). As rotas de
 * /clone/shopify reexportam esta pagina e recebem o assistente -- ver
 * encaminhar.tsx. As lojas sao lidas uma vez e servem aos dois.
 */
export default async function ClonePage() {
  const lojas = await carregarLojas();
  return (
    <EncaminharClone
      central={<CentralImportacao lojas={lojas} />}
      lojas={(lojas ?? []).map((l) => ({ id: l.id, name: l.nome, shop_domain: l.dominio }))}
    />
  );
}
