import { describe, expect, it } from "vitest";
import {
  dataDeAjuste,
  emailParaGoogle,
  nomeParaGoogle,
  normalizarNome,
  normalizarTelefone,
  sha256,
  telefoneE164,
} from "../src/lib/tracking/normalizar";
import { montarIdentificadoresGoogle } from "../src/lib/tracking/purchase";

/**
 * O Google compara HASH com HASH, e normaliza DIFERENTE do Meta.
 *
 * Nenhuma das divergencias da erro. O hash sai valido, a API responde sucesso e
 * o identificador simplesmente nao casa com ninguem -- enhanced conversions
 * "ligado" sem efeito nenhum. Estes testes travam as tres diferencas que
 * existem hoje entre os dois destinos.
 */

describe("telefone: Google quer E.164 com +, Meta quer digitos", () => {
  it("mantem o + quando o numero ja veio internacional", () => {
    expect(telefoneE164("+81 90-1234-5678")).toBe("+819012345678");
  });

  it("cola o DDI do pais quando o numero e nacional", () => {
    expect(telefoneE164("11 98765-4321", "BR")).toBe("+5511987654321");
  });

  it("derruba o zero do tronco nacional antes do DDI", () => {
    expect(telefoneE164("090-1234-5678", "JP")).toBe("+819012345678");
  });

  it("nao duplica o DDI quando o numero ja o inclui", () => {
    expect(telefoneE164("5511987654321", "BR")).toBe("+5511987654321");
  });

  /**
   * O ponto principal. Colar `+` num numero nacional de pais desconhecido
   * produz um E.164 mentiroso: no melhor caso nao casa com ninguem, no pior
   * casa com outra pessoa em outro pais. Nao mandar o identificador e melhor.
   */
  it("devolve null quando nao da para afirmar o pais", () => {
    expect(telefoneE164("11987654321", null)).toBeNull();
    expect(telefoneE164("11987654321", "ZZ")).toBeNull();
  });

  it("difere do formato do Meta: la sem +, aqui com", () => {
    expect(normalizarTelefone("11987654321", "BR")).toBe("5511987654321");
    expect(telefoneE164("11987654321", "BR")).toBe("+5511987654321");
  });
});

describe("e-mail: a regra do gmail", () => {
  it("remove os pontos da parte local em gmail.com", () => {
    expect(emailParaGoogle("Jo.ao.Silva@Gmail.com")).toBe("joaosilva@gmail.com");
  });

  it("vale tambem para googlemail.com", () => {
    expect(emailParaGoogle("a.b@googlemail.com")).toBe("ab@googlemail.com");
  });

  it("NAO remove pontos em outros dominios", () => {
    // Fora do Google, "a.b@" e "ab@" sao caixas diferentes de verdade.
    expect(emailParaGoogle("a.b@outlook.com")).toBe("a.b@outlook.com");
  });

  it("recusa o que nao e e-mail", () => {
    expect(emailParaGoogle("semarroba")).toBeNull();
    expect(emailParaGoogle("")).toBeNull();
  });
});

describe("nome: o Google mantem acento, o Meta tira", () => {
  it("nao tira acento", () => {
    expect(nomeParaGoogle("José")).toBe("josé");
  });

  it("difere do do Meta no mesmo nome", () => {
    // Se usassemos a funcao do Meta aqui, o hash seria de "jose" enquanto o
    // Google calculou o de "josé". Hash valido, match zero.
    expect(normalizarNome("José")).toBe("jose");
    expect(nomeParaGoogle("José")).not.toBe(normalizarNome("José"));
  });

  it("baixa a caixa e junta espaco repetido", () => {
    expect(nomeParaGoogle("  Yuki   TANAKA ")).toBe("yuki tanaka");
  });
});

describe("data do ajuste", () => {
  it("sai no formato exato que a API exige, em UTC", () => {
    const d = new Date("2026-09-25T14:05:09.800Z");
    expect(dataDeAjuste(d)).toBe("2026-09-25 14:05:09+00:00");
  });

  it("preenche com zero a esquerda", () => {
    const d = new Date("2026-01-02T03:04:05Z");
    expect(dataDeAjuste(d)).toBe("2026-01-02 03:04:05+00:00");
  });
});

