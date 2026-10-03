import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { listarLojasDoUsuario } from "@/lib/filtro-global";

// ============================================================================
// Busca de objetos para o Ctrl K: lojas por nome ou dominio e pedidos pelo
// numero (fin_orders.nome, "#1001"). So o que e do usuario: tudo pela sessao,
// com RLS, e o user_id no filtro.
//
// fin_orders nao tem dado pessoal (migration 052): nome do pedido, dia,
// total e moeda. O link leva ao pedido no admin da propria Shopify da loja.
//
// Prefixo restringe: "loja:lumen" so lojas, "pedido:1001" so pedidos.
// ============================================================================

export interface LojaEncontrada {
  id: string;
  nome: string;
  dominio: string;
}

export interface PedidoEncontrado {
  lojaId: string;
  lojaNome: string;
  dominio: string;
  /** Id numerico da Shopify. */
  pedidoId: string;
  /** "#1001". */
  nome: string;
  /** Dia do pedido no fuso da loja, "AAAA-MM-DD". */
  dia: string;
  /** null quando o valor do banco nao e numero: melhor nada que um zero falso. */
  total: number | null;
  moeda: string;
  cancelado: boolean;
}

export interface ResultadoBusca {
  lojas: LojaEncontrada[];
  pedidos: PedidoEncontrado[];
}

const MAX_LOJAS = 6;
const MAX_PEDIDOS = 8;
const MAX_TERMO = 60;

/** Sem acento e minusculo, para "sao" achar "São". */
function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O termo vira literal no ILIKE: % _ e \ perdem o poder de curinga. */
function literalIlike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export function interpretarBusca(bruto: string): {
  termo: string;
  lojas: boolean;
  pedidos: boolean;
} {
  let termo = bruto.trim().slice(0, MAX_TERMO);
  let lojas = true;
  let pedidos = true;
  const prefixo = /^(loja|pedido):\s*/i.exec(termo);
  if (prefixo) {
    termo = termo.slice(prefixo[0].length).trim();
    lojas = prefixo[1].toLowerCase() === "loja";
    pedidos = !lojas;
  }
  // Pedido so com algarismo: "lumen" nao tem por que varrer os pedidos.
  if (!/\d/.test(termo)) pedidos = false;
  return { termo, lojas, pedidos };
}

export async function buscar(bruto: string): Promise<ResultadoBusca> {
  const vazio: ResultadoBusca = { lojas: [], pedidos: [] };
  const { termo, lojas: querLojas, pedidos: querPedidos } = interpretarBusca(bruto);
  if (termo.length < 2) return vazio;

  const user = await getCurrentUser();
  if (!user) return vazio;

  // Lojas sao poucas: a lista inteira (a mesma do seletor, em cache na
  // requisicao) filtrada aqui, sem montar filtro com texto do usuario.
  const todas = await listarLojasDoUsuario();
  const alvo = normalizar(termo);
  const lojas = querLojas
    ? todas
        .filter((l) => normalizar(`${l.nome} ${l.dominio}`).includes(alvo))
        .slice(0, MAX_LOJAS)
    : [];

  let pedidos: PedidoEncontrado[] = [];
  if (querPedidos && todas.length > 0) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fin_orders")
      .select("store_id, shopify_order_id, nome, dia_local, total_atual, moeda, cancelado_em")
      .eq("user_id", user.id)
      .ilike("nome", `%${literalIlike(termo.replace(/^#/, ""))}%`)
      .order("processado_em", { ascending: false })
      .limit(MAX_PEDIDOS);
    if (error) throw new Error(`Falha ao buscar pedidos: ${error.message}`);
    const lojaPorId = new Map(todas.map((l) => [l.id, l]));
    pedidos = (data ?? []).flatMap(
      (p: {
        store_id: string;
        shopify_order_id: string;
        nome: string | null;
        dia_local: string;
        total_atual: number | string;
        moeda: string;
        cancelado_em: string | null;
      }) => {
        const loja = lojaPorId.get(String(p.store_id));
        if (!loja) return [];
        const total = Number(p.total_atual);
        return [
          {
            lojaId: loja.id,
            lojaNome: loja.nome,
            dominio: loja.dominio,
            pedidoId: String(p.shopify_order_id),
            nome: String(p.nome || `#${p.shopify_order_id}`),
            dia: String(p.dia_local),
            total: Number.isFinite(total) ? total : null,
            moeda: String(p.moeda),
            cancelado: !!p.cancelado_em,
          },
        ];
      }
    );
  }

  return { lojas, pedidos };
}
