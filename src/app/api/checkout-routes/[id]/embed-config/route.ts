import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildEmbedConfig, EMBED_CONFIG_SELECT } from "@/lib/checkout-routes/embed-config";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const admin = createAdminClient();
  const { data: config, error } = await admin
    .from("routed_checkout_configs")
    .select(EMBED_CONFIG_SELECT)
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error || !config) {
    return NextResponse.json({ error: "Rota não encontrada." }, { status: 404 });
  }

  try {
    return NextResponse.json(await buildEmbedConfig(admin, config));
  } catch (erro) {
    // Leitura dos destinos falhou: 503, nunca um config montado pelo legado.
    console.error("[checkout-routes/embed-config]", erro);
    return NextResponse.json(
      { error: "Não deu para ler as lojas de checkout agora. Tente de novo." },
      { status: 503 }
    );
  }
}
