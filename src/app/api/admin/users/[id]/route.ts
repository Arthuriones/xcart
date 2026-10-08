import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehPlanoId } from "@/lib/billing/plans";

export const runtime = "nodejs";

async function requireAdmin() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Unauthorized", status: 401 as const };
  const admin = createAdminClient();
  const { data: me } = await admin
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .single();
  if (!me?.is_admin) return { error: "Acesso restrito.", status: 403 as const };
  return { admin, userId: user.id };
}

// GET /api/admin/users/:id -> detalhe completo do usuario.
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { admin } = auth;
  const { id } = await params;

  const [{ data: profile }, userRes, { data: stores }, { data: routes }, { data: usage }, { data: purchases }] =
    await Promise.all([
      admin
        .from("profiles")
        .select(
          "id, plan, subscription_status, ai_credits, current_period_end, access_granted, is_admin, created_at"
        )
        .eq("id", id)
        .single(),
      admin.auth.admin.getUserById(id),
      admin
        .from("stores")
        .select("id, shop_domain, name, niche, target_language, created_at")
        .eq("user_id", id),
      admin
        .from("routed_checkout_configs")
        .select(
          "id, name, source_store_id, target_store_id, public_token, enabled"
        )
        .eq("user_id", id),
      admin
        .from("ai_usage_log")
        .select("action, cost_usd, credits_used, created_at, metadata")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      admin
        .from("credit_purchases")
        .select("credits, amount_cents, currency, created_at")
        .eq("user_id", id)
        .order("created_at", { ascending: false })
        .limit(20),
    ]);

  if (!profile) {
    return NextResponse.json({ error: "Usuario nao encontrado." }, { status: 404 });
  }

  // Contagem de produtos por loja.
  const storeIds = (stores || []).map((s) => s.id);
  const productCountByStore = new Map<string, number>();
  if (storeIds.length > 0) {
    const { data: products } = await admin
      .from("products")
      .select("store_id")
      .in("store_id", storeIds);
    for (const p of products || []) {
      productCountByStore.set(
        p.store_id,
        (productCountByStore.get(p.store_id) || 0) + 1
      );
    }
  }

  const storeNameById = new Map<string, string>();
  for (const s of stores || []) storeNameById.set(s.id, s.name || s.shop_domain);

  return NextResponse.json({
    profile: {
      ...profile,
      email: userRes?.data?.user?.email || "—",
      hasAccess:
        profile.is_admin === true ||
        profile.plan === "pro" ||
        profile.access_granted === true,
    },
    stores: (stores || []).map((s) => ({
      ...s,
      productCount: productCountByStore.get(s.id) || 0,
    })),
    routes: (routes || []).map((r) => ({
      ...r,
      sourceName: storeNameById.get(r.source_store_id) || "—",
      targetName: storeNameById.get(r.target_store_id) || "—",
    })),
    totals: {
      stores: stores?.length || 0,
      products: [...productCountByStore.values()].reduce((a, b) => a + b, 0),
      routes: routes?.length || 0,
    },
    usage: usage || [],
    purchases: purchases || [],
  });
}

// PATCH /api/admin/users/:id -> seta plano, creditos (absoluto), soma creditos
// ou alterna admin de um usuario.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin();
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  const { admin } = auth;
  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // Soma de creditos (atomica) tem prioridade.
  if (typeof body.addCredits === "number" && body.addCredits !== 0) {
    await admin.rpc("add_ai_credits", {
      p_user_id: id,
      p_amount: Math.floor(body.addCredits),
    });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.plan === "free" || body.plan === "pro") update.plan = body.plan;
  // Tier (limite de lojas): "loja1" | "lojas3" | "ilimitado", ou null (Pro antigo).
  if (body.plano === null || ehPlanoId(body.plano)) update.plano = body.plano;
  if (typeof body.aiCredits === "number") {
    update.ai_credits = Math.max(0, Math.floor(body.aiCredits));
  }
  if (typeof body.accessGranted === "boolean") {
    update.access_granted = body.accessGranted;
  }
  if (typeof body.isAdmin === "boolean") update.is_admin = body.isAdmin;

  // Evita o admin remover o proprio acesso sem querer.
  if (update.is_admin === false && id === auth.userId) {
    return NextResponse.json(
      { error: "Voce nao pode remover o proprio admin." },
      { status: 400 }
    );
  }

  if (Object.keys(update).length > 1) {
    const { error } = await admin.from("profiles").update(update).eq("id", id);
    if (error) {
      return NextResponse.json(
        { error: "Falha ao atualizar usuario." },
        { status: 500 }
      );
    }
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("id, plan, ai_credits, is_admin, access_granted, subscription_status")
    .eq("id", id)
    .single();

  return NextResponse.json({ profile });
}
