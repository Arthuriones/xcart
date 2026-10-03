import "server-only";
import { createClient } from "@/lib/supabase/server";
import { FUSO_RELATORIO_PADRAO, TODAS, type EventoFeed } from "@/lib/financeiro/tipos";

// ============================================================================
// Leituras da tela Eventos ao vivo que o feed nao traz. So leitura, pela
// sessao (RLS): nada aqui passa pelo admin.
//
// - Nome do pedido: o feed traz o id numerico da Shopify (tracking_events.
//   order_id), que nao diz nada ao lojista. O "#1040" mora em fin_orders, sem
//   dado pessoal, com chave (store_id, shopify_order_id).
// - Fuso da tela: o mesmo da barra do topo -- o da loja escolhida, ou o de
//   Sao Paulo com todas as lojas.
// ============================================================================

const MAX_PEDIDOS = 200;

/**
 * "loja:pedidoId" -> "#1040". Nunca lanca: o nome e enfeite, e sem ele a tela
 * mostra "Abrir pedido" com o mesmo link. Pedido de loja sem a sincronizacao
 * do financeiro simplesmente fica sem nome.
 */
export async function nomesDosPedidos(eventos: EventoFeed[]): Promise<Record<string, string>> {
  const comPedido = eventos.filter((e) => e.pedido && /^\d+$/.test(e.pedido));
  if (!comPedido.length) return {};
  const lojas = [...new Set(comPedido.map((e) => e.store_id))];
  const pedidos = [...new Set(comPedido.map((e) => e.pedido as string))].slice(0, MAX_PEDIDOS);
  try {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("fin_orders")
      .select("store_id, shopify_order_id, nome")
      .in("store_id", lojas)
      .in("shopify_order_id", pedidos)
      .limit(MAX_PEDIDOS);
    if (error) {
      console.error("[leitura/eventos] nomes dos pedidos:", error.message);
      return {};
    }
    const saida: Record<string, string> = {};
    for (const p of (data ?? []) as {
      store_id: string;
      shopify_order_id: string;
      nome: string | null;
    }[]) {
      if (p.nome) saida[`${p.store_id}:${p.shopify_order_id}`] = p.nome;
    }
    return saida;
  } catch (e) {
    console.error("[leitura/eventos] nomes dos pedidos:", e);
    return {};
  }
}

function fusoValido(fuso: unknown): fuso is string {
  if (typeof fuso !== "string" || !fuso) return false;
  try {
    new Intl.DateTimeFormat("pt-BR", { timeZone: fuso });
    return true;
  } catch {
    return false;
  }
}

/** Fuso das horas da tela. Erro de leitura cai no padrao: e so a hora exibida. */
export async function fusoDaTela(lojaId: string): Promise<string> {
  if (lojaId === TODAS) return FUSO_RELATORIO_PADRAO;
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("fin_sync_state")
      .select("fuso")
      .eq("store_id", lojaId)
      .maybeSingle();
    const fuso = (data as { fuso: string | null } | null)?.fuso;
    return fusoValido(fuso) ? fuso : FUSO_RELATORIO_PADRAO;
  } catch {
    return FUSO_RELATORIO_PADRAO;
  }
}
