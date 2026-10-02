import { describe, expect, it } from "vitest";
import {
  MOEDAS_GUARDADAS,
  dataPtax,
  mesclarCambio,
  parseFrankfurterV2,
  parsePtax,
} from "@/lib/financeiro/cambio-parse";

// Trechos das respostas reais de 02/10/2026 para o dia 2026-10-01:
//   https://api.frankfurter.dev/v2/rates?from=2026-10-01&to=2026-10-01&base=USD
//   (165 itens; aqui so alguns, inclusive moeda fora da lista e o proprio USD)
//   PTAX CotacaoMoedaPeriodo, USD, boletim Fechamento.

const FRANKFURTER_2026_10_01 = [
  { date: "2026-10-01", base: "USD", quote: "AED", rate: 3.6725 },
  { date: "2026-10-01", base: "USD", quote: "AFN", rate: 65.149 },
  { date: "2026-10-01", base: "USD", quote: "ARS", rate: 1524.92 },
  { date: "2026-10-01", base: "USD", quote: "BRL", rate: 5.1908 },
  { date: "2026-10-01", base: "USD", quote: "EUR", rate: 0.88249 },
  { date: "2026-10-01", base: "USD", quote: "GBP", rate: 0.75405 },
  { date: "2026-10-01", base: "USD", quote: "JPY", rate: 157.72 },
  { date: "2026-10-01", base: "USD", quote: "USD", rate: 1 },
];

const PTAX_2026_10_01 = {
  "@odata.context":
    "https://was-p.bcnet.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata$metadata#_CotacaoMoedaPeriodo",
  value: [
    {
      paridadeCompra: 1.0,
      paridadeVenda: 1.0,
      cotacaoCompra: 5.2073,
      cotacaoVenda: 5.2079,
      dataHoraCotacao: "2026-10-01 13:10:35.4469",
      tipoBoletim: "Fechamento",
    },
  ],
};

describe("parseFrankfurterV2", () => {
  it("le o JSON real e filtra pelas moedas guardadas", () => {
    const r = parseFrankfurterV2(FRANKFURTER_2026_10_01);
    expect(r).toContainEqual({ data: "2026-10-01", moeda: "BRL", por_usd: 5.1908, fonte: "frankfurter" });
    expect(r).toContainEqual({ data: "2026-10-01", moeda: "EUR", por_usd: 0.88249, fonte: "frankfurter" });
    const moedas = r.map((x) => x.moeda);
    // AFN nao esta na lista; USD entra pela mescla, nao daqui.
    expect(moedas).not.toContain("AFN");
    expect(moedas).not.toContain("USD");
    expect(moedas.every((m) => MOEDAS_GUARDADAS.includes(m))).toBe(true);
    expect(moedas.sort()).toEqual(["AED", "ARS", "BRL", "EUR", "GBP", "JPY"]);
  });

  it("recusa base diferente de USD, taxa nao positiva e data torta", () => {
    expect(
      parseFrankfurterV2([
        { date: "2026-10-01", base: "EUR", quote: "BRL", rate: 5.88 },
        { date: "2026-10-01", base: "USD", quote: "BRL", rate: 0 },
        { date: "2026-10-01", base: "USD", quote: "EUR", rate: -1 },
        { date: "01/10/2026", base: "USD", quote: "GBP", rate: 0.75 },
        { date: "2026-10-01", base: "USD", quote: "brl", rate: 5.19 },
        null,
        "lixo",
      ])
    ).toEqual([]);
  });
});

describe("parsePtax", () => {
  it("le o JSON real do BCB", () => {
    expect(parsePtax(PTAX_2026_10_01)).toEqual([
      { data: "2026-10-01", moeda: "BRL", por_usd: 5.2079, fonte: "ptax" },
    ]);
  });

  it("so Fechamento, e o ultimo do dia vence", () => {
    const r = parsePtax({
      value: [
        { cotacaoVenda: 5.1, dataHoraCotacao: "2026-10-01 10:00:00.0", tipoBoletim: "Abertura" },
        { cotacaoVenda: 5.2, dataHoraCotacao: "2026-10-01 13:00:00.0", tipoBoletim: "Fechamento" },
        { cotacaoVenda: 5.3, dataHoraCotacao: "2026-10-01 13:30:00.0", tipoBoletim: "Fechamento" },
        { cotacaoVenda: 5.25, dataHoraCotacao: "2026-09-30 13:00:00.0", tipoBoletim: "Fechamento" },
      ],
    });
    expect(r).toHaveLength(2);
    expect(r).toContainEqual({ data: "2026-10-01", moeda: "BRL", por_usd: 5.3, fonte: "ptax" });
    expect(r).toContainEqual({ data: "2026-09-30", moeda: "BRL", por_usd: 5.25, fonte: "ptax" });
  });
});

describe("mesclarCambio", () => {
  it("PTAX vence no BRL e USD = 1 entra em cada dia", () => {
    const r = mesclarCambio(parseFrankfurterV2(FRANKFURTER_2026_10_01), parsePtax(PTAX_2026_10_01));
    const brl = r.filter((x) => x.moeda === "BRL");
    expect(brl).toEqual([{ data: "2026-10-01", moeda: "BRL", por_usd: 5.2079, fonte: "ptax" }]);
    expect(r).toContainEqual({ data: "2026-10-01", moeda: "USD", por_usd: 1, fonte: "frankfurter" });
    expect(r).toContainEqual({ data: "2026-10-01", moeda: "EUR", por_usd: 0.88249, fonte: "frankfurter" });
    // Uma linha por (data, moeda): o upsert por essa chave nao pode receber duplicata.
    const chaves = r.map((x) => `${x.data}|${x.moeda}`);
    expect(new Set(chaves).size).toBe(chaves.length);
  });

  it("sem PTAX, o BRL do Frankfurter fica", () => {
    const r = mesclarCambio(parseFrankfurterV2(FRANKFURTER_2026_10_01), []);
    expect(r).toContainEqual({ data: "2026-10-01", moeda: "BRL", por_usd: 5.1908, fonte: "frankfurter" });
  });

  it("nada entra, nada sai (nem USD)", () => {
    expect(mesclarCambio([], [])).toEqual([]);
  });
});

describe("dataPtax", () => {
  it("AAAA-MM-DD vira MM-DD-AAAA", () => {
    expect(dataPtax("2026-09-28")).toBe("09-28-2026");
  });
});

describe("entrada invalida", () => {
  it("da [] sem lancar", () => {
    for (const lixo of [null, undefined, 42, "x", {}, { value: "nao" }, { value: [null, 1] }, [1, 2]]) {
      expect(parseFrankfurterV2(lixo)).toEqual([]);
      expect(parsePtax(lixo)).toEqual([]);
    }
  });
});
