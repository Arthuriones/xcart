import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const SELECT =
  "id, target_store_id, weight, enabled, daily_limit, position, last_healed_at, settings, sku_map, variant_map, store:target_store_id(id, name, shop_domain, target_language)";

async function requireRoute(routeId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const { data: route } = await supabase
    .from("routed_checkout_configs")
    .select("id, user_id, source_store_id, rotation")
    .eq("id", routeId)
    .eq("user_id", user.id)
    .single();

  if (!route) {
    return { error: NextResponse.json({ error: "Rota nao encontrada." }, { status: 404 }) };
  }
  return { supabase, user, route };
}

/** Destinos da rota, com o tamanho do mapa em vez do mapa inteiro. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireRoute(id);
  if (ctx.error) return ctx.error;

  const { data, error } = await ctx.supabase
    .from("routed_checkout_targets")
    .select(SELECT)
    .eq("route_id", id)
    .order("position", { ascending: true })
    .order("id", { ascending: true });

  if (error) {
    return NextResponse.json({ error: "Falha ao ler os destinos." }, { status: 500 });
  }

  const targets = (data || []).map((row) => {
    const store = Array.isArray(row.store) ? row.store[0] : row.store;
    const skuMap = (row.sku_map || {}) as Record<string, unknown>;
    const variantMap = (row.variant_map || {}) as Record<string, unknown>;
    return {
      id: row.id,
      storeId: row.target_store_id,
      storeName: store?.name || "",
      shopDomain: store?.shop_domain || "",
      targetLanguage: store?.target_language || null,
      weight: row.weight ?? 1,
      enabled: row.enabled !== false,
      dailyLimit: row.daily_limit ?? null,
      position: row.position ?? 0,
      lastHealedAt: row.last_healed_at,
      settings: row.settings || {},
      // O mapa inteiro pode ter milhares de entradas; a UI so precisa do
      // tamanho para mostrar cobertura.
      skuMapCount: Object.keys(skuMap).length,
      variantMapCount: Object.keys(variantMap).length,
    };
  });

  // Peso -> fatia do trafego. O peso e relativo, entao a porcentagem so faz
  // sentido calculada contra o total dos destinos que estao no rodizio.
  const totalWeight = targets
    .filter((t) => t.enabled && t.weight > 0)
    .reduce((sum, t) => sum + t.weight, 0);

  return NextResponse.json({
    targets: targets.map((t) => ({
      ...t,
      sharePercent:
        t.enabled && t.weight > 0 && totalWeight > 0
          ? Math.round((t.weight / totalWeight) * 100)
          : 0,
    })),
    rotation: ctx.route.rotation || { strategy: "sticky" },
  });
}

/** Atualiza peso / liga-desliga de um destino, ou a estrategia do rodizio. */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireRoute(id);
  if (ctx.error) return ctx.error;

  const body = await request.json().catch(() => ({}));

  if (body.rotation && typeof body.rotation === "object") {
    const strategy =
      body.rotation.strategy === "each_checkout" ? "each_checkout" : "sticky";
    const { error } = await ctx.supabase
      .from("routed_checkout_configs")
      .update({ rotation: { strategy } })
      .eq("id", id);
    if (error) {
      return NextResponse.json({ error: "Falha ao salvar o rodizio." }, { status: 500 });
    }
  }

  const updates = Array.isArray(body.targets) ? body.targets : [];
  for (const update of updates) {
    if (!update || typeof update.id !== "string") continue;
    const patch: Record<string, unknown> = {};
    if (typeof update.weight === "number" && Number.isFinite(update.weight)) {
      patch.weight = Math.min(1000, Math.max(0, Math.floor(update.weight)));
    }
    if (typeof update.enabled === "boolean") patch.enabled = update.enabled;
    // Teto de pedidos/dia: null tira o teto.
    if (update.dailyLimit === null) patch.daily_limit = null;
    else if (typeof update.dailyLimit === "number" && Number.isFinite(update.dailyLimit)) {
      patch.daily_limit = Math.min(100000, Math.max(1, Math.floor(update.dailyLimit)));
    }
    if (typeof update.position === "number") patch.position = Math.floor(update.position);
    if (Object.keys(patch).length === 0) continue;

    // O filtro por route_id importa: sem ele o id de um destino de outra rota
    // do mesmo usuario passaria (a RLS so verifica o dono).
    const { error } = await ctx.supabase
      .from("routed_checkout_targets")
      .update(patch)
      .eq("id", update.id)
      .eq("route_id", id);
    if (error) {
      return NextResponse.json({ error: "Falha ao salvar o destino." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}

/** Remove um destino do rodizio. */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ctx = await requireRoute(id);
  if (ctx.error) return ctx.error;

  const targetId = new URL(request.url).searchParams.get("targetId") || "";
  if (!targetId) {
    return NextResponse.json({ error: "targetId e obrigatorio." }, { status: 400 });
  }

  const { count } = await ctx.supabase
    .from("routed_checkout_targets")
    .select("id", { count: "exact", head: true })
    .eq("route_id", id);

  // Rota sem nenhum destino nao roteia: o comprador cairia no checkout da
  // vitrine, que nao cobra. Melhor recusar do que deixar apagar o ultimo.
  if ((count ?? 0) <= 1) {
    return NextResponse.json(
      {
        error:
          "Esta e a unica loja de checkout da rota. Adicione outra antes de remover, ou desligue a rota inteira.",
      },
      { status: 409 }
    );
  }

  const { error } = await ctx.supabase
    .from("routed_checkout_targets")
    .delete()
    .eq("id", targetId)
    .eq("route_id", id);

  if (error) {
    return NextResponse.json({ error: "Falha ao remover o destino." }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
