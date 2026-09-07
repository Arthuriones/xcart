import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { deriveStoreRoles, type StoreRole } from "@/lib/checkout-routes/store-roles";

interface TargetRow {
  id: string;
  route_id: string;
  target_store_id: string;
  weight: number | null;
  enabled: boolean | null;
  position: number | null;
  last_healed_at: string | null;
  sku_map: Record<string, unknown> | null;
}

export interface GraphStore {
  id: string;
  name: string;
  shopDomain: string;
  targetLanguage: string | null;
  logoPath: string | null;
  niche: string | null;
  role: StoreRole;
}

export interface GraphTarget {
  id: string;
  storeId: string;
  weight: number;
  enabled: boolean;
  legacy: boolean;
  mappedSkuCount: number;
  lastHealedAt: string | null;
  sharePercent: number;
}

export interface GraphRoute {
  id: string;
  name: string;
  enabled: boolean;
  mode: string | null;
  publicToken: string;
  lastHeal: { at: string; ok: boolean; message?: string; mappedCount?: number } | null;
  sourceStoreId: string;
  rotationStrategy: "sticky" | "each_checkout";
  targets: GraphTarget[];
  /** Carrinhos que esta rota levou para um checkout nos ultimos 30 dias. */
  routedCount30d: number;
}

export interface RouteGraph {
  stores: GraphStore[];
  routes: GraphRoute[];
}

export const EMPTY_GRAPH: RouteGraph = { stores: [], routes: [] };

/**
 * O grafo inteiro do usuario: lojas, rotas e destinos, numa consulta so.
 *
 * O mapa precisa de tudo junto para desenhar -- buscar rota por rota faria a
 * tela piscar em N requisicoes e ainda assim mostrar um estado inconsistente
 * no meio do caminho.
 *
 * Mora aqui, e nao dentro da rota de API, porque a pagina do roteamento monta
 * no servidor e ja entrega o desenho pronto. A rota de API continua existindo
 * para o console recarregar depois de mexer em peso ou destino.
 */
export const getRouteGraph = cache(async (): Promise<RouteGraph> => {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return EMPTY_GRAPH;

  const [storesResult, routesResult] = await Promise.all([
    supabase
      .from("stores")
      .select("id, name, shop_domain, target_language, logo_path, niche")
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
    supabase
      .from("routed_checkout_configs")
      .select(
        "id, name, enabled, mode, rotation, public_token, settings, source_store_id, target_store_id, sku_map, last_healed_at, created_at"
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true }),
  ]);

  const stores = storesResult.data || [];
  const routes = routesResult.data || [];
  const routeIds = routes.map((route) => route.id);

  let targets: TargetRow[] = [];
  if (routeIds.length > 0) {
    const { data } = await supabase
      .from("routed_checkout_targets")
      .select("id, route_id, target_store_id, weight, enabled, position, last_healed_at, sku_map")
      .in("route_id", routeIds)
      .order("position", { ascending: true })
      .order("id", { ascending: true });
    targets = (data || []) as TargetRow[];
  }

  // Quantos carrinhos cada rota levou de verdade nos ultimos 30 dias.
  //
  // Sai de "routed_ok", que o loader grava na vitrine quando o comprador
  // clicou em finalizar E foi redirecionado. E o numero que a tela de
  // roteamento quer: nao "quantos pedidos a loja teve" (isso e Vendas), mas
  // quantos carrinhos ESTA rota entregou.
  const desde = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const roteados = new Map<string, number>();
  if (routeIds.length > 0) {
    const { data } = await supabase
      .from("routed_checkout_fallbacks")
      .select("route_config_id")
      .in("route_config_id", routeIds)
      .eq("reason", "routed_ok")
      .gte("created_at", desde);
    for (const linha of (data || []) as { route_config_id: string }[]) {
      roteados.set(linha.route_config_id, (roteados.get(linha.route_config_id) || 0) + 1);
    }
  }

  const byRoute = new Map<string, TargetRow[]>();
  for (const target of targets) {
    const list = byRoute.get(target.route_id) || [];
    list.push(target);
    byRoute.set(target.route_id, list);
  }

  const graphRoutes: GraphRoute[] = routes.map((route) => {
    const rows = byRoute.get(route.id) || [];

    // Rota anterior a migracao 025 sem linha de destino (destino apagado a
    // mao): mostra o destino legado para o mapa nao desenhar uma rota solta.
    const effective: TargetRow[] =
      rows.length > 0
        ? rows
        : route.target_store_id
          ? [
              {
                id: `legacy:${route.id}`,
                route_id: route.id,
                target_store_id: route.target_store_id,
                weight: 1,
                enabled: true,
                position: 0,
                last_healed_at: route.last_healed_at,
                sku_map: route.sku_map,
              },
            ]
          : [];

    const totalWeight = effective
      .filter((t) => t.enabled !== false && (t.weight ?? 1) > 0)
      .reduce((sum, t) => sum + (t.weight ?? 1), 0);

    // Resultado da ultima passada do auto-conserto. E o unico sinal de saude
    // que existe sem o usuario pedir, entao o console mostra ele direto.
    const settings = (route.settings || {}) as {
      last_heal?: { at: string; ok: boolean; message?: string; mappedCount?: number };
    };

    return {
      id: route.id,
      name: route.name,
      enabled: route.enabled !== false,
      mode: route.mode,
      publicToken: route.public_token,
      lastHeal: settings.last_heal ?? null,
      sourceStoreId: route.source_store_id,
      rotationStrategy:
        (route.rotation as { strategy?: string } | null)?.strategy === "each_checkout"
          ? "each_checkout"
          : "sticky",
      routedCount30d: roteados.get(route.id) || 0,
      targets: effective.map((target) => {
        const weight = target.weight ?? 1;
        const active = target.enabled !== false && weight > 0;
        return {
          id: target.id,
          storeId: target.target_store_id,
          weight,
          enabled: target.enabled !== false,
          legacy: String(target.id).startsWith("legacy:"),
          mappedSkuCount: Object.keys(target.sku_map || {}).length,
          lastHealedAt: target.last_healed_at,
          sharePercent:
            active && totalWeight > 0 ? Math.round((weight / totalWeight) * 100) : 0,
        };
      }),
    };
  });

  const roles = deriveStoreRoles(
    graphRoutes.map((route) => ({
      sourceStoreId: route.sourceStoreId,
      targetStoreIds: route.targets.map((t) => t.storeId),
    }))
  );

  return {
    stores: stores.map((store) => ({
      id: store.id,
      name: store.name,
      shopDomain: store.shop_domain,
      targetLanguage: store.target_language,
      logoPath: store.logo_path,
      niche: store.niche,
      role: (roles.get(store.id) || "unassigned") as StoreRole,
    })),
    routes: graphRoutes,
  };
})
