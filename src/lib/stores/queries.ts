import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { deriveStoreRoles, type StoreRole } from "@/lib/checkout-routes/store-roles";

/** O que sempre existiu na tabela. */
const CAMPOS_BASE =
  "id, name, shop_domain, theme_id, logo_path, target_language, currency_code, auto_convert_prices, currency_rate, price_markup_percent, created_at";

/** Contagem de catalogo -- so existe depois da migration 026. */
const CAMPOS_CATALOGO = "product_count, variant_count, catalog_synced_at";

export const CAMPOS_LOJA = `${CAMPOS_BASE}, ${CAMPOS_CATALOGO}`;

type ClienteSupabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Le as lojas sem depender da migration 026 ter rodado.
 *
 * Isto aqui e a correcao de um bug feio: a consulta pedia product_count numa
 * base onde a coluna nao existia, o PostgREST devolvia 400, o codigo fazia
 * `data || []` e a tela dizia "Nenhuma loja conectada" para quem tinha nove.
 * Erro de banco nao pode ser indistinguivel de lista vazia.
 *
 * Agora a contagem e opcional: se as colunas nao estiverem la, as lojas vem
 * do mesmo jeito e o catalogo aparece como "—". Qualquer outro erro sobe.
 */
export async function lerLojas(supabase: ClienteSupabase) {
  const completa = await supabase
    .from("stores")
    .select(CAMPOS_LOJA)
    .order("created_at", { ascending: false });

  if (!completa.error) return completa.data || [];

  const semColuna = /column .* does not exist/i.test(completa.error.message || "");
  if (!semColuna) throw new Error(completa.error.message);

  console.warn(
    "[stores] migration 026 nao aplicada: seguindo sem a contagem de catalogo.",
    completa.error.message
  );

  const base = await supabase
    .from("stores")
    .select(CAMPOS_BASE)
    .order("created_at", { ascending: false });

  if (base.error) throw new Error(base.error.message);

  return (base.data || []).map((loja) => ({
    ...loja,
    product_count: null,
    variant_count: null,
    catalog_synced_at: null,
  }));
}

export interface StoreRow {
  id: string;
  name: string;
  shop_domain: string;
  theme_id: string | null;
  logo_path: string | null;
  target_language: string | null;
  currency_code: string | null;
  auto_convert_prices: boolean | null;
  currency_rate: number | null;
  price_markup_percent: number | null;
  product_count: number | null;
  variant_count: number | null;
  catalog_synced_at: string | null;
  created_at: string;
  role: StoreRole;
  /** Estado da loja dentro do roteamento. */
  routeState: "ok" | "paused" | "attention" | "none";
}

/**
 * Lojas do usuario, com o papel de cada uma no roteamento ja resolvido.
 *
 * Roda no servidor de proposito. Antes a pagina baixava um componente de 1500
 * linhas, autenticava no Supabase pelo navegador, buscava as lojas e SO ENTAO
 * chamava /api/checkout-routes/map para descobrir quem era vitrine e quem era
 * checkout -- quatro idas e voltas em serie antes de aparecer qualquer coisa
 * na tela. Aqui e uma consulta so, ao lado do banco, e o HTML ja sai pronto.
 */
export async function getStoresWithRoles(): Promise<StoreRow[]> {
  // As duas nao dependem uma da outra: em serie era um arredondamento a mais
  // antes da primeira consulta sair.
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return [];

  const [linhas, rotas] = await Promise.all([
    lerLojas(supabase),
    supabase
      .from("routed_checkout_configs")
      .select("id, source_store_id, target_store_id")
      .eq("user_id", user.id),
  ]);

  const configs = rotas.data || [];

  let destinos: {
    route_id: string;
    target_store_id: string;
    enabled: boolean | null;
    weight: number | null;
    sku_map: Record<string, unknown> | null;
  }[] = [];
  if (configs.length > 0) {
    const { data } = await supabase
      .from("routed_checkout_targets")
      .select("route_id, target_store_id, enabled, weight, sku_map")
      .in(
        "route_id",
        configs.map((c) => c.id)
      );
    destinos = data || [];
  }

  const porRota = new Map<string, string[]>();
  for (const destino of destinos) {
    const lista = porRota.get(destino.route_id) || [];
    lista.push(destino.target_store_id);
    porRota.set(destino.route_id, lista);
  }

  const papeis = deriveStoreRoles(
    configs.map((config) => ({
      sourceStoreId: config.source_store_id,
      // Rota anterior a migracao 025 sem linha de destino cai no destino
      // legado da propria rota, senao a loja apareceria como "sem rota".
      targetStoreIds: porRota.get(config.id) || [config.target_store_id].filter(Boolean),
    }))
  );

  // Mesma regra do roteamento: ligada sem nenhum produto ligado e "atencao",
  // mesmo em 0%. As duas telas precisam contar igual.
  const estadoPorLoja = new Map<string, StoreRow["routeState"]>();
  for (const destino of destinos) {
    const ligada = destino.enabled !== false;
    const mapa = Object.keys(destino.sku_map || {}).length;
    const estado: StoreRow["routeState"] =
      ligada && mapa === 0
        ? "attention"
        : ligada && (destino.weight ?? 0) > 0
          ? "ok"
          : "paused";
    // Uma loja pode ser destino de mais de uma rota: o pior estado manda.
    const atual = estadoPorLoja.get(destino.target_store_id);
    if (!atual || estado === "attention" || (estado === "paused" && atual === "ok")) {
      estadoPorLoja.set(destino.target_store_id, estado);
    }
  }

  return linhas.map((loja) => {
    const papel = papeis.get(loja.id) || "unassigned";
    return {
      ...loja,
      role: papel,
      routeState:
        estadoPorLoja.get(loja.id) ?? (papel === "vitrine" || papel === "both" ? "ok" : "none"),
    };
  }) as StoreRow[];
}
