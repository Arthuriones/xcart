import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { APP_HOME } from "@/lib/app-home";

const PUBLIC_PATHS = [
  "/api/health",
  "/api/checkout-routes/resolve",
  "/api/jobs/bulk-import/process",
  "/routed-checkout-loader.js",
];

// Liga o Supabase ao par request/response sem recriar a response, para os
// cookies de sessao serem atualizados em cima dela.
function attachSupabase(request: NextRequest, response: NextResponse) {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
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

function isPublic(pathname: string) {
  return PUBLIC_PATHS.some((p) => pathname.startsWith(p));
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
    const {
      data: { user },
    } = await supabase.auth.getUser();
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
    await supabase.auth.getUser();
    return response;
  }

  // ===== Paginas do app: auth =====
  const response = NextResponse.next({ request });
  const supabase = attachSupabase(request, response);
  const {
    data: { user },
  } = await supabase.auth.getUser();

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
    return NextResponse.redirect(url);
  }

  if (user) {
    const hasPassword = user.user_metadata?.has_password === true;
    const isSetPassword = pathname.startsWith("/set-password");
    if (!hasPassword && !isSetPassword && !isAuthPath) {
      const url = request.nextUrl.clone();
      url.pathname = "/set-password";
      return NextResponse.redirect(url);
    }
    if (isAuthPath && !isSetPassword) {
      const url = request.nextUrl.clone();
      url.pathname = APP_HOME;
      return NextResponse.redirect(url);
    }
  }

  return response;
}
