import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { APP_HOME } from "@/lib/app-home";
import { caminhoInternoSeguro } from "@/lib/net/url-guard";

const PUBLIC_PATHS = [
  "/api/health",
  "/api/checkout-routes/resolve",
  "/api/jobs/bulk-import/process",
  "/routed-checkout-loader.js",
  "/privacy",
  "/terms",
  "/data-deletion",
  "/user-data-deletion",
];

// Liga o Supabase ao par request/response sem recriar a response, para os
// cookies de sessao serem atualizados em cima dela.
//
// A sessao aqui e conferida por getClaims(), nao getUser(): o projeto assina o
// token com chave assimetrica (ES256), e o getClaims confere a assinatura aqui
// mesmo, com a chave publica em cache -- sem a ida ao servidor de login que o
// getUser fazia em TODA navegacao de pagina. Ele renova o cookie vencido do
// mesmo jeito. Quem decide acesso a dado continua sendo o layout (getUser, em
// current-user.ts) e o RLS; o proxy so escolhe para onde redirecionar.
//
// Prazo de 5 s para buscar a chave publica, 15 s para renovar o token
// (comPrazoDoSupabase): o proxy roda antes da pagina, e pendurado nem o
// esqueleto aparece. O auth-js ainda repete a renovacao dentro da janela dele
// de 30 s -- o prazo tira a espera sem fim, nao essa.
function attachSupabase(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: comPrazoDoSupabase(5_000) },
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );
}

/**
 * fetch com prazo para o cliente do Supabase (proxy aqui, sessao em server.ts).
 * Sem ele, Auth ou PostgREST que aceita a conexao e nao responde segura a
 * requisicao ate a Vercel matar a funcao.
 *
 * AbortController com abort() SEM motivo, de proposito: da AbortError, que o
 * postgrest-js nao repete (o auth-js vira AuthRetryableFetchError). Com
 * AbortSignal.timeout() o erro seria TimeoutError, e o postgrest-js repetiria o
 * GET 3 vezes. O signal de quem chamou (.abortSignal() da consulta) continua
 * valendo, com o motivo dele.
 *
 * fetch direto, sem safeFetch (tests/sem-fetch-cru.test.ts): quem monta a URL
 * e o supabase-js, sempre no projeto de NEXT_PUBLIC_SUPABASE_URL -- nunca
 * endereco vindo do usuario. safeFetch resolveria o DNS em toda ida ao banco.
 */
export function comPrazo(ms: number): typeof fetch {
  return async (entrada, init) => {
    const controle = new AbortController();
    const prazo = setTimeout(() => controle.abort(), ms);
    const deQuemChamou = init?.signal;
    const repassar = () => controle.abort(deQuemChamou?.reason);
    if (deQuemChamou?.aborted) repassar();
    else deQuemChamou?.addEventListener("abort", repassar, { once: true });
    try {
      return await globalThis.fetch(entrada, { ...init, signal: controle.signal });
    } finally {
      clearTimeout(prazo);
      deQuemChamou?.removeEventListener("abort", repassar);
    }
  };
}

/** Prazo minimo da renovacao do token (POST /auth/v1/token). */
const PRAZO_DA_RENOVACAO_MS = 15_000;

/**
 * comPrazo(ms) com prazo proprio, maior, na renovacao do token.
 *
 * O auth-js repete o POST /auth/v1/token com o MESMO refresh token, e a
 * tentativa que o prazo cortou pode terminar a troca no servidor mesmo assim.
 * A repeticao que chega mais de 10 s depois da troca (a janela de reuso do
 * login) recebe refresh_token_already_used, e o login revoga a sessao
 * inteira: o lojista sai de verdade, e sem o aviso de instavel (400 nao e
 * retentavel). Com o login lento -- respondendo em 6 s, digamos -- o corte em
 * 5 s fazia exatamente isso; esperar a primeira tentativa nao. Chave publica,
 * usuario e banco seguem com o prazo de quem chamou.
 */
