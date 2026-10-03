// ============================================================================
// Regras puras das telas de acesso (/login e /set-password): os modos do
// formulario, a validacao dos campos, a traducao dos erros do Supabase, o
// aviso de link expirado, a forca da senha e o endereco das paginas legais.
// Sem React e sem rede: travado por tests/acesso-tela.test.ts.
// ============================================================================

export type Modo = "entrar" | "criar" | "link" | "esqueci";

/**
 * ?mode= da URL. A landing manda "signup" para quem clicou em "Começar agora".
 * Sem modo e com ?error= (link que falhou), ja abre em "Entrar com link": o
 * aviso pede outro link e o formulario e exatamente esse.
 */
export function modoInicial(param: string | null | undefined, erroDaUrl?: string | null): Modo {
  if (param === "signup") return "criar";
  if (param === "link") return "link";
  if (!param && erroDaUrl) return "link";
  return "entrar";
}

/** "link" e "esqueci" mandam o mesmo link: ele entra na conta e abre a tela de senha. */
export function pedeLink(modo: Modo): boolean {
  return modo === "link" || modo === "esqueci";
}

export const TITULO: Record<Modo, string> = {
  entrar: "Entrar",
  criar: "Criar conta",
  link: "Entrar com link por e-mail",
  esqueci: "Esqueci a senha",
};

export const SUBTITULO: Record<Modo, string> = {
  entrar: "Use o e-mail e a senha da sua conta.",
  criar: "Com a conta criada, você escolhe o plano e conecta a primeira loja Shopify.",
  link: "Mandamos um link que entra na sua conta sem pedir a senha.",
  esqueci: "Mandamos um link que entra na sua conta. Lá você cria uma senha nova.",
};

export const BOTAO: Record<Modo, string> = {
  entrar: "Entrar",
  criar: "Criar conta",
  link: "Enviar link",
  esqueci: "Enviar link",
};

/** Titulo do aviso de erro quando a traducao nao traz um proprio. */
export const TITULO_ERRO: Record<Modo, string> = {
  entrar: "Não deu para entrar",
  criar: "A conta não foi criada",
  link: "O link não foi enviado",
  esqueci: "O link não foi enviado",
};

// ---------------------------------------------------------------------------
// Senha
// ---------------------------------------------------------------------------

/** O minimo do Supabase (e o que /set-password ja cobrava). */
export const SENHA_MINIMA = 6;

export type NivelForca = 0 | 1 | 2 | 3;

export type Forca = { nivel: NivelForca; rotulo: "" | "Curta demais" | "Fraca" | "Média" | "Forte" };

const SENHAS_COMUNS = new Set([
  "123456",
  "1234567",
  "12345678",
  "123456789",
  "1234567890",
  "123123",
  "111111",
  "000000",
  "654321",
  "abc123",
  "qwerty",
  "password",
  "senha",
  "senha1",
  "senha12",
  "senha123",
  "mudar123",
  "xcart",
  "xcart123",
  "shopify",
]);

/**
 * Medidor simples: comprimento e variedade de caracteres. Senha da lista das
 * mais usadas, ou um caractere repetido, e sempre fraca. Nao e regra de
 * aceite -- quem decide o aceite e o minimo de 6 caracteres.
 */
export function forcaDaSenha(senha: string): Forca {
  if (!senha) return { nivel: 0, rotulo: "" };
  if (senha.length < SENHA_MINIMA) return { nivel: 0, rotulo: "Curta demais" };
  if (SENHAS_COMUNS.has(senha.toLowerCase()) || /^(.)\1+$/.test(senha)) {
    return { nivel: 1, rotulo: "Fraca" };
  }
  const tipos = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(senha)).length;
  let pontos = 0;
  if (senha.length >= 10) pontos++;
  if (senha.length >= 14) pontos++;
  if (tipos >= 2) pontos++;
  if (tipos >= 3) pontos++;
  if (pontos >= 3) return { nivel: 3, rotulo: "Forte" };
  if (pontos === 2) return { nivel: 2, rotulo: "Média" };
  return { nivel: 1, rotulo: "Fraca" };
}

