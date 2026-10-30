import { describe, expect, it } from "vitest";
import {
  MAX_ACOES_POR_PASSADA,
  avaliarRegra,
  bateCondicao,
  erroDaRegra,
  inicioDoDiaNoFuso,
  objetoAoVivoDaResposta,
  orcamentoDaAcao,
  paraUnidadeMeta,
  proximaExecucao,
  validarAlteracao,
  valorDaMetrica,
  type ObjetoNaJanela,
  type RegraAnuncio,
} from "@/lib/ads/gerenciar-regras";

const conjuntoBidCap = objetoAoVivoDaResposta(
  {
    id: "120200000000001",
    name: "Conjunto A",
    status: "ACTIVE",
    effective_status: "ACTIVE",
    daily_budget: "5000",
    bid_strategy: "LOWEST_COST_WITH_BID_CAP",
    bid_amount: "250",
    campaign_id: "120200000000000",
    account_id: "123456789",
  },
  "grupo",
  "USD"
)!;

describe("estado ao vivo do objeto", () => {
  it("converte orcamento e lance da menor unidade", () => {
    expect(conjuntoBidCap.diario).toBe(50);
    expect(conjuntoBidCap.lance).toBe(2.5);
    expect(conjuntoBidCap.total).toBeNull();
    expect(conjuntoBidCap.conta).toBe("123456789");
  });

  it("moeda sem centavo vem na unidade cheia", () => {
    const o = objetoAoVivoDaResposta({ id: "1202000000001", daily_budget: "20000", account_id: "1" }, "campanha", "CLP")!;
    expect(o.diario).toBe(20000);
    expect(paraUnidadeMeta(25000, "CLP")).toBe("25000");
    expect(paraUnidadeMeta(50.5, "BRL")).toBe("5050");
  });

  it("le o ROAS minimo de bid_constraints (10000 = 1,00)", () => {
    const o = objetoAoVivoDaResposta(
      {
        id: "1202000000002",
        bid_strategy: "LOWEST_COST_WITH_MIN_ROAS",
        bid_constraints: { roas_average_floor: 15000 },
        account_id: "1",
      },
      "grupo",
      "USD"
    )!;
    expect(o.roasMinimo).toBe(1.5);
  });

  it("anuncio nao tem orcamento nem lance", () => {
    const o = objetoAoVivoDaResposta({ id: "1202000000003", daily_budget: "5000", account_id: "1" }, "anuncio", "USD")!;
    expect(o.diario).toBeNull();
    expect(o.lance).toBeNull();
  });

  it("sem id valido nao vira objeto", () => {
    expect(objetoAoVivoDaResposta({ name: "x" }, "grupo", "USD")).toBeNull();
  });
});