export function comPrazoDoSupabase(ms: number): typeof fetch {
  const geral = comPrazo(ms);
  const renovacao = comPrazo(Math.max(ms, PRAZO_DA_RENOVACAO_MS));
  return (entrada, init) => {
    const url =
      typeof entrada === "string" ? entrada : entrada instanceof URL ? entrada.href : entrada.url;
    return (url.includes("/auth/v1/token") ? renovacao : geral)(entrada, init);
  };
}

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
}

/**
 * Para onde vai quem ja entrou e abriu o /login: o ?next= (so caminho interno,
 * a mesma regra do /login), senao a home. Antes ia sempre para a home, e quem
 * caiu no login com o cookie ainda valido perdia a tela que tinha aberto.
 *
 * - A origem e conferida depois de resolver: caminhoInternoSeguro normaliza os
 *   pontos, e "/.//evil.com" (ou "/a/..//evil.com") sai dela "//evil.com", que
 *   o new URL leva para outro site.
 * - /api nunca: o proxy nao confere sessao la, e a rota decide pelo getUser,
 *   que discorda do getClaims com a sessao revogada em outro aparelho (o token
 *   vale ate 1 h) ou com o login fora do ar. /api/shopify/auth manda ao
 *   /login?next=/api/shopify/auth..., e o laco nao fechava.
 */
function destinoDeQuemJaEntrou(request: NextRequest): URL {
  const home = new URL(APP_HOME, request.url);
  const next = caminhoInternoSeguro(request.nextUrl.searchParams.get("next"));
  if (!next) return home;
  const alvo = new URL(next, request.url);
  if (alvo.origin !== home.origin) return home;
  if (["/login", "/callback", "/api"].some((p) => alvo.pathname.startsWith(p))) return home;
  return alvo;
}

