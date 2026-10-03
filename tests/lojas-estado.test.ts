import { describe, expect, it } from "vitest";
import {
  estadoConexao,
  filtrarLojas,
  itensInventario,
  mensagemConexao,
  moedaIdioma,
  nomeIdioma,
  quandoFoi,
  rotuloPapel,
  type InventarioLoja,
} from "@/lib/leitura/lojas-estado";

const OK = {
  ultimoErro: null,
  ultimoErroTipo: null,
  ultimoSyncOkEm: "2026-10-02T17:28:00Z",
  cargaInicialOk: true,
} as const;

describe("estadoConexao: ativas e sem acesso", () => {
  it("sem erro e conectada, entre as ativas", () => {
    const e = estadoConexao({ desinstaladaEm: null, sync: { ...OK } });
    expect(e.chave).toBe("conectada");
    expect(e.semAcesso).toBe(false);
    expect(e.sugestao).toBeNull();
    expect(e.detalhe).toBe("Pedidos em dia");
  });

  it("nunca sincronizou continua conectada, com a busca pendente", () => {
    const e = estadoConexao({ desinstaladaEm: null, sync: null });
    expect(e.chave).toBe("conectada");
    expect(e.detalhe).toMatch(/pendente/);
  });

  it("carga inicial em andamento avisa dos 60 dias", () => {
    const e = estadoConexao({ desinstaladaEm: null, sync: { ...OK, cargaInicialOk: false } });
    expect(e.detalhe).toMatch(/60 dias/);
  });

  it("app desinstalado vence qualquer outro sinal e sugere remover", () => {
    const e = estadoConexao({
      desinstaladaEm: "2026-09-27T15:00:00Z",
      sync: { ...OK, ultimoErroTipo: "negado", ultimoErro: "ACCESS_DENIED" },
    });
    expect(e.chave).toBe("appDesinstalado");
    expect(e.semAcesso).toBe(true);
    expect(e.sugestao).toBe("remover");
    expect(e.detalhe).toBe("desde 27/09");
  });

  it("negado (sem read_orders) e sem permissao e sugere reconectar", () => {
    const e = estadoConexao({
      desinstaladaEm: null,
      sync: { ...OK, ultimoErroTipo: "negado", ultimoErro: "ACCESS_DENIED: read_orders" },
    });
    expect(e.chave).toBe("semPermissao");
    expect(e.semAcesso).toBe(true);
    expect(e.sugestao).toBe("reconectar");
  });

  it("402 da Shopify e loja pausada, sugere remover", () => {
    const e = estadoConexao({
      desinstaladaEm: null,
      sync: {
        ...OK,
        ultimoErroTipo: "falhou",
        ultimoErro: "A Shopify recusou a chamada API com 402 Payment Required. Normalmente...",
      },
    });
    expect(e.chave).toBe("pausada");
    expect(e.semAcesso).toBe(true);
    expect(e.sugestao).toBe("remover");
  });

  it("credencial recusada e token invalido, desde o ultimo sync bom", () => {
    const e = estadoConexao({
      desinstaladaEm: null,
      sync: {
        ...OK,
        ultimoSyncOkEm: "2026-09-12T12:00:00Z",
        ultimoErroTipo: "falhou",
        ultimoErro: "Client ID ou Client Secret invalidos. Verifique as credenciais do app no Shopify.",
      },
    });
    expect(e.chave).toBe("tokenInvalido");
    expect(e.semAcesso).toBe(true);
    expect(e.sugestao).toBe("reconectar");
    expect(e.detalhe).toBe("desde 12/09");
  });

  it("outra falha continua ativa, com a sugestao de tentar de novo", () => {
    const e = estadoConexao({
      desinstaladaEm: null,
      sync: { ...OK, ultimoErroTipo: "falhou", ultimoErro: "Shopify API error: 500 Internal Server Error" },
    });
    expect(e.chave).toBe("falhaSync");
    expect(e.semAcesso).toBe(false);
    expect(e.sugestao).toBe("sincronizar");
  });
});

describe("quandoFoi", () => {
  const agora = new Date("2026-10-02T18:00:00Z"); // 15:00 em Sao Paulo

  it("hoje e ontem no fuso de Sao Paulo", () => {
    expect(quandoFoi("2026-10-02T17:28:00Z", agora)).toBe("hoje, 14:28");
    expect(quandoFoi("2026-10-01T12:05:00Z", agora)).toBe("ontem, 09:05");
  });

  it("outro dia do ano e dia de outro ano", () => {
    expect(quandoFoi("2026-09-12T15:00:00Z", agora)).toBe("12/09, 12:00");
    expect(quandoFoi("2025-12-30T15:00:00Z", agora)).toBe("30/12/2025");
  });

  it("sem data ou data invalida devolve null (a tela mostra travessao)", () => {
    expect(quandoFoi(null, agora)).toBeNull();
    expect(quandoFoi("lixo", agora)).toBeNull();
  });
});

