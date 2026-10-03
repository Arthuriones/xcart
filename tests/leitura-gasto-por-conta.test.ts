import { describe, expect, it } from "vitest";
import { criarConversor } from "../src/lib/financeiro/calculo";
import {
  janelaDaConsulta,
  somarGastoPorConta,
  type LinhaGastoConta,
} from "../src/lib/leitura/gasto-por-conta-soma";

// O gasto por conta da tela Integracoes (#12). O que importa travar:
// dia sem linha nao vira zero, "hoje" e o dia DA CONTA, e moeda sem cotacao
// fica na moeda da conta em vez de entrar somada como se fosse a do relatorio.

const intervalo = { desde: "2026-09-26", ate: "2026-10-02" };

function linha(conta: string, data: string, gasto: number | string, moeda = "BRL"): LinhaGastoConta {
  return { ad_account_id: conta, data, gasto, moeda };
}

describe("somarGastoPorConta", () => {
  it("soma o período e pega o hoje do fuso da conta", () => {
    const r = somarGastoPorConta(
      [linha("a", "2026-09-30", 100), linha("a", "2026-10-01", "50.5"), linha("a", "2026-10-02", 10)],
      {
        contaIds: ["a"],
        hojePorConta: { a: "2026-10-01" },
        intervalo,
        moeda: "BRL",
        converter: criarConversor([]),
      }
    ).get("a")!;
    expect(r.periodo?.valor).toBeCloseTo(160.5);
    expect(r.hoje?.valor).toBeCloseTo(50.5);
    expect(r.diasComDado).toBe(3);
    expect(r.diasNoPeriodo).toBe(7);
    expect(r.primeiroDia).toBe("2026-09-30");
  });

  it("conta sem linha sai com null, nunca zero", () => {
    const r = somarGastoPorConta([], {
      contaIds: ["a"],
      hojePorConta: { a: "2026-10-02" },
      intervalo,
      moeda: "BRL",
      converter: criarConversor([]),
    }).get("a")!;
    expect(r.hoje).toBeNull();
    expect(r.periodo).toBeNull();
    expect(r.primeiroDia).toBeNull();
  });

  it("linha gravada com zero é zero (o sync grava o dia sem entrega)", () => {
    const r = somarGastoPorConta([linha("a", "2026-10-02", 0)], {
      contaIds: ["a"],
      hojePorConta: { a: "2026-10-02" },
      intervalo,
      moeda: "BRL",
      converter: criarConversor([]),
    }).get("a")!;
    expect(r.hoje?.valor).toBe(0);
    expect(r.periodo?.valor).toBe(0);
  });

  it("converte pela cotação do dia", () => {
    const cambio = [
      { data: "2026-10-01", moeda: "BRL", por_usd: 5, fonte: "ptax" as const },
      { data: "2026-10-02", moeda: "BRL", por_usd: 6, fonte: "ptax" as const },
    ];
    const r = somarGastoPorConta(
      [linha("a", "2026-10-01", 10, "USD"), linha("a", "2026-10-02", 10, "USD")],
      {
        contaIds: ["a"],
        hojePorConta: { a: "2026-10-02" },
        intervalo,
        moeda: "BRL",
        converter: criarConversor(cambio),
      }
    ).get("a")!;
    expect(r.periodo?.valor).toBeCloseTo(110);
    expect(r.periodo?.original).toBeCloseTo(20);
    expect(r.periodo?.moedaOriginal).toBe("USD");
    expect(r.periodo?.convertido).toBe(true);
    expect(r.periodo?.aproximado).toBe(false);
    expect(r.hoje?.valor).toBeCloseTo(60);
  });

  it("sem cotação nenhuma, fica na moeda da conta", () => {
    const r = somarGastoPorConta([linha("a", "2026-10-02", 10, "XYZ")], {
      contaIds: ["a"],
      hojePorConta: { a: "2026-10-02" },
      intervalo,
      moeda: "BRL",
      converter: criarConversor([]),
    }).get("a")!;
    expect(r.periodo?.convertido).toBe(false);
    expect(r.periodo?.valor).toBe(10);
    expect(r.periodo?.moedaOriginal).toBe("XYZ");
  });

  it("linha fora do período só conta no hoje", () => {
    const r = somarGastoPorConta([linha("a", "2026-10-03", 7)], {
      contaIds: ["a"],
      hojePorConta: { a: "2026-10-03" },
      intervalo,
      moeda: "BRL",
      converter: criarConversor([]),
    }).get("a")!;
    expect(r.hoje?.valor).toBe(7);
    expect(r.periodo).toBeNull();
  });

  it("separa as contas", () => {
    const m = somarGastoPorConta([linha("a", "2026-10-02", 1), linha("b", "2026-10-02", 2)], {
      contaIds: ["a", "b", "c"],
      hojePorConta: { a: "2026-10-02", b: "2026-10-02", c: "2026-10-02" },
      intervalo,
      moeda: "BRL",
      converter: criarConversor([]),
    });
    expect(m.get("a")?.periodo?.valor).toBe(1);
    expect(m.get("b")?.periodo?.valor).toBe(2);
    expect(m.get("c")?.periodo).toBeNull();
  });
});

describe("janelaDaConsulta", () => {
  it("estica o intervalo para cobrir o hoje de cada conta", () => {
    expect(janelaDaConsulta(intervalo, ["2026-10-03", "2026-10-01"])).toEqual({
      desde: "2026-09-26",
      ate: "2026-10-03",
    });
    expect(janelaDaConsulta({ desde: "2026-09-01", ate: "2026-09-30" }, ["2026-10-02"])).toEqual({
      desde: "2026-09-01",
      ate: "2026-10-02",
    });
  });
});
