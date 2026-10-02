import { describe, expect, it } from "vitest";
import {
  PERIODO_PADRAO,
  MOEDA_PADRAO,
  TODAS,
  custoVigente,
  diaNoFuso,
  filtroDeCookies,
  intervaloDoPeriodo,
  linhaDeCookie,
  qtdParaCusto,
  receitaDoPedido,
  variacaoPct,
  type ProductCostRow,
} from "@/lib/financeiro/tipos";

/**
 * O contrato da reformulacao financeira foi escrito uma vez e e usado por
 * todas as telas: periodo, receita e custo calculados de um jeito em um lugar
 * e de outro em outro seriam duas verdades na mesma tela. Estes testes travam
 * as regras que mudam o numero que o lojista ve.
 */
describe("intervaloDoPeriodo", () => {
  const hoje = "2026-10-02";

  it("hoje e ontem", () => {
    expect(intervaloDoPeriodo("hoje", hoje)).toEqual({
      atual: { desde: "2026-10-02", ate: "2026-10-02" },
      anterior: { desde: "2026-10-01", ate: "2026-10-01" },
    });
    expect(intervaloDoPeriodo("ontem", hoje)).toEqual({
      atual: { desde: "2026-10-01", ate: "2026-10-01" },
      anterior: { desde: "2026-09-30", ate: "2026-09-30" },
    });
  });

  it("7 dias contando hoje, comparado com os 7 antes", () => {
    expect(intervaloDoPeriodo("7d", hoje)).toEqual({
      atual: { desde: "2026-09-26", ate: "2026-10-02" },
      anterior: { desde: "2026-09-19", ate: "2026-09-25" },
    });
  });

  it("30 dias", () => {
    expect(intervaloDoPeriodo("30d", hoje)).toEqual({
      atual: { desde: "2026-09-03", ate: "2026-10-02" },
      anterior: { desde: "2026-08-04", ate: "2026-09-02" },
    });
  });

  it("este mes compara com o mesmo pedaco do mes anterior", () => {
    expect(intervaloDoPeriodo("mes", hoje)).toEqual({
      atual: { desde: "2026-10-01", ate: "2026-10-02" },
      anterior: { desde: "2026-09-01", ate: "2026-09-02" },
    });
  });

  it("mes passado inteiro contra o retrasado inteiro", () => {
    expect(intervaloDoPeriodo("mes_passado", hoje)).toEqual({
      atual: { desde: "2026-09-01", ate: "2026-09-30" },
      anterior: { desde: "2026-08-01", ate: "2026-08-31" },
    });
  });

  it("dia 31 nao estoura fevereiro", () => {
    expect(intervaloDoPeriodo("mes", "2026-03-31").anterior).toEqual({
      desde: "2026-02-01",
      ate: "2026-02-28",
    });
  });
});

describe("diaNoFuso", () => {
  const instante = new Date("2026-10-02T02:00:00Z");

  it("o dia depende do fuso da loja", () => {
    expect(diaNoFuso(instante, "America/Sao_Paulo")).toBe("2026-10-01");
    expect(diaNoFuso(instante, "Europe/Paris")).toBe("2026-10-02");
  });

  it("fuso invalido ou vazio cai em UTC", () => {
    expect(diaNoFuso(instante, "Nada/Inventado")).toBe("2026-10-02");
    expect(diaNoFuso(instante, null)).toBe("2026-10-02");
  });
});

describe("filtroDeCookies", () => {
  it("lixo vira o padrao, nunca erro", () => {
    expect(filtroDeCookies({ loja: "'; drop table", periodo: "ano", moeda: "XYZ" })).toEqual({
      lojaId: TODAS,
      periodo: PERIODO_PADRAO,
      moeda: MOEDA_PADRAO,
    });
    expect(filtroDeCookies({})).toEqual({
      lojaId: TODAS,
      periodo: PERIODO_PADRAO,
      moeda: MOEDA_PADRAO,
    });
  });

  it("uuid em maiuscula vira minuscula", () => {
    const f = filtroDeCookies({
      loja: "0F8FAD5B-D9CB-469F-A165-70867728950E",
      periodo: "30d",
      moeda: "USD",
    });
    expect(f).toEqual({ lojaId: "0f8fad5b-d9cb-469f-a165-70867728950e", periodo: "30d", moeda: "USD" });
  });
});