describe("textos curtos", () => {
  it("idioma pelo codigo, em portugues", () => {
    expect(nomeIdioma("en-US")).toBe("inglês");
    expect(nomeIdioma("pt-BR")).toBe("português");
    expect(nomeIdioma("de-DE")).toBe("alemão");
    expect(nomeIdioma(null)).toBeNull();
  });

  it("moeda e idioma juntos, ou travessao", () => {
    expect(moedaIdioma("usd", "en-US")).toBe("USD · inglês");
    expect(moedaIdioma("EUR", null)).toBe("EUR");
    expect(moedaIdioma(null, null)).toBe("—");
  });

  it("papel no roteamento", () => {
    expect(rotuloPapel("vitrine")).toBe("Vitrine");
    expect(rotuloPapel("both")).toBe("Vitrine e checkout");
    expect(rotuloPapel("unassigned")).toBe("Sem rota");
  });
});

describe("filtrarLojas", () => {
  const lojas = [
    { id: "a", nome: "Lash Bestie", dominio: "qkgknv-w3.myshopify.com", semAcesso: false },
    { id: "b", nome: "Softnook", dominio: "kphigm-76.myshopify.com", semAcesso: false },
    { id: "c", nome: "Gotoku Café", dominio: "gotoku.myshopify.com", semAcesso: true },
  ];

  it("separa ativas e sem acesso", () => {
    expect(filtrarLojas(lojas, "ativas", "").map((l) => l.id)).toEqual(["a", "b"]);
    expect(filtrarLojas(lojas, "semAcesso", "").map((l) => l.id)).toEqual(["c"]);
    expect(filtrarLojas(lojas, "todas", "")).toHaveLength(3);
  });

  it("busca por nome ou dominio, sem caixa nem acento", () => {
    expect(filtrarLojas(lojas, "todas", "cafe").map((l) => l.id)).toEqual(["c"]);
    expect(filtrarLojas(lojas, "todas", "KPHIGM").map((l) => l.id)).toEqual(["b"]);
    expect(filtrarLojas(lojas, "ativas", "gotoku")).toEqual([]);
  });
});

describe("itensInventario", () => {
  const vazio: InventarioLoja = {
    produtos: 0,
    materiais: 0,
    temLogo: false,
    rotasComoVitrine: 0,
    destinosComoCheckout: 0,
    destinosRastreamento: 0,
    rastreamentoLigado: false,
    pedidos: 0,
    custos: 0,
    alertas: 0,
    contasAnuncio: 0,
  };

  it("loja vazia nao inventa item", () => {
    expect(itensInventario(vazio)).toEqual({ apaga: [], fica: [] });
  });

  it("so o que existe, com numero real e plural certo", () => {
    const { apaga, fica } = itensInventario({
      ...vazio,
      produtos: 1,
      materiais: 18,
      temLogo: true,
      destinosComoCheckout: 2,
      destinosRastreamento: 1,
      rastreamentoLigado: true,
      pedidos: 1234,
      contasAnuncio: 1,
    });
    expect(apaga).toEqual([
      "1 produto importado",
      "18 materiais de marca e a logo",
      "2 destinos de rota em que ela é a loja de checkout — a vitrine perde esse destino",
      "1 destino de rastreamento e o histórico de envios (o rastreamento está ligado)",
      "1.234 pedidos sincronizados e o histórico de lucro",
    ]);
    expect(fica).toHaveLength(1);
    expect(fica[0]).toMatch(/^1 conta de anúncio continua/);
  });
});

describe("mensagemConexao: erro cru vira frase", () => {
  it("nunca devolve o texto tecnico", () => {
    expect(mensagemConexao("Failed to save store")).toBe(
      "Não deu para salvar a loja agora. Tente de novo em instantes."
    );
    expect(mensagemConexao("Unauthorized", 401)).toMatch(/sessão expirou/);
    expect(mensagemConexao("Client ID ou Client Secret invalidos. Verifique...")).toMatch(
      /Client ID ou o Client Secret não confere/
    );
    expect(mensagemConexao("Sessao de instalacao invalida ou expirada")).toMatch(/expirou/);
    expect(mensagemConexao("Assinatura do callback invalida")).toMatch(/não confere com este app/);
    expect(mensagemConexao("algo inesperado")).toMatch(/^Não deu para conectar/);
  });
});
