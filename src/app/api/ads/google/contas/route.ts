import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getPublicAppUrl } from "@/lib/public-url";
import { COLUNAS_CONTA, resumoDaConta } from "@/lib/ads/contas";
import { gerarSegredo, hashSegredo, normalizarCustomerId } from "@/lib/ads/google-ingest";
import { scriptGoogleAds } from "@/lib/ads/google-script";
import {
  ROTAS,
  ehUuid,
  type GoogleContaCorpo,
  type GoogleContaCriadaResposta,
} from "@/lib/financeiro/tipos";

export const runtime = "nodejs";

// ============================================================================
// Cadastra uma conta do Google Ads e devolve o script com o segredo dela.
//
// O segredo aparece UMA vez, nesta resposta. O banco guarda so o sha256: nem
// o xcart consegue mostrar de novo, so gerar outro.
//
// A URL do script vem de getPublicAppUrl() SEM a origem da requisicao: um
// cadastro feito num deploy de preview geraria um script apontando para o
// preview, que some -- e o lojista so descobriria dias depois, sem gasto.
// ============================================================================

function json(status: number, corpo: GoogleContaCriadaResposta) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return json(401, { ok: false, erro: "Sessão expirada. Entre de novo." });

  let corpo: Partial<GoogleContaCorpo>;
  try {
    corpo = (await request.json()) as Partial<GoogleContaCorpo>;
  } catch {
    return json(400, { ok: false, erro: "Corpo inválido." });
  }

  const admin = createAdminClient();

  if (!ehUuid(corpo.store_id)) return json(400, { ok: false, erro: "Escolha a loja da conta." });
  const { data: loja } = await admin
    .from("stores")
    .select("id, user_id")
    .eq("id", corpo.store_id)
    .maybeSingle();
  if (!loja || loja.user_id !== user.id) {
    return json(404, { ok: false, erro: "Loja não encontrada." });
  }

  const customerId = normalizarCustomerId(String(corpo.customer_id ?? ""));
  if (!customerId) {
    return json(400, {
      ok: false,
      erro:
        "Use o ID de CLIENTE de 10 dígitos (123-456-7890), que aparece no topo do Google Ads. Não é o AW-...",
    });
  }

  const { data: existente } = await admin
    .from("ad_accounts")
    .select("id")
    .eq("user_id", user.id)
    .eq("plataforma", "google")
    .eq("external_id", customerId)
    .maybeSingle();
  if (existente) {
    return json(409, { ok: false, erro: "Esta conta já está cadastrada. Use Gerar novo script." });
  }

  const nome = typeof corpo.nome === "string" ? corpo.nome.trim().slice(0, 120) || null : null;

  const { data: conta, error: erroConta } = await admin
    .from("ad_accounts")
    .insert({
      user_id: user.id,
      store_id: loja.id,
      plataforma: "google",
      external_id: customerId,
      nome,
      fonte: "script",
      ativo: true,
    })
    .select(COLUNAS_CONTA)
    .single();
  if (erroConta || !conta) {
    // Corrida com outro cadastro da mesma conta: o indice unico responde.
    if (erroConta?.code === "23505") {
      return json(409, { ok: false, erro: "Esta conta já está cadastrada. Use Gerar novo script." });
    }
    return json(500, { ok: false, erro: `Falha ao cadastrar a conta: ${erroConta?.message ?? ""}` });
  }

  const segredo = gerarSegredo();
  const { error: erroSegredo } = await admin
    .from("ad_account_secrets")
    .upsert(
      {
        ad_account_id: conta.id,
        ingest_token_hash: hashSegredo(segredo),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "ad_account_id" }
    );
  if (erroSegredo) {
    // Conta sem segredo seria um cadastro que nenhum script alcanca: desfaz.
    await admin.from("ad_accounts").delete().eq("id", conta.id).eq("user_id", user.id);
    return json(500, { ok: false, erro: `Falha ao gerar o segredo: ${erroSegredo.message}` });
  }

  const script = scriptGoogleAds({ url: getPublicAppUrl() + ROTAS.apiGoogleIngest, segredo });
  return json(200, { ok: true, conta: resumoDaConta(conta, true), segredo, script });
}