describe("identificadores a partir do pedido", () => {
  const pedido = {
    id: 5678901234567,
    email: "Cliente@Gmail.com",
    currency: "JPY",
    total_price: "12800",
    customer: {
      email: "Cli.ente@Gmail.com",
      phone: "090-1234-5678",
      first_name: "Yuki",
      last_name: "Tanaka",
    },
    billing_address: {
      first_name: "Yuki",
      last_name: "Tanaka",
      city: "Tokyo",
      province: "Tokyo",
      zip: "150-0001",
      country_code: "JP",
    },
  };

  it("cada sinal vira um item separado da lista", () => {
    // O campo do Google e um oneof: hashedEmail e addressInfo no MESMO objeto
    // limpariam um dos dois.
    const ids = montarIdentificadoresGoogle(pedido);
    for (const id of ids) {
      const preenchidos = ["hashedEmail", "hashedPhoneNumber", "addressInfo"].filter(
        (k) => k in id
      );
      expect(preenchidos).toHaveLength(1);
    }
  });

  it("hasheia o e-mail com a regra do gmail aplicada", () => {
    const ids = montarIdentificadoresGoogle(pedido);
    const email = ids.find((i) => "hashedEmail" in i) as { hashedEmail: string };
    expect(email.hashedEmail).toBe(sha256("cliente@gmail.com"));
  });

  it("hasheia o telefone em E.164, usando o pais do endereco", () => {
    const ids = montarIdentificadoresGoogle(pedido);
    const tel = ids.find((i) => "hashedPhoneNumber" in i) as {
      hashedPhoneNumber: string;
    };
    expect(tel.hashedPhoneNumber).toBe(sha256("+819012345678"));
  });

  it("manda cidade, estado e pais em CLARO e o nome hasheado", () => {
    const ids = montarIdentificadoresGoogle(pedido);
    const end = ids.find((i) => "addressInfo" in i) as {
      addressInfo: Record<string, string>;
    };
    expect(end.addressInfo).toMatchObject({
      hashedFirstName: sha256("yuki"),
      hashedLastName: sha256("tanaka"),
      countryCode: "JP",
      postalCode: "150-0001",
      city: "tokyo",
      state: "tokyo",
    });
  });

  it("marca tudo como FIRST_PARTY", () => {
    for (const id of montarIdentificadoresGoogle(pedido)) {
      expect(id.userIdentifierSource).toBe("FIRST_PARTY");
    }
  });

  /**
   * O Google exige nome, sobrenome, pais e CEP juntos e descarta o
   * identificador inteiro se faltar um. Montar pela metade gastaria uma das 5
   * vagas para nada.
   */
  it("omite o endereco quando falta o CEP", () => {
    const semCep = {
      ...pedido,
      billing_address: { ...pedido.billing_address, zip: "" },
    };
    const ids = montarIdentificadoresGoogle(semCep);
    expect(ids.some((i) => "addressInfo" in i)).toBe(false);
    // Mas o e-mail continua indo: um sinal ausente nao derruba os outros.
    expect(ids.some((i) => "hashedEmail" in i)).toBe(true);
  });

  it("omite o telefone quando o pais e desconhecido", () => {
    const semPais = {
      ...pedido,
      customer: { ...pedido.customer, phone: "11987654321" },
      billing_address: { ...pedido.billing_address, country_code: "" },
    };
    const ids = montarIdentificadoresGoogle(semPais);
    expect(ids.some((i) => "hashedPhoneNumber" in i)).toBe(false);
  });

  it("devolve lista vazia para pedido sem nenhum dado pessoal", () => {
    // A fila usa isto para nao enfileirar um enhancement que nada acrescenta.
    expect(montarIdentificadoresGoogle({ id: 1 })).toHaveLength(0);
  });
});
