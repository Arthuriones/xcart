import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  formatarCustomerId,
  hashSegredo,
  linhasDoIngest,
  normalizarCustomerId,
  segredoDoAuthorization,
  validarIngest,
} from "@/lib/ads/google-ingest";

export const runtime = "nodejs";
export const maxDuration = 60;

// ============================================================================
// Recebe o gasto que o Google Ads Script manda de cada conta.
//
// ROTA PUBLICA, MAS AUTENTICADA POR CONTA
//
// Quem chama e o servidor do Google, sem sessao. E o corpo traz VALOR
// MONETARIO que vai direto para o lucro -- o mesmo motivo pelo qual
// /api/tracking/collect nao aceita valor nenhum. Aqui o valor e o ponto, entao
// a porta e um segredo POR CONTA: so o sha256 fica no banco, o customer_id do
// corpo tem que bater com a conta dona do segredo, e dado mais velho que o
// ultimo recebido e recusado (replay de um envio antigo nao reescreve o gasto).
//
// A autenticacao vem ANTES da validacao do corpo: requisicao sem segredo nao
// gasta parse de 5 MB, e erro de validacao de quem e dono fica gravado na
// conta (ultimo_erro), que e onde a tela mostra.
// ============================================================================

const MAX_CORPO = 5_000_000;
const LOTE = 500;

function resposta(status: number, corpo: Record<string, unknown>) {
  return NextResponse.json(corpo, { status, headers: { "Cache-Control": "no-store" } });
}

const NAO_AUTORIZADO = () => resposta(401, { ok: false, erro: "nao autorizado" });

export async function POST(request: NextRequest) {
  const segredo = segredoDoAuthorization(request.headers.get("authorization"));
  if (!segredo) return NAO_AUTORIZADO();

  const tamanhoDeclarado = Number(request.headers.get("content-length") || 0);
  if (tamanhoDeclarado > MAX_CORPO) {
    return resposta(413, { ok: false, erro: "corpo grande demais" });
  }

  const admin = createAdminClient();

  const { data: sec, error: erroSec } = await admin
    .from("ad_account_secrets")
    .select("ad_account_id")
    .eq("ingest_token_hash", hashSegredo(segredo))
    .maybeSingle();
  if (erroSec) return resposta(500, { ok: false, erro: "falha ao conferir o segredo" });
  if (!sec) return NAO_AUTORIZADO();

  const { data: conta, error: erroConta } = await admin
    .from("ad_accounts")
    .select("id, user_id, plataforma, external_id, ativo, ultimo_dado_gerado_em")
    .eq("id", sec.ad_account_id)
    .maybeSingle();
  if (erroConta) return resposta(500, { ok: false, erro: "falha ao ler a conta" });
  if (!conta || conta.plataforma !== "google") return NAO_AUTORIZADO();

  const agora = new Date();

  /** Erro de quem TEM o segredo: grava na conta para a tela mostrar. */
  const recusar = async (status: number, erro: string) => {
    await admin
      .from("ad_accounts")
      .update({
        ultimo_sync_em: agora.toISOString(),
        ultimo_erro: `Script: ${erro}`.slice(0, 500),
        updated_at: agora.toISOString(),
      })
      .eq("id", conta.id);
    return resposta(status, { ok: false, erro });
  };

  const raw = await request.text();
  if (raw.length > MAX_CORPO) return recusar(413, "corpo grande demais");

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return recusar(400, "corpo nao e JSON");
  }

  const validacao = validarIngest(json, agora);
  if (!validacao.ok) return recusar(400, validacao.erro);
  const corpo = validacao.corpo;

  if (!conta.ativo) return resposta(200, { ok: true, ignorado: true });

  if (normalizarCustomerId(corpo.customer_id) !== conta.external_id) {
    return recusar(
      409,
      `Script colado na conta errada: este segredo e da conta ${formatarCustomerId(
        String(conta.external_id)
      )}.`
    );
  }

  // Dois envios fora de ordem (agendado + Visualizar, por exemplo): o mais
  // velho nao pode sobrescrever o mais novo. Nao vira ultimo_erro: e corrida
  // benigna, o proximo envio de hora em hora resolve.
  if (
    conta.ultimo_dado_gerado_em &&
    Date.parse(corpo.gerado_em) < Date.parse(String(conta.ultimo_dado_gerado_em))
  ) {
    return resposta(409, { ok: false, erro: "dado mais velho que o ultimo recebido" });
  }

  const runTs = new Date().toISOString();
  const linhas = linhasDoIngest(corpo, {
    ad_account_id: String(conta.id),
    user_id: String(conta.user_id),
    sincronizado_em: runTs,
  });

  for (let i = 0; i < linhas.length; i += LOTE) {
    const { error } = await admin
      .from("ad_spend_daily")
      .upsert(linhas.slice(i, i + LOTE), { onConflict: "ad_account_id,data,nivel,campanha_id" });
    if (error) return recusar(500, `falha ao gravar o gasto: ${error.message}`);
  }

  // Campanha que sumiu da janela (apagada, ou custo estornado a zero) nao
  // volta do Google: o que nao foi regravado agora e velho e sai.
  const { error: erroLimpeza } = await admin
    .from("ad_spend_daily")
    .delete()
    .eq("ad_account_id", conta.id)
    .gte("data", corpo.inicio)
    .lte("data", corpo.fim)
    .lt("sincronizado_em", runTs);
  if (erroLimpeza) return recusar(500, `falha ao limpar o gasto antigo: ${erroLimpeza.message}`);

  const fimTs = new Date().toISOString();
  const { error: erroUpdate } = await admin
    .from("ad_accounts")
    .update({
      moeda: corpo.moeda,
      fuso: corpo.fuso,
      ultimo_sync_em: fimTs,
      ultimo_sync_ok_em: fimTs,
      ultimo_dado_gerado_em: corpo.gerado_em,
      ultimo_erro: null,
      updated_at: fimTs,
    })
    .eq("id", conta.id);
  if (erroUpdate) return resposta(500, { ok: false, erro: "gasto gravado, conta nao atualizada" });

  return resposta(200, { ok: true, linhas: linhas.length });
}
