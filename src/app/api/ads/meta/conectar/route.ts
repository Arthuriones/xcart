import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ErroGraph, listarContasMeta } from "@/lib/ads/meta-graph";
import { classificarErroMeta } from "@/lib/ads/meta-mapear";
import type {
  AdAccountRow,
  ContaAnuncioResumo,
  MetaConectarCorpo,
  MetaConectarResposta,
} from "@/lib/financeiro/tipos";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Conecta o Meta: o lojista cola um token de system user (ads_read) e nos
// descobrimos as contas que ele enxerga.
//
// O token mora em ad_account_secrets (sem policy, so service role) e NUNCA
// volta para o navegador: a resposta diz so que o segredo existe. Tambem nao
// vai para log -- nenhum console.* aqui, de proposito.
//
// Conta nova nasce sem loja e ativa; conta que ja existia mantem a loja e o
// "ativo" que o lojista escolheu (por isso store_id e ativo ficam FORA do
// payload do upsert).
// ============================================================================

/** Token do Meta: base62 na pratica; `|` aparece em token de app. */
const RE_TOKEN = /^[A-Za-z0-9_\-.|]{20,1000}$/;

function falha(erro: string, status = 400) {
  return NextResponse.json<MetaConectarResposta>({ ok: false, erro }, { status });
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, erro: "Faça login de novo." }, { status: 401 });
  }

  let corpo: Partial<MetaConectarCorpo> | null = null;
  try {
    corpo = (await request.json()) as Partial<MetaConectarCorpo>;
  } catch {
    corpo = null;
  }
  const token = typeof corpo?.token === "string" ? corpo.token.trim() : "";
  if (!RE_TOKEN.test(token)) {
    return falha(
      "Token em formato inválido. Copie o token inteiro gerado para o usuário do sistema no Business Manager."
    );
  }

  let contas;
  try {
    contas = await listarContasMeta(token);
  } catch (e) {
    if (e instanceof ErroGraph) {
      const tipo = classificarErroMeta(e.codigo);
      if (tipo === "token") return falha("Token inválido ou expirado.");
      if (tipo === "permissao") {
        return falha("O token não tem ads_read ou não tem acesso às contas.");
      }
      if (tipo === "limite") {
        return falha("O Meta pediu uma pausa (limite de chamadas). Tente de novo em alguns minutos.", 429);
      }
    }
    return falha("Não consegui falar com o Meta agora. Tente de novo em alguns minutos.", 502);
  }

  if (contas.length === 0) {
    return falha(
      "O token não enxerga nenhuma conta de anúncio. No Business Manager, atribua cada conta ao usuário do sistema com Ver desempenho e gere o token de novo."
    );
  }

  const admin = createAdminClient();
  const agoraIso = new Date().toISOString();

  const { data: gravadas, error: erroContas } = await admin
    .from("ad_accounts")
    .upsert(
      contas.map((c) => ({
        user_id: user.id,
        plataforma: "meta",
        external_id: c.account_id,
        nome: c.nome,
        moeda: c.moeda,
        fuso: c.fuso,
        status_externo: c.status,
        fonte: "api",
        updated_at: agoraIso,
      })),
      { onConflict: "user_id,plataforma,external_id" }
    )
    .select("*");
  if (erroContas || !gravadas) {
    return falha("Não consegui salvar as contas. Tente de novo.", 500);
  }

  const linhas = gravadas as AdAccountRow[];
  const { error: erroSegredo } = await admin.from("ad_account_secrets").upsert(
    linhas.map((c) => ({
      ad_account_id: c.id,
      meta_access_token: token,
      updated_at: agoraIso,
    })),
    { onConflict: "ad_account_id" }
  );
  if (erroSegredo) {
    return falha("Salvei as contas, mas não consegui guardar o token. Cole de novo.", 500);
  }

  const resumo: ContaAnuncioResumo[] = linhas.map((c) => ({
    id: c.id,
    plataforma: c.plataforma,
    external_id: c.external_id,
    nome: c.nome,
    moeda: c.moeda,
    fuso: c.fuso,
    store_id: c.store_id,
    ativo: c.ativo,
    fonte: c.fonte,
    ultimo_sync_ok_em: c.ultimo_sync_ok_em,
    ultimo_erro: c.ultimo_erro,
    temSegredo: true,
  }));

  return NextResponse.json<MetaConectarResposta>({ ok: true, contas: resumo });
}
