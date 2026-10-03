import { describe, expect, it } from "vitest";
import {
  agrupar,
  campoCsv,
  derivar,
  dinheiro,
  granularidades,
  lerListaGuardada,
  montarCsv,
  montarGrafico,
  montarPendencias,
  ordenarFixados,
  porcento,
  semInicioVazio,
  vezes,
  type EntradaPendencias,
} from "@/app/(dashboard)/financeiro/lucro-dados";
import type { PontoDia } from "@/lib/leitura/serie-diaria";

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

describe("formatacao", () => {
  it("dinheiro inteiro e compacto; sem valor vira travessao", () => {
    expect(s(dinheiro(1234.5, "BRL"))).toBe("R$ 1.234,50");
    expect(s(dinheiro(48700, "BRL", true))).toBe("R$ 48,7 mil");
    expect(dinheiro(null, "BRL")).toBe("—");
    expect(dinheiro(Number.NaN, "BRL")).toBe("—");
  });

  it("ROAS e porcentagem", () => {
    expect(vezes(2.345)).toBe("2,35×");
    expect(vezes(null)).toBe("—");
    expect(s(porcento(0.1234))).toBe("12,3%");
  });
});

describe("derivar", () => {
  it("usa as formulas do calculo e nao inventa sem base", () => {
    const d = derivar({ pedidos: 4, receita: 1000, cmv: 300, taxas: 50, gastoMeta: 200, gastoGoogle: 50 });
    expect(d).toEqual({ receita: 1000, gasto: 250, lucro: 400, roas: 4, pedidos: 4, ticket: 250, cpa: 62.5, margem: 0.4 });
    const vazio = derivar({ pedidos: 0, receita: 0, cmv: 0, taxas: 0, gastoMeta: 0, gastoGoogle: 0 });
    expect(vazio).toMatchObject({ roas: null, ticket: null, cpa: null, margem: null, lucro: 0 });
  });
});

describe("agrupar e granularidades", () => {
  const d = dias("2026-09-03", 30);
  const pontos = d.map((x, i) => ponto(x, { receita: 10, pedidos: 1, parcial: i === 29 }));

  it("semana em blocos de 7 a partir do primeiro dia", () => {
    const g = agrupar(pontos, d, "semana");
    expect(g.map((x) => x.rotulo)).toEqual(["03/09", "10/09", "17/09", "24/09", "01/10"]);
    expect(g.map((x) => x.soma?.receita)).toEqual([70, 70, 70, 70, 20]);
    expect(g[4].parcial).toBe(true);
  });

  it("mes pelo calendario", () => {
    const g = agrupar(pontos, d, "mes");
    expect(g.map((x) => x.rotulo)).toEqual(["set", "out"]);
    expect(g.map((x) => x.soma?.receita)).toEqual([280, 20]);
  });

  it("grupo sem nenhum dia com dado fica sem soma", () => {
    const g = agrupar([null, null, ponto(d[2])], d.slice(0, 3), "dia");
    expect(g.map((x) => x.soma === null)).toEqual([true, true, false]);
  });

  it("semana e mes so quando fazem sentido", () => {
    const sete = granularidades(dias("2026-09-26", 7));
    expect(sete.find((o) => o.valor === "semana")?.desabilitado).toBe(true);
    expect(sete.find((o) => o.valor === "mes")?.desabilitado).toBe(false);
    const umMes = granularidades(dias("2026-09-01", 30));
    expect(umMes.find((o) => o.valor === "semana")?.desabilitado).toBe(false);
    expect(umMes.find((o) => o.valor === "mes")?.desabilitado).toBe(true);
  });
});

describe("semInicioVazio", () => {
  it("dias sem movimento no comeco viram lacuna, nunca zero", () => {
    const p = [ponto("2026-08-01"), ponto("2026-08-02"), ponto("2026-08-03", { receita: 5 }), ponto("2026-08-04")];
    expect(semInicioVazio(p).map((x) => (x ? x.dia : null))).toEqual([null, null, "2026-08-03", "2026-08-04"]);
    expect(semInicioVazio([ponto("2026-08-01")])).toEqual([null]);
  });
});

describe("montarGrafico", () => {
  const d = dias("2026-09-03", 14);
  const atual = d.map((x, i) => ponto(x, { receita: 100, cmv: 40, gastoMeta: 20, pedidos: 2, parcial: i === 13 }));
  const anterior = dias("2026-08-20", 14).map((x, i) => ponto(x, { receita: i < 2 ? 0 : 50, cmv: i < 2 ? 0 : 10 }));

  it("composto: faturamento, gasto, lucro e o lucro anterior tracejado", () => {
    const g = montarGrafico({ atual, anterior, gran: "dia", metrica: null });
    expect(g.series.map((x) => [x.id, x.cor])).toEqual([
      ["receita", "chart-2"],
      ["gasto", "chart-3"],
      ["lucro", "chart-1"],
      ["anterior", "comparacao"],
    ]);
    expect(g.series[2].valores[0]).toBe(40);
    // Comeco do anterior sem movimento: lacuna, nao zero.
    expect(g.series[3].valores.slice(0, 3)).toEqual([null, null, 40]);
    expect(g.parcialUltimo).toBe(true);
    expect(g.rotulos[0]).toBe("03/09");
  });

  it("metrica escolhida: atual e anterior da mesma metrica", () => {
    const g = montarGrafico({ atual, anterior, gran: "semana", metrica: "roas" });
    expect(g.series.map((x) => x.id)).toEqual(["atual", "anterior"]);
    expect(g.series[0].valores).toEqual([5, 5]);
    expect(g.series[0].rotulo).toBe("ROAS real · período atual");
  });

  it("sem comparacao, anterior vazio ou por mes: sem a linha tracejada", () => {
    expect(montarGrafico({ atual, anterior: null, gran: "dia", metrica: null }).series).toHaveLength(3);
    const vazio = anterior.map((p) => ponto(p.dia));
    expect(montarGrafico({ atual, anterior: vazio, gran: "dia", metrica: null }).series).toHaveLength(3);
    expect(montarGrafico({ atual, anterior, gran: "mes", metrica: null }).series).toHaveLength(3);
  });
});

