import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// O sync fala com a Graph por meta-graph; aqui ela e trocada por respostas
// fixas para testar o que o sync GRAVA e o que ele APAGA.
const graph = vi.hoisted(() => ({
  buscarConta: vi.fn(),
  buscarInsightsDetalhado: vi.fn(),
}));
vi.mock("@/lib/ads/meta-graph", async () => {
  class ErroGraph extends Error {
    codigo: number | null;
    subcodigo: number | null;
    constructor(m: string, c: number | null, s: number | null) {
      super(m);
      this.codigo = c;
      this.subcodigo = s;
    }
  }
  return {
    ErroGraph,
    buscarConta: graph.buscarConta,
    buscarInsightsDetalhado: graph.buscarInsightsDetalhado,
  };
});

import {
  classificarErroMeta,
  comprasDe,
  contaDaListaMeta,
  deduplicarLinhas,
  deveBuscarCampanha,
  janelaDeSync,
  lerThrottle,
  linhasDeInsights,
  niveisParaLimpar,
  preencherDiasConta,
  type ContextoLinhas,
} from "../src/lib/ads/meta-mapear";
import { sincronizarContaMeta } from "../src/lib/ads/meta-sync";
import { diasNoIntervalo, type AdAccountRow, type AdSpendDailyRow } from "../src/lib/financeiro/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

const CTX: ContextoLinhas = {
  ad_account_id: "conta-1",
  user_id: "user-1",
  moedaConta: "USD",
  sincronizado_em: "2026-10-02T12:00:00.000Z",
};

describe("comprasDe", () => {
  it("escolhe omni_purchase quando ha os dois tipos e nao soma offsite", () => {
    const r = comprasDe(
      [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "3" },
        { action_type: "omni_purchase", value: "4" },
        { action_type: "link_click", value: "90" },
      ],
      [
        { action_type: "offsite_conversion.fb_pixel_purchase", value: "150.00" },
        { action_type: "omni_purchase", value: "210.50" },
      ]
    );
    expect(r).toEqual({ compras: 4, valor: 210.5 });
  });

  it("cai em offsite_conversion.fb_pixel_purchase quando falta omni", () => {
    const r = comprasDe(
      [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "2" }],
      [{ action_type: "offsite_conversion.fb_pixel_purchase", value: "99.9" }]
    );
    expect(r).toEqual({ compras: 2, valor: 99.9 });
  });

  it("sem actions da 0", () => {
    expect(comprasDe(undefined, undefined)).toEqual({ compras: 0, valor: 0 });
    expect(comprasDe([], [{ action_type: "omni_purchase", value: "10" }])).toEqual({
      compras: 0,
      valor: 0,
    });
  });
});

describe("linhasDeInsights", () => {
  it("converte spend '12.34' em 12.34, usa campanha_id '' no nivel conta e respeita account_currency", () => {
    const [l] = linhasDeInsights(
      [
        {
          account_currency: "BRL",
          date_start: "2026-10-01",
          spend: "12.34",
          impressions: "1000",
          clicks: "25",
          campaign_id: "999",
        },
      ],
      "conta",
      CTX
    );
    expect(l.gasto).toBe(12.34);
    expect(l.campanha_id).toBe("");
    expect(l.campanha_nome).toBeNull();
    expect(l.moeda).toBe("BRL");
    expect(l.impressoes).toBe(1000);
    expect(l.cliques).toBe(25);
    expect(l.fonte).toBe("api");
    expect(l.sincronizado_em).toBe(CTX.sincronizado_em);
  });

  it("no nivel campanha leva id e nome, e cai na moeda da conta sem account_currency", () => {
    const [l] = linhasDeInsights(
      [{ date_start: "2026-10-01", spend: "5", campaign_id: 123, campaign_name: "Lash" }],
      "campanha",
      CTX
    );
    expect(l.campanha_id).toBe("123");
    expect(l.campanha_nome).toBe("Lash");
    expect(l.moeda).toBe("USD");
  });

  it("descarta linha de campanha sem id", () => {
    expect(linhasDeInsights([{ date_start: "2026-10-01", spend: "5" }], "campanha", CTX)).toEqual(
      []
    );
  });
});

