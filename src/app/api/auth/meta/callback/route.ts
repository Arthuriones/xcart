import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COOKIE_META_STATE,
  lerEstadoMeta,
  nonceConfere,
} from "@/lib/ads/meta-oauth-state";
import {
  buscarPerfilMeta,
  obterRedirectUriMeta,
  trocarCodigoPorTokenMeta,
} from "@/lib/ads/meta-oauth";
import { listarContasMeta } from "@/lib/ads/meta-graph";
import { mensagemDoErroOAuth, renderPopupOAuth } from "@/lib/ads/popup-oauth";
import {
  validarTicketMultilogin,
  concluirTicketMultilogin,
  falharTicketMultilogin,
} from "@/lib/ads/multilogin-ticket";

export const runtime = "nodejs";

const renderPopup = (dados: Parameters<typeof renderPopupOAuth>[1]) =>
  renderPopupOAuth("meta", dados);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateQuery = searchParams.get("state");
  const erroUrl = searchParams.get("error");

  // Cancelou, ou a Meta devolveu erro. O texto da URL NAO vai para a tela: a
  // URL e publica e qualquer um monta o link -- ver popup-oauth.ts. So o
  // codigo escolhe entre duas mensagens nossas; o resto fica no log.
  if (erroUrl || !code) {
    if (erroUrl) {
      console.warn("[auth/meta/callback] autorizacao recusada", {
        error: erroUrl.slice(0, 100),
        descricao: (searchParams.get("error_description") || "").slice(0, 200),
      });
    }
    return renderPopup({ ok: false, erro: mensagemDoErroOAuth(erroUrl || "access_denied") });
  }

  const isTicket = stateQuery?.startsWith("ticket.");
  let targetUserId = "";
  let ticketId = "";

  if (isTicket) {
    const rawTicket = stateQuery!.replace("ticket.", "");
    const ticketValido = await validarTicketMultilogin(rawTicket, "meta");
    if (!ticketValido || ticketValido.status !== "pending") {
      return renderPopup({
        ok: false,
        erro: "Este link de autorização multilogin expirou ou já foi utilizado.",
      });
    }
    targetUserId = ticketValido.userId;
    ticketId = ticketValido.id;
  } else {
    // 1. Confere usuario logado no xcart
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return renderPopup({
        ok: false,
        erro: "Sua sessão expirou. Faça login no xcart novamente.",
      });
    }
    targetUserId = user.id;

    // 2. Confere state do cookie contra CSRF
    const cookieStateRaw = request.cookies.get(COOKIE_META_STATE)?.value;
    const cookieState = lerEstadoMeta(cookieStateRaw);
    const queryState = lerEstadoMeta(stateQuery || undefined);

    if (!cookieState || !queryState || !nonceConfere(cookieState.nonce, queryState.nonce)) {
      return renderPopup({
        ok: false,
        erro: "Falha de validação de segurança (state inválido ou expirado). Tente novamente.",
      });
    }
  }

  const redirectUri = obterRedirectUriMeta(request.nextUrl.origin);

  try {
    // 3. Troca code por Token Longo (60 dias)
    const tokenRes = await trocarCodigoPorTokenMeta({ code, redirectUri });
    const accessToken = tokenRes.accessToken;

    // 4. Busca dados do perfil do Facebook
    const perfil = await buscarPerfilMeta(accessToken);

    const admin = createAdminClient();
    const agoraIso = new Date().toISOString();
    const expiraIso = new Date(Date.now() + tokenRes.expiresInSegundos * 1000).toISOString();

    // 5. Salva perfil em ad_connections
    let connectionId: string | null = null;
    try {
      const { data: gravouConexao } = await admin
        .from("ad_connections")
        .upsert(
          {
            user_id: targetUserId,
            plataforma: "meta",
            external_user_id: perfil.id,
            nome: perfil.nome,
            email: perfil.email,
            foto_url: perfil.fotoUrl,
            token_expira_em: expiraIso,
            updated_at: agoraIso,
          },
          { onConflict: "user_id,plataforma,external_user_id" }
        )
        .select("id")
        .maybeSingle();

      if (gravouConexao?.id) {
        connectionId = gravouConexao.id;
        await admin.from("ad_connection_secrets").upsert(
          {
            connection_id: connectionId,
            access_token: accessToken,
            updated_at: agoraIso,
          },
          { onConflict: "connection_id" }
        );
      }
    } catch {
      // Ignora se tabela ad_connections ainda nao existir no ambiente
    }

    // 6. Descobre as contas de anuncio que o usuario tem acesso
    const contas = await listarContasMeta(accessToken);

    if (contas.length > 0) {
      const { data: contasGravadas } = await admin
        .from("ad_accounts")
        .upsert(
          contas.map((c) => ({
            user_id: targetUserId,
            plataforma: "meta",
            external_id: c.account_id,
            nome: c.nome,
            moeda: c.moeda,
            fuso: c.fuso,
            status_externo: c.status,
            fonte: "api",
            ...(connectionId ? { connection_id: connectionId } : {}),
            updated_at: agoraIso,
          })),
          { onConflict: "user_id,plataforma,external_id" }
        )
        .select("id");

      if (contasGravadas && contasGravadas.length > 0) {
        await admin.from("ad_account_secrets").upsert(
          contasGravadas.map((cg) => ({
            ad_account_id: cg.id,
            meta_access_token: accessToken,
            updated_at: agoraIso,
          })),
          { onConflict: "ad_account_id" }
        );
      }
    }

    // 7. Se for ticket, conclui o ticket no banco
    if (ticketId) {
      await concluirTicketMultilogin(ticketId, {
        ok: true,
        nome: perfil.nome,
        contas: contas.length,
      });
    }

    const response = renderPopup({
      ok: true,
      nome: perfil.nome,
      contas: contas.length,
    });

    if (!isTicket) {
      response.cookies.delete(COOKIE_META_STATE);
    }
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro interno ao processar autorização.";
    console.error("[auth/meta/callback] falha ao concluir a conexao", err);
    if (ticketId) {
      await falharTicketMultilogin(ticketId, msg);
    }
    return renderPopup({
      ok: false,
      erro: "Falha ao concluir autorização. Tente novamente.",
    });
  }
}
