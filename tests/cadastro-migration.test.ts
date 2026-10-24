import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ============================================================================
// Trava de privilegio do cadastro (migration 077): o trigger handle_new_user
// le o raw_user_meta_data -- que e do USUARIO, ele escolhe o que manda no
// signUp -- e grava no perfil. Nada desse caminho pode chegar em is_admin,
// plan, plano, access_granted ou credito, e nada pode devolver ao usuario a
// escrita em profiles que a 030 tirou (CLAUDE.md: policy de UPDATE/INSERT
// precisa de WITH CHECK; funcao SECURITY DEFINER sem EXECUTE para o cliente).
// ============================================================================

const PASTA = path.resolve(__dirname, "../supabase/migrations");
const ARQUIVOS = readdirSync(PASTA)
  .filter((f) => f.endsWith(".sql"))
  .sort();

/** Sem comentario de linha: os comentarios citam is_admin e grant de proposito. */
const codigo = (arquivo: string) => readFileSync(path.join(PASTA, arquivo), "utf8").replace(/--[^\n]*/g, "");

const DEFINICAO = /create\s+or\s+replace\s+function\s+public\.handle_new_user\(\)([\s\S]*?)as\s+\$\$([\s\S]*?)\$\$\s*;/i;

// A definicao que vale e a da ultima migration que recria a funcao.
const ultima = [...ARQUIVOS].reverse().find((f) => DEFINICAO.test(codigo(f)))!;
const [, cabecalho, corpo] = codigo(ultima).match(DEFINICAO)!;

const COLUNAS_DE_PRIVILEGIO =
  /\b(is_admin|plan|plano|access_granted|ai_credits|credits_reset_at|subscription_status|current_period_end|cancel_at_period_end|payment_provider|free_clone_store_id|stripe_\w+|pagou_\w+)\b/i;

describe("handle_new_user (trigger que cria o perfil)", () => {
  it("a definicao em vigor e a da 077", () => {
    expect(ultima).toBe("077_cadastro_dados.sql");
  });

  it("security definer com search_path fixo", () => {
    expect(cabecalho).toMatch(/security\s+definer/i);
    expect(cabecalho).toMatch(/set\s+search_path\s*=\s*public\b/i);
  });

  it("so grava id e os dados do cadastro no perfil", () => {
    const inserts = [...corpo.matchAll(/insert\s+into\s+([\w.]+)\s*\(([^)]*)\)/gi)];
    expect(inserts).toHaveLength(1);
    expect(inserts[0][1]).toBe("public.profiles");
    const colunas = inserts[0][2].split(",").map((c) => c.trim());
    expect(colunas).toEqual(["id", "nome", "sobrenome", "telefone", "document_number", "document_type"]);
    expect(corpo).toMatch(/on\s+conflict\s*\(id\)\s+do\s+nothing/i);
  });

  it("nao encosta em coluna de privilegio, plano ou credito", () => {
    expect(corpo).not.toMatch(COLUNAS_DE_PRIVILEGIO);
    expect(corpo).not.toMatch(/raw_app_meta_data/i);
  });

  it("do metadata so le nome, sobrenome, telefone e documento", () => {
    const chaves = [...corpo.matchAll(/->>?\s*'([^']+)'/g)].map((m) => m[1]);
    expect(new Set(chaves)).toEqual(new Set(["nome", "sobrenome", "telefone", "documento"]));
  });

  it("o unico UPDATE tira telefone e documento do metadata, e nao derruba o cadastro", () => {
    const updates = [...corpo.matchAll(/update\s+([\w.]+)\s+set\s+([\s\S]*?)\s+where\s+([^;]*);/gi)];
    expect(updates).toHaveLength(1);
    const [, tabela, set, onde] = updates[0];
    expect(tabela).toBe("auth.users");
    expect(set.replace(/\s+/g, " ").trim()).toBe(
      "raw_user_meta_data = raw_user_meta_data - array['telefone', 'documento']"
    );
    expect(onde.trim()).toBe("id = new.id");
    expect(corpo).toMatch(/exception\s+when\s+others\s+then\s+null\s*;/i);
  });

  it("telefone e documento so entram no formato (o resto vira null)", () => {
    expect(corpo).toContain("'^[1-9]{2}(9[0-9]{8}|[2-5][0-9]{7})$'");
    expect(corpo).toContain("'^([0-9]{11}|[0-9]{14})$'");
    expect(corpo).toContain("'^(.)\\1+$'");
  });
});

describe("077 nao abre escrita nem execucao para o cliente", () => {
  const sql = codigo("077_cadastro_dados.sql");

  it("sem grant, sem policy e sem desligar RLS", () => {
    expect(sql).not.toMatch(/\bgrant\b/i);
    expect(sql).not.toMatch(/\b(create|alter)\s+policy\b/i);
    expect(sql).not.toMatch(/disable\s+row\s+level\s+security/i);
    expect(sql).not.toMatch(/security\s+invoker/i);
  });

  it("revoga de novo o EXECUTE do trigger, depois de recriar", () => {
    const revoke = /revoke\s+execute\s+on\s+function\s+public\.handle_new_user\(\)\s+from\s+public\s*,\s*anon\s*,\s*authenticated\s*;/i;
    expect(sql).toMatch(revoke);
    expect(sql.search(revoke)).toBeGreaterThan(sql.search(DEFINICAO));
  });

  it("colunas novas sem CHECK (um CHECK que falhasse derrubava o signUp)", () => {
    expect(sql).not.toMatch(/\bcheck\s*\(/i);
  });
});

describe("profiles em todas as migrations", () => {
  it("ninguem devolve INSERT/UPDATE de profiles ao anon/authenticated", () => {
    const grant = /grant\s+[^;]*\b(insert|update|all)\b[^;]*\bon\s+(table\s+)?public\.profiles\b[^;]*\bto\b[^;]*\b(anon|authenticated|public)\b/i;
    for (const f of ARQUIVOS) expect(codigo(f), f).not.toMatch(grant);
    expect(codigo("030_tenant_isolation_and_fk_indexes.sql")).toMatch(
      /revoke\s+update\s+on\s+public\.profiles\s+from\s+anon\s*,\s*authenticated/i
    );
  });

  it("toda policy de escrita em vigor em profiles tem WITH CHECK", () => {
    const vigentes = new Map<string, string>();
    for (const f of ARQUIVOS) {
      const sql = codigo(f);
      const eventos = [
        ...[...sql.matchAll(/drop\s+policy\s+if\s+exists\s+("[^"]+"|\w+)\s+on\s+public\.profiles\b/gi)].map((m) => ({
          i: m.index ?? 0,
          nome: m[1].replace(/"/g, ""),
          resto: null as string | null,
        })),
        ...[...sql.matchAll(/create\s+policy\s+("[^"]+"|\w+)\s+on\s+public\.profiles\b([^;]*);/gi)].map((m) => ({
          i: m.index ?? 0,
          nome: m[1].replace(/"/g, ""),
          resto: m[2] as string | null,
        })),
      ].sort((a, b) => a.i - b.i);
      for (const e of eventos) {
        if (e.resto === null) vigentes.delete(e.nome);
        else vigentes.set(e.nome, e.resto);
      }
    }
    expect(vigentes.size).toBeGreaterThan(0);
    for (const [nome, resto] of vigentes) {
      if (/\bfor\s+(update|insert|all)\b/i.test(resto)) expect(resto, nome).toMatch(/with\s+check/i);
    }
  });
});
