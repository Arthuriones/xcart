import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ErroGraph, listarContasMeta } from "@/lib/ads/meta-graph";
import { classificarErroMeta } from "@/lib/ads/meta-mapear";

// ============================================================================
// "Buscar contas novas": a conta de anuncio criada DEPOIS de conectar o perfil
// do Facebook. O callback do OAuth so lista as contas na hora do login; o
// token de 60 dias ja enxerga a conta nova, mas ninguem perguntava de novo.
//
// So ACRESCENTA: conta que o usuario ja tem nao muda (loja, ativo, nome e o
// token dela ficam), e o token da conexao so vai para a conta que esta sem
// segredo. O token nunca vai para log nem para a resposta.
//
// Nao roda sozinho de proposito: conta removida do xcart que o perfil ainda
// enxerga volta aqui -- e o lojista e quem pede.
// ============================================================================

/** Teto de tempo da busca inteira: o resto dos perfis fica para o proximo clique. */
const ORCAMENTO_MS = 45_000;

export interface ResultadoContasNovas {
  /** Contas que entraram agora. */
  novas: number;
  /** Uma frase por perfil que falhou, para a tela. */
  erros: string[];
}

function frasePorErro(perfil: string, e: unknown): string {
  if (e instanceof ErroGraph) {
    switch (classificarErroMeta(e.codigo)) {
      case "token":
        return `${perfil}: o login do Facebook venceu ou foi revogado. Conecte o perfil de novo.`;
      case "permissao":
        return `${perfil}: sem a permissão de leitura de anúncios (ads_read). Conecte o perfil de novo e aceite a permissão.`;
      case "limite":
        return `${perfil}: o Meta pediu uma pausa (limite de chamadas). Tente de novo em alguns minutos.`;
    }
  }
  return `${perfil}: não deu para falar com o Meta agora. Tente de novo em alguns minutos.`;
}

export async function buscarContasNovasMeta(
  admin: SupabaseClient,
  userId: string,
  agora: Date = new Date()
): Promise<ResultadoContasNovas> {
  const resultado: ResultadoContasNovas = { novas: 0, erros: [] };
  const inicio = Date.now();
  const agoraIso = agora.toISOString();

  const { data: conexoes, error: erroConexoes } = await admin
    .from("ad_connections")
    .select("id, nome")
    .eq("user_id", userId)
    .eq("plataforma", "meta")
    .order("created_at", { ascending: true });
  if (erroConexoes) throw new Error("falha ao ler os perfis conectados");

  for (const conexao of (conexoes ?? []) as { id: string; nome: string | null }[]) {
    const perfil = conexao.nome || "Perfil do Facebook";
    if (Date.now() - inicio > ORCAMENTO_MS) {
      resultado.erros.push(`${perfil}: faltou tempo nesta busca. Clique de novo.`);
      continue;
    }

    const { data: segredo, error: erroSegredo } = await admin
      .from("ad_connection_secrets")
      .select("access_token")
      .eq("connection_id", conexao.id)
      .maybeSingle();
    const token = (segredo?.access_token as string | null | undefined) ?? "";
    if (erroSegredo) {
      resultado.erros.push(`${perfil}: não deu para ler o login salvo. Tente de novo.`);
      continue;
    }
    if (!token) {
      resultado.erros.push(`${perfil}: o login do Facebook não ficou salvo. Conecte o perfil de novo.`);
      continue;
    }

    let contas;
    try {
      contas = await listarContasMeta(token);
    } catch (e) {
      resultado.erros.push(frasePorErro(perfil, e));
      continue;
    }
    if (contas.length === 0) continue;

    // ON CONFLICT DO NOTHING: so a conta nova volta no select (e conta como nova).
    const { data: gravadas, error: erroContas } = await admin
      .from("ad_accounts")
      .upsert(
        contas.map((c) => ({
          user_id: userId,
          plataforma: "meta",
          external_id: c.account_id,
          nome: c.nome,
          moeda: c.moeda,
          fuso: c.fuso,
          status_externo: c.status,
          fonte: "api",
          connection_id: conexao.id,
          updated_at: agoraIso,
        })),
        { onConflict: "user_id,plataforma,external_id", ignoreDuplicates: true }
      )
      .select("id");
    if (erroContas) {
      resultado.erros.push(`${perfil}: não deu para salvar as contas. Tente de novo.`);
      continue;
    }
    resultado.novas += gravadas?.length ?? 0;

    // O token da conexao vai para toda conta DELA que esta sem segredo -- a que
    // entrou agora e a que entrou sem ele numa busca que caiu no meio. Conta com
    // token (este ou um colado a mao) nao muda.
    const { data: daConexao, error: erroDaConexao } = await admin
      .from("ad_accounts")
      .select("id")
      .eq("user_id", userId)
      .eq("plataforma", "meta")
      .eq("connection_id", conexao.id)
      .in(
        "external_id",
        contas.map((c) => c.account_id)
      );
    const ids = ((daConexao ?? []) as { id: string }[]).map((c) => c.id);
    if (erroDaConexao) {
      resultado.erros.push(`${perfil}: as contas entraram, mas o login não foi gravado nelas. Clique de novo.`);
      continue;
    }
    if (ids.length === 0) continue;
    const { error: erroTokens } = await admin.from("ad_account_secrets").upsert(
      ids.map((id) => ({ ad_account_id: id, meta_access_token: token, updated_at: agoraIso })),
      { onConflict: "ad_account_id", ignoreDuplicates: true }
    );
    if (erroTokens) {
      resultado.erros.push(`${perfil}: as contas entraram, mas o login não foi gravado nelas. Clique de novo.`);
    }
  }

  return resultado;
}