describe("KPI fixado", () => {
  it("fixados primeiro, na ordem padrao; lixo e ignorado", () => {
    expect(ordenarFixados(["margem", "lucro", "xyz"]).slice(0, 3)).toEqual(["lucro", "margem", "receita"]);
    expect(ordenarFixados([])).toHaveLength(8);
  });

  it("lista guardada invalida volta ao padrao", () => {
    expect(lerListaGuardada(null, ["lucro"])).toEqual(["lucro"]);
    expect(lerListaGuardada("{quebrado", ["lucro"])).toEqual(["lucro"]);
    expect(lerListaGuardada('["cpa", 3]', ["lucro"])).toEqual(["cpa"]);
    expect(lerListaGuardada("[]", ["lucro"])).toEqual([]);
  });
});

describe("montarPendencias", () => {
  const A = "a";
  const B = "b";
  const base: EntradaPendencias = {
    lojas: [
      { id: A, nome: "Lumen", dominio: "lumen.myshopify.com" },
      { id: B, nome: "Tarn", dominio: "tarn.myshopify.com" },
    ],
    lojaIds: [A, B],
    estados: [
      { store_id: A, carga_inicial_ok: true, ultimo_erro: null, ultimo_erro_tipo: null },
      { store_id: B, carga_inicial_ok: true, ultimo_erro: null, ultimo_erro_tipo: null },
    ],
    contas: { total: 1, semLoja: 0, comErro: [], googleSemDado3h: [] },
    avisos: {
      cambioAproximado: false,
      moedasSemCotacao: [],
      lojasSemTaxa: [],
      lojasSemCustoPadraoComFalta: [],
      fusosDiferentes: [],
    },
    coberturaCusto: 1,
    porLoja: [
      { storeId: A, receita: 100, pedidos: 1 },
      { storeId: B, receita: 0, pedidos: 0 },
    ],
  };

  it("tudo certo: nenhuma pendencia", () => {
    expect(montarPendencias(base)).toEqual([]);
  });

  it("critico antes de atencao antes de informativo; so o informativo se dispensa", () => {
    const p = montarPendencias({
      ...base,
      coberturaCusto: 0.8,
      avisos: { ...base.avisos, lojasSemCustoPadraoComFalta: ["Lumen"], cambioAproximado: true, lojasSemTaxa: ["Tarn"] },
      contas: { ...base.contas, googleSemDado3h: ["Google Lumen"] },
    });
    expect(p.map((x) => [x.id, x.tom])).toEqual([
      ["custo-faltando", "err"],
      ["google-3h", "warn"],
      ["taxa", "warn"],
      ["cambio", "info"],
    ]);
    expect(s(p[0].titulo)).toBe("Lucro inflado: 20,0% da receita vendeu sem custo cadastrado");
    expect(p.filter((x) => x.dispensavel).map((x) => x.id)).toEqual(["cambio"]);
  });

  it("loja sem acesso que vendeu no periodo e critica; parada so pede atencao", () => {
    const parada = montarPendencias({
      ...base,
      estados: [base.estados[0], { ...base.estados[1], ultimo_erro: "403", ultimo_erro_tipo: "negado" }],
    });
    expect(parada.map((x) => [x.id, x.tom])).toEqual([["negado", "warn"]]);
    expect(parada[0].titulo).toBe("A Shopify não deixa ler os pedidos de Tarn");

    const vendeu = montarPendencias({
      ...base,
      estados: [{ ...base.estados[0], ultimo_erro: "403", ultimo_erro_tipo: "negado" }, base.estados[1]],
    });
    expect(vendeu[0].tom).toBe("err");
  });

  it("um aviso por tipo, com as lojas listadas", () => {
    const p = montarPendencias({
      ...base,
      estados: [
        { store_id: A, carga_inicial_ok: false, ultimo_erro: null, ultimo_erro_tipo: null },
        { store_id: B, carga_inicial_ok: false, ultimo_erro: null, ultimo_erro_tipo: null },
      ],
    });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ id: "carga", acao: { sincronizar: true } });
    expect(p[0].detalhe).toContain("Lumen e Tarn");
  });
});

describe("CSV", () => {
  it("numero cru com virgula, texto com aspas so quando precisa", () => {
    expect(campoCsv(1234.5)).toBe("1234,5");
    expect(campoCsv(0.123456)).toBe("0,1235");
    expect(campoCsv(null)).toBe("");
    expect(campoCsv("Loja; teste")).toBe('"Loja; teste"');
    expect(campoCsv('diz "oi"')).toBe('"diz ""oi"""');
  });

  it("contexto, linha em branco, cabecalho e linhas", () => {
    expect(montarCsv(["Lucro por loja", "Todas as lojas"], ["Loja", "Lucro"], [["Lumen", 10.5]])).toBe(
      "Lucro por loja;Todas as lojas\r\n\r\nLoja;Lucro\r\nLumen;10,5\r\n"
    );
  });
});
