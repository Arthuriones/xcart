import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";
import { comPrazo, updateSession } from "../src/lib/supabase/middleware";
import LoginPage from "@/app/(auth)/login/page";

// A sessao que o Supabase "devolve" em cada teste. O proxy so pode ler o token
// (getClaims): getUser e uma ida ao servidor de login em toda navegacao.
const sessao = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  erro: null as unknown,
  getUser: 0,
  getClaims: 0,
  // As opcoes do ultimo cliente criado: o fetch com prazo vai em global.fetch.
  opcoes: null as { global?: { fetch?: typeof fetch } } | null,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_url: string, _chave: string, opcoes: { global?: { fetch?: typeof fetch } }) => {
    sessao.opcoes = opcoes;
    return {
      auth: {
        getClaims: async () => {
          sessao.getClaims++;
          return { data: sessao.claims ? { claims: sessao.claims } : null, error: sessao.erro };
        },
        getUser: async () => {
          sessao.getUser++;
          return { data: { user: null }, error: null };
        },
      },
    };
  },
}));

// O /login (page.tsx), para conferir o destino do "Tentar de novo" e do
// formulario: a pagina sem o resto da tela.
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ host: "user.xcart.app" }),
}));
vi.mock("@/app/(auth)/login/formulario-acesso", () => ({ FormularioAcesso: () => null }));
vi.mock("@/components/ui/callout", () => ({ Callout: () => null }));
vi.mock("@/components/ui/button", () => ({ buttonVariants: () => "" }));

