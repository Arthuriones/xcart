import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ehUuid, type ContaPatchCorpo } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Edita (loja, ativo, nome) ou remove uma conta de anuncio, Meta ou Google.
//
// Escrita pelo service role, depois de conferir pela SESSAO que a conta e do
// usuario -- e, ao ligar a uma loja, que a loja tambem e. O user_id nunca vem
// do corpo. Conta alheia responde 404, igual a conta que nao existe.
// ============================================================================

type Resposta = { ok: true } | { ok: false; erro: string };

function json(status: number, corpo: Resposta) {
  return NextResponse.json(corpo, { status });
}

async function usuario() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuario();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  if (!ehUuid(id)) return json(404, { ok: false, erro: "Conta não encontrada." });

  let corpo: ContaPatchCorpo;
  try {
    corpo = (await request.json()) as ContaPatchCorpo;
  } catch {
    return json(400, { ok: false, erro: "Corpo inválido." });
  }
  if (!corpo || typeof corpo !== "object") return json(400, { ok: false, erro: "Corpo inválido." });

  const admin = createAdminClient();
  const mudanca: Record<string, unknown> = {};

  if (corpo.store_id !== undefined) {
    if (corpo.store_id === null) {
      mudanca.store_id = null;
    } else {
      if (!ehUuid(corpo.store_id)) return json(404, { ok: false, erro: "Loja não encontrada." });
      const { data: loja } = await admin
        .from("stores")
        .select("id, user_id")
        .eq("id", corpo.store_id)
        .maybeSingle();
      if (!loja || loja.user_id !== user.id) {
        return json(404, { ok: false, erro: "Loja não encontrada." });
      }
      mudanca.store_id = loja.id;
    }
  }

  if (corpo.ativo !== undefined) {
    if (typeof corpo.ativo !== "boolean") return json(400, { ok: false, erro: "ativo inválido." });
    mudanca.ativo = corpo.ativo;
  }

  if (corpo.nome !== undefined) {
    if (corpo.nome !== null && typeof corpo.nome !== "string") {
      return json(400, { ok: false, erro: "Nome inválido." });
    }
    mudanca.nome = corpo.nome ? corpo.nome.trim().slice(0, 120) || null : null;
  }

  if (Object.keys(mudanca).length === 0) {
    return json(400, { ok: false, erro: "Nada para mudar." });
  }
  mudanca.updated_at = new Date().toISOString();

  const { data, error } = await admin
    .from("ad_accounts")
    .update(mudanca)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return json(500, { ok: false, erro: `Falha ao salvar: ${error.message}` });
  if (!data || data.length === 0) return json(404, { ok: false, erro: "Conta não encontrada." });

  return json(200, { ok: true });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await usuario();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  if (!ehUuid(id)) return json(404, { ok: false, erro: "Conta não encontrada." });

  // O cascade da 052 leva junto o segredo e o gasto gravado da conta.
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ad_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");
  if (error) return json(500, { ok: false, erro: `Falha ao remover: ${error.message}` });
  if (!data || data.length === 0) return json(404, { ok: false, erro: "Conta não encontrada." });

  return json(200, { ok: true });
}
