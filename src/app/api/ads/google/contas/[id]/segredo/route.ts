import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicAppUrl } from "@/lib/public-url";
import { gerarSegredo, hashSegredo } from "@/lib/ads/google-ingest";
import { scriptGoogleAds } from "@/lib/ads/google-script";
import { ROTAS, ehUuid } from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Gera um segredo novo para uma conta do Google (e o script com ele).
//
// O hash antigo e SOBRESCRITO: o script colado antes para de funcionar na
// hora. E o que se quer quando o segredo vazou ou o script se perdeu -- o
// lojista cola o novo e o antigo, onde quer que esteja, nao escreve mais.
// ============================================================================

type Resposta = { ok: true; segredo: string; script: string } | { ok: false; erro: string };

function json(status: number, corpo: Resposta) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  if (!ehUuid(id)) return json(404, { ok: false, erro: "Conta não encontrada." });

  const admin = createAdminClient();
  const { data: conta } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .eq("plataforma", "google")
    .maybeSingle();
  if (!conta) return json(404, { ok: false, erro: "Conta não encontrada." });

  const segredo = gerarSegredo();
  const { error } = await admin
    .from("ad_account_secrets")
    .upsert(
      {
        ad_account_id: conta.id,
        ingest_token_hash: hashSegredo(segredo),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ad_account_id" }
    );
  if (error) return json(500, { ok: false, erro: `Falha ao gerar o segredo: ${error.message}` });

  const script = scriptGoogleAds({ url: getPublicAppUrl() + ROTAS.apiGoogleIngest, segredo });
  return json(200, { ok: true, segredo, script });
}
