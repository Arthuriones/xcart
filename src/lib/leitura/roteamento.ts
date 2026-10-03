import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";

// ============================================================================
// Leituras da tela de Rotas que o grafo (src/lib/checkout-routes/graph.ts)
// nao traz. So leitura, pela sessao: a RLS de routed_checkout_configs e de
// routed_checkout_fallbacks so devolve linha do dono.
// ============================================================================

/**
 * A leitura das rotas funciona? O grafo engole erro de banco e devolve lista
 * vazia -- e a tela diria "Nenhuma rota ainda" para quem tem rota. Por isso,
 * quando o grafo volta vazio, esta consulta barata confere se o vazio e de
 * verdade. Erro de banco LANCA.
 */
export async function conferirLeituraDasRotas(): Promise<void> {
  const user = await getCurrentUser();
  if (!user) return;
  const supabase = await createClient();
  const { error } = await supabase
    .from("routed_checkout_configs")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id);
  if (error) throw new Error(`[rotas] leitura falhou: ${error.message}`);
}

/**
 * Quando o script da vitrine deu sinal de vida pela ultima vez nesta rota.
 *
 * O loader manda "loader_ready" uma vez por sessao, quando alguem abre produto
 * ou carrinho da vitrine. O registro fica 30 dias (migration 028), entao null
 * = nenhum sinal nos ultimos 30 dias: script fora do tema OU vitrine sem
 * visita. A tela diz as duas coisas. Erro de banco LANCA.
 */
export async function lerUltimoSinalDoScript(routeId: string): Promise<string | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("routed_checkout_fallbacks")
    .select("created_at")
    .eq("route_config_id", routeId)
    .eq("reason", "loader_ready")
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`[rotas] sinal do script: ${error.message}`);
  return (data?.[0]?.created_at as string | undefined) ?? null;
}
