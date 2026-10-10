import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { semTabelaDeCelulares } from "@/lib/alertas/venda-webhook";
import { ID_LEGADO } from "@/lib/alertas/venda-celulares";
import { ehUuid } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// DELETE /api/alertas/venda-webhook/[id]: tira um celular da "Venda no
// celular". So o do dono da sessao (o filtro por user_id vai junto; o de
// outro usuario responde 404, igual ao que nao existe).
//
// Tambem limpa a coluna da 063 quando ela guarda a MESMA URL: o codigo antigo
// (num rollback) nao manda mais para o celular removido, e rodar a 070 de
// novo nao o traz de volta. A comparacao e feita aqui, nunca em filtro de
// consulta: a URL e segredo e a query string vai para o log do PostgREST.
// ============================================================================

const NAO_ENCONTRADO = "Celular não encontrado.";

function json(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  if (id !== ID_LEGADO && !ehUuid(id)) return json(404, { ok: false, erro: NAO_ENCONTRADO });

  const admin = createAdminClient();
  const agora = new Date().toISOString();

  if (id === ID_LEGADO) {
    // Antes da 070: o celular unico e a coluna da 063.
    const { error } = await admin
      .from("alerta_config_secrets")
      .update({ venda_webhook_url: null, updated_at: agora })
      .eq("user_id", user.id);
    if (error) return json(500, { ok: false, erro: `Não deu para remover: ${error.message}` });
    return json(200, { ok: true });
  }

  const { data, error } = await admin
    .from("venda_webhooks")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("url");
  if (error) {
    if (semTabelaDeCelulares(error)) return json(404, { ok: false, erro: NAO_ENCONTRADO });
    return json(500, { ok: false, erro: `Não deu para remover: ${error.message}` });
  }
  const removida = String(((data || []) as { url: string | null }[])[0]?.url || "").trim();
  if (!removida) return json(404, { ok: false, erro: NAO_ENCONTRADO });

  try {
    const { data: seg } = await admin
      .from("alerta_config_secrets")
      .select("venda_webhook_url")
      .eq("user_id", user.id)
      .maybeSingle();
    const antiga = String((seg as { venda_webhook_url?: string | null } | null)?.venda_webhook_url || "").trim();
    if (antiga && antiga === removida) {
      const { error: erroAntiga } = await admin
        .from("alerta_config_secrets")
        .update({ venda_webhook_url: null, updated_at: agora })
        .eq("user_id", user.id);
      if (erroAntiga) console.warn("[alertas/venda-webhook] nao limpou a URL antiga", erroAntiga.message);
    }
  } catch (e) {
    console.warn("[alertas/venda-webhook] nao limpou a URL antiga", e instanceof Error ? e.message : e);
  }

  return json(200, { ok: true });
}
