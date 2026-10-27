import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * O supabase-js do navegador (auth, banco, realtime: uns 70 KB gzip) so serve
 * no envio do login, do cadastro, do link e da senha nova. Ele sai do primeiro
 * acesso: import() dentro dos handlers, com pre-carga no foco de um campo.
 * Um import fixo no topo de qualquer um dos dois formularios o traz de volta.
 *
 * Le o fonte: os formularios sao componentes de cliente (React, lucide), e o
 * vitest roda em node.
 */
const RAIZ = path.join(__dirname, "..");
const ler = (...p: string[]) => readFileSync(path.join(RAIZ, ...p), "utf8");

const acesso = ler("src", "app", "(auth)", "login", "formulario-acesso.tsx");
const senha = ler("src", "app", "(auth)", "set-password", "formulario-senha.tsx");

const IMPORT_FIXO = /^\s*import\s[^;]*from\s+["']@\/lib\/supabase\/client["']/m;
const IMPORT_SOB_DEMANDA = 'import("@/lib/supabase/client")';

describe("cliente do Supabase sob demanda no login e na senha nova", () => {
  for (const [nome, fonte, envios] of [
    ["formulario-acesso", acesso, 2],
    ["formulario-senha", senha, 1],
  ] as const) {
    it(`${nome}: sem import fixo do cliente`, () => {
      expect(fonte).not.toMatch(IMPORT_FIXO);
      expect(fonte).not.toMatch(/from\s+["']@supabase\//);
    });

    it(`${nome}: cada envio carrega o cliente com import()`, () => {
      expect(fonte).toContain(IMPORT_SOB_DEMANDA);
      expect(fonte.match(/await supabaseDoNavegador\(\)/g)?.length).toBe(envios);
      // Ninguem cria o cliente por fora do carregador.
      expect(fonte.match(/createClient\(\)/g)?.length).toBe(1);
      expect(fonte).toMatch(/m\.createClient\(\)/);
    });

    it(`${nome}: o foco num campo do formulario ja baixa o cliente`, () => {
      expect(fonte).toMatch(/<form noValidate onSubmit=\{\w+\} onFocus=\{preCarregarSupabase\}/);
      // A pre-carga que falha nao vira erro solto; quem mostra e o envio (abaixo).
      expect(fonte).toMatch(/function preCarregarSupabase\(\) \{\s*void import\("@\/lib\/supabase\/client"\)\.catch\(/);
    });

    it(`${nome}: o import() que falhou pede para recarregar, sem passar pelo erroDeAcesso`, () => {
      // O Turbopack guarda a promessa rejeitada do chunk: todo import() seguinte
      // falha igual sem buscar o arquivo. "Tente de novo" nunca resolveria, e
      // "429" no meio da URL do chunk viraria "Muitas tentativas seguidas".
      expect(fonte).toContain("class PaginaSemCliente extends Error {}");
      expect(fonte).toMatch(
        /const supabaseDoNavegador = \(\) =>\s*import\("@\/lib\/supabase\/client"\)\.then\(\s*\(m\) => m\.createClient\(\),\s*\(\) => \{\s*throw new PaginaSemCliente\(/,
      );
      // A frase propria, com o botao que recarrega.
      expect(fonte).toMatch(/const RECARREGAR: ErroDeAcesso = \{\s*titulo: "Recarregue a página"/);
      expect(fonte).toMatch(/=== RECARREGAR \? \(\s*<Button[^>]*onClick=\{\(\) => window\.location\.reload\(\)\}/);
      // A checagem vem antes do erroDeAcesso no mesmo tratamento.
      const desvio = fonte.indexOf("instanceof PaginaSemCliente");
      expect(desvio).toBeGreaterThan(-1);
      expect(fonte.indexOf("erroDeAcesso(e)", desvio)).toBeGreaterThan(desvio);
      expect(fonte.slice(fonte.indexOf("erroDeAcesso(e)") - 200, fonte.indexOf("erroDeAcesso(e)"))).toContain(
        "PaginaSemCliente",
      );
    });
  }

  it("o cadastro e a entrada continuam saindo do navegador (077)", () => {
    expect(acesso.startsWith('"use client"')).toBe(true);
    expect(acesso).toContain("supabase.auth.signUp(");
    expect(acesso).toContain("supabase.auth.signInWithPassword(");
    expect(acesso).toContain("supabase.auth.resetPasswordForEmail(");
    expect(ler("src", "lib", "supabase", "client.ts")).toContain("createBrowserClient");
  });

  it("a senha nova renova a sessao no mesmo cliente depois de salvar", () => {
    const salvar = senha.slice(senha.indexOf("async function salvar"), senha.indexOf("async function sair"));
    const criar = salvar.indexOf("await supabaseDoNavegador()");
    const atualizar = salvar.indexOf("supabase.auth.updateUser(");
    const renovar = salvar.indexOf("await supabase.auth.refreshSession()");
    expect(criar).toBeGreaterThan(-1);
    expect(atualizar).toBeGreaterThan(criar);
    expect(renovar).toBeGreaterThan(atualizar);
  });
});
