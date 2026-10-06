import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";

function renderPopupRespostaGoogle({
  ok,
  nome,
  contas,
  erro,
}: {
  ok: boolean;
  nome?: string;
  contas?: number;
  erro?: string;
}) {
  const dados = { ok, nome: nome || null, contas: contas ?? 0, erro: erro || null };
  const jsonStr = JSON.stringify(dados);

  const html = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>${ok ? "Conectado com sucesso" : "Falha na conexão"}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body {
      font-family: system-ui, -apple-system, sans-serif;
      background: #0f1115;
      color: #f1f3f5;
      display: grid;
      place-items: center;
      height: 100vh;
      margin: 0;
      text-align: center;
      padding: 20px;
      box-sizing: border-box;
    }
    .box {
      background: #181b21;
      border: 1px solid #282d37;
      border-radius: 12px;
      padding: 32px 24px;
      max-width: 380px;
      width: 100%;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .icon {
      font-size: 36px;
      margin-bottom: 12px;
    }
    h2 {
      font-size: 18px;
      margin: 0 0 8px;
      font-weight: 600;
      color: ${ok ? "#34d399" : "#f87171"};
    }
    p {
      font-size: 14px;
      color: #9ca3af;
      margin: 0 0 16px;
      line-height: 1.5;
    }
    .aviso {
      font-size: 12px;
      color: #6b7280;
    }
  </style>
</head>
<body>
  <div class="box">
    <div class="icon">${ok ? "✓" : "⚠"}</div>
    <h2>${ok ? (nome ? `Olá, ${nome}!` : "Conta Google Conectada!") : "Falha na autorização"}</h2>
    <p>${
      ok
        ? `Sua conta do Google Ads foi vinculada com sucesso.${contas ? ` Encontramos ${contas} conta(s) vinculada(s).` : ""}`
        : erro || "Ocorreu um erro ao autorizar com o Google."
    }</p>
    <div class="aviso">Fechando esta janela em instantes...</div>
  </div>
  <script>
    (function() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'XCART_GOOGLE_CONNECTED', ...${jsonStr} }, window.location.origin);
          setTimeout(function() { window.close(); }, 900);
          return;
        }
      } catch (e) {}
      setTimeout(function() {
        window.location.href = '/integracoes/google';
      }, 1500);
    })();
  </script>
</body>
</html>`;

  return new NextResponse(html, {
    status: ok ? 200 : 400,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const stateQuery = searchParams.get("state");
  const erroUrl = searchParams.get("error_description") || searchParams.get("error");

  if (erroUrl || !code) {
    return renderPopupRespostaGoogle({
      ok: false,
      erro: erroUrl || "Você cancelou a autorização do Google.",
    });
  }

  // 1. Confere usuario autenticado no xcart
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return renderPopupRespostaGoogle({
      ok: false,
      erro: "Sua sessão expirou. Faça login no xcart novamente.",
    });
  }

  // 2. Confere state contra CSRF
  const cookieStateRaw = request.cookies.get(COOKIE_GOOGLE_STATE)?.value;
  const cookieState = lerEstadoGoogle(cookieStateRaw);
  const queryState = lerEstadoGoogle(stateQuery || undefined);

  if (!cookieState || !queryState || !nonceGoogleConfere(cookieState.nonce, queryState.nonce)) {
    return renderPopupRespostaGoogle({
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

    const response = renderPopupRespostaGoogle({
      ok: true,
      nome: perfil.nome,
      contas: contasDescobertas.length,
    });

    response.cookies.delete(COOKIE_GOOGLE_STATE);
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro ao processar autorização do Google.";
    return renderPopupRespostaGoogle({
      ok: false,
      erro: msg,
    });
  }
}
