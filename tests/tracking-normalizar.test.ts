import { describe, expect, it } from "vitest";
import {
  contarSinais,
  montarFbc,
  montarUserData,
  normalizarCep,
  normalizarCidade,
  normalizarEmail,
  normalizarNome,
  normalizarPais,
  normalizarTelefone,
  sha256,
} from "../src/lib/tracking/normalizar";

/**
 * O Meta compara HASH com HASH.
 *
 * Normalizar diferente do que ele normaliza nao da erro nem aviso: o hash sai
 * diferente e o casamento simplesmente nao acontece. O sintoma e um Event
 * Match Quality baixo que ninguem consegue explicar. Por isso a normalizacao
 * esta travada aqui campo a campo.
 */
describe("normalizacao dos sinais de match", () => {
  it("e-mail vai em minusculo e sem espaco", () => {
    expect(normalizarEmail("  Joao@Gmail.COM ")).toBe("joao@gmail.com");
    // O mesmo comprador tem que produzir o mesmo hash, escreva como escrever.
    expect(sha256(normalizarEmail("Joao@Gmail.com")!)).toBe(
      sha256(normalizarEmail("joao@gmail.com ")!)
    );
  });

  it("recusa o que nao e e-mail em vez de hashear lixo", () => {
    expect(normalizarEmail("joao")).toBeNull();
    expect(normalizarEmail("")).toBeNull();
    expect(normalizarEmail(null)).toBeNull();
  });

  it("telefone internacional perde o '+' e fica so digito", () => {
    expect(normalizarTelefone("+55 (11) 98765-4321")).toBe("5511987654321");
    expect(normalizarTelefone("+81 90-1234-5678")).toBe("819012345678");
  });

  it("telefone nacional recebe o DDI do pais do pedido", () => {
    expect(normalizarTelefone("(11) 98765-4321", "BR")).toBe("5511987654321");
    expect(normalizarTelefone("090-1234-5678", "JP")).toBe("819012345678");
  });

  it("o zero de tronco nacional cai antes do DDI", () => {
    // "090..." no Japao e "90..." em formato internacional. Manter o zero
    // geraria um numero que nao existe e um hash que nao casa com ninguem.
    expect(normalizarTelefone("090-1234-5678", "JP")).not.toContain("81090");
  });

  it("nao inventa DDI para pais desconhecido", () => {
    // Colar um DDI errado e pior que nao casar: casaria com outra pessoa.
    expect(normalizarTelefone("11987654321", "XX")).toBe("11987654321");
    expect(normalizarTelefone("11987654321")).toBe("11987654321");
  });

  it("nome perde acento e pontuacao", () => {
    expect(normalizarNome("  João  ")).toBe("joao");
    expect(normalizarNome("D'Ávila")).toBe("davila");
    expect(normalizarNome("Mary-Jane")).toBe("maryjane");
  });

  it("cidade perde espaco e acento", () => {
    expect(normalizarCidade("São Paulo")).toBe("saopaulo");
    expect(normalizarCidade("New York")).toBe("newyork");
  });

  it("CEP americano vai so com os 5 primeiros digitos", () => {
    // ZIP+4 nao casa com o cadastro do Meta.
    expect(normalizarCep("94107-1234", "US")).toBe("94107");
    // Fora dos EUA o formato local e mantido, so sem hifen e espaco.
    expect(normalizarCep("01310-100", "BR")).toBe("01310100");
    expect(normalizarCep("150-0001", "JP")).toBe("1500001");
  });

  it("pais so passa se for ISO de duas letras", () => {
    expect(normalizarPais("BR")).toBe("br");
    expect(normalizarPais("Brasil")).toBeNull();
  });
});

describe("fbc reconstruido a partir do fbclid", () => {
  it("monta no formato que o Meta espera", () => {
    expect(montarFbc("ABC123", 1_700_000_000_000)).toBe("fb.1.1700000000000.ABC123");
  });

  it("sem fbclid nao inventa nada", () => {
    expect(montarFbc(null)).toBeNull();
    expect(montarFbc("  ")).toBeNull();
  });
});

describe("user_data do CAPI", () => {
  const pedido = {
    email: "Cliente@Exemplo.com",
    telefone: "090-1234-5678",
    primeiroNome: "Yuki",
    sobrenome: "Tanaka",
    cidade: "Tokyo",
    estado: "Tokyo",
    cep: "150-0001",
    pais: "JP",
    externalId: "cliente-99",
  };

  it("hasheia toda PII e deixa IP e user agent em claro", () => {
    const ud = montarUserData(pedido, {
      fbp: "fb.1.1700000000000.123",
      fbc: "fb.1.1700000000000.ABC",
      clientIp: "203.0.113.9",
      userAgent: "Mozilla/5.0",
    });

    // 64 hex = SHA-256.
    for (const campo of ["em", "ph", "fn", "ln", "ct", "st", "zp", "country", "external_id"] as const) {
      expect(ud[campo]?.[0], campo).toMatch(/^[a-f0-9]{64}$/);
    }
    // Hashear estes dois quebraria o match: o Meta usa o valor cru.
    expect(ud.client_ip_address).toBe("203.0.113.9");
    expect(ud.client_user_agent).toBe("Mozilla/5.0");
    expect(ud.fbp).toBe("fb.1.1700000000000.123");
  });

  it("o hash e do valor JA normalizado", () => {
    const ud = montarUserData({ email: "  Cliente@EXEMPLO.com " });
    expect(ud.em?.[0]).toBe(sha256("cliente@exemplo.com"));
  });

  it("campo ausente nao vira hash de string vazia", () => {
    // Hash de "" e constante: casaria com todo mundo e envenenaria o match.
    const ud = montarUserData({ email: "a@b.com" });
    expect(ud.ph).toBeUndefined();
    expect(ud.ct).toBeUndefined();
    expect(JSON.stringify(ud)).not.toContain(sha256(""));
  });

  it("pedido completo entrega bem mais sinal que so os cookies", () => {
    // Mandar so fbp/fbc e o que trava o EMQ em 4.
    const soCookies = montarUserData({}, { fbp: "x", fbc: "y" });
    const completo = montarUserData(pedido, {
      fbp: "x", fbc: "y", clientIp: "203.0.113.9", userAgent: "UA",
    });
    expect(contarSinais(soCookies)).toBe(2);
    expect(contarSinais(completo)).toBeGreaterThanOrEqual(11);
  });
});
