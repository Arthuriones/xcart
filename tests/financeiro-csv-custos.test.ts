import { describe, expect, it } from "vitest";
import { lerNumero, parseCsvCustos, validarCustoItem } from "@/lib/financeiro/csv-custos";

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
