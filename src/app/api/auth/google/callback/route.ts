import { NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  COOKIE_GOOGLE_STATE,
  lerEstadoGoogle,
  nonceGoogleConfere,
} from "@/lib/ads/google-oauth-state";
import {
  buscarPerfilGoogle,
  listarContasGoogleAds,
  obterRedirectUriGoogle,
  trocarCodigoPorTokenGoogle,
} from "@/lib/ads/google-oauth";
import { mensagemDoErroOAuth, renderPopupOAuth } from "@/lib/ads/popup-oauth";

export const runtime = "nodejs";

const renderPopup = (dados: Parameters<typeof renderPopupOAuth>[1]) =>
  renderPopupOAuth("google", dados);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateQuery = searchParams.get("state");
  const erroUrl = searchParams.get("error");

  // Cancelou, ou o Google devolveu erro. O texto da URL NAO vai para a tela: a
  // URL e publica e qualquer um monta o link -- ver popup-oauth.ts. So o
  // codigo escolhe entre duas mensagens nossas; o resto fica no log.
  if (erroUrl || !code) {
    if (erroUrl) {
      console.warn("[auth/google/callback] autorizacao recusada", {
        error: erroUrl.slice(0, 100),
        descricao: (searchParams.get("error_description") || "").slice(0, 200),
      });
    }
    return renderPopup({ ok: false, erro: mensagemDoErroOAuth(erroUrl || "access_denied") });
  }

  // 1. Confere usuario autenticado no xcart
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

  // 2. Confere state contra CSRF
  const cookieStateRaw = request.cookies.get(COOKIE_GOOGLE_STATE)?.value;
  const cookieState = lerEstadoGoogle(cookieStateRaw);
  const queryState = lerEstadoGoogle(stateQuery || undefined);

  if (!cookieState || !queryState || !nonceGoogleConfere(cookieState.nonce, queryState.nonce)) {
    return renderPopup({
      ok: false,
      erro: "Falha de segurança: state inválido ou expirado. Tente novamente.",
    });
  }

  const redirectUri = obterRedirectUriGoogle(request.nextUrl.origin);

  try {
    // 3. Troca code pelos tokens do Google (access_token + refresh_token)
    const tokenRes = await trocarCodigoPorTokenGoogle({ code, redirectUri });
    const accessToken = tokenRes.accessToken;
    const refreshToken = tokenRes.refreshToken;

    // 4. Busca dados do perfil do Google
    const perfil = await buscarPerfilGoogle(accessToken);

    const admin = createAdminClient();
    const agoraIso = new Date().toISOString();

    // 5. Salva perfil em ad_connections
    let connectionId: string | null = null;
    try {
      const { data: gravouConexao } = await admin
        .from("ad_connections")
        .upsert(
          {
            user_id: user.id,
            plataforma: "google",
            external_user_id: perfil.id,
            nome: perfil.nome,
            email: perfil.email,
            foto_url: perfil.fotoUrl,
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
            ...(refreshToken ? { refresh_token: refreshToken } : {}),
            updated_at: agoraIso,
          },
          { onConflict: "connection_id" }
        );
      }
    } catch {
      // Ignora erro caso tabela nao exista
    }

    // 6. Tenta listar contas do Google Ads vinculadas
    const contasDescobertas = await listarContasGoogleAds(accessToken);

    if (contasDescobertas.length > 0) {
      await admin.from("ad_accounts").upsert(
        contasDescobertas.map((c) => ({
          user_id: user.id,
          plataforma: "google",
          external_id: c.customerId,
          nome: c.nome || `Conta Google Ads (${c.customerId})`,
          fonte: "api",
          ...(connectionId ? { connection_id: connectionId } : {}),
          updated_at: agoraIso,
        })),
        { onConflict: "user_id,plataforma,external_id" }
      );
    }

    const response = renderPopup({
      ok: true,
      nome: perfil.nome,
      contas: contasDescobertas.length,
    });

    response.cookies.delete(COOKIE_GOOGLE_STATE);
    return response;
  } catch (err: unknown) {
    // A mensagem da excecao pode trazer texto da resposta do Google: fica no
    // log, e a tela recebe a nossa.
    console.error("[auth/google/callback] falha ao concluir a conexao", err);
    return renderPopup({ ok: false });
  }
}
