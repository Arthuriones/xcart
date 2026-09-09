import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ensureUninstallWebhook, getShopInfo, getThemes } from "@/lib/shopify/client";
import { safeFetch } from "@/lib/net/safe-url";
import { assertShopDomainPublico } from "@/lib/shopify/safe-shop";
import { normalizeShopDomain } from "@/lib/shopify/domain";
import { SHOPIFY_SCOPES_STRING } from "@/lib/shopify/scopes";
import {
  COOKIE_STATE,
  lerEstado,
  nonceConfere,
  novoNonce,
  opcoesCookie,
  serializarEstado,
} from "@/lib/shopify/oauth-state";

// Mesma lista mostrada no tutorial de conexao — ver src/lib/shopify/scopes.ts.
const SCOPES = SHOPIFY_SCOPES_STRING;

// Valida a assinatura HMAC do callback de OAuth da Shopify: remove o parametro
// `hmac`, ordena o resto, refaz a query string e compara com HMAC-SHA256 do
// client secret, em tempo constante.
function verifyShopifyHmac(
  params: URLSearchParams,
  clientSecret: string
): boolean {
  const received = params.get("hmac");
  if (!received || !clientSecret) return false;

  const message = [...params.entries()]
    .filter(([key]) => key !== "hmac" && key !== "signature")
    .map(([key, value]) => [key, value] as const)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => `${key}=${value}`)
    .join("&");

  const digest = createHmac("sha256", clientSecret).update(message).digest();
  let expected: Buffer;
  try {
    expected = Buffer.from(received, "hex");
  } catch {
    return false;
  }
  if (expected.length !== digest.length) return false;
  return timingSafeEqual(digest, expected);
}