describe("validarAlteracao", () => {
  it("pausar e ativar", () => {
    const r = validarAlteracao(conjuntoBidCap, "status", "PAUSED");
    expect(r).toEqual({ ok: true, campos: { status: "PAUSED" }, antes: "ACTIVE", depois: "PAUSED" });
    expect(validarAlteracao(conjuntoBidCap, "status", "ACTIVE").ok).toBe(false);
    expect(validarAlteracao(conjuntoBidCap, "status", "DELETED").ok).toBe(false);
  });

  it("orcamento diario vai em centavos", () => {
    const r = validarAlteracao(conjuntoBidCap, "orcamento_diario", "60,5");
    expect(r).toEqual({ ok: true, campos: { daily_budget: "6050" }, antes: "50", depois: "60.5" });
  });

  it("recusa digito a mais e valor igual", () => {
    expect(validarAlteracao(conjuntoBidCap, "orcamento_diario", 5000).ok).toBe(false);
    expect(validarAlteracao(conjuntoBidCap, "orcamento_diario", 50).ok).toBe(false);
    expect(validarAlteracao(conjuntoBidCap, "orcamento_diario", 0).ok).toBe(false);
  });

  it("orcamento de quem nao o tem aponta o outro nivel", () => {
    const cbo = objetoAoVivoDaResposta({ id: "1202000000004", account_id: "1", bid_strategy: "LOWEST_COST_WITHOUT_CAP" }, "grupo", "USD")!;
    const r = validarAlteracao(cbo, "orcamento_diario", 10);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erro).toMatch(/campanha/);
  });

  it("lance so com bid cap / cost cap, e so no conjunto", () => {
    expect(validarAlteracao(conjuntoBidCap, "lance", 3)).toEqual({
      ok: true,
      campos: { bid_amount: "300" },
      antes: "2.5",
      depois: "3",
    });
    const semCap = { ...conjuntoBidCap, estrategia: "LOWEST_COST_WITHOUT_CAP" };
    expect(validarAlteracao(semCap, "lance", 3).ok).toBe(false);
  });

  it("ROAS minimo vira bid_constraints", () => {
    const roas = { ...conjuntoBidCap, estrategia: "LOWEST_COST_WITH_MIN_ROAS", roasMinimo: 1.2 };
    const r = validarAlteracao(roas, "roas_minimo", 1.5);
    expect(r.ok && r.campos).toEqual({ bid_constraints: JSON.stringify({ roas_average_floor: 15000 }) });
  });

  it("arquivado nao edita", () => {
    expect(validarAlteracao({ ...conjuntoBidCap, status: "ARCHIVED" }, "status", "ACTIVE").ok).toBe(false);
  });
});

const regraBase: RegraAnuncio = {
  id: "r1",
  nome: "IC caro",
  nivel: "anuncio",
  filtroNome: null,
  metrica: "custo_por_ic",
  operador: "maior",
  valor: 20,
  gastoMinimo: 20,
  janela: "hoje",
  acao: "pausar",
  acaoPercentual: null,
  orcamentoLimite: null,
  intervaloMinutos: 60,
};

function objeto(p: Partial<ObjetoNaJanela>): ObjetoNaJanela {
  return {
    contaId: "c1",
    objetoId: "1",
    nome: "Anuncio",
    nivel: "anuncio",
    status: "ACTIVE",
    gasto: 0,
    impressoes: 1000,
    cliques: 10,
    ic: 0,
    compras: 0,
    orcamentoDiario: 0,
    ...p,
  };
}

describe("metrica e condicao", () => {
  it("custo por IC sem IC: o que ja foi gasto e o piso", () => {
    const m = valorDaMetrica("custo_por_ic", objeto({ gasto: 25, ic: 0 }));
    expect(m).toEqual({ valor: null, piso: 25, indisponivel: false });
    expect(bateCondicao("maior", 20, m)).toBe(true);
    expect(bateCondicao("menor", 20, m)).toBe(false);
  });

  it("custo por compra sem loja nao julga", () => {
    const m = valorDaMetrica("custo_por_compra", objeto({ gasto: 100, compras: null }));
    expect(m.indisponivel).toBe(true);
    expect(bateCondicao("maior", 1, m)).toBe(false);
  });

  it("CTR e CPM", () => {
    expect(valorDaMetrica("ctr", objeto({ cliques: 15, impressoes: 1000 })).valor).toBe(1.5);
    expect(valorDaMetrica("cpm", objeto({ gasto: 12, impressoes: 1000 })).valor).toBe(12);
  });
});

