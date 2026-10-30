import { describe, expect, it } from "vitest";
import {
  escalaLinha,
  montarCascata,
  montarSerieLinha,
  rotuloTick,
  trilhaSparkline,
  valorDaSerie,
  vaoDaCelula,
  vereditoDoPeriodo,
} from "@/app/(dashboard)/financeiro/lucro-dados";
import { montarIndicadores, type BaseIndicadores } from "@/app/(dashboard)/financeiro/indicadores";
import type { Totais } from "@/lib/financeiro/calculo";
import type { PontoDia } from "@/lib/leitura/serie-diaria";

/**
 * O destaque do Dashboard (mockup "design novo/Dashboard.dc.html"): o eixo e
 * o desenho do grafico de linha, a sparkline, a composicao do lucro, a faixa
 * de KPIs e os indicadores que a tela mostra. Tudo puro.
 */

/** Intl usa espaco fino/inseparavel: compara com espaco comum. */
const s = (t: string) => t.replace(/[  ]/g, " ");

function ponto(dia: string, p: Partial<PontoDia> = {}): PontoDia {
  return { dia, parcial: false, pedidos: 0, receita: 0, cmv: 0, taxas: 0, gastoMeta: 0, gastoGoogle: 0, ...p };
}

function dias(desde: string, n: number): string[] {
  const out: string[] = [];
  const d = new Date(`${desde}T00:00:00Z`);
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function totais(p: Partial<Totais> = {}): Totais {
  return {
    pedidos: 0,
    receita: 0,
    cmv: 0,
    taxas: 0,
    devolucoes: 0,
    gastoMeta: 0,
    gastoGoogle: 0,
    gasto: 0,
    lucro: 0,
    roas: null,
    roasEquilibrio: null,
    margem: null,
    cpa: null,
    ticket: null,
    reenvios: 0,
    coberturaCusto: null,
    cod: {
      gerados: 0,
      abertos: 0,
      recusados: 0,
      cancelados: 0,
      aReceber: 0,
      previsto: 0,
      taxaEntrega: null,
      custoPrevisto: 0,
      devolucoesPrevistas: 0,
      taxasPrevistas: 0,
      lucroPrevisto: 0,
      roasPrevisto: null,
      roasEquilibrioPrevisto: null,
      cpa: null,
      coberturaCusto: null,
    },
    externo: { pedidos: 0, pendentes: 0, aprovados: 0, pagos: 0, perdidos: 0, perdido: 0, valorPedidos: 0 },
    venda: {
      vendas: 0,
      itens: 0,
      faturamento: 0,
      taxa: 0,
      comissoes: 0,
      liquido: 0,
      aguardando: 0,
      aReceber: 0,
      vencidas: 0,
      recusadas: 0,
      reembolsos: 0,
      chargebacks: 0,
      estornado: 0,
      emRisco: 0,
    },
    ...p,
  };
}

describe("eixo Y do grafico do destaque", () => {
  it("zero dentro, passo redondo e folga de 4% em cima", () => {
    expect(escalaLinha([100, 250, 3000])).toEqual({ min: 0, max: 4000, passo: 1000, ticks: [0, 1000, 2000, 3000, 4000] });
  });

  it("prejuizo desce abaixo do zero; tudo negativo ainda mostra o zero", () => {
    expect(escalaLinha([-500, 1200]).ticks).toEqual([-500, 0, 500, 1000, 1500]);
    expect(escalaLinha([-300, -100]).ticks).toEqual([-300, -200, -100, 0, 100]);
  });

  it("passo decimal com prejuizo (margem negativa): o zero sai exato, sem residuo de ponto flutuante", () => {
    // min + k x passo deixava o zero em 2,8e-17 e a linha do zero sem destaque.
    for (const serie of [[-0.15, 0.05], [-0.3, -0.1], [-0.25, 0.1], [-0.6, 0.2]]) {
      const { ticks } = escalaLinha(serie);
      expect(ticks, serie.join(",")).toContain(0);
      expect(ticks.every((t) => t === 0 || Math.abs(t) > 1e-9)).toBe(true);
    }
    expect(escalaLinha([-0.15, 0.05]).ticks).toEqual([-0.15, -0.1, -0.05, 0, 0.05, 0.1]);
  });

  it("sem valor nenhum nao quebra: eixo de 0 para cima", () => {
    const e = escalaLinha([null, null]);
    expect(e.min).toBe(0);
    expect(e.max).toBeGreaterThan(0);
    expect(e.ticks[0]).toBe(0);
  });

  it("rotulo do tick: compacto e sem moeda, porcento, vezes e o menos tipografico", () => {
    expect(s(rotuloTick(3000, "dinheiro"))).toBe("3 mil");
    expect(rotuloTick(-500, "dinheiro")).toBe("−500");
    expect(s(rotuloTick(0.2, "pct"))).toBe("20%");
    expect(rotuloTick(1.5, "vezes")).toBe("1,5×");
  });
});

describe("frase acima do grafico", () => {
  const loja = (lucro: number, movimento = true) => ({ lucro, movimento });

  it("em quantas lojas deu lucro e o ROAS contra o de equilibrio", () => {
    expect(
      vereditoDoPeriodo({
        lojas: [loja(100), loja(50), loja(-20), loja(10), loja(5)],
        roas: 2.7,
        equilibrio: 1.69,
        previsto: false,
        palavra: "lojas",
      })
    ).toBe("Lucro em 4 de 5 lojas. ROAS real 2,70× contra equilíbrio de 1,69×.");
  });

  it("loja sem movimento nao conta; com uma so, fica so o ROAS", () => {
    expect(
      vereditoDoPeriodo({ lojas: [loja(80), loja(0, false)], roas: 3, equilibrio: null, previsto: false, palavra: "lojas" })
    ).toBe("ROAS real 3,00×.");
  });

  it("contra entrega fala do previsto; sem gasto e sem lojas, nada", () => {
    expect(
      vereditoDoPeriodo({ lojas: [loja(10), loja(-5)], roas: 1.2, equilibrio: 1.5, previsto: true, palavra: "operações" })
    ).toBe("Lucro previsto em 1 de 2 operações. ROAS previsto 1,20× contra equilíbrio de 1,50×.");
    expect(vereditoDoPeriodo({ lojas: [loja(10)], roas: null, equilibrio: null, previsto: false, palavra: "lojas" })).toBeNull();
    expect(vereditoDoPeriodo({ lojas: [loja(10)], roas: null, equilibrio: 1.4, previsto: false, palavra: "lojas" })).toBe(
      "ROAS de equilíbrio 1,40×."
    );
  });
});

describe("sparkline", () => {
  it("so a forma, pela faixa da propria serie", () => {
    expect(trilhaSparkline([1, 3, 2], 64, 20)).toBe("M0.0 18.0 L32.0 2.0 L64.0 10.0");
  });

  it("menos de 2 pontos com dado: nada a desenhar", () => {
    expect(trilhaSparkline([5], 64, 20)).toBe("");
    expect(trilhaSparkline([null, 4, null], 80, 24)).toBe("");
  });
});

describe("composicao do lucro", () => {
  const opcoes = { rotuloReceita: "Faturamento", rotuloTaxas: "Taxas de pagamento", rotuloLucro: "Lucro estimado", devolucoes: false };

  it("cada custo desce de onde o anterior parou, ate o lucro", () => {
    const c = montarCascata(
      { receita: 1000, cmv: 300, taxas: 50, gastoMeta: 200, gastoGoogle: 50, devolucoes: 0, lucro: 400, margem: 0.4 },
      opcoes
    );
    expect(c.map((l) => [l.sinal, l.rotulo, l.esq, l.larg])).toEqual([
      ["", "Faturamento", 0, 100],
      ["−", "Produto + frete", 70, 30],
      ["−", "Taxas de pagamento", 65, 5],
      ["−", "Meta Ads", 45, 20],
      ["−", "Google Ads", 40, 5],
      ["=", "Lucro estimado", 0, 40],
    ]);
    expect(c.map((l) => l.pct)).toEqual([1, 0.3, 0.05, 0.2, 0.05, 0.4]);
    expect(c[5].tom).toBe("lucro");
  });

  it("prejuizo cabe a esquerda do zero; custo zerado ainda aparece", () => {
    const c = montarCascata(
      { receita: 100, cmv: 80, taxas: 0, gastoMeta: 70, gastoGoogle: 0, devolucoes: 0, lucro: -50, margem: -0.5 },
      { ...opcoes, devolucoes: true }
    );
    expect(c.map((l) => l.rotulo)).toContain("Devoluções");
    const faturamento = c[0];
    expect(faturamento.esq).toBeCloseTo(33.333, 2);
    expect(faturamento.larg).toBeCloseTo(66.667, 2);
    const taxas = c[2];
    expect(taxas.larg).toBe(0.4);
    const lucro = c[c.length - 1];
    expect(lucro.esq).toBe(0);
    expect(lucro.larg).toBeCloseTo(33.333, 2);
    expect(lucro.tom).toBe("prejuizo");
  });

  it("sem faturamento: sem porcentagem", () => {
    const c = montarCascata(
      { receita: 0, cmv: 0, taxas: 0, gastoMeta: 30, gastoGoogle: 0, devolucoes: 0, lucro: -30, margem: null },
      opcoes
    );
    expect(c.map((l) => l.pct)).toEqual([null, null, null, null, null, null]);
  });
});

describe("faixa de KPIs", () => {
  it("a ultima linha divide a largura, sem buraco", () => {
    expect(Array.from({ length: 10 }, (_, i) => vaoDaCelula(i, 10, 4))).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 2]);
    expect(Array.from({ length: 10 }, (_, i) => vaoDaCelula(i, 10, 2)).every((v) => v === 1)).toBe(true);
    expect(Array.from({ length: 12 }, (_, i) => vaoDaCelula(i, 12, 4)).every((v) => v === 1)).toBe(true);
    expect(vaoDaCelula(8, 9, 4)).toBe(4);
    expect(vaoDaCelula(8, 9, 2)).toBe(2);
    expect(Array.from({ length: 3 }, (_, i) => vaoDaCelula(8 + i, 11, 4))).toEqual([1, 1, 2]);
  });

  it("as series dos cartoes: custos totais, taxas e devolucoes", () => {
    const soma = { pedidos: 4, receita: 1000, cmv: 300, taxas: 50, devolucoes: 10, gastoMeta: 200, gastoGoogle: 50 };
    expect(valorDaSerie(soma, "custos")).toBe(600);
    expect(valorDaSerie(soma, "taxas")).toBe(50);
    expect(valorDaSerie(soma, "devolucoes")).toBe(10);
    expect(valorDaSerie(soma, "lucro")).toBe(390);
    expect(valorDaSerie(soma, "roas")).toBe(4);
  });
});

