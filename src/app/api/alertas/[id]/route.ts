import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehUuid, type AlertaPatchCorpo } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Silenciar um alerta: so adia a RENOTIFICACAO. O alerta continua aberto e
// continua na tela -- silenciar nao e "resolvido". 0 h tira o silencio.
//
// A escrita e pelo service role (alertas nao tem grant de escrita para o
// authenticated), com o dono conferido no proprio UPDATE: alerta alheio
// atualiza zero linhas e vira 404.
// ============================================================================

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, erro: "Unauthorized" }, { status: 401 });

  if (!ehUuid(id)) {
    return NextResponse.json({ ok: false, erro: "Alerta não encontrado." }, { status: 404 });
  }

  let corpo: Partial<AlertaPatchCorpo>;
  try {
    corpo = (await request.json()) as Partial<AlertaPatchCorpo>;
  } catch {
    return NextResponse.json({ ok: false, erro: "Corpo inválido." }, { status: 400 });
  }
  const horas = Number(corpo.silenciar_horas);
  if (!Number.isFinite(horas) || horas < 0 || horas > 168) {
    return NextResponse.json(
      { ok: false, erro: "Silenciar: de 0 a 168 horas." },
      { status: 400 }
    );
  }

  const silenciadoAte = horas === 0 ? null : new Date(Date.now() + horas * 3600 * 1000).toISOString();

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("alertas")
    .update({ silenciado_ate: silenciadoAte })
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) {
    return NextResponse.json({ ok: false, erro: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ ok: false, erro: "Alerta não encontrado." }, { status: 404 });
  }
  return NextResponse.json({ ok: true, silenciado_ate: silenciadoAte });
}
