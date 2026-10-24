import { describe, expect, it } from "vitest";
import {
  NOME_MAXIMO,
  cnpjValido,
  cpfValido,
  dadosDoCadastro,
  digitosDoTelefone,
  documentoParaLer,
  erroDoDocumento,
  erroDoNome,
  erroDoTelefone,
  formatarDocumento,
  formatarTelefone,
  limparNome,
  mascaraDocumento,
  mascaraTelefone,
  nomeCompleto,
  telefoneValido,
  tipoDoDocumento,
} from "../src/lib/cadastro";
import { FILTROS_PADRAO, filtrarUsuarios } from "../src/app/admin/formato";

// Dados do "Criar conta": mascara, digito verificador e formatacao do admin.
// O banco (077) confere so o formato; o digito e daqui.

describe("CPF", () => {
  it("válidos", () => {
    for (const c of ["52998224725", "11144477735", "12345678909"]) expect(cpfValido(c)).toBe(true);
  });
  it("dígito verificador errado", () => {
    expect(cpfValido("52998224724")).toBe(false);
    expect(cpfValido("12345678900")).toBe(false);
  });
  it("todos iguais passam na conta, mas não valem", () => {
    for (let n = 0; n <= 9; n++) expect(cpfValido(String(n).repeat(11))).toBe(false);
  });
  it("só 11 dígitos, sem máscara", () => {
    expect(cpfValido("529.982.247-25")).toBe(false);
    expect(cpfValido("5299822472")).toBe(false);
  });
});

describe("CNPJ", () => {
  it("válidos", () => {
    for (const c of ["11222333000181", "12345678000195", "11444777000161"]) expect(cnpjValido(c)).toBe(true);
  });
  it("dígito errado e todos iguais", () => {
    expect(cnpjValido("11222333000180")).toBe(false);
    expect(cnpjValido("11222333000191")).toBe(false);
    for (let n = 0; n <= 9; n++) expect(cnpjValido(String(n).repeat(14))).toBe(false);
  });
});

describe("campo CPF ou CNPJ", () => {
  it("máscara de CPF até 11 dígitos e de CNPJ a partir do 12º", () => {
    expect(mascaraDocumento("")).toBe("");
    expect(mascaraDocumento("1234")).toBe("123.4");
    expect(mascaraDocumento("1234567")).toBe("123.456.7");
    expect(mascaraDocumento("52998224725")).toBe("529.982.247-25");
    expect(mascaraDocumento("123456789012")).toBe("12.345.678/9012");
    expect(mascaraDocumento("11222333000181")).toBe("11.222.333/0001-81");
  });
  it("aceita o texto já mascarado e corta no 14º dígito", () => {
    expect(mascaraDocumento("529.982.247-25")).toBe("529.982.247-25");
    expect(mascaraDocumento("11.222.333/0001-819")).toBe("11.222.333/0001-81");
    expect(mascaraDocumento("abc")).toBe("");
  });
  it("nunca termina em separador (o apagar do celular não trava)", () => {
    for (let n = 1; n <= 14; n++) expect(mascaraDocumento("1".repeat(n))).toMatch(/\d$/);
  });
  it("erro por caso, curto", () => {
    expect(erroDoDocumento("")).toBe("Escreva seu CPF ou CNPJ.");
    expect(erroDoDocumento("529.982.247")).toBe("O CPF tem 11 números e o CNPJ, 14.");
    expect(erroDoDocumento("529.982.247-24")).toBe("CPF inválido. Confira os números.");
    expect(erroDoDocumento("111.111.111-11")).toBe("CPF inválido. Confira os números.");
    expect(erroDoDocumento("11.222.333/0001-80")).toBe("CNPJ inválido. Confira os números.");
    expect(erroDoDocumento("529.982.247-25")).toBeUndefined();
    expect(erroDoDocumento("11.222.333/0001-81")).toBeUndefined();
  });
  it("tipo pelo tamanho", () => {
    expect(tipoDoDocumento("52998224725")).toBe("CPF");
    expect(tipoDoDocumento("11.222.333/0001-81")).toBe("CNPJ");
  });
});