function storesUrl(request: NextRequest, query?: string): string {
  const url = new URL("/stores", request.nextUrl.origin);
  if (query) url.search = query;
  return url.toString();
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const shop = searchParams.get("shop");
  const state = searchParams.get("state");
  const storeIdParam = searchParams.get("store_id");

  // `rawSearch` saia daqui inteiro -- ou seja, `code` e `hmac` do callback
  // iam para o log da funcao. O `code` e trocavel por access token enquanto
  // nao for usado, e o `hmac` e material de assinatura. Nenhum dos dois pode
  // sair do processo. Os booleanos abaixo bastam para depurar o fluxo.
  console.log("[shopify/auth] incoming", {
    hasUser: !!user,
    hasCode: !!code,
    hasShop: !!shop,
    hasState: !!state,
    hasStoreId: !!storeIdParam,
  });

  if (!user) {
    // Retomar depois do login SEM carregar o code na URL.
    //
    // Antes o `next` levava a query inteira: o authorization code ia parar na
    // barra de endereco, no historico e no Referer da pagina de login. E um
    // code so vale para quem tambem tem o client_secret, mas ele nao tem por
    // que passear por ali -- e de qualquer forma o code ja tera expirado
    // quando o login terminar. Reinicia a instalacao pela loja, que e o
    // caminho seguro e leva ao mesmo lugar.
    const loginUrl = new URL("/login", request.nextUrl.origin);
    const normalizado = shop ? normalizeShopDomain(shop) : null;
    loginUrl.searchParams.set(
      "next",
      normalizado
        ? `/api/shopify/auth?shop=${encodeURIComponent(normalizado)}`
        : storeIdParam
          ? `/api/shopify/auth?store_id=${encodeURIComponent(storeIdParam)}`
          : "/stores"
    );
    return NextResponse.redirect(loginUrl);
  }

  // Step 1: Iniciar OAuth — pode vir como:
  // (a) ?store_id=X (clicou em Conectar no app)
  // (b) ?shop=Y (Shopify redirecionou pro app_url quando o lojista clicou Install no dev.shopify.com)
  if (!code && (storeIdParam || shop)) {
    let store: { id: string; shop_domain: string; client_id: string } | null =
      null;

    if (storeIdParam) {
      const { data } = await supabase
        .from("stores")
        .select("id, shop_domain, client_id")
        .eq("id", storeIdParam)
        .eq("user_id", user.id)
        .single();
      store = data;
    } else if (shop) {
      const normalizedShop = normalizeShopDomain(shop);
      if (!normalizedShop) {
        return NextResponse.redirect(
          storesUrl(request, "error=Dominio+invalido+no+install")
        );
      }
      const { data } = await supabase
        .from("stores")
        .select("id, shop_domain, client_id")
        .eq("shop_domain", normalizedShop)
        .eq("user_id", user.id)
        .single();
      store = data;
    }

    if (!store) {
      return NextResponse.redirect(
        storesUrl(
          request,
          "error=Cadastre+a+loja+no+app+antes+de+instalar+(preencha+dominio+e+credenciais)."
        )
      );
    }

    const redirectUri = `${request.nextUrl.origin}/api/shopify/auth`;

    // O state e um nonce aleatorio, nao o id da loja. O par nonce+storeId vai
    // num cookie HttpOnly; o callback so aceita o que casar com ele. Ver
    // src/lib/shopify/oauth-state.ts.
    const nonce = novoNonce();
    const authUrl =
      `https://${store.shop_domain}/admin/oauth/authorize?` +
      `client_id=${encodeURIComponent(store.client_id)}` +
      `&scope=${encodeURIComponent(SCOPES)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(nonce)}`;

    const resposta = NextResponse.redirect(authUrl);
    resposta.cookies.set(
      COOKIE_STATE,
      serializarEstado({ nonce, storeId: store.id }),
      opcoesCookie(request.nextUrl.protocol === "https:")
    );
    return resposta;
  }

  // Step 2: Callback do Shopify — vem com ?code=X&shop=Y&state=Z
  if (code && shop && state) {
    const normalizedShop = normalizeShopDomain(shop);
    if (!normalizedShop) {
      return NextResponse.redirect(
        storesUrl(request, "error=Dominio+invalido+no+callback")
      );
    }

    // O storeId sai do COOKIE, nunca da query.
    //
    // Aceitar `state` como identificador de loja era o que tornava o
    // parametro inutil: qualquer valor conhecido servia. Agora o cookie e a
    // unica fonte do id, e o `state` da query so serve para provar que quem
    // voltou e o mesmo navegador que comecou.
    const estado = lerEstado(request.cookies.get(COOKIE_STATE)?.value);
    if (!estado || !nonceConfere(state, estado.nonce)) {
      const recusa = NextResponse.redirect(
        storesUrl(request, "error=Sessao+de+instalacao+invalida+ou+expirada")
      );
      recusa.cookies.delete(COOKIE_STATE);
      return recusa;
    }

    const { data: store, error } = await supabase
      .from("stores")
      .select("id, shop_domain, client_id, client_secret")
      .eq("id", estado.storeId)
      .eq("user_id", user.id)
      .single();

    if (error || !store) {
      return NextResponse.redirect(
        storesUrl(request, "error=Sessao+de+instalacao+invalida")
      );
    }

    if (store.shop_domain !== normalizedShop) {
      return NextResponse.redirect(
        storesUrl(request, "error=Loja+do+callback+nao+confere")
      );
    }

    // A Shopify assina a query do callback com HMAC-SHA256 usando o client
    // secret. Sem essa verificacao qualquer um poderia chamar o endpoint com um
    // `code` arbitrario. Ver:
    // https://shopify.dev/docs/apps/auth/oauth/getting-started
    if (!verifyShopifyHmac(request.nextUrl.searchParams, store.client_secret)) {
      return NextResponse.redirect(
        storesUrl(request, "error=Assinatura+do+callback+invalida")
      );
    }

    // Step 2a: Trocar o authorization code por um access token
    // (obrigatório para completar a instalação do app na loja)
    let accessToken = "";
    try {
      // O client_secret vai no CORPO desta requisicao. Sem a trava, o host de
      // destino era o que estivesse gravado em shop_domain.
      const hostDaTroca = await assertShopDomainPublico(store.shop_domain);
      const tokenRes = await safeFetch(
        `https://${hostDaTroca}/admin/oauth/access_token`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_id: store.client_id,
            client_secret: store.client_secret,
            code,
          }),
        }
      );

      if (!tokenRes.ok) {
        const body = await tokenRes.text();
        console.error("[shopify/auth] code exchange failed", {
          status: tokenRes.status,
          body: body.slice(0, 300),
        });
        return NextResponse.redirect(
          storesUrl(
            request,
            `error=${encodeURIComponent("Falha ao trocar o codigo de autorizacao. Tente conectar novamente.")}`
          )
        );
      }

      const tokenPayload = (await tokenRes.json()) as {
        access_token?: string;
      };
      if (!tokenPayload.access_token) {
        console.error("[shopify/auth] code exchange without access_token");
        return NextResponse.redirect(
          storesUrl(
            request,
            `error=${encodeURIComponent("Shopify nao retornou token de acesso. Tente conectar novamente.")}`
          )
        );
      }

      accessToken = tokenPayload.access_token;
      await supabase
        .from("stores")
        .update({ access_token: accessToken })
        .eq("id", store.id);

      // Code exchange succeeded — app is now installed
      console.log("[shopify/auth] code exchange OK for", store.shop_domain);
    } catch (exchangeErr) {
      console.error("[shopify/auth] code exchange error", exchangeErr);
      return NextResponse.redirect(
        storesUrl(
          request,
          `error=${encodeURIComponent("Erro de rede ao trocar codigo de autorizacao.")}`
        )
      );
    }

    // Step 2b: Agora o Client Credentials Grant funciona
    const creds = {
      shopDomain: store.shop_domain,
      clientId: store.client_id,
      clientSecret: store.client_secret,
      accessToken,
    };

    try {
      // O webhook de desinstalacao e inscrito AQUI, que e o unico ponto em que
      // sabemos que o app acabou de entrar nesta loja. Sem ele, remover o app
      // nao avisa ninguem e o auto-conserto fica batendo em token morto.
      const webhook = await ensureUninstallWebhook(
        creds,
        `${request.nextUrl.origin}/api/shopify/webhooks`
      );
      if (!webhook.ok) {
        // Nao derruba a instalacao: a loja funciona sem o webhook, so perde o
        // aviso de saida. Fica no log para dar para investigar depois.
        console.warn("[shopify/auth] webhook app/uninstalled nao inscrito", {
          shopDomain: store.shop_domain,
          motivo: webhook.message,
        });
      }

      const [shopData, themesData] = await Promise.all([
        getShopInfo(creds),
        getThemes(creds),
      ]);

      const activeTheme = themesData.themes.nodes.find(
        (t: { role: string }) => t.role === "MAIN"
      );

      await supabase
        .from("stores")
        .update({
          name: shopData.shop.name,
          theme_id: activeTheme?.id || null,
        })
        .eq("id", store.id);

      // Uso unico: o cookie morre aqui, entao repetir o callback com o mesmo
      // state nao passa de novo.
      const pronto = NextResponse.redirect(storesUrl(request, "installed=1"));
      pronto.cookies.delete(COOKIE_STATE);
      return pronto;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Erro pos-instalacao";
      const falhou = NextResponse.redirect(
        storesUrl(request, `error=${encodeURIComponent(message.slice(0, 200))}`)
      );
      falhou.cookies.delete(COOKIE_STATE);
      return falhou;
    }
  }

  // Diagnostico mais util do que "Parametros invalidos"
  const missing: string[] = [];
  if (!code && !storeIdParam) missing.push("code/store_id");
  if (code && !shop) missing.push("shop");
  if (code && !state) missing.push("state");

  const errorMsg =
    missing.length > 0
      ? `Callback do Shopify sem parametros: ${missing.join(", ")}. Verifique se a URL de redirecionamento no dev.shopify.com termina exatamente em /api/shopify/auth.`
      : "Parametros invalidos no OAuth";

  return NextResponse.redirect(
    storesUrl(request, `error=${encodeURIComponent(errorMsg)}`)
  );
}
