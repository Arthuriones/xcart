import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { updateSession } from "../src/lib/supabase/middleware";

// A sessao que o Supabase "devolve" em cada teste. O proxy so pode ler o token
// (getClaims): getUser e uma ida ao servidor de login em toda navegacao.
const sessao = vi.hoisted(() => ({
  claims: null as Record<string, unknown> | null,
  getUser: 0,
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getClaims: async () => ({ data: sessao.claims ? { claims: sessao.claims } : null, error: null }),
      getUser: async () => {
        sessao.getUser++;
        return { data: { user: null }, error: null };
      },
    },
  }),
}));

beforeEach(() => {
  sessao.claims = null;
  sessao.getUser = 0;
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