// ---------------------------------------------------------------------------
// Validacao dos campos: todos os problemas de uma vez, no campo.
// ---------------------------------------------------------------------------

export type CamposAcesso = { nome: string; email: string; senha: string };
export type ErrosDeCampo = Partial<Record<keyof CamposAcesso, string>>;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validarAcesso(modo: Modo, c: CamposAcesso): ErrosDeCampo {
  const erros: ErrosDeCampo = {};
  if (modo === "criar" && !c.nome.trim()) erros.nome = "Escreva seu nome.";
  const email = c.email.trim();
  if (!email) erros.email = "Escreva seu e-mail.";
  else if (!EMAIL.test(email)) erros.email = "Confira o e-mail: ele precisa ser como voce@empresa.com.";
  if (modo === "entrar" && !c.senha) erros.senha = "Escreva sua senha.";
  if (modo === "criar" && c.senha.length < SENHA_MINIMA) {
    erros.senha = `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  }
  return erros;
}

export type ErrosSenhaNova = { senha?: string; repetida?: string };

export function validarSenhaNova(senha: string, repetida: string): ErrosSenhaNova {
  const erros: ErrosSenhaNova = {};
  if (senha.length < SENHA_MINIMA) erros.senha = `A senha precisa ter pelo menos ${SENHA_MINIMA} caracteres.`;
  if (!repetida) erros.repetida = "Repita a senha para confirmar.";
  else if (senha !== repetida) erros.repetida = "As duas senhas não são iguais.";
  return erros;
}

// ---------------------------------------------------------------------------
// Erros do Supabase em portugues
// ---------------------------------------------------------------------------

export type ErroDeAcesso = {
  /** Quando a situacao pede um titulo proprio (senao vale TITULO_ERRO do modo). */
  titulo?: string;
  texto: string;
  /** Limite de tentativas: segundos ate liberar o botao. */
  esperarSegundos?: number;
  /** O e-mail ja tem conta: o formulario volta para "Entrar". */
  irParaEntrar?: boolean;
  /** A sessao do link acabou: o caminho e pedir outro link. */
  sessaoExpirada?: boolean;
  /** Mensagem crua, so quando nao ha frase para ela (fica recolhida). */
  detalhe?: string;
};

function partes(erro: unknown): { mensagem: string; codigo: string; status: number | null } {
  if (typeof erro === "string") return { mensagem: erro, codigo: "", status: null };
  if (erro && typeof erro === "object") {
    const e = erro as { message?: unknown; code?: unknown; status?: unknown };
    return {
      mensagem: typeof e.message === "string" ? e.message : "",
      codigo: typeof e.code === "string" ? e.code : "",
      status: typeof e.status === "number" ? e.status : null,
    };
  }
  return { mensagem: "", codigo: "", status: null };
}

export function erroDeAcesso(erro: unknown): ErroDeAcesso {
  const { mensagem, codigo, status } = partes(erro);
  const m = mensagem.toLowerCase();

  if (
    status === 429 ||
    codigo.startsWith("over_") ||
    /429|too many|security purposes|rate limit/.test(m)
  ) {
    const s = mensagem.match(/(\d+)\s*seconds?/i);
    return {
      titulo: "Muitas tentativas seguidas",
      texto: "Por segurança, espere a contagem do botão acabar e tente de novo.",
      esperarSegundos: s ? Number(s[1]) : 60,
    };
  }
  if (codigo === "invalid_credentials" || m.includes("invalid login credentials")) {
    return {
      texto:
        "O e-mail ou a senha não conferem. Se você costuma entrar pelo link do e-mail, use “Entrar com link por e-mail”.",
    };
  }
  if (codigo === "email_not_confirmed" || m.includes("email not confirmed")) {
    return {
      titulo: "E-mail ainda não confirmado",
      texto: "Abra o link que mandamos no cadastro ou peça um link de acesso por e-mail.",
    };
  }
  if (
    codigo === "user_already_exists" ||
    codigo === "email_exists" ||
    /already registered|already been registered|already exists/.test(m)
  ) {
    return {
      titulo: "Este e-mail já tem conta",
      texto: "Entre com a sua senha ou peça um link de acesso por e-mail.",
      irParaEntrar: true,
    };
  }
  if (codigo === "same_password" || m.includes("different from the old")) {
    return { texto: "A senha nova precisa ser diferente da atual." };
  }
  if (/known to be weak|pwned|easy to guess/.test(m)) {
    return { texto: "Essa senha aparece em vazamentos conhecidos e é fácil de adivinhar. Escolha outra." };
  }
  if (codigo === "weak_password" || /password should|at least \d+ characters/.test(m)) {
    return {
      texto: `A senha não passou nas regras de segurança. Use pelo menos ${SENHA_MINIMA} caracteres, misturando letras e números.`,
    };
  }
  if (
    codigo === "session_not_found" ||
    codigo === "session_expired" ||
    m.includes("session missing") ||
    m.includes("session expired") ||
    status === 401
  ) {
    return {
      titulo: "Sua sessão expirou",
      texto: "Peça um novo link por e-mail para continuar.",
      sessaoExpirada: true,
    };
  }
  if (codigo === "signup_disabled" || m.includes("signups not allowed")) {
    return { texto: "O cadastro de contas novas está fechado no momento." };
  }
  if (codigo === "email_address_invalid" || /invalid format|unable to validate email|email address .* is invalid/.test(m)) {
    return { texto: "Confira o e-mail: o endereço não parece certo." };
  }
  if (/failed to fetch|network|load failed|fetch failed/.test(m)) {
    return { texto: "A conexão caiu antes da resposta. Confira a internet e tente de novo." };
  }
  return {
    texto: "Não deu certo agora. Tente de novo em instantes.",
    detalhe: mensagem || undefined,
  };
}

// ---------------------------------------------------------------------------
// Volta de um link que nao funcionou
// ---------------------------------------------------------------------------

export type AvisoDoLink = { titulo: string; texto: string };

const LINK_EXPIRADO: AvisoDoLink = {
  titulo: "O link expirou ou já foi usado",
  texto: "Cada link vale uma vez, por pouco tempo, e só no navegador em que foi pedido. Peça outro.",
};

const LINK_FALHOU: AvisoDoLink = {
  titulo: "Não deu para entrar por este link",
  texto: "Peça outro link ou entre com e-mail e senha.",
};

/**
 * Dois caminhos trazem o aviso:
 * - ?error=link_invalido, que o /callback manda quando a troca do codigo falha;
 * - #error=...&error_code=otp_expired, que o Supabase poe no endereco quando o
 *   link ja chega vencido. O /callback redireciona para /login e o navegador
 *   leva o trecho depois do # junto.
 */
export function avisoDoLink(erroDaUrl: string | null | undefined, hash: string): AvisoDoLink | null {
  if (erroDaUrl === "link_invalido") return LINK_EXPIRADO;
  const h = new URLSearchParams(hash.replace(/^#/, ""));
  const codigo = h.get("error_code");
  if (codigo === "otp_expired" || codigo === "flow_state_expired") return LINK_EXPIRADO;
  if (h.get("error") || codigo) return LINK_FALHOU;
  if (erroDaUrl) return LINK_FALHOU;
  return null;
}

// ---------------------------------------------------------------------------
// Paginas legais
// ---------------------------------------------------------------------------

/**
 * Termos e Privacidade moram no dominio publico (xcart.app): no host do app
 * (user.) o middleware manda quem nao entrou para /login. Fora de user./adm.
 * (local, previa da Vercel) o link fica relativo.
 */
export function origemDoSite(host: string | null | undefined): string {
  if (!host) return "";
  const m = host.trim().toLowerCase().match(/^(?:user|adm)\.([a-z0-9.-]+\.[a-z]{2,})(?::\d+)?$/);
  return m ? `https://${m[1]}` : "";
}