describe("preencherDiasConta", () => {
  it("cria zeros nos dias faltantes de um intervalo de 3 dias", () => {
    const linhas = linhasDeInsights(
      [{ date_start: "2026-09-30", spend: "10", account_currency: "USD" }],
      "conta",
      CTX
    );
    const r = preencherDiasConta(linhas, { desde: "2026-09-29", ate: "2026-10-01" }, CTX);
    const conta = r.filter((l) => l.nivel === "conta");
    expect(conta.map((l) => [l.data, l.gasto])).toEqual([
      ["2026-09-29", 0],
      ["2026-09-30", 10],
      ["2026-10-01", 0],
    ]);
    expect(conta.every((l) => l.campanha_id === "" && l.moeda === "USD")).toBe(true);
  });

  it("deixa as linhas de campanha intactas", () => {
    const camp = linhasDeInsights(
      [{ date_start: "2026-09-30", spend: "3", campaign_id: "7" }],
      "campanha",
      CTX
    );
    const r = preencherDiasConta(camp, { desde: "2026-09-30", ate: "2026-09-30" }, CTX);
    expect(r.filter((l) => l.nivel === "campanha")).toEqual(camp);
    expect(r.filter((l) => l.nivel === "conta")).toHaveLength(1);
  });
});

describe("janelaDeSync", () => {
  const agora = new Date("2026-10-02T15:00:00Z");

  it("sem reprocesso anterior: 28 dias com reprocesso true", () => {
    const j = janelaDeSync({ fuso: "UTC", ultimo_reprocesso_em: null }, agora);
    expect(j.reprocesso).toBe(true);
    expect(j.ate).toBe("2026-10-02");
    expect(j.desde).toBe("2026-09-05");
    expect(diasNoIntervalo(j)).toBe(28);
  });

  it("reprocesso de 2 h atras: ontem..hoje", () => {
    const j = janelaDeSync(
      { fuso: "UTC", ultimo_reprocesso_em: "2026-10-02T13:00:00Z" },
      agora
    );
    expect(j).toEqual({ desde: "2026-10-01", ate: "2026-10-02", reprocesso: false });
  });

  it("reprocesso de mais de 20 h atras volta a ser reprocesso", () => {
    const j = janelaDeSync(
      { fuso: "UTC", ultimo_reprocesso_em: "2026-10-01T18:00:00Z" },
      agora
    );
    expect(j.reprocesso).toBe(true);
  });

  it("fuso America/Los_Angeles muda o 'hoje' perto da meia-noite UTC", () => {
    const meiaNoite = new Date("2026-10-02T01:00:00Z");
    const ultimo = "2026-10-02T00:00:00Z";
    expect(janelaDeSync({ fuso: "UTC", ultimo_reprocesso_em: ultimo }, meiaNoite).ate).toBe(
      "2026-10-02"
    );
    const la = janelaDeSync({ fuso: "America/Los_Angeles", ultimo_reprocesso_em: ultimo }, meiaNoite);
    expect(la).toEqual({ desde: "2026-09-30", ate: "2026-10-01", reprocesso: false });
  });
});

describe("classificarErroMeta", () => {
  it("190 = token, 17 = limite, 200 = permissao", () => {
    expect(classificarErroMeta(190)).toBe("token");
    expect(classificarErroMeta(17)).toBe("limite");
    expect(classificarErroMeta(200)).toBe("permissao");
    expect(classificarErroMeta(10)).toBe("permissao");
    expect(classificarErroMeta(4)).toBe("limite");
    expect(classificarErroMeta(80000)).toBe("limite");
    expect(classificarErroMeta(100)).toBe("outro");
    expect(classificarErroMeta(null)).toBe("outro");
  });
});