describe("telefone", () => {
  it("máscara enquanto digita, sem separador no fim", () => {
    expect(mascaraTelefone("")).toBe("");
    expect(mascaraTelefone("1")).toBe("(1");
    expect(mascaraTelefone("11")).toBe("(11");
    expect(mascaraTelefone("119")).toBe("(11) 9");
    expect(mascaraTelefone("119123")).toBe("(11) 9123");
    expect(mascaraTelefone("1191234")).toBe("(11) 9123-4");
    expect(mascaraTelefone("1132345678")).toBe("(11) 3234-5678");
    expect(mascaraTelefone("11912345678")).toBe("(11) 91234-5678");
    expect(mascaraTelefone("119123456789")).toBe("(11) 91234-5678");
  });
  it("colado com +55 ou com 0 na frente", () => {
    expect(digitosDoTelefone("+55 11 91234-5678")).toBe("11912345678");
    expect(digitosDoTelefone("5511912345678")).toBe("11912345678");
    expect(digitosDoTelefone("011 91234-5678")).toBe("11912345678");
  });
  it("DDD 55 (Santa Maria) não perde o DDD com dígito a mais", () => {
    expect(digitosDoTelefone("(55) 99123-45678")).toBe("55991234567");
    expect(telefoneValido("55991234567")).toBe(true);
  });
  it("valida DDD, celular com 9 e fixo de 2 a 5", () => {
    expect(telefoneValido("31991234567")).toBe(true);
    expect(telefoneValido("3132345678")).toBe(true);
    expect(telefoneValido("2091234567")).toBe(false); // DDD 20 nao existe
    expect(telefoneValido("11812345678")).toBe(false); // celular sem o 9
    expect(telefoneValido("1191234567")).toBe(false); // 10 digitos com 9: celular antigo
    expect(telefoneValido("1162345678")).toBe(false);
  });
  it("erro por caso, curto", () => {
    expect(erroDoTelefone("")).toBe("Escreva seu telefone com DDD.");
    expect(erroDoTelefone("(11) 9123")).toMatch(/Faltam números/);
    expect(erroDoTelefone("(20) 91234-5678")).toBe("Esse DDD não existe. Confira.");
    expect(erroDoTelefone("(11) 81234-5678")).toMatch(/Confira o número/);
    expect(erroDoTelefone("(11) 91234-5678")).toBeUndefined();
    expect(erroDoTelefone("(31) 3234-5678")).toBeUndefined();
  });
});

describe("nome e sobrenome", () => {
  it("limpa controle e espaço repetido", () => {
    expect(limparNome("  Ana \u0007  Maria  ")).toBe("Ana Maria");
    expect(limparNome("Jo​ão")).toBe("João");
  });
  it("obrigatórios, curtos e com letra", () => {
    expect(erroDoNome(" ", "nome")).toBe("Escreva seu nome.");
    expect(erroDoNome("", "sobrenome")).toBe("Escreva seu sobrenome.");
    expect(erroDoNome("x".repeat(NOME_MAXIMO + 1), "nome")).toBe(`Use até ${NOME_MAXIMO} caracteres.`);
    expect(erroDoNome("123", "nome")).toBe("Escreva com letras.");
    expect(erroDoNome("Zé", "nome")).toBeUndefined();
  });
  it("nome completo do admin: o do cadastro, senão o full_name antigo", () => {
    expect(nomeCompleto("Arthur", "Ferreira", "outro")).toBe("Arthur Ferreira");
    expect(nomeCompleto(null, null, "Arthur F")).toBe("Arthur F");
    expect(nomeCompleto(null, null, 42)).toBeNull();
    expect(nomeCompleto(null, null, undefined)).toBeNull();
  });
});

describe("o que vai no signUp", () => {
  it("tudo limpo e só com dígitos, nas chaves que o trigger lê", () => {
    const d = dadosDoCadastro({
      nome: " Arthur ",
      sobrenome: "Ferreira  Gomes",
      telefone: "(31) 99123-4567",
      documento: "529.982.247-25",
    });
    expect(d).toEqual({
      nome: "Arthur",
      sobrenome: "Ferreira Gomes",
      full_name: "Arthur Ferreira Gomes",
      telefone: "31991234567",
      documento: "52998224725",
    });
    // Nenhuma chave de privilegio sai daqui.
    expect(Object.keys(d).sort()).toEqual(["documento", "full_name", "nome", "sobrenome", "telefone"]);
  });
});

describe("formatação do admin", () => {
  it("telefone e documento gravados só com dígitos", () => {
    expect(formatarTelefone("31991234567")).toBe("(31) 99123-4567");
    expect(formatarTelefone("3132345678")).toBe("(31) 3234-5678");
    expect(formatarTelefone(null)).toBeNull();
    expect(formatarDocumento("52998224725")).toBe("CPF 529.982.247-25");
    expect(formatarDocumento("11222333000181")).toBe("CNPJ 11.222.333/0001-81");
    expect(formatarDocumento("")).toBeNull();
    expect(documentoParaLer("123")).toEqual({ tipo: null, numero: "123" });
  });
  it("a busca da lista acha por nome (sem acento), telefone e documento", () => {
    const base = { plan: "free", isAdmin: false, accessGranted: false, stores: [] };
    const usuarios = [
      { ...base, email: "a@x.com", nome: "João Silva", telefone: "31991234567", documento: "52998224725" },
      { ...base, email: "b@x.com", nome: null, telefone: null, documento: null },
    ];
    const achar = (busca: string) => filtrarUsuarios(usuarios, { ...FILTROS_PADRAO, busca }).map((u) => u.email);
    expect(achar("joao")).toEqual(["a@x.com"]);
    expect(achar("(31) 99123")).toEqual(["a@x.com"]);
    expect(achar("529.982")).toEqual(["a@x.com"]);
    expect(achar("12")).toEqual([]); // menos de 3 digitos nao busca numero
    expect(achar("b@x")).toEqual(["b@x.com"]);
  });
});