beforeEach(() => {
  sessao.claims = null;
  sessao.erro = null;
  sessao.getUser = 0;
  sessao.getClaims = 0;
  sessao.opcoes = null;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ============================================================================
// A raiz do host comercial e a landing, servida de /lp (estatica, cache da
// borda). Antes a page.tsx da raiz lia headers() e renderizava a landing a cada
// visita: medido em 27/10, xcart.app/ com 0,5 s de TTFB contra 0,13 s de /lp.
// ============================================================================

function pedir(url: string) {
  return updateSession(new NextRequest(url, { headers: { host: new URL(url).host } }));
}

describe("landing no host comercial", () => {
  it("a raiz vira /lp por rewrite: a URL do visitante continua a raiz", async () => {
    const r = await pedir("https://xcart.app/");
    expect(r.status).toBe(200);
    expect(new URL(r.headers.get("x-middleware-rewrite") || "").pathname).toBe("/lp");
    expect(r.headers.get("location")).toBeNull();
  });

  it("a query do anuncio vai junto (UTM, fbclid)", async () => {
    const r = await pedir("https://xcart.app/?utm_source=fb&fbclid=ABC");
    const destino = new URL(r.headers.get("x-middleware-rewrite") || "");
    expect(destino.pathname).toBe("/lp");
    expect(destino.searchParams.get("utm_source")).toBe("fb");
    expect(destino.searchParams.get("fbclid")).toBe("ABC");
  });

  it("www tambem; /lp e as paginas legais seguem sem rewrite", async () => {
    expect(new URL((await pedir("https://www.xcart.app/")).headers.get("x-middleware-rewrite") || "").pathname).toBe("/lp");
    for (const caminho of ["/lp", "/privacy", "/terms"]) {
      const r = await pedir(`https://xcart.app${caminho}`);
      expect(r.headers.get("x-middleware-rewrite"), caminho).toBeNull();
      expect(r.headers.get("location"), caminho).toBeNull();
    }
  });

  it("tela do app no host comercial continua indo para o app", async () => {
    const r = await pedir("https://xcart.app/financeiro");
    expect(r.status).toBeGreaterThanOrEqual(300);
    expect(r.headers.get("location")).toContain("/financeiro");
  });
});

describe("sessao no host do app: so o token, sem ida ao servidor de login", () => {
  const COM_SENHA = { sub: "u1", user_metadata: { has_password: true } };

  it("sem sessao: login, guardando o destino", async () => {
    const r = await pedir("https://user.xcart.app/pedidos?periodo=7d");
    const destino = new URL(r.headers.get("location") || "");
    expect(destino.pathname).toBe("/login");
    expect(destino.searchParams.get("next")).toBe("/pedidos?periodo=7d");
    expect(sessao.getUser).toBe(0);
  });

  it("com sessao e senha: a pagina segue", async () => {
    sessao.claims = COM_SENHA;
    const r = await pedir("https://user.xcart.app/pedidos");
    expect(r.headers.get("location")).toBeNull();
    expect(sessao.getUser).toBe(0);
  });

  it("entrou pelo link do e-mail e ainda nao tem senha: /set-password", async () => {
    sessao.claims = { sub: "u1", user_metadata: {} };
    const r = await pedir("https://user.xcart.app/pedidos");
    expect(new URL(r.headers.get("location") || "").pathname).toBe("/set-password");
  });

  it("logado abrindo o login vai para a home do app", async () => {
    sessao.claims = COM_SENHA;
    const r = await pedir("https://user.xcart.app/login");
    expect(new URL(r.headers.get("location") || "").pathname).toBe("/financeiro");
  });

  it("host do admin: sem sessao vai ao login; com sessao, fora do /admin vai ao /admin", async () => {
    expect(new URL((await pedir("https://adm.xcart.app/admin")).headers.get("location") || "").pathname).toBe("/login");
    sessao.claims = COM_SENHA;
    expect((await pedir("https://adm.xcart.app/admin")).headers.get("location")).toBeNull();
    expect(new URL((await pedir("https://adm.xcart.app/pedidos")).headers.get("location") || "").pathname).toBe("/admin");
    expect(sessao.getUser).toBe(0);
  });
});

// ============================================================================
// Login do Supabase fora do ar. getClaims devolve data null tambem quando a
// renovacao do token falha por rede ou 5xx (AuthRetryableFetchError), e o
// auth-js NAO apaga o cookie nesse caso. Antes isso virava "sem sessao": o
// lojista caia no /login como se tivesse saido, o /login rodava a mesma
// renovacao de ~25 s, e quem recarregava depois ia para a home, nao para a
// tela que tinha aberto.
// ============================================================================

describe("login fora do ar e volta ao destino", () => {
  const COM_SENHA = { sub: "u1", user_metadata: { has_password: true } };

  it("logado abrindo o login com ?next= volta a tela que tinha aberto", async () => {
    sessao.claims = COM_SENHA;
    const next = encodeURIComponent("/tracking/eventos?status=falhou");
    const destino = new URL((await pedir(`https://user.xcart.app/login?next=${next}`)).headers.get("location") || "");
    expect(destino.host).toBe("user.xcart.app");
    expect(destino.pathname).toBe("/tracking/eventos");
    expect(destino.searchParams.get("status")).toBe("falhou");
    expect(destino.searchParams.get("next")).toBeNull();
  });

  it("?next= para fora do app, ou de volta ao login, vai para a home", async () => {
    sessao.claims = COM_SENHA;
    for (const next of [
      "//evil.com/x",
      "https://evil.com",
      "/\\evil.com",
      // Os pontos normalizados viravam "//evil.com" -- 307 para https://evil.com/.
      "/.//evil.com",
      "/a/..//evil.com/x",
      "/%2e%2e//evil.com",
      "/login?next=/pedidos",
      "/callback",
    ]) {
      const destino = new URL(
        (await pedir(`https://user.xcart.app/login?next=${encodeURIComponent(next)}`)).headers.get("location") || ""
      );
      expect(destino.host, next).toBe("user.xcart.app");
      expect(destino.pathname, next).toBe("/financeiro");
      expect(destino.search, next).toBe("");
    }
  });

  it("?next= de API vai para a home: getUser e getClaims podem discordar, e o laco nao fechava", async () => {
    // Sessao revogada em outro aparelho: o token vale ate 1 h, o getUser da
    // rota diz null e ela manda ao /login?next=ela mesma.
    sessao.claims = COM_SENHA;
    for (const next of ["/api/shopify/auth?shop=x.myshopify.com", "/api/shopify/auth?store_id=1", "/api"]) {
      const destino = new URL(
        (await pedir(`https://user.xcart.app/login?next=${encodeURIComponent(next)}`)).headers.get("location") || ""
      );
      expect(destino.host, next).toBe("user.xcart.app");
      expect(destino.pathname, next).toBe("/financeiro");
      expect(destino.search, next).toBe("");
    }
  });

  it("erro retentavel do login: /login com o destino e instavel=1", async () => {
    sessao.erro = new AuthRetryableFetchError("fetch failed", 0);
    const destino = new URL((await pedir("https://user.xcart.app/pedidos?periodo=7d")).headers.get("location") || "");
    expect(destino.pathname).toBe("/login");
    expect(destino.searchParams.get("next")).toBe("/pedidos?periodo=7d");
    expect(destino.searchParams.get("instavel")).toBe("1");
  });

  it("503 do login tambem; refresh token recusado (400) e sessao ausente de verdade, sem instavel", async () => {
    sessao.erro = new AuthRetryableFetchError("Service Unavailable", 503);
    expect(new URL((await pedir("https://user.xcart.app/financeiro")).headers.get("location") || "").searchParams.get("instavel")).toBe("1");

    sessao.erro = new AuthApiError("Invalid Refresh Token: Refresh Token Not Found", 400, "refresh_token_not_found");
    const destino = new URL((await pedir("https://user.xcart.app/financeiro")).headers.get("location") || "");
    expect(destino.pathname).toBe("/login");
    expect(destino.searchParams.get("instavel")).toBeNull();
  });

  it("/login?instavel=1 abre sem conferir a sessao de novo, mesmo com cookie", async () => {
    sessao.claims = COM_SENHA;
    const r = await pedir("https://user.xcart.app/login?instavel=1&next=%2Fpedidos");
    expect(r.headers.get("location")).toBeNull();
    expect(sessao.getClaims).toBe(0);
  });

  it("/login sem instavel continua conferindo (logado vai ao destino)", async () => {
    sessao.claims = COM_SENHA;
    const r = await pedir("https://user.xcart.app/login?instavel=0&next=%2Fpedidos");
    expect(sessao.getClaims).toBe(1);
    expect(new URL(r.headers.get("location") || "").pathname).toBe("/pedidos");
  });
});

// ============================================================================
// Prazo nas idas ao Supabase. Sem ele, Auth ou PostgREST pendurado segurava a
// requisicao ate a Vercel matar a funcao. abort() sem motivo da AbortError, que
// o postgrest-js nao repete; AbortSignal.timeout() daria TimeoutError, repetido
// 3 vezes.
// ============================================================================

/** fetch que so termina quando o signal aborta (com o motivo dele, como o real). */
function fetchPendurado() {
  const chamadas: (RequestInit | undefined)[] = [];
  vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
    chamadas.push(init);
    return new Promise((_ok, falhar) => {
      if (init?.signal?.aborted) return falhar(init.signal.reason);
      init?.signal?.addEventListener("abort", () => falhar(init.signal!.reason));
    });
  });
  return chamadas;
}

