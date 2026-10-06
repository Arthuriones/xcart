import { NextRequest, NextResponse } from "next/server";
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

export const runtime = "nodejs";

function renderPopupResposta({
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
    <h2>${ok ? (nome ? `Olá, ${nome}!` : "Perfil Conectado!") : "Falha na autorização"}</h2>
    <p>${
      ok
        ? `Sua conta do Meta Ads foi vinculada com sucesso.${contas ? ` Encontramos ${contas} conta(s) de anúncio.` : ""}`
        : erro || "Ocorreu um erro ao autorizar a conta no Facebook."
    }</p>
    <div class="aviso">Fechando esta janela em instantes...</div>
  </div>
  <script>
    (function() {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({ type: 'XCART_META_CONNECTED', ...${jsonStr} }, window.location.origin);
          setTimeout(function() { window.close(); }, 900);
          return;
        }
      } catch (e) {}
      setTimeout(function() {
        window.location.href = '/integracoes/meta';
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

  // Se o usuario cancelou ou a Meta retornou erro
  if (erroUrl || !code) {
    return renderPopupResposta({
      ok: false,
      erro: erroUrl || "Você cancelou a autorização do Facebook.",
    });
  }

  // 1. Confere usuario logado no xcart
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return renderPopupResposta({
      ok: false,
      erro: "Sua sessão expirou. Faça login no xcart novamente.",
    });
  }

  // 2. Confere state do cookie contra CSRF
  const cookieStateRaw = request.cookies.get(COOKIE_META_STATE)?.value;
  const cookieState = lerEstadoMeta(cookieStateRaw);
  const queryState = lerEstadoMeta(stateQuery || undefined);

  if (!cookieState || !queryState || !nonceConfere(cookieState.nonce, queryState.nonce)) {
    return renderPopupResposta({
      ok: false,
      erro: "Falha de validação de segurança (state inválido ou expirado). Tente novamente.",
    });
  }

  // Limpa o cookie de state
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

    // 5. Salva perfil em ad_connections (se a tabela existir)
    let connectionId: string | null = null;
    try {
      const { data: gravouConexao } = await admin
        .from("ad_connections")
        .upsert(
          {
            user_id: user.id,
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
      // Salva as contas em ad_accounts
      const { data: contasGravadas } = await admin
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
            ...(connectionId ? { connection_id: connectionId } : {}),
            updated_at: agoraIso,
          })),
          { onConflict: "user_id,plataforma,external_id" }
        )
        .select("id");

      // Salva o token de acesso de cada conta em ad_account_secrets
      // Isso alimenta o cron de sync existente sem quebrar nada!
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

    const response = renderPopupResposta({
      ok: true,
      nome: perfil.nome,
      contas: contas.length,
    });

    // Remove o cookie do state
    response.cookies.delete(COOKIE_META_STATE);
    return response;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Erro interno ao processar autorização.";
    return renderPopupResposta({
      ok: false,
      erro: msg,
    });
  }
}