describe("throttle e contas", () => {
  it("le o header de throttle e decide pular a campanha acima de 75%", () => {
    const t = lerThrottle('{"app_id_util_pct":10,"acc_id_util_pct":80,"ads_api_access_tier":"x"}');
    expect(t).toEqual({ app_id_util_pct: 10, acc_id_util_pct: 80 });
    expect(deveBuscarCampanha(t)).toBe(false);
    expect(deveBuscarCampanha({ app_id_util_pct: 0, acc_id_util_pct: 75 })).toBe(true);
    expect(deveBuscarCampanha(null)).toBe(true);
    expect(lerThrottle("lixo")).toBeNull();
  });

  it("niveisParaLimpar so inclui campanha quando ela foi buscada", () => {
    expect(niveisParaLimpar(true)).toEqual(["conta", "campanha"]);
    expect(niveisParaLimpar(false)).toEqual(["conta"]);
  });

  it("contaDaListaMeta tira o act_ e recusa id curto", () => {
    expect(
      contaDaListaMeta({ id: "act_123456789", name: " Loja ", currency: "usd", account_status: 1 })
    ).toEqual({ account_id: "123456789", nome: "Loja", moeda: "USD", fuso: null, status: "ativa" });
    expect(contaDaListaMeta({ id: "act_12" })).toBeNull();
  });

  it("deduplicarLinhas mantem a ultima de cada chave", () => {
    const [a] = linhasDeInsights([{ date_start: "2026-10-01", spend: "1" }], "conta", CTX);
    const b = { ...a, gasto: 2 };
    expect(deduplicarLinhas([a, b])).toEqual([b]);
  });
});

// ---------------------------------------------------------------------------
// Sync com banco falso em memoria: o que importa e o que sobra na tabela.
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

function bancoFalso(gasto: AdSpendDailyRow[]) {
  const tabelas: Record<string, Linha[]> = {
    ad_spend_daily: gasto.map((g) => ({ ...g })),
    ad_accounts: [],
  };
  const chave = (l: Linha) => `${l.ad_account_id}|${l.data}|${l.nivel}|${l.campanha_id}`;

  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: "delete" | "update" | null = null;
    let patch: Linha = {};
    const builder = {
      upsert(rows: Linha[]) {
        const t = tabelas[tabela];
        for (const r of rows) {
          const i = t.findIndex((l) => chave(l) === chave(r));
          if (i >= 0) t[i] = { ...t[i], ...r };
          else t.push({ ...r });
        }
        return Promise.resolve({ error: null });
      },
      update(p: Linha) {
        op = "update";
        patch = p;
        return builder;
      },
      delete() {
        op = "delete";
        return builder;
      },
      eq(c: string, v: unknown) {
        filtros.push((l) => l[c] === v);
        return builder;
      },
      in(c: string, vs: unknown[]) {
        filtros.push((l) => vs.includes(l[c]));
        return builder;
      },
      gte(c: string, v: string) {
        filtros.push((l) => String(l[c]) >= v);
        return builder;
      },
      lte(c: string, v: string) {
        filtros.push((l) => String(l[c]) <= v);
        return builder;
      },
      lt(c: string, v: string) {
        filtros.push((l) => String(l[c]) < v);
        return builder;
      },
      then(res: (v: { error: null }) => unknown) {
        const casa = (l: Linha) => filtros.every((f) => f(l));
        if (op === "delete") tabelas[tabela] = tabelas[tabela].filter((l) => !casa(l));
        if (op === "update") tabelas[tabela] = tabelas[tabela].map((l) => (casa(l) ? { ...l, ...patch } : l));
        return Promise.resolve({ error: null }).then(res);
      },
    };
    return builder;
  }
  return { admin: { from } as unknown as SupabaseClient, tabelas };
}

const CONTA: AdAccountRow = {
  id: "conta-1",
  user_id: "user-1",
  store_id: "loja-1",
  plataforma: "meta",
  external_id: "123456789",
  nome: "Conta",
  moeda: "USD",
  fuso: "UTC",
  status_externo: "ativa",
  fonte: "api",
  ativo: true,
  sincronizando_desde: null,
  ultimo_sync_em: null,
  ultimo_sync_ok_em: null,
  // Reprocesso recente: janela curta (ontem..hoje) e sem buscarConta.
  ultimo_reprocesso_em: "2026-10-02T10:00:00Z",
  ultimo_dado_gerado_em: null,
  ultimo_erro: null,
};

