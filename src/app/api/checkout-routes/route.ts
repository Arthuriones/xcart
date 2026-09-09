import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { createClient } from "@/lib/supabase/server";
import { usuarioPossuiLojas } from "@/lib/stores/authorize";

async function getUserAndClient() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return { supabase, user };
}


export async function GET() {
  const { supabase, user } = await getUserAndClient();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("routed_checkout_configs")
    .select(
      "id, name, mode, public_token, enabled, source_store_id, target_store_id, sku_map, variant_map, settings, created_at, updated_at"
    )
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel carregar configuracoes." },
      { status: 500 }
    );
  }

  return NextResponse.json({ configs: data || [] });
}

export async function POST(request: NextRequest) {
  const { supabase, user } = await getUserAndClient();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceStoreId =
    typeof body.sourceStoreId === "string" ? body.sourceStoreId : "";
  const targetStoreId =
    typeof body.targetStoreId === "string" ? body.targetStoreId : "";
  const mode =
    body.mode === "enterprise" || body.mode === "enterprise_static"
      ? body.mode
      : "standard";

  if (!name || !sourceStoreId || !targetStoreId) {
    return NextResponse.json(
      { error: "Nome, loja vitrine e loja checkout sao obrigatorios." },
      { status: 400 }
    );
  }

  if (sourceStoreId === targetStoreId) {
    return NextResponse.json(
      { error: "A vitrine e a loja checkout precisam ser lojas diferentes." },
      { status: 400 }
    );
  }

  const ownsStores = await usuarioPossuiLojas([sourceStoreId, targetStoreId], user.id);
  if (!ownsStores) {
    return NextResponse.json(
      { error: "Uma das lojas selecionadas nao pertence ao usuario." },
      { status: 403 }
    );
  }

  // Uma vitrine so pode ter UMA rota ligada.
  //
  // O modelo e "uma vitrine, varias lojas de checkout" -- as lojas extras
  // entram como destino em routed_checkout_targets, nao como rota nova. Duas
  // rotas ligadas na mesma vitrine geram dois public_token, e o tema carrega um
  // so: as outras viram configuracao fantasma. O lojista mexe no peso da rota
  // errada e nao ve efeito nenhum, sem nada na tela explicando por que.
  //
  // Encontrado em producao: duas contas com TRES rotas ligadas na mesma
  // vitrine, uma delas criada em dias seguidos.
  const { data: jaExiste } = await supabase
    .from("routed_checkout_configs")
    .select("id, name")
    .eq("user_id", user.id)
    .eq("source_store_id", sourceStoreId)
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();

  if (jaExiste) {
    return NextResponse.json(
      {
        error:
          `Esta vitrine ja roteia pela rota "${jaExiste.name}". Para mandar ` +
          `trafego para outra loja de checkout, adicione ela como destino ` +
          `dessa rota em vez de criar uma segunda.`,
        existingRouteId: jaExiste.id,
      },
      { status: 409 }
    );
  }

  const { data, error } = await supabase
    .from("routed_checkout_configs")
    .insert({
      user_id: user.id,
      source_store_id: sourceStoreId,
      target_store_id: targetStoreId,
      name,
      mode,
      public_token: randomUUID(),
      enabled: body.enabled !== false,
      sku_map: body.skuMap && typeof body.skuMap === "object" ? body.skuMap : {},
      variant_map:
        body.variantMap && typeof body.variantMap === "object"
          ? body.variantMap
          : {},
      settings:
        body.settings && typeof body.settings === "object" ? body.settings : {},
    })
    .select()
    .single();

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel salvar o checkout roteado." },
      { status: 500 }
    );
  }

  return NextResponse.json({ config: data });
}

export async function PATCH(request: NextRequest) {
  const { supabase, user } = await getUserAndClient();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const sourceStoreId =
    typeof body.sourceStoreId === "string" ? body.sourceStoreId : "";
  const targetStoreId =
    typeof body.targetStoreId === "string" ? body.targetStoreId : "";
  const mode =
    body.mode === "enterprise" || body.mode === "enterprise_static"
      ? body.mode
      : "standard";

  if (!id || !name || !sourceStoreId || !targetStoreId) {
    return NextResponse.json(
      { error: "Id, nome, loja vitrine e loja checkout sao obrigatorios." },
      { status: 400 }
    );
  }

  if (sourceStoreId === targetStoreId) {
    return NextResponse.json(
      { error: "A vitrine e a loja checkout precisam ser lojas diferentes." },
      { status: 400 }
    );
  }

  const ownsStores = await usuarioPossuiLojas([sourceStoreId, targetStoreId], user.id);
  if (!ownsStores) {
    return NextResponse.json(
      { error: "Uma das lojas selecionadas nao pertence ao usuario." },
      { status: 403 }
    );
  }

  const { data, error } = await supabase
    .from("routed_checkout_configs")
    .update({
      source_store_id: sourceStoreId,
      target_store_id: targetStoreId,
      name,
      mode,
      enabled: body.enabled !== false,
      sku_map: body.skuMap && typeof body.skuMap === "object" ? body.skuMap : {},
      variant_map:
        body.variantMap && typeof body.variantMap === "object"
          ? body.variantMap
          : {},
      settings:
        body.settings && typeof body.settings === "object" ? body.settings : {},
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar o checkout roteado." },
      { status: 500 }
    );
  }

  return NextResponse.json({ config: data });
}

export async function DELETE(request: NextRequest) {
  const { supabase, user } = await getUserAndClient();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";

  if (!id) {
    return NextResponse.json(
      { error: "Id da rota e obrigatorio." },
      { status: 400 }
    );
  }

  const { error } = await supabase
    .from("routed_checkout_configs")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) {
    return NextResponse.json(
      { error: "Nao foi possivel excluir a rota." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
