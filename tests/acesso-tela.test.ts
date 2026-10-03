import { describe, expect, it } from "vitest";
import {
  BOTAO,
  SENHA_MINIMA,
  SUBTITULO,
  TITULO,
  TITULO_ERRO,
  avisoDoLink,
  erroDeAcesso,
  forcaDaSenha,
  modoInicial,
  origemDoSite,
  pedeLink,
  validarAcesso,
  validarSenhaNova,
  type Modo,
} from "../src/app/(auth)/acesso";

const MODOS: Modo[] = ["entrar", "criar", "link", "esqueci"];

describe("modo inicial do /login", () => {
  it("a landing abre em Criar conta", () => {
    expect(modoInicial("signup")).toBe("criar");
  });
  it("?mode=link abre em Entrar com link", () => {
    expect(modoInicial("link")).toBe("link");
  });
  it("sem modo e sem erro, Entrar", () => {
    expect(modoInicial(null)).toBe("entrar");
    expect(modoInicial("qualquer")).toBe("entrar");
  });
  it("link que falhou (?error=) abre direto em pedir outro link", () => {
    expect(modoInicial(null, "link_invalido")).toBe("link");
    // modo explicito vence
    expect(modoInicial("signup", "link_invalido")).toBe("criar");
  });
  it("link e esqueci a senha mandam o mesmo link", () => {
    expect(pedeLink("link")).toBe(true);
    expect(pedeLink("esqueci")).toBe(true);
    expect(pedeLink("entrar")).toBe(false);
    expect(pedeLink("criar")).toBe(false);
  });
});

describe("textos dos modos", () => {
  it("todo modo tem titulo, subtitulo, botao e titulo de erro", () => {
    for (const m of MODOS) {
      expect(TITULO[m]).toBeTruthy();
      expect(SUBTITULO[m]).toBeTruthy();
      expect(BOTAO[m]).toBeTruthy();
      expect(TITULO_ERRO[m]).toBeTruthy();
    }
  });
  it("caixa de frase, sem plural (s), sem Title Case e sem o modelo de vitrine", () => {
    const todos = [...Object.values(TITULO), ...Object.values(SUBTITULO), ...Object.values(BOTAO)];
    for (const t of todos) {
      expect(t).not.toMatch(/\(s\)/);
      expect(t).not.toMatch(/Criar Conta|Voltar ao Login|\bEmail\b/);
      expect(t.toLowerCase()).not.toContain("vitrine");
    }
  });
});

describe("validação dos campos", () => {
  it("criar: todos os problemas de uma vez", () => {
    const e = validarAcesso("criar", { nome: " ", email: "", senha: "123" });
    expect(Object.keys(e).sort()).toEqual(["email", "nome", "senha"]);
    expect(e.senha).toContain(String(SENHA_MINIMA));
  });
  it("e-mail mal escrito", () => {
    expect(validarAcesso("link", { nome: "", email: "arthur@", senha: "" }).email).toBeTruthy();
    expect(validarAcesso("link", { nome: "", email: "a@b.co", senha: "" })).toEqual({});
  });
  it("entrar não cobra tamanho de senha (só que exista)", () => {
    expect(validarAcesso("entrar", { nome: "", email: "a@b.co", senha: "1" })).toEqual({});
    expect(validarAcesso("entrar", { nome: "", email: "a@b.co", senha: "" }).senha).toBeTruthy();
  });
  it("link não pede nome nem senha", () => {
    expect(validarAcesso("esqueci", { nome: "", email: "a@b.co", senha: "" })).toEqual({});
  });
  it("senha nova: mínimo e repetição", () => {
    expect(validarSenhaNova("12345", "12345").senha).toBeTruthy();
    expect(validarSenhaNova("abcdef", "").repetida).toBe("Repita a senha para confirmar.");
    expect(validarSenhaNova("abcdef", "abcdeg").repetida).toBe("As duas senhas não são iguais.");
    expect(validarSenhaNova("abcdef", "abcdef")).toEqual({});
  });
});

describe("força da senha", () => {
  it("vazia não mostra nada; curta avisa", () => {
    expect(forcaDaSenha("")).toEqual({ nivel: 0, rotulo: "" });
    expect(forcaDaSenha("abc")).toEqual({ nivel: 0, rotulo: "Curta demais" });
  });
  it("as mais usadas e as repetidas são fracas", () => {
    expect(forcaDaSenha("123456").rotulo).toBe("Fraca");
    expect(forcaDaSenha("Senha123").rotulo).toBe("Fraca");
    expect(forcaDaSenha("aaaaaaaaaaaaaaaa").rotulo).toBe("Fraca");
  });
  it("comprimento e variedade sobem o nível", () => {
    expect(forcaDaSenha("abcdef").rotulo).toBe("Fraca");
    expect(forcaDaSenha("abcdef1234").rotulo).toBe("Média");
    expect(forcaDaSenha("Abcdef1234").rotulo).toBe("Forte");
    expect(forcaDaSenha("minha senha bem longa").rotulo).toBe("Forte");
  });
});