const VELHO = "2026-10-02T11:45:00.000Z";

function linhaVelha(p: Partial<AdSpendDailyRow>): AdSpendDailyRow {
  return {
    ad_account_id: "conta-1",
    user_id: "user-1",
    data: "2026-10-01",
    nivel: "campanha",
    campanha_id: "77",
    campanha_nome: "Antiga",
    moeda: "USD",
    gasto: 9,
    impressoes: 0,
    cliques: 0,
    compras: 0,
    valor_compras: 0,
    fonte: "api",
    sincronizado_em: VELHO,
    ...p,
  };
}

describe("sincronizarContaMeta", () => {
  const agora = new Date("2026-10-02T12:00:00Z");

  beforeEach(() => {
    graph.buscarConta.mockReset();
    graph.buscarInsightsDetalhado.mockReset();
  });

  it("com throttle alto, linhas campanha da janela sobrevivem", async () => {
    const { admin, tabelas } = bancoFalso([
      linhaVelha({}),
      linhaVelha({ nivel: "conta", campanha_id: "", campanha_nome: null, data: "2026-09-20" }),
    ]);
    graph.buscarInsightsDetalhado.mockResolvedValueOnce({
      rows: [{ date_start: "2026-10-01", spend: "20", account_currency: "USD" }],
      throttle: { app_id_util_pct: 5, acc_id_util_pct: 90 },
    });

    await sincronizarContaMeta(admin, CONTA, "tok", agora);

    // Nao chamou o nivel campanha.
    expect(graph.buscarInsightsDetalhado).toHaveBeenCalledTimes(1);
    const campanhas = tabelas.ad_spend_daily.filter((l) => l.nivel === "campanha");
    expect(campanhas).toHaveLength(1);
    expect(campanhas[0].gasto).toBe(9);
    // Total da conta: ontem e hoje gravados (hoje zerado); dia fora da janela intacto.
    const conta = tabelas.ad_spend_daily
      .filter((l) => l.nivel === "conta")
      .map((l) => [l.data, l.gasto])
      .sort();
    expect(conta).toEqual([
      ["2026-09-20", 9],
      ["2026-10-01", 20],
      ["2026-10-02", 0],
    ]);
  });

  it("com campanha buscada, campanha que sumiu do Insights e apagada", async () => {
    const { admin, tabelas } = bancoFalso([linhaVelha({})]);
    graph.buscarInsightsDetalhado
      .mockResolvedValueOnce({
        rows: [{ date_start: "2026-10-01", spend: "20", account_currency: "USD" }],
        throttle: { app_id_util_pct: 5, acc_id_util_pct: 10 },
      })
      .mockResolvedValueOnce({
        rows: [
          { date_start: "2026-10-01", spend: "20", campaign_id: "88", campaign_name: "Nova" },
        ],
        throttle: null,
      });

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    expect(r.linhas).toBe(3);
    const campanhas = tabelas.ad_spend_daily.filter((l) => l.nivel === "campanha");
    expect(campanhas.map((l) => l.campanha_id)).toEqual(["88"]);
    expect(campanhas[0].sincronizado_em).toBe(agora.toISOString());
  });

  it("limite do Meta no nivel campanha nao derruba o total", async () => {
    const { ErroGraph } = await import("@/lib/ads/meta-graph");
    const { admin, tabelas } = bancoFalso([linhaVelha({})]);
    graph.buscarInsightsDetalhado
      .mockResolvedValueOnce({
        rows: [{ date_start: "2026-10-01", spend: "20", account_currency: "USD" }],
        throttle: null,
      })
      .mockRejectedValueOnce(new ErroGraph("limite", 80000, null));

    await sincronizarContaMeta(admin, CONTA, "tok", agora);

    const campanhas = tabelas.ad_spend_daily.filter((l) => l.nivel === "campanha");
    expect(campanhas.map((l) => l.campanha_id)).toEqual(["77"]);
    expect(
      tabelas.ad_spend_daily.some((l) => l.nivel === "conta" && l.data === "2026-10-01" && l.gasto === 20)
    ).toBe(true);
  });
});