/** Acompanha a promessa sem deixar rejeicao solta. */
function acompanhar(p: Promise<unknown>) {
  const estado: { fim: "pendente" | "ok" | "erro"; erro: unknown } = { fim: "pendente", erro: null };
  p.then(
    () => (estado.fim = "ok"),
    (e) => {
      estado.fim = "erro";
      estado.erro = e;
    }
  );
  return estado;
}

describe("prazo no fetch do Supabase", () => {
  it("o cliente do proxy usa prazo de 5 s na chave publica, e o corte e AbortError", async () => {
    await pedir("https://user.xcart.app/pedidos");
    const fetchDoProxy = sessao.opcoes?.global?.fetch;
    expect(typeof fetchDoProxy).toBe("function");

    vi.useFakeTimers();
    fetchPendurado();
    const estado = acompanhar(fetchDoProxy!("https://projeto.supabase.co/auth/v1/.well-known/jwks.json"));
    await vi.advanceTimersByTimeAsync(4_999);
    expect(estado.fim).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    expect(estado.fim).toBe("erro");
    expect((estado.erro as Error).name).toBe("AbortError");
  });

  it("renovar o token tem 15 s: a tentativa cortada e repetida fora da janela de reuso revogava a sessao", async () => {
    await pedir("https://user.xcart.app/pedidos");
    const fetchDoProxy = sessao.opcoes?.global?.fetch;

    vi.useFakeTimers();
    fetchPendurado();
    const url = "https://projeto.supabase.co/auth/v1/token?grant_type=refresh_token";
    const comTexto = acompanhar(fetchDoProxy!(url, { method: "POST" }));
    // Request e URL no lugar do texto tambem.
    const comRequest = acompanhar(fetchDoProxy!(new Request(url, { method: "POST" })));
    const comUrl = acompanhar(fetchDoProxy!(new URL(url), { method: "POST" }));
    await vi.advanceTimersByTimeAsync(14_999);
    for (const estado of [comTexto, comRequest, comUrl]) expect(estado.fim).toBe("pendente");
    await vi.advanceTimersByTimeAsync(1);
    for (const estado of [comTexto, comRequest, comUrl]) {
      expect(estado.fim).toBe("erro");
      expect((estado.erro as Error).name).toBe("AbortError");
    }
  });

  it("o signal de quem chamou continua valendo, com o motivo dele", async () => {
    vi.useFakeTimers();
    fetchPendurado();
    const quem = new AbortController();
    const estado = acompanhar(comPrazo(10_000)("https://x.supabase.co/rest/v1/t", { signal: quem.signal }));
    quem.abort(new Error("consulta cancelada"));
    await vi.advanceTimersByTimeAsync(0);
    expect(estado.fim).toBe("erro");
    expect((estado.erro as Error).message).toBe("consulta cancelada");
  });

  it("signal ja abortado corta na hora", async () => {
    fetchPendurado();
    const quem = new AbortController();
    quem.abort();
    await expect(comPrazo(10_000)("https://x.supabase.co/rest/v1/t", { signal: quem.signal })).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("resposta a tempo: passa intacta, e o prazo nao aborta nada depois", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Response("[]", { status: 200 });
    });
    const r = await comPrazo(10_000)("https://x.supabase.co/rest/v1/t", { headers: { apikey: "k" } });
    expect(await r.text()).toBe("[]");
    await vi.advanceTimersByTimeAsync(20_000);
    expect(signal?.aborted).toBe(false);
  });
});

