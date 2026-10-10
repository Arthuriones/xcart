import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { VENDA_DE_TESTE, celularDoDono, enviarParaUmCelular } from "@/lib/alertas/venda-webhook";
import { ID_LEGADO } from "@/lib/alertas/venda-celulares";
import { ehUuid } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// POST /api/alertas/venda-webhook/[id]/teste: manda a venda de exemplo SO
// para este celular -- com o aviso ligado ou desligado, porque e o lojista
// conferindo a URL. O resultado vira o "último envio" do celular, como uma
// venda de verdade. Celular de outro usuario responde 404.
// ============================================================================

function json(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });
  if (id !== ID_LEGADO && !ehUuid(id)) return json(404, { ok: false, erro: "Celular não encontrado." });

  const admin = createAdminClient();
  let destino;
  try {
    destino = await celularDoDono(admin, user.id, id);
  } catch (e) {
    return json(500, { ok: false, erro: `Não deu para ler o celular: ${e instanceof Error ? e.message : e}` });
  }
  if (!destino) return json(404, { ok: false, erro: "Celular não encontrado." });

  const r = await enviarParaUmCelular(admin, user.id, destino, VENDA_DE_TESTE);
  // 200 com ok:false: a rota funcionou, quem recusou foi o servico do celular.
  if (!r.ok) return json(200, { ok: false, erro: r.erro ?? "O serviço do celular recusou." });
  return json(200, { ok: true });
}