describe("receitaDoPedido", () => {
  const base = { tipo: "venda" as const, liquido_pago: 0, imposto_atual: 0, taxas_alfandega: 0, gorjeta: 0 };

  it("reembolso parcial entra pelo liquido, sem imposto, alfandega e gorjeta", () => {
    // Pagou 100, reembolsou 20: liquido 80. Imposto 5, alfandega 2, gorjeta 3.
    expect(
      receitaDoPedido({ ...base, liquido_pago: 80, imposto_atual: 5, taxas_alfandega: 2, gorjeta: 3 })
    ).toBe(70);
  });

  it("reenvio nao tem receita", () => {
    expect(receitaDoPedido({ ...base, tipo: "reenvio", liquido_pago: 50 })).toBe(0);
  });

  it("nunca negativa", () => {
    expect(receitaDoPedido({ ...base, liquido_pago: 0, imposto_atual: 10 })).toBe(0);
  });

  it("numeric chega como string do Postgres", () => {
    expect(
      receitaDoPedido({
        ...base,
        liquido_pago: "120.50" as unknown as number,
        imposto_atual: "10.25" as unknown as number,
      })
    ).toBe(110.25);
  });
});

describe("qtdParaCusto", () => {
  it("reembolsado depois de enviar continua custando", () => {
    expect(qtdParaCusto({ sku: "A", qtd: 2, qtd_atual: 0, qtd_nao_enviada: 0, preco: 10 })).toBe(2);
  });

  it("cancelado antes de enviar nao custa", () => {
    expect(qtdParaCusto({ sku: "A", qtd: 2, qtd_atual: 0, qtd_nao_enviada: 2, preco: 10 }, true)).toBe(0);
  });

  it("pedido normal custa o que esta no pedido", () => {
    expect(qtdParaCusto({ sku: "A", qtd: 3, qtd_atual: 3, qtd_nao_enviada: 3, preco: 10 })).toBe(3);
  });
});

describe("custoVigente", () => {
  const v = (valido_desde: string, custo: number): ProductCostRow => ({
    id: valido_desde,
    store_id: "s",
    user_id: "u",
    sku: "A",
    custo_unitario: custo,
    frete_unitario: 0,
    moeda: "USD",
    valido_desde,
    origem: "manual",
  });
  const versoes = [v("2026-06-01", 12), v("2026-01-01", 10)];

  it("escolhe a versao vigente no dia", () => {
    expect(custoVigente(versoes, "2026-03-01")?.custo_unitario).toBe(10);
    expect(custoVigente(versoes, "2026-06-01")?.custo_unitario).toBe(12);
    expect(custoVigente(versoes, "2026-07-15")?.custo_unitario).toBe(12);
  });

  it("antes da primeira versao, vale a primeira (retroativo)", () => {
    expect(custoVigente(versoes, "2025-12-01")?.custo_unitario).toBe(10);
  });

  it("sem versao, null", () => {
    expect(custoVigente([], "2026-01-01")).toBeNull();
  });
});

describe("variacaoPct", () => {
  it("anterior zero nao tem base", () => {
    expect(variacaoPct(10, 0)).toBeNull();
  });

  it("calcula a variacao", () => {
    expect(variacaoPct(150, 100)).toBe(50);
    expect(variacaoPct(-50, -100)).toBe(50);
  });
});

describe("linhaDeCookie", () => {
  it("vale para o site inteiro e nao vaza em navegacao cruzada", () => {
    const l = linhaDeCookie("xc_loja", "abc");
    expect(l).toContain("Path=/");
    expect(l).toContain("SameSite=Lax");
    expect(l.startsWith("xc_loja=abc;")).toBe(true);
  });
});
