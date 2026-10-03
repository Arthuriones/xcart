import { describe, expect, it } from "vitest";
import {
  lerNumero,
  numeroAmbiguo,
  parseCsvCustos,
  validarCustoItem,
  validarValor,
} from "@/lib/financeiro/csv-custos";

/**
 * O CSV de custos vem de planilha, quase sempre Excel em pt-BR: ";" e decimal
 * com virgula. Um custo lido como 1250 em vez de 12,50 nao da erro nenhum -- so
 * transforma lucro em prejuizo na tela. Por isso o formato do numero e o
 * separador sao travados aqui.
 */
describe("parseCsvCustos", () => {
  it("separador ';' com decimal em virgula", () => {
    const r = parseCsvCustos(
      "sku;custo_unitario;frete_unitario;moeda;valido_desde\nCIL-01;12,50;3,20;usd;2026-09-01\nCIL-02;1.234,56;;BRL;",
      "USD"
    );
    expect(r.erros).toEqual([]);
    expect(r.itens).toEqual([
      { sku: "CIL-01", custo_unitario: 12.5, frete_unitario: 3.2, moeda: "USD", valido_desde: "2026-09-01" },
      { sku: "CIL-02", custo_unitario: 1234.56, frete_unitario: 0, moeda: "BRL", valido_desde: null },
    ]);
  });

  it("separador ',' com ponto decimal (e aspas do Excel)", () => {
    const r = parseCsvCustos(
      'sku,custo_unitario,frete_unitario,moeda\r\nA-1,4.75,1.10,EUR\r\nA-2,"1,234.50",0,\r\n',
      "USD"
    );
    expect(r.erros).toEqual([]);
    expect(r.itens).toEqual([
      { sku: "A-1", custo_unitario: 4.75, frete_unitario: 1.1, moeda: "EUR", valido_desde: null },
      { sku: "A-2", custo_unitario: 1234.5, frete_unitario: 0, moeda: "USD", valido_desde: null },
    ]);
  });

  it("aceita tab como separador", () => {
    const r = parseCsvCustos("sku\tcusto\nX\t2,5", "BRL");
    expect(r.itens).toEqual([
      { sku: "X", custo_unitario: 2.5, frete_unitario: 0, moeda: "BRL", valido_desde: null },
    ]);
  });

  it("aliases de cabecalho e BOM", () => {
    const r = parseCsvCustos(
      "﻿SKU;Cost;Shipping;Currency;Desde\nZ-9;7;2;cny;2026-01-15\n",
      "USD"
    );
    expect(r.erros).toEqual([]);
    expect(r.itens).toEqual([
      { sku: "Z-9", custo_unitario: 7, frete_unitario: 2, moeda: "CNY", valido_desde: "2026-01-15" },
    ]);
  });

  it("custo negativo, SKU vazio ou moeda invalida viram erro com o numero da linha", () => {
    const r = parseCsvCustos(
      [
        "sku;custo;frete;moeda;data",
        "OK-1;10;0;USD;",
        "NEG;-1;0;USD;",
        ";5;0;USD;",
        "", // linha vazia: ignorada, mas conta no numero da linha
        "MOE;5;0;REAIS;",
        "DATA;5;0;USD;2026-02-30",
        "TXT;abc;0;USD;",
      ].join("\n"),
      "USD"
    );
    expect(r.itens.map((i) => i.sku)).toEqual(["OK-1"]);
    expect(r.erros.map((e) => e.linha)).toEqual([3, 4, 6, 7, 8]);
    expect(r.erros[0].motivo).toMatch(/negativo/);
    expect(r.erros[1].motivo).toMatch(/SKU vazio/);
    expect(r.erros[2].motivo).toMatch(/moeda/);
    expect(r.erros[3].motivo).toMatch(/data/);
  });

  it("sem coluna sku da erro na linha 1 e nenhum item", () => {
    const r = parseCsvCustos("produto;custo\nA;1\n", "USD");
    expect(r.itens).toEqual([]);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].linha).toBe(1);
    expect(r.erros[0].motivo).toMatch(/sku/);
  });

  it("sem coluna de custo tambem recusa o arquivo", () => {
    const r = parseCsvCustos("sku;frete\nA;1\n", "USD");
    expect(r.itens).toEqual([]);
    expect(r.erros[0]).toMatchObject({ linha: 1 });
  });

  it("mais de 5000 linhas gera erro (um so, para o excedente)", () => {
    const linhas = ["sku;custo"];
    for (let i = 0; i < 5003; i += 1) linhas.push(`S${i};1`);
    const r = parseCsvCustos(linhas.join("\n"), "USD");
    expect(r.itens).toHaveLength(5000);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0].linha).toBe(5002);
    expect(r.erros[0].motivo).toMatch(/5000/);
  });
});