// ============================================================================
// O /login usa a mesma regra do ?next= no "Tentar de novo" (instavel=1) e no
// destino do formulario. "/.//evil.com" saia da caminhoInternoSeguro como
// "//evil.com", e o botao, com cara de aviso do xcart, levava a outro site.
// ============================================================================

type Elemento = { props: Record<string, unknown> & { children?: unknown } };

async function paginaDoLogin(sp: Record<string, string>) {
  return (await LoginPage({ searchParams: Promise.resolve(sp) })) as unknown as Elemento;
}

/** O href do "Tentar de novo" e o destino do formulario, com instavel=1. */
async function destinosDoLogin(next: string) {
  const pagina = await paginaDoLogin({ instavel: "1", next });
  const [aviso, formulario] = pagina.props.children as Elemento[];
  const botao = aviso.props.acao as Elemento;
  return { botao: botao.props.href, formulario: formulario.props.destino };
}

describe("/login: destino do ?next=", () => {
  it("caminho interno: o botao e o formulario voltam a ele", async () => {
    expect(await destinosDoLogin("/tracking/eventos?status=falhou")).toEqual({
      botao: "/tracking/eventos?status=falhou",
      formulario: "/tracking/eventos?status=falhou",
    });
  });

  it("caminho que normaliza para // vai para a home, no botao e no formulario", async () => {
    for (const next of ["/.//evil.com", "/a/..//evil.com/x", "/%2e%2e//evil.com", "//evil.com", "https://evil.com"]) {
      expect(await destinosDoLogin(next), next).toEqual({ botao: "/financeiro", formulario: "/financeiro" });
    }
  });

  it("sem instavel: so o formulario, com o mesmo destino seguro", async () => {
    const pagina = await paginaDoLogin({ next: "/.//evil.com" });
    expect(pagina.props.destino).toBe("/financeiro");
    expect((await paginaDoLogin({ next: "/pedidos" })).props.destino).toBe("/pedidos");
  });
});
