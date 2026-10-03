import { lerLojasDestino, type LojaDestino } from "@/lib/leitura/importar";
import { ErroLojas } from "./estados";
import { ImportacaoEmLote } from "./importacao-lote";
import { lojaInicialDe, type Origem } from "./regras";

/**
 * O corpo de /bulk e /multi-site: le as lojas no servidor (o seletor ja vem
 * no HTML) e entrega o formulario. Falha de banco vira erro na tela, nunca
 * "nenhuma loja conectada".
 */
export async function ConteudoLote({ origem, lojaPedida }: { origem: Origem; lojaPedida: string | null }) {
  let lojas: LojaDestino[];
  try {
    lojas = await lerLojasDestino();
  } catch (e) {
    console.error("[importar] falha ao ler lojas", e);
    return <ErroLojas />;
  }
  return <ImportacaoEmLote origem={origem} lojas={lojas} lojaInicial={lojaInicialDe(lojas, lojaPedida)} />;
}

/** ?loja=<id> na URL: chega com a loja escolhida (vindo da central ou de outra tela). */
export function lojaDaUrl(sp: { [chave: string]: string | string[] | undefined }): string | null {
  return typeof sp.loja === "string" && sp.loja ? sp.loja : null;
}