describe("lerNumero", () => {
  it("formato brasileiro e americano", () => {
    expect(lerNumero("1.234,56")).toBe(1234.56);
    expect(lerNumero("1,234.56")).toBe(1234.56);
    expect(lerNumero("12,5")).toBe(12.5);
    expect(lerNumero(" 3 ")).toBe(3);
  });

  it("vazio e lixo sao NaN (nao zero)", () => {
    expect(lerNumero("")).toBeNaN();
    expect(lerNumero("1e3")).toBeNaN();
    expect(lerNumero("R$ 5")).toBeNaN();
  });

  // Achado da revisao: "4.990" virava 4,99 calado. Na planilha brasileira e
  // 4990; na americana e 4,99. Adivinhar errado erra o custo por mil.
  it("ponto com tres casas e ambiguo: NaN, nunca 4,99 calado", () => {
    expect(numeroAmbiguo("4.990")).toBe(true);
    expect(numeroAmbiguo(" 12.345 ")).toBe(true);
    expect(lerNumero("4.990")).toBeNaN();
    expect(lerNumero("-1.500")).toBeNaN();
  });

  it("o que nao e ambiguo continua passando", () => {
    expect(numeroAmbiguo("0.125")).toBe(false); // milhar nao comeca com zero
    expect(lerNumero("0.125")).toBe(0.125);
    expect(lerNumero("4.99")).toBe(4.99);
    expect(lerNumero("4.9900")).toBe(4.99);
    expect(lerNumero("4,990")).toBe(4.99); // virgula e sempre decimal
    expect(lerNumero("4990")).toBe(4990);
    expect(lerNumero("1234.567")).toBe(1234.567);
    expect(numeroAmbiguo(4.99)).toBe(false);
  });

  it("varios grupos de milhar sem decimal", () => {
    expect(lerNumero("1.234.567")).toBe(1234567);
    expect(lerNumero("1,234,567")).toBe(1234567);
    expect(lerNumero("1 234,50")).toBe(1234.5);
    expect(lerNumero("1,2,3")).toBeNaN();
  });
});

describe("validarValor", () => {
  it("ambiguo explica as duas leituras", () => {
    const r = validarValor("4.990", "custo");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.motivo).toMatch(/ambíguo/);
      expect(r.motivo).toContain("4990");
      expect(r.motivo).toContain("4,99");
    }
  });

  it("number vindo do JSON nao passa pela regra do texto", () => {
    expect(validarValor(4.99, "custo")).toEqual({ ok: true, valor: 4.99 });
    expect(validarValor(1.234, "frete")).toEqual({ ok: true, valor: 1.234 });
  });

  it("vazio, negativo e alto demais", () => {
    expect(validarValor("", "frete")).toEqual({ ok: false, motivo: "frete vazio" });
    expect(validarValor("-1", "custo")).toEqual({ ok: false, motivo: "custo negativo" });
    expect(validarValor("10000000", "custo")).toMatchObject({ ok: false });
  });
});

describe("parseCsvCustos com numero ambiguo", () => {
  it("a linha volta com erro e as outras passam", () => {
    const r = parseCsvCustos("sku;custo;frete\nA;4.990;0\nB;4990;1.500\nC;4,99;0", "BRL");
    expect(r.itens.map((i) => [i.sku, i.custo_unitario])).toEqual([["C", 4.99]]);
    expect(r.erros.map((e) => e.linha)).toEqual([2, 3]);
    expect(r.erros[0].motivo).toMatch(/custo "4.990" é ambíguo/);
    expect(r.erros[1].motivo).toMatch(/frete "1.500" é ambíguo/);
  });
});

describe("validarCustoItem", () => {
  it("sem moeda e sem padrao recusa", () => {
    const r = validarCustoItem({ sku: "A", custo_unitario: 1 }, null);
    expect(r.ok).toBe(false);
  });

  it("numero ja como number passa", () => {
    const r = validarCustoItem({ sku: " A ", custo_unitario: 2, frete_unitario: 0.5, moeda: "usd" }, null);
    expect(r).toEqual({
      ok: true,
      item: { sku: "A", custo_unitario: 2, frete_unitario: 0.5, moeda: "USD", valido_desde: null },
    });
  });
});