export async function updateSession(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("host") || "";
  const isLocal =
    host.includes("localhost") ||
    host.includes("127.0.0.1") ||
    host.endsWith(".vercel.app");
  const isAdminHost = host.startsWith("adm.");
  const isAppHost = host.startsWith("user.");
  const isMarketingHost = !isLocal && !isAdminHost && !isAppHost;
  const appOrigin =
    process.env.NEXT_PUBLIC_APP_URL ||
    `https://user.${host.replace(/^www\./, "")}`;
  const isApi = pathname.startsWith("/api");

  // Link antigo com idioma na URL (/pt/lojas, /en/stores, /ja/...) vira o
  // endereco sem prefixo. O xcart e so em portugues agora, mas anuncio,
  // favorito e e-mail antigo ainda apontam para la.
  const idiomaAntigo = pathname.match(/^\/(pt|en|ja)(\/.*)?$/);
  if (idiomaAntigo) {
    const url = request.nextUrl.clone();
    url.pathname = idiomaAntigo[2] || "/";
    return NextResponse.redirect(url);
  }

  // Arquivos estaticos (loaders .js, .html publicos, etc.) servem crus, sem
  // passar por auth (ex.: /routed-checkout-loader.js).
  if (!isApi && /\.[a-zA-Z0-9]+$/.test(pathname)) {
    return NextResponse.next({ request });
  }

  // ===== HOST COMERCIAL (landing publica) =====
  if (isMarketingHost) {
    if (isApi) return NextResponse.next({ request });
    // A raiz E a landing: servida de /lp, que e estatica e sai do cache da
    // borda. A page.tsx da raiz le headers() para separar landing de app, e
    // por isso renderizava a landing inteira a cada visita, longe do Brasil
    // (medido em 27/10: xcart.app/ 0,5 s no TTFB; xcart.app/lp 0,13 s).
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/lp";
      return NextResponse.rewrite(url);
    }
    const marketingBare = [
      "/",
      "/lp",
      "/privacy",
      "/terms",
      "/data-deletion",
      "/user-data-deletion",
    ];
    const isMarketingPath =
      marketingBare.some((p) => pathname === p || pathname.startsWith(p + "/")) ||
      pathname.startsWith("/routed-checkout-loader.js");
    if (!isMarketingPath) {
      return NextResponse.redirect(
        new URL(pathname + request.nextUrl.search, appOrigin)
      );
    }
    return NextResponse.next({ request });
  }

  // ===== HOST ADMIN =====
  if (isAdminHost) {
    const response = NextResponse.next({ request });
    const supabase = attachSupabase(request, response);
    const { data } = await supabase.auth.getClaims();
    const user = data?.claims ?? null;
    if (
      !user &&
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/callback") &&
      !isPublic(pathname)
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (
      user &&
      !pathname.startsWith("/admin") &&
      !isApi &&
      !pathname.startsWith("/login") &&
      !pathname.startsWith("/callback") &&
      !pathname.startsWith("/set-password")
    ) {
      const url = request.nextUrl.clone();
      url.pathname = "/admin";
      return NextResponse.redirect(url);
    }
    return response;
  }

  // ===== HOST DO APP (ou local) =====
  // /admin so existe no subdominio adm.; no app manda pra home (roteamento).
  if (!isLocal && pathname.startsWith("/admin")) {
    const url = request.nextUrl.clone();
    url.pathname = APP_HOME;
    return NextResponse.redirect(url);
  }

  // A rota de API autentica sozinha e devolve 401 -- este getUser() so servia
  // para renovar o cookie, e custava uma ida a rede em TODA chamada de API.
  // O app faz varias por tela, entao era o gasto mais repetido do sistema.
  // A renovacao continua acontecendo na navegacao de pagina, que passa pelo
  // ramo de baixo.
  if (isApi) {
    return NextResponse.next({ request });
  }

  if (pathname.startsWith("/admin")) {
    const response = NextResponse.next({ request });
    const supabase = attachSupabase(request, response);
    await supabase.auth.getClaims();
    return response;
  }

  // ===== Paginas do app: auth =====
  // O /login que este proxy abriu porque o login do Supabase nao respondeu
  // (instavel=1, abaixo) nao confere a sessao de novo: seriam mais ~30 s
  // tentando renovar o token antes de desenhar a tela que avisa da pane.
  if (pathname.startsWith("/login") && request.nextUrl.searchParams.get("instavel") === "1") {
    return NextResponse.next({ request });
  }

  const response = NextResponse.next({ request });
  const supabase = attachSupabase(request, response);
  const { data, error } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const isAuthPath =
    pathname.startsWith("/login") || pathname.startsWith("/callback");

  if (!user && !isAuthPath && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    const intendedPath = `${pathname}${request.nextUrl.search}`;
    url.pathname = "/login";
    url.search = "";
    // Guarda o destino para o login devolver o usuario ao lugar certo depois de
    // entrar (ex.: link direto para /products ou instalacao da Shopify).
    url.searchParams.set("next", intendedPath);
    // Rede, 5xx ou prazo estourado ao renovar o token ou buscar a chave: o
    // login esta fora do ar, nao a sessao ausente (o auth-js nem apaga o
    // cookie). O /login avisa em vez de pedir a senha como se a pessoa tivesse
    // saido. Nao deixa passar: a pagina repetiria a mesma renovacao.
    if (isAuthRetryableFetchError(error)) url.searchParams.set("instavel", "1");
    return NextResponse.redirect(url);
  }

  if (user) {
    // Do token: so muda quando ele e renovado -- por isso o formulario de senha
    // renova a sessao depois de salvar (formulario-senha.tsx).
    const hasPassword = user.user_metadata?.has_password === true;
    const isSetPassword = pathname.startsWith("/set-password");
    if (!hasPassword && !isSetPassword && !isAuthPath) {
      const url = request.nextUrl.clone();
      url.pathname = "/set-password";
      return NextResponse.redirect(url);
    }
    if (isAuthPath && !isSetPassword) {
      return NextResponse.redirect(destinoDeQuemJaEntrou(request));
    }
  }

  return response;
}
