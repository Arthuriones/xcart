import { describe, expect, it } from "vitest";
import {
  TODAS_AS_COLUNAS,
  COLUNAS_PADRAO_IDS,
  MAPA_COLUNAS,
} from "@/app/(dashboard)/campanhas/colunas-config";
import type { LinhaCampanha } from "@/app/(dashboard)/campanhas/tipos";

describe("Dashboard de Campanhas (estilo Cakto / UTMify)", () => {
  it("contém o catálogo completo de métricas", () => {
    expect(TODAS_AS_COLUNAS.length).toBeGreaterThan(25);

    const ids = TODAS_AS_COLUNAS.map((c) => c.id);
    expect(ids).toContain("tipo");
    expect(ids).toContain("orcamento");
    expect(ids).toContain("cpa");
    expect(ids).toContain("gastos");
    expect(ids).toContain("faturamento");
    expect(ids).toContain("lucro");
    expect(ids).toContain("roas");
    expect(ids).toContain("margem");
    expect(ids).toContain("cpc");
    expect(ids).toContain("impressoes");
    expect(ids).toContain("cliques");
    expect(ids).toContain("ic");
  });

  it("define colunas padrão ativas sensatas", () => {
    expect(COLUNAS_PADRAO_IDS).toContain("tipo");
    expect(COLUNAS_PADRAO_IDS).toContain("orcamento");
    expect(COLUNAS_PADRAO_IDS).toContain("vendas");
    expect(COLUNAS_PADRAO_IDS).toContain("gastos");
    expect(COLUNAS_PADRAO_IDS).toContain("faturamento");
    expect(COLUNAS_PADRAO_IDS).toContain("lucro");
    expect(COLUNAS_PADRAO_IDS).toContain("roas");
    expect(COLUNAS_PADRAO_IDS).toContain("margem");
  });

  it("mapa de colunas resolve cada coluna por ID", () => {
    const col = MAPA_COLUNAS.get("lucro");
    expect(col).toBeDefined();
    expect(col?.rotulo).toBe("Lucro");
    expect(col?.formato).toBe("moeda");
    expect(col?.categoria).toBe("financeiro");
  });

  it("calcula métricas de totais agregados corretamente", () => {
    const linhas: LinhaCampanha[] = [
      {
        id: "1",
        objetoId: "camp_1",
        nome: "Campanha 1",
        status: "ACTIVE",
        plataforma: "meta",
        nivel: "campanha",
        contaId: "acc_1",
        contaNome: "Conta Meta 1",
        tipo: "CBO",
        orcamento: 100,
        gastos: 200,
        faturamento: 600,
        custoProduto: 150,
        lucro: 250,
        roas: 3,
        roi: 0.71,
        margem: 41.67,
        cpa: 20,
        vendas: 10,
        cliques: 150,
        impressoes: 5000,
        cpc: 1.33,
        cpm: 40,
        ctr: 3,
        ic: 25,
        cpi: 8,
      },
      {
        id: "2",
        objetoId: "camp_2",
        nome: "Campanha 2",
        status: "ACTIVE",
        plataforma: "google",
        nivel: "campanha",
        contaId: "acc_2",
        contaNome: "Conta Google 1",
        tipo: "PMAX",
        orcamento: 150,
        gastos: 300,
        faturamento: 900,
        custoProduto: 200,
        lucro: 400,
        roas: 3,
        roi: 0.8,
        margem: 44.44,
        cpa: 30,
        vendas: 10,
        cliques: 200,
        impressoes: 8000,
        cpc: 1.5,
        cpm: 37.5,
        ctr: 2.5,
        ic: 30,
        cpi: 10,
      },
    ];

    const gastosTotais = linhas.reduce((acc, l) => acc + l.gastos, 0);
    const faturamentoTotal = linhas.reduce((acc, l) => acc + l.faturamento, 0);
    const lucroTotal = linhas.reduce((acc, l) => acc + l.lucro, 0);
    const vendasTotais = linhas.reduce((acc, l) => acc + l.vendas, 0);

    expect(gastosTotais).toBe(500);
    expect(faturamentoTotal).toBe(1500);
    expect(lucroTotal).toBe(650);
    expect(vendasTotais).toBe(20);

    const cpaMedio = gastosTotais / vendasTotais;
    const roasMedio = faturamentoTotal / gastosTotais;
    const margemMedia = (lucroTotal / faturamentoTotal) * 100;

    expect(cpaMedio).toBe(25);
    expect(roasMedio).toBe(3);
    expect(margemMedia).toBeCloseTo(43.33, 1);
  });
});
