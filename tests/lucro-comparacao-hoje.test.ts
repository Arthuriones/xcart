import { describe, expect, it } from "vitest";
import { bomComParcial, terminaHoje, textoDoAnterior } from "@/app/(dashboard)/financeiro/comparacao-parcial";
import { tomVariacao } from "@/components/ui/variacao";
import type { PontoDia } from "@/lib/leitura/serie-diaria";

// Periodo que termina hoje contra um anterior inteiro: a variacao sai sem
// verde nem vermelho, e o texto diz que o anterior esta completo.

function ponto(dia: string, parcial = false): PontoDia {
  return { dia, parcial, pedidos: 0, receita: 0, cmv: 0, taxas: 0, gastoMeta: 0, gastoGoogle: 0 };
}

describe("terminaHoje", () => {
  it("o ultimo ponto e o dia de hoje (parcial)", () => {
    expect(terminaHoje([ponto("2026-10-27", true)])).toBe(true);
    expect(terminaHoje([ponto("2026-10-21"), ponto("2026-10-27", true)])).toBe(true);
  });

  it("periodo fechado (Ontem, Mes passado) ou sem pontos nao termina hoje", () => {
    expect(terminaHoje([ponto("2026-10-26")])).toBe(false);
    expect(terminaHoje([ponto("2026-09-01"), ponto("2026-09-30")])).toBe(false);
    expect(terminaHoje([])).toBe(false);
  });
});

describe("bomComParcial", () => {
  it("termina hoje: a queda contra o dia inteiro anterior nao fica vermelha", () => {
    expect(tomVariacao(-0.7, bomComParcial("subir", true))).toBe("neutral");
    expect(tomVariacao(0.4, bomComParcial("descer", true))).toBe("neutral");
  });

  it("periodo fechado: a cor de sempre", () => {
    expect(bomComParcial("subir", false)).toBe("subir");
    expect(bomComParcial("descer", false)).toBe("descer");
    expect(tomVariacao(-0.7, bomComParcial("subir", false))).toBe("err");
  });
});

describe("textoDoAnterior", () => {
  it("Hoje: diz que o dia anterior e inteiro", () => {
    expect(textoDoAnterior("R$ 1.200,00", "26/10", { umDia: true, parcial: true })).toBe(
      "vs. R$ 1.200,00 em 26/10 (dia inteiro)"
    );
  });

  it("7 dias, 30 dias, Este mes: diz que hoje esta pela metade", () => {
    expect(textoDoAnterior("R$ 9.000,00", "14/10–20/10", { umDia: false, parcial: true })).toBe(
      "vs. R$ 9.000,00 em 14/10–20/10 (hoje parcial)"
    );
  });

  it("periodo fechado: o texto de sempre", () => {
    expect(textoDoAnterior("R$ 1.200,00", "25/10", { umDia: true, parcial: false })).toBe("vs. R$ 1.200,00 em 25/10");
    expect(textoDoAnterior("−R$ 50,00", "01/09–30/09", { umDia: false, parcial: false })).toBe(
      "vs. −R$ 50,00 em 01/09–30/09"
    );
  });
});