describe("avaliarRegra", () => {
  it("pausa o anuncio com IC caro e respeita o gasto minimo", () => {
    const r = avaliarRegra(regraBase, [
      objeto({ objetoId: "1", gasto: 60, ic: 2 }), // 30 por IC: pausa
      objeto({ objetoId: "2", gasto: 60, ic: 4 }), // 15 por IC: fica
      objeto({ objetoId: "3", gasto: 10, ic: 0 }), // abaixo do gasto minimo
      objeto({ objetoId: "4", gasto: 80, ic: 1, status: "PAUSED" }), // ja parado
      objeto({ objetoId: "5", gasto: 80, ic: 1, nivel: "grupo" }), // outro nivel
    ]);
    expect(r.decisoes.map((d) => d.objeto.objetoId)).toEqual(["1"]);
    expect(r.decisoes[0].valorMetrica).toBe(30);
    expect(r.julgados).toBe(2);
  });

  it("filtro de nome sem acento nem maiuscula", () => {
    const regra = { ...regraBase, filtroNome: "PROMOÇÃO" };
    const r = avaliarRegra(regra, [
      objeto({ objetoId: "1", nome: "Promocao Black", gasto: 60, ic: 1 }),
      objeto({ objetoId: "2", nome: "Outro", gasto: 60, ic: 1 }),
    ]);
    expect(r.decisoes.map((d) => d.objeto.objetoId)).toEqual(["1"]);
  });

  it("diminuir orcamento respeita o piso e ignora quem nao tem orcamento", () => {
    const regra: RegraAnuncio = {
      ...regraBase,
      nivel: "grupo",
      acao: "diminuir_orcamento",
      acaoPercentual: 20,
      orcamentoLimite: 45,
    };
    const r = avaliarRegra(regra, [
      objeto({ objetoId: "1", nivel: "grupo", gasto: 60, ic: 1, orcamentoDiario: 100 }),
      objeto({ objetoId: "2", nivel: "grupo", gasto: 60, ic: 1, orcamentoDiario: 50 }),
      objeto({ objetoId: "3", nivel: "grupo", gasto: 60, ic: 1, orcamentoDiario: 0 }),
    ]);
    expect(r.decisoes.map((d) => [d.objeto.objetoId, d.orcamentoNovo])).toEqual([
      ["1", 80],
      ["2", 45],
    ]);
    expect(r.ignorados.map((i) => i.objetoId)).toEqual(["3"]);
  });

  it("teto de acoes por passada, quem gasta mais primeiro", () => {
    const muitos = Array.from({ length: MAX_ACOES_POR_PASSADA + 5 }, (_, i) =>
      objeto({ objetoId: String(i + 1), gasto: 100 + i, ic: 1 })
    );
    const r = avaliarRegra(regraBase, muitos);
    expect(r.decisoes).toHaveLength(MAX_ACOES_POR_PASSADA);
    expect(r.cortados).toBe(5);
    expect(r.decisoes[0].objeto.gasto).toBe(100 + MAX_ACOES_POR_PASSADA + 4);
  });
});

describe("orcamentoDaAcao", () => {
  it("aumentar para no teto", () => {
    expect(orcamentoDaAcao({ acao: "aumentar_orcamento", acaoPercentual: 30, orcamentoLimite: 120 }, 100)).toEqual({
      novo: 120,
    });
    expect("motivo" in orcamentoDaAcao({ acao: "aumentar_orcamento", acaoPercentual: 30, orcamentoLimite: 100 }, 100)).toBe(
      true
    );
  });
});

describe("erroDaRegra", () => {
  it("aceita a regra do exemplo e recusa orcamento no anuncio", () => {
    expect(erroDaRegra(regraBase)).toBeNull();
    expect(erroDaRegra({ ...regraBase, acao: "diminuir_orcamento", acaoPercentual: 20 })).toMatch(/Anúncio/);
    expect(erroDaRegra({ ...regraBase, intervaloMinutos: 45 })).toMatch(/Intervalo/);
    expect(erroDaRegra({ ...regraBase, nivel: "grupo", acao: "diminuir_orcamento", acaoPercentual: 100 })).toMatch(/Pausar/);
  });
});

describe("tempo", () => {
  it("proxima execucao no minuto cheio", () => {
    const agora = Date.parse("2026-10-30T03:10:42Z");
    expect(proximaExecucao(agora, 60)).toBe("2026-10-30T04:10:00.000Z");
  });

  it("meia-noite no fuso da conta", () => {
    expect(new Date(inicioDoDiaNoFuso("2026-10-30", "America/Sao_Paulo")).toISOString()).toBe("2026-10-30T03:00:00.000Z");
    expect(new Date(inicioDoDiaNoFuso("2026-10-30", "UTC")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(new Date(inicioDoDiaNoFuso("2026-10-30", "fuso/errado")).toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });
});