describe("erros do Supabase em português", () => {
  it("limite de tentativas lê os segundos da mensagem", () => {
    const r = erroDeAcesso({ message: "For security purposes, you can only request this after 42 seconds.", status: 429 });
    expect(r.esperarSegundos).toBe(42);
    expect(r.texto).not.toMatch(/security/i);
  });
  it("limite sem número espera 60 s", () => {
    expect(erroDeAcesso({ message: "Email rate limit exceeded", code: "over_email_send_rate_limit" }).esperarSegundos).toBe(60);
  });
  it("credenciais erradas apontam para o link por e-mail", () => {
    const r = erroDeAcesso({ message: "Invalid login credentials", code: "invalid_credentials", status: 400 });
    expect(r.texto).toContain("Entrar com link por e-mail");
  });
  it("e-mail que já tem conta volta para Entrar", () => {
    expect(erroDeAcesso(new Error("User already registered")).irParaEntrar).toBe(true);
    expect(erroDeAcesso({ message: "x", code: "user_already_exists" }).irParaEntrar).toBe(true);
  });
  it("sessão perdida no definir senha pede link novo", () => {
    const r = erroDeAcesso({ message: "Auth session missing!", status: 400 });
    expect(r.sessaoExpirada).toBe(true);
  });
  it("senha igual, fraca e vazada", () => {
    expect(erroDeAcesso({ message: "New password should be different from the old password.", code: "same_password" }).texto).toMatch(/diferente/);
    expect(erroDeAcesso({ message: "Password should be at least 6 characters.", code: "weak_password" }).texto).toMatch(/6 caracteres/);
    expect(erroDeAcesso({ message: "Password is known to be weak and easy to guess, please choose a different one." }).texto).toMatch(/vazamentos/);
  });
  it("queda de rede", () => {
    expect(erroDeAcesso(new TypeError("Failed to fetch")).texto).toMatch(/conexão caiu/);
  });
  it("o que não tem frase vira genérico, com o detalhe cru recolhido", () => {
    const r = erroDeAcesso({ message: "Database error saving new user" });
    expect(r.texto).toBe("Não deu certo agora. Tente de novo em instantes.");
    expect(r.detalhe).toBe("Database error saving new user");
  });
  it("nenhuma frase em inglês", () => {
    const amostras = [
      "Invalid login credentials",
      "Email not confirmed",
      "User already registered",
      "Auth session missing!",
      "Signups not allowed for this instance",
      "Unable to validate email address: invalid format",
      "Failed to fetch",
    ];
    for (const a of amostras) {
      const r = erroDeAcesso(new Error(a));
      expect(r.detalhe).toBeUndefined();
      expect(r.texto).not.toMatch(/\b(the|invalid|error|failed|session)\b/i);
    }
  });
});

describe("aviso de link que falhou", () => {
  it("?error=link_invalido do /callback", () => {
    expect(avisoDoLink("link_invalido", "")?.titulo).toBe("O link expirou ou já foi usado");
  });
  it("#error_code=otp_expired do Supabase (o navegador leva o # no redirect)", () => {
    const hash = "#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired";
    expect(avisoDoLink(null, hash)?.titulo).toBe("O link expirou ou já foi usado");
  });
  it("outro erro do link", () => {
    expect(avisoDoLink(null, "#error=server_error")?.titulo).toBe("Não deu para entrar por este link");
    expect(avisoDoLink("outra_coisa", "")?.titulo).toBe("Não deu para entrar por este link");
  });
  it("sem erro, sem aviso", () => {
    expect(avisoDoLink(null, "")).toBeNull();
    expect(avisoDoLink(null, "#secao")).toBeNull();
  });
});

describe("endereço das páginas legais", () => {
  it("do host do app e do admin vai para o domínio público", () => {
    expect(origemDoSite("user.xcart.app")).toBe("https://xcart.app");
    expect(origemDoSite("adm.xcart.app")).toBe("https://xcart.app");
    expect(origemDoSite("USER.xcart.app:443")).toBe("https://xcart.app");
  });
  it("local e prévia ficam relativos", () => {
    expect(origemDoSite("localhost:3000")).toBe("");
    expect(origemDoSite("xcart-git-redesign.vercel.app")).toBe("");
    expect(origemDoSite(null)).toBe("");
  });
  it("host esquisito não vira link", () => {
    expect(origemDoSite("user.evil.com/x")).toBe("");
    expect(origemDoSite("user.")).toBe("");
  });
});