describe("serie do grafico do destaque", () => {
  const d = dias("2026-09-03", 14);
  const atual = d.map((x, i) => ponto(x, { receita: 100, cmv: 40, gastoMeta: 20, pedidos: 2, parcial: i === 13 }));
  const anterior = dias("2026-08-20", 14).map((x, i) => ponto(x, { receita: i < 2 ? 0 : 50 }));

  it("por dia: titulo com o dia da semana e hoje parcial; o anterior em branco antes do historico", () => {
    const sLinha = montarSerieLinha({ atual, anterior, gran: "dia" });
    expect(sLinha.rotulos[0]).toBe("03/09");
    expect(sLinha.titulos[0]).toBe("qui. 03/09");
    expect(sLinha.titulos[13]).toBe("qua. 16/09 · hoje, parcial");
    expect(sLinha.parcialUltimo).toBe(true);
    expect(sLinha.anterior?.slice(0, 3).map((x) => x?.receita ?? null)).toEqual([null, null, 50]);
  });

  it("por semana soma os dias; por mes nao compara", () => {
    const semana = montarSerieLinha({ atual, anterior, gran: "semana" });
    expect(semana.titulos).toEqual(["Semana 03/09–09/09", "Semana 10/09–16/09 · parcial"]);
    expect(semana.atual.map((x) => x?.receita)).toEqual([700, 700]);
    expect(montarSerieLinha({ atual, anterior, gran: "mes" }).anterior).toBeNull();
  });

  it("variacao do ponto so entre grupos com o mesmo numero de dias", () => {
    // O anterior comeca 2 dias depois (antes do historico): a 1a semana tem 5 dias contra 7.
    expect(montarSerieLinha({ atual, anterior, gran: "semana" }).comparavel).toEqual([false, true]);
    expect(montarSerieLinha({ atual, anterior, gran: "dia" }).comparavel?.slice(0, 3)).toEqual([false, false, true]);
    // "Mes passado" de 31 dias contra 30: a ultima semana fica com um dia a menos no anterior.
    const curto = montarSerieLinha({ atual, anterior: anterior.slice(0, 13), gran: "semana" });
    expect(curto.comparavel).toEqual([false, false]);
    expect(montarSerieLinha({ atual, anterior: null, gran: "semana" }).comparavel).toBeNull();
  });

  it("anterior sem movimento nenhum: sem a linha tracejada", () => {
    const vazio = anterior.map((p) => ponto(p.dia));
    expect(montarSerieLinha({ atual, anterior: vazio, gran: "dia" }).anterior).toBeNull();
  });
});

