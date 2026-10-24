import { describe, expect, it } from "vitest";
import {
  TODAS_AS_COLUNAS,
  COLUNAS_PADRAO_IDS,
  MAPA_COLUNAS,
} from "@/app/(dashboard)/campanhas/colunas-config";
import type { LinhaCampanha } from "@/app/(dashboard)/campanhas/tipos";
import { derivar, somarLinhas, somasVazias, type SomasCampanha } from "@/lib/campanhas/metricas";

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

  it("calcula métricas de totais agregados corretamente (somas cruas, não média de razões)", () => {
    const linha = (p: Partial<SomasCampanha>): LinhaCampanha => {
      const somas = { ...somasVazias(), ...p };
      return {
        id: "x",
        objetoId: "x",
        nome: "x",
        status: "ACTIVE",
        plataforma: "meta",
        nivel: "campanha",
        contaId: "acc",
        contaNome: "Conta",
        campanhaId: "x",
        campanhaNome: "x",
        grupoId: null,
        grupoNome: null,
        tipo: "CBO",
        orcamento: 100,
        cpaDesejado: null,
        ...somas,
        ...derivar(somas),
      };
    };
    const linhas = [
      linha({ gastos: 200, faturamento: 600, custoProduto: 150, lucroPedidos: 450, vendas: 10, cliques: 150, impressoes: 5000 }),
      linha({ gastos: 300, faturamento: 900, custoProduto: 200, lucroPedidos: 700, vendas: 10, cliques: 200, impressoes: 8000 }),
    ];

    const total = { ...somarLinhas(linhas), ...derivar(somarLinhas(linhas)) };
    expect(total.gastos).toBe(500);
    expect(total.faturamento).toBe(1500);
    expect(total.lucro).toBe(650);
    expect(total.vendas).toBe(20);
    expect(total.cpa).toBe(25);
    expect(total.roas).toBe(3);
    expect(total.margem).toBeCloseTo(43.33, 1);
    expect(total.cpc).toBeCloseTo(500 / 350, 6);
    expect(linhas[0].lucro).toBe(250);
  });
});
