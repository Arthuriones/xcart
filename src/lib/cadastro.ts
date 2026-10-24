// ============================================================================
// Dados do cadastro ("Criar conta"): nome, sobrenome, telefone do Brasil e
// CPF/CNPJ. Mascara do campo, validacao (com o digito verificador do CPF e do
// CNPJ) e formatacao para o admin. Sem React e sem rede: o formulario, o admin
// e tests/cadastro-dados.test.ts usam.
//
// O signUp e do navegador direto no Supabase: quem grava o perfil e o trigger
// handle_new_user (migration 077), que confere so o FORMATO (so digitos, 10/11
// no telefone, 11/14 no documento). O digito verificador e conferido aqui.
// Telefone e documento sao dado pessoal: nada de console.log com eles.
// ============================================================================

export const NOME_MAXIMO = 60;

export function soDigitos(v: string | null | undefined): string {
  return (v || "").replace(/\D/g, "");
}

// ---------------------------------------------------------------------------
// Nome e sobrenome
// ---------------------------------------------------------------------------

// RegExp por string: o target do tsconfig (ES2017) nao aceita \p{} em literal.
const CONTROLE = new RegExp("[\\p{Cc}\\p{Cf}]", "gu");
const LETRA = new RegExp("\\p{L}", "u");

/** Sem caractere de controle e sem espaco repetido (o trigger repete o basico: controle, espaco, 60). */
export function limparNome(v: string): string {
  return (v || "").normalize("NFC").replace(CONTROLE, "").replace(/\s+/g, " ").trim();
}

export function erroDoNome(v: string, campo: "nome" | "sobrenome"): string | undefined {
  const n = limparNome(v);
  if (!n) return campo === "nome" ? "Escreva seu nome." : "Escreva seu sobrenome.";
  if (n.length > NOME_MAXIMO) return `Use até ${NOME_MAXIMO} caracteres.`;
  if (!LETRA.test(n)) return "Escreva com letras.";
  return undefined;
}

/**
 * Nome para o admin: "Nome Sobrenome" do cadastro; conta de antes da 077 cai
 * no full_name que o cadastro antigo ja mandava (`reserva`).
 */
export function nomeCompleto(
  nome: string | null | undefined,
  sobrenome: string | null | undefined,
  reserva?: unknown
): string | null {
  const junto = limparNome(`${nome ?? ""} ${sobrenome ?? ""}`);
  if (junto) return junto;
  const antigo = typeof reserva === "string" ? limparNome(reserva) : "";
  return antigo || null;
}

// ---------------------------------------------------------------------------
// Telefone (DDD + numero)
// ---------------------------------------------------------------------------

// DDDs que existem (Anatel). 20, 23, 25, 26, 29, 30, 36, 39, 40, 50, 52, 56-60,
// 70, 72, 76, 78, 80 e 90 nao existem.
const DDDS = new Set(
  (
    "11 12 13 14 15 16 17 18 19 21 22 24 27 28 31 32 33 34 35 37 38 " +
    "41 42 43 44 45 46 47 48 49 51 53 54 55 61 62 63 64 65 66 67 68 69 " +
    "71 73 74 75 77 79 81 82 83 84 85 86 87 88 89 91 92 93 94 95 96 97 98 99"
  ).split(" ")
);

/** Celular: 9 + 8 digitos. Fixo: comeca com 2 a 5, 8 digitos. */
function numeroValido(d: string): boolean {
  return /^\d{2}9\d{8}$/.test(d) || /^\d{2}[2-5]\d{7}$/.test(d);
}

export function telefoneValido(d: string): boolean {
  return DDDS.has(d.slice(0, 2)) && numeroValido(d);
}

/**
 * Os digitos do telefone, no maximo 11. Colou "+55 11 91234-5678" (o que o
 * WhatsApp copia): tira o 55 do pais -- so quando o resto e um telefone
 * valido, porque 55 tambem e DDD (Santa Maria). O 0 da frente (operadora) sai.
 */
export function digitosDoTelefone(v: string): string {
  const d = soDigitos(v).replace(/^0+/, "");
  if (d.length > 11 && d.startsWith("55") && telefoneValido(d.slice(2, 13))) return d.slice(2, 13);
  return d.slice(0, 11);
}

/**
 * "(11) 91234-5678" enquanto digita. Nunca termina em separador: se
 * terminasse, o apagar do celular tirava o separador e a mascara o punha de
 * volta (o campo travava).
 */
export function mascaraTelefone(v: string): string {
  const d = digitosDoTelefone(v);
  if (d.length <= 2) return d ? `(${d}` : "";
  const ddd = `(${d.slice(0, 2)}) `;
  const resto = d.slice(2);
  // Ate 10 digitos o corte e 4-4 (fixo); com 11, 5-4 (celular).
  const corte = d.length === 11 ? 5 : 4;
  if (resto.length <= corte) return ddd + resto;
  return `${ddd}${resto.slice(0, corte)}-${resto.slice(corte)}`;
}