describe("indicadores da tela", () => {
  const atual = totais({
    pedidos: 4,
    receita: 1000,
    cmv: 300,
    taxas: 50,
    gastoMeta: 200,
    gastoGoogle: 50,
    gasto: 250,
    lucro: 400,
    roas: 4,
    roasEquilibrio: 1000 / 650,
    margem: 0.4,
    cpa: 62.5,
    ticket: 250,
    coberturaCusto: 1,
  });
  const anterior = totais({ pedidos: 2, receita: 800, cmv: 300, taxas: 50, gastoMeta: 250, gasto: 250, lucro: 200, margem: 0.25 });
  const base: BaseIndicadores = { moeda: "BRL", atual, anterior, compara: true, dicas: { lucro: ["Parte usa câmbio aproximado."] } };

  it("loja online: lucro no destaque com o semaforo e a faixa na ordem da tela", () => {
    const { principal, celulas } = montarIndicadores(base, false);
    expect(principal.rotulo).toBe("Lucro estimado");
    expect(principal.selo).toEqual({ tom: "ok", texto: "Lucro" });
    expect(principal.variacao).toBe(1);
    expect(s(principal.anterior?.cheio ?? "")).toBe("R$ 200,00");
    expect(principal.notas).toEqual(["Parte usa câmbio aproximado."]);
    expect(principal.serie).toBe("lucro");
    expect(celulas.map((c) => c.id)).toEqual(["receita", "gasto", "roas", "margem", "pedidos", "ticket", "cpa", "custos", "custo", "taxas"]);
    const porId = new Map(celulas.map((c) => [c.id, c]));
    expect(s(porId.get("gasto")?.sub ?? "")).toMatch(/^Meta R\$ 200(,00)? · Google R\$ 50(,00)?$/);
    expect(porId.get("roas")?.sub).toBe("equilíbrio 1,54×");
    expect(porId.get("margem")?.variacao).toBeCloseTo(0.15);
    expect(porId.get("pedidos")?.selo).toEqual({ texto: "Todos com custo", tom: "ok" });
    // Todo KPI da loja online troca o grafico.
    expect(celulas.every((c) => c.serie)).toBe(true);
  });

  it("sem comparacao: nenhuma variacao nem valor anterior", () => {
    const { principal, celulas } = montarIndicadores({ ...base, compara: false }, false);
    expect([principal, ...celulas].every((c) => c.variacao === undefined && c.anterior === undefined)).toBe(true);
  });

  it("contra entrega: lucro previsto no destaque, desenhado pelo realizado", () => {
    const cod = totais({ ...atual, cod: { ...atual.cod, lucroPrevisto: -20, previsto: 900, gerados: 6 } });
    const { principal, celulas } = montarIndicadores({ ...base, atual: cod }, true);
    expect(principal.rotulo).toBe("Lucro previsto");
    expect(principal.rotuloSerie).toBe("Lucro realizado");
    expect(principal.selo?.texto).toBe("Prejuízo");
    expect(celulas).toHaveLength(12);
    const porRotulo = new Map(celulas.map((c) => [c.rotulo, c]));
    expect(porRotulo.get("Recebido")?.serie).toBe("receita");
    expect(porRotulo.get("A receber")?.serie).toBeUndefined();
    expect(porRotulo.get("Pedidos")?.valor).toBe(6);
  });
});
