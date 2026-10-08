import type { SupabaseClient } from "@supabase/supabase-js";

// ============================================================================
// Teto de pedidos por dia no rodizio.
//
// Para aquecer uma conta de pagamento nova se manda poucos pedidos por dia
// para ela e o resto para a conta principal. O teto e sobre PEDIDOS, nao sobre
// carrinhos encaminhados: e o pedido que o adquirente ve. A contagem vem do
// webhook orders/create de cada loja de checkout (routed_checkout_orders,
// migration 062), numa janela deslizante de 24 h -- sem fuso horario e sem
// rajada a meia-noite.
//
// So o servidor conhece a contagem: rota com teto nao sorteia inline no tema
// (o loader cai na API /resolve). Ver pickTarget em rotation.ts.
// ============================================================================

export const JANELA_LIMITE_MS = 24 * 60 * 60 * 1000;

/** Pedidos por loja nas ultimas 24 h. Loja sem pedido nao aparece no mapa. */
export async function contarPedidos24h(
  supabase: SupabaseClient,
  storeIds: string[],
  agora: number = Date.now()
): Promise<Record<string, number>> {
  const saida: Record<string, number> = {};
  const ids = [...new Set(storeIds.filter(Boolean))];
  if (ids.length === 0) return saida;

  const { data, error } = await supabase
    .from("routed_checkout_orders")
    .select("store_id")
    .in("store_id", ids)
    .gte("created_at", new Date(agora - JANELA_LIMITE_MS).toISOString())
    .limit(10000);

  // Sem a contagem o teto nao segura, mas o carrinho nao pode parar por isso.
  if (error) {
    console.error("[rodizio] falha ao contar pedidos das 24 h", error.message);
    return saida;
  }
  for (const linha of (data || []) as { store_id: string }[]) {
    saida[linha.store_id] = (saida[linha.store_id] || 0) + 1;
  }
  return saida;
}

/**
 * Grava um pedido real da loja para a contagem. Chamado pelo webhook
 * orders/create com o cliente admin (so o service_role escreve na tabela).
 * Reentrega do mesmo pedido nao conta duas vezes: a PK e (store_id, order_id).
 *
 * Devolve true so na PRIMEIRA vez que o pedido entra: e o que impede a
 * notificacao de venda de tocar duas vezes quando a Shopify reentrega.
 */
export async function registrarPedidoDoRodizio(
  admin: SupabaseClient,
  storeId: string,
  orderId: string,
  createdAt: string | null
): Promise<boolean> {
  const data = createdAt ? new Date(createdAt) : null;
  const quando = data && !Number.isNaN(data.getTime()) ? data.toISOString() : new Date().toISOString();

  const { error } = await admin
    .from("routed_checkout_orders")
    .insert({ store_id: storeId, order_id: orderId, created_at: quando });
  // 23505 = ja gravado (reentrega da Shopify). Outro erro so vai para o log.
  if (error) {
    if (error.code !== "23505") console.error("[rodizio] falha ao gravar pedido", error.message);
    return false;
  }

  // Retencao: a janela e de 24 h; 3 dias de folga e a tabela nunca cresce.
  await admin
    .from("routed_checkout_orders")
    .delete()
    .eq("store_id", storeId)
    .lt("created_at", new Date(Date.now() - 3 * JANELA_LIMITE_MS).toISOString());
  return true;
}