export function erroDoTelefone(v: string): string | undefined {
  const d = digitosDoTelefone(v);
  if (!d) return "Escreva seu telefone com DDD.";
  if (d.length < 10) return "Faltam números: escreva o DDD e o número completo.";
  if (!DDDS.has(d.slice(0, 2))) return "Esse DDD não existe. Confira.";
  if (!numeroValido(d)) return "Confira o número, como (11) 91234-5678.";
  return undefined;
}

/** Para o admin: o numero gravado (so digitos) com a mascara. */
export function formatarTelefone(d: string | null | undefined): string | null {
  const s = soDigitos(d);
  if (!s) return null;
  return s.length === 10 || s.length === 11 ? mascaraTelefone(s) : s;
}

// ---------------------------------------------------------------------------
// CPF e CNPJ
// ---------------------------------------------------------------------------

// 111.111.111-11 e 00.000.000/0000-00 PASSAM no digito verificador: o
// "tudo igual" e recusado antes da conta.
const TUDO_IGUAL = /^(\d)\1+$/;

export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || TUDO_IGUAL.test(d)) return false;
  for (const ate of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < ate; i++) soma += Number(d[i]) * (ate + 1 - i);
    const dv = ((soma * 10) % 11) % 10;
    if (dv !== Number(d[ate])) return false;
  }
  return true;
}

export function cnpjValido(d: string): boolean {
  if (!/^\d{14}$/.test(d) || TUDO_IGUAL.test(d)) return false;
  for (const ate of [12, 13]) {
    let soma = 0;
    // Pesos da direita para a esquerda: 2, 3, ..., 9 e volta ao 2.
    for (let i = 0; i < ate; i++) soma += Number(d[ate - 1 - i]) * ((i % 8) + 2);
    const r = soma % 11;
    if ((r < 2 ? 0 : 11 - r) !== Number(d[ate])) return false;
  }
  return true;
}

export type TipoDocumento = "CPF" | "CNPJ";

/** Ate 11 digitos e CPF; de 12 a 14, CNPJ. */
export function tipoDoDocumento(d: string): TipoDocumento {
  return soDigitos(d).length > 11 ? "CNPJ" : "CPF";
}

export function digitosDoDocumento(v: string): string {
  return soDigitos(v).slice(0, 14);
}

/** "000.000.000-00" ate 11 digitos; a partir do 12o vira "00.000.000/0000-00". */
export function mascaraDocumento(v: string): string {
  const d = digitosDoDocumento(v);
  const juntar = (partes: [string, number, number][]) =>
    partes.reduce((s, [sep, de, ate]) => (d.length > de ? s + sep + d.slice(de, ate) : s), "");
  if (d.length <= 11) {
    return juntar([["", 0, 3], [".", 3, 6], [".", 6, 9], ["-", 9, 11]]);
  }
  return juntar([["", 0, 2], [".", 2, 5], [".", 5, 8], ["/", 8, 12], ["-", 12, 14]]);
}

export function erroDoDocumento(v: string): string | undefined {
  const d = digitosDoDocumento(v);
  if (!d) return "Escreva seu CPF ou CNPJ.";
  if (d.length !== 11 && d.length !== 14) return "O CPF tem 11 números e o CNPJ, 14.";
  if (d.length === 11 && !cpfValido(d)) return "CPF inválido. Confira os números.";
  if (d.length === 14 && !cnpjValido(d)) return "CNPJ inválido. Confira os números.";
  return undefined;
}

/**
 * Para o admin: tipo e numero com mascara. Gravado fora do tamanho (nao
 * deveria: o trigger e a cobranca so gravam 11 ou 14) sai cru e sem tipo.
 */
export function documentoParaLer(
  d: string | null | undefined
): { tipo: TipoDocumento | null; numero: string } | null {
  const s = soDigitos(d);
  if (!s) return null;
  if (s.length === 11 || s.length === 14) return { tipo: tipoDoDocumento(s), numero: mascaraDocumento(s) };
  return { tipo: null, numero: s };
}

/** "CPF 123.456.789-09" ou "CNPJ 12.345.678/0001-95". */
export function formatarDocumento(d: string | null | undefined): string | null {
  const p = documentoParaLer(d);
  if (!p) return null;
  return p.tipo ? `${p.tipo} ${p.numero}` : p.numero;
}

// ---------------------------------------------------------------------------
// O que vai no signUp
// ---------------------------------------------------------------------------

export type DadosDoCadastro = {
  nome: string;
  sobrenome: string;
  /** O menu do app ja le full_name para mostrar quem esta logado. */
  full_name: string;
  telefone: string;
  documento: string;
};

/**
 * O options.data do signUp: tudo limpo e so com digitos. O trigger le estas
 * chaves (nome, sobrenome, telefone, documento) e grava no perfil.
 */
export function dadosDoCadastro(c: {
  nome: string;
  sobrenome: string;
  telefone: string;
  documento: string;
}): DadosDoCadastro {
  const nome = limparNome(c.nome);
  const sobrenome = limparNome(c.sobrenome);
  return {
    nome,
    sobrenome,
    full_name: `${nome} ${sobrenome}`.trim(),
    telefone: digitosDoTelefone(c.telefone),
    documento: digitosDoDocumento(c.documento),
  };
}
