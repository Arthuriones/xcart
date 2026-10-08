import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sincronizarTemaDaRota } from "@/lib/checkout-routes/tema-vitrine";

export const runtime = "nodejs";

// Liga/desliga uma rota, e SO isso.
//
// O PATCH de /api/checkout-routes reescreve sku_map e variant_map com o que
// vier no corpo — chamar ele so para virar um booleano apagaria o mapa inteiro
// da rota. Este endpoint existe para o botao "ligar mesmo assim" do assistente.
export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const id = typeof body.id === "string" ? body.id : "";
  if (!id || typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "Informe id e enabled." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("routed_checkout_configs")
    .update({ enabled: body.enabled, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id, enabled")
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Nao foi possivel atualizar a rota." },
      { status: 500 }
    );
  }

  // Pausar so valia na API: o tema da vitrine continuava roteando pelo
  // config embutido. Reenvia (rota pausada vai sem destino; ver
  // configParaOTema) e diz a tela se chegou.
  const tema = await sincronizarTemaDaRota(createAdminClient(), data.id);

  return NextResponse.json({ config: data, tema });
}
