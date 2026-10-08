import { describe, expect, it, vi } from "vitest";

// ============================================================================
// XSS refletido nos callbacks OAuth (Meta e Google).
//
// O `error_description` da URL ia cru para `<p>${erro}</p>`, num ramo que roda
// antes de conferir sessao e state: um link montado por terceiro executava
// script na origem do painel. E o JSON dentro do <script> nao escapava
// `</script>`. Isto trava as tres regras de popup-oauth.ts.
// ============================================================================

vi.mock("server-only", () => ({}));
// O ramo de erro tem que responder ANTES de tocar na sessao.
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    throw new Error("o ramo de erro nao devia abrir sessao");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => null }));

import {
  escHtml,
  jsonNoScript,
  mensagemDoErroOAuth,
  renderPopupOAuth,
} from "@/lib/ads/popup-oauth";

const PAYLOAD = `<img src=x onerror=alert(document.cookie)></script><script>alert(1)</script>`;

/** O que esta dentro do unico <script> da pagina. */
function scriptDe(html: string): string {
  const blocos = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  expect(blocos.length).toBe(1);
  return blocos[0][1];
}

describe("popup do OAuth", () => {
  it("escHtml troca os cinco caracteres", () => {
    expect(escHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
      "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
    );
  });

  it("jsonNoScript nao deixa tag nem fim de linha cru, e continua JSON valido", () => {
    const s = jsonNoScript({ nome: "</script><b>&\u2028\u2029" });
    expect(s).not.toMatch(/[<>&\u2028\u2029]/);
    expect(JSON.parse(s)).toEqual({ nome: "</script><b>&\u2028\u2029" });
  });

  it("o erro da URL nunca vira texto da tela", () => {
    expect(mensagemDoErroOAuth("access_denied")).toBe("Você cancelou a autorização.");
    expect(mensagemDoErroOAuth(PAYLOAD)).toBe("Falha na autorização. Tente de novo.");
  });

  it("nome do perfil com HTML sai escapado no corpo e no <script>", async () => {
    const r = renderPopupOAuth("meta", { ok: true, nome: PAYLOAD, contas: 2 });
    const html = await r.text();
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;img src=x onerror=alert(document.cookie)&gt;");
    // So um </script> na pagina: o do proprio bloco.
    expect(html.match(/<\/script>/g)?.length).toBe(1);
    const script = scriptDe(html);
    expect(script).toContain('"type":"XCART_META_CONNECTED"');
    expect(script).toContain("\\u003cimg");
  });

  it("o <script> so roda com o nonce da propria resposta", async () => {
    const r = renderPopupOAuth("google", { ok: false });
    const csp = r.headers.get("content-security-policy") || "";
    const nonce = csp.match(/script-src 'nonce-([^']+)'/)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain("unsafe-inline' 'nonce");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    const html = await r.text();
    expect(html).toContain(`<script nonce="${nonce}">`);
    // Outra resposta, outro nonce.
    const outra = renderPopupOAuth("google", { ok: false });
    expect(outra.headers.get("content-security-policy")).not.toContain(nonce!);
  });
});

describe("callbacks com ?error= montado por terceiro", () => {
  const casos = [
    ["meta", "../src/app/api/auth/meta/callback/route"],
    ["google", "../src/app/api/auth/google/callback/route"],
  ] as const;

  for (const [nome, caminho] of casos) {
    it(`${nome}: nao reflete error nem error_description`, async () => {
      const { GET } = await import(caminho);
      const { NextRequest } = await import("next/server");
      const url = new URL(`https://user.xcart.app/api/auth/${nome}/callback`);
      url.searchParams.set("error", PAYLOAD);
      url.searchParams.set("error_description", PAYLOAD);

      const r = await GET(new NextRequest(url));
      const html = await r.text();

      expect(r.status).toBe(400);
      expect(html).not.toContain("onerror");
      expect(html).not.toContain("alert(");
      expect(html).toContain("Falha na autorização. Tente de novo.");
      expect(r.headers.get("content-security-policy")).toMatch(/script-src 'nonce-/);
    });

    it(`${nome}: access_denied vira "Você cancelou"`, async () => {
      const { GET } = await import(caminho);
      const { NextRequest } = await import("next/server");
      const r = await GET(
        new NextRequest(`https://user.xcart.app/api/auth/${nome}/callback?error=access_denied`)
      );
      expect(await r.text()).toContain("Você cancelou a autorização.");
    });
  }
});
