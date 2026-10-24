import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// A Graph e trocada por respostas fixas: o que importa e o que o sync GRAVA
// em ad_insights_granular, o que APAGA, e que o gasto (ad_spend_daily) segue
// igual quando o detalhe falha.
const graph = vi.hoisted(() => ({
  buscarConta: vi.fn(),
  buscarInsightsDetalhado: vi.fn(),
  buscarEstruturaMeta: vi.fn(),
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
    buscarEstruturaMeta: graph.buscarEstruturaMeta,
  };
});

import {
  corteDaRetencaoGranular,
  estruturaDaLista,
  linhasGranulares,
  metricasDoDia,
  niveisGranularesParaLimpar,
  objetoDaLista,
  orcamentoEmUnidades,
  STATUS_FORA_DA_LISTA,
  textoDoErroGranular,
  tipoDoOrcamento,
  type EntradaGranular,
  type LinhaGranularMeta,
  type ObjetoMeta,
} from "../src/lib/ads/meta-granular";
import type { ContextoLinhas, InsightMeta } from "../src/lib/ads/meta-mapear";
import { sincronizarContaMeta } from "../src/lib/ads/meta-sync";
import type { AdAccountRow } from "../src/lib/financeiro/tipos";
import type { SupabaseClient } from "@supabase/supabase-js";

const CTX: ContextoLinhas = {
  ad_account_id: "conta-1",
  user_id: "user-1",
  moedaConta: "USD",
  sincronizado_em: "2026-10-02T12:00:00.000Z",
};

// ---------------------------------------------------------------------------
// Pecas puras
// ---------------------------------------------------------------------------

describe("orcamentoEmUnidades", () => {
  it("centavos viram unidades; moeda de offset 1 fica cheia; vazio e zero viram 0", () => {
    expect(orcamentoEmUnidades("5000", "USD")).toBe(50);
    expect(orcamentoEmUnidades("12345", "BRL")).toBe(123.45);
    expect(orcamentoEmUnidades("5000", "JPY")).toBe(5000);
    expect(orcamentoEmUnidades("0", "USD")).toBe(0);
    expect(orcamentoEmUnidades(undefined, "USD")).toBe(0);
    expect(orcamentoEmUnidades("abc", "USD")).toBe(0);
  });
});

describe("objetoDaLista e tipoDoOrcamento", () => {
  it("le id, status efetivo, pais e orcamento diario; sem id nao entra", () => {
    const c = objetoDaLista(
      { id: "10", name: " Campanha X ", effective_status: "active", daily_budget: "2500" },
      "USD"
    );
    expect(c).toEqual({
      id: "10",
      nome: "Campanha X",
      status: "ACTIVE",
      campanhaId: null,
      grupoId: null,
      diario: 25,
      temOrcamento: true,
    });
    const ad = objetoDaLista({ id: 30, effective_status: "ADSET_PAUSED", adset_id: "20", campaign_id: "10" }, "USD");
    expect(ad?.id).toBe("30");
    expect(ad?.grupoId).toBe("20");
    expect(ad?.campanhaId).toBe("10");
    expect(ad?.temOrcamento).toBe(false);
    expect(objetoDaLista({ name: "sem id" }, "USD")).toBeNull();
    expect(objetoDaLista(null, "USD")).toBeNull();
    expect(objetoDaLista({ id: "1" }, "USD")?.status).toBe("UNKNOWN");
  });

  it("vitalicio conta como orcamento (CBO) mas o diario fica 0", () => {
    const c = objetoDaLista({ id: "10", effective_status: "ACTIVE", lifetime_budget: "100000" }, "USD");
    expect(c?.diario).toBe(0);
    expect(c?.temOrcamento).toBe(true);
    expect(tipoDoOrcamento(c ?? undefined)).toBe("CBO");
  });

  it("CBO pela campanha; sem campanha na lista, o conjunto decide; sem nada, null", () => {
    const comOrc = { temOrcamento: true } as ObjetoMeta;
    const semOrc = { temOrcamento: false } as ObjetoMeta;
    expect(tipoDoOrcamento(comOrc, semOrc)).toBe("CBO");
    expect(tipoDoOrcamento(semOrc, comOrc)).toBe("ABO");
    expect(tipoDoOrcamento(undefined, comOrc)).toBe("ABO");
    expect(tipoDoOrcamento(undefined, semOrc)).toBe("CBO");
    expect(tipoDoOrcamento()).toBeNull();
  });
});

describe("metricasDoDia", () => {
  it("le o cru: gasto, IC omni antes do pixel, 3 s em actions, reproducao e 75% em listas proprias", () => {
    const m = metricasDoDia({
      spend: "12.3456",
      impressions: "1000",
      clicks: "40",
      frequency: "1.23456",
      actions: [
        { action_type: "offsite_conversion.fb_pixel_initiate_checkout", value: "9" },
        { action_type: "omni_initiated_checkout", value: "7" },
        { action_type: "video_view", value: "300" },
        { action_type: "link_click", value: "35" },
      ],
      video_play_actions: [{ action_type: "video_view", value: "400" }],
      video_p75_watched_actions: [{ action_type: "video_view", value: "30" }],
    });
    expect(m).toEqual({
      gasto: 12.3456,
      impressoes: 1000,
      cliques: 40,
      ic: 7,
      vis_video: 400,
      vis_3s: 300,
      // CONTAGEM de 75% assistido, nao taxa.
      retencao_75: 30,
      frequencia: 1.23,
    });
  });

  it("cai no IC do pixel sem omni; lista de video sem video_view soma; campo ausente e 0", () => {
    const m = metricasDoDia({
      spend: "1",
      actions: [{ action_type: "offsite_conversion.fb_pixel_initiate_checkout", value: "3" }],
      video_p75_watched_actions: [{ action_type: "outro", value: "5" }],
    });
    expect(m.ic).toBe(3);
    expect(m.vis_video).toBe(0);
    expect(m.retencao_75).toBe(5);
    expect(m.impressoes).toBe(0);
    expect(m.frequencia).toBe(0);
    expect(metricasDoDia({})).toEqual({
      gasto: 0,
      impressoes: 0,
      cliques: 0,
      ic: 0,
      vis_video: 0,
      vis_3s: 0,
      retencao_75: 0,
      frequencia: 0,
    });
  });

  it("numero absurdo nao passa do numeric(8,2) (recusaria o lote)", () => {
    expect(metricasDoDia({ frequency: "123456789" }).frequencia).toBe(999_999.99);
    expect(
      metricasDoDia({ video_p75_watched_actions: [{ action_type: "video_view", value: "5000000" }] }).retencao_75
    ).toBe(999_999);
  });
});

function estrutura() {
  return estruturaDaLista(
    {
      campanhas: [
        // CBO: orcamento na campanha (centavos).
        { id: "c1", name: "CBO Nome Novo", effective_status: "ACTIVE", daily_budget: "10000" },
        // ABO: orcamento nos conjuntos.
        { id: "c2", name: "ABO", effective_status: "PAUSED" },
        // Ativa sem gasto hoje.
        { id: "c3", name: "Ligada agora", effective_status: "ACTIVE", daily_budget: "3000" },
      ],
      conjuntos: [
        { id: "g1", name: "Conj CBO", effective_status: "ACTIVE", campaign_id: "c1" },
        { id: "g2", name: "Conj ABO", effective_status: "CAMPAIGN_PAUSED", campaign_id: "c2", daily_budget: "2000" },
      ],
      anuncios: [
        { id: "a1", name: "Video 1", effective_status: "ACTIVE", adset_id: "g1", campaign_id: "c1" },
        { id: "a2", name: "Pausado", effective_status: "PAUSED", adset_id: "g1", campaign_id: "c1" },
      ],
    },
    "USD"
  );
}

function entrada(p: Partial<EntradaGranular> = {}): EntradaGranular {
  return {
    ctx: CTX,
    hoje: "2026-10-02",
    insights: { campanha: [], grupo: [], anuncio: [] },
    completos: { campanha: true, grupo: true, anuncio: true },
    estrutura: estrutura(),
    ...p,
  };
}

function achar(linhas: LinhaGranularMeta[], data: string, nivel: string, id: string) {
  return linhas.find((l) => l.data === data && l.nivel === nivel && l.objeto_id === id);
}

describe("linhasGranulares", () => {
  const insights: EntradaGranular["insights"] = {
    campanha: [
      { date_start: "2026-10-01", campaign_id: "c1", campaign_name: "CBO Nome Velho", spend: "20", account_currency: "USD" },
      { date_start: "2026-10-01", campaign_id: "c2", campaign_name: "ABO", spend: "5" },
    ],
    grupo: [
      { date_start: "2026-10-01", campaign_id: "c2", campaign_name: "ABO", adset_id: "g2", adset_name: "Conj ABO", spend: "5" },
    ],
    anuncio: [
      {
        date_start: "2026-10-01",
        campaign_id: "c1",
        campaign_name: "CBO Nome Velho",
        adset_id: "g1",
        adset_name: "Conj CBO",
        ad_id: "a2",
        ad_name: "Pausado",
        spend: "20",
        impressions: "500",
      },
    ],
  };

  it("campanha CBO: orcamento da campanha em unidades, nome e status de agora", () => {
    const l = achar(linhasGranulares(entrada({ insights })), "2026-10-01", "campanha", "c1");
    expect(l).toMatchObject({
      plataforma: "meta",
      user_id: "user-1",
      ad_account_id: "conta-1",
      objeto_nome: "CBO Nome Novo",
      objeto_status: "ACTIVE",
      campanha_id: "c1",
      campanha_nome: "CBO Nome Novo",
      grupo_id: null,
      grupo_nome: null,
      tipo: "CBO",
      orcamento: 100,
      gasto: 20,
      moeda: "USD",
      sincronizado_em: CTX.sincronizado_em,
    });
  });

  it("ABO: campanha sem orcamento (0), conjunto com o dele; anuncio nunca tem orcamento", () => {
    const linhas = linhasGranulares(entrada({ insights }));
    expect(achar(linhas, "2026-10-01", "campanha", "c2")).toMatchObject({ tipo: "ABO", orcamento: 0, objeto_status: "PAUSED" });
    expect(achar(linhas, "2026-10-01", "grupo", "g2")).toMatchObject({
      tipo: "ABO",
      orcamento: 20,
      objeto_status: "CAMPAIGN_PAUSED",
      campanha_id: "c2",
      campanha_nome: "ABO",
      grupo_id: "g2",
      grupo_nome: "Conj ABO",
    });
    expect(achar(linhas, "2026-10-01", "anuncio", "a2")).toMatchObject({
      tipo: "CBO",
      orcamento: 0,
      objeto_status: "PAUSED",
      campanha_id: "c1",
      campanha_nome: "CBO Nome Novo",
      grupo_id: "g1",
      grupo_nome: "Conj CBO",
      impressoes: 500,
    });
  });

  it("objeto que gastou e nao esta na lista (arquivado ou apagado) leva o nome do Insights", () => {
    const linhas = linhasGranulares(
      entrada({
        insights: {
          campanha: [{ date_start: "2026-10-01", campaign_id: "c9", campaign_name: "Apagada", spend: "3" }],
          grupo: [],
          anuncio: [{ date_start: "2026-10-01", campaign_id: "c9", adset_id: "g9", ad_id: "a9", spend: "3" }],
        },
      })
    );
    expect(achar(linhas, "2026-10-01", "campanha", "c9")).toMatchObject({
      objeto_nome: "Apagada",
      objeto_status: STATUS_FORA_DA_LISTA,
      tipo: null,
      orcamento: 0,
    });
    // Sem nome em lugar nenhum: o id.
    expect(achar(linhas, "2026-10-01", "anuncio", "a9")).toMatchObject({
      objeto_nome: "a9",
      campanha_id: "c9",
      grupo_id: "g9",
      grupo_nome: null,
    });
  });

  it("descarta linha sem id, sem data valida ou sem moeda", () => {
    const linhas = linhasGranulares(
      entrada({
        ctx: { ...CTX, moedaConta: "" },
        insights: {
          campanha: [
            { date_start: "2026-10-01", spend: "1", account_currency: "USD" },
            { date_start: "01/10/2026", campaign_id: "c1", spend: "1", account_currency: "USD" },
            { date_start: "2026-10-01", campaign_id: "c2", spend: "1" },
            { date_start: "2026-10-01", campaign_id: "c1", spend: "1", account_currency: "usd" },
          ],
          grupo: [],
          anuncio: [],
        },
      })
    );
    // So a ultima fica; e sem moeda da conta nao ha linha zerada de hoje.
    expect(linhas.map((l) => [l.nivel, l.objeto_id, l.moeda])).toEqual([["campanha", "c1", "USD"]]);
  });

  it("ativo sem entrega hoje ganha a linha zerada de hoje; pausado nao; quem entregou nao duplica", () => {
    const linhas = linhasGranulares(
      entrada({
        insights: {
          campanha: [{ date_start: "2026-10-02", campaign_id: "c1", spend: "4" }],
          grupo: [],
          anuncio: [],
        },
      })
    );
    const hoje = linhas.filter((l) => l.data === "2026-10-02");
    expect(hoje.map((l) => `${l.nivel}:${l.objeto_id}`).sort()).toEqual([
      "anuncio:a1",
      "campanha:c1",
      "campanha:c3",
      "grupo:g1",
    ]);
    expect(achar(linhas, "2026-10-02", "campanha", "c1")?.gasto).toBe(4);
    expect(achar(linhas, "2026-10-02", "campanha", "c3")).toMatchObject({
      gasto: 0,
      impressoes: 0,
      frequencia: 0,
      orcamento: 30,
      tipo: "CBO",
      objeto_status: "ACTIVE",
    });
    expect(achar(linhas, "2026-10-02", "anuncio", "a1")).toMatchObject({
      campanha_id: "c1",
      grupo_id: "g1",
      grupo_nome: "Conj CBO",
      objeto_nome: "Video 1",
    });
  });

  it("nivel com o Insights incompleto nao ganha linha zerada", () => {
    const linhas = linhasGranulares(entrada({ completos: { campanha: true, grupo: true, anuncio: false } }));
    expect(linhas.some((l) => l.nivel === "anuncio")).toBe(false);
    expect(linhas.some((l) => l.nivel === "campanha" && l.objeto_id === "c3")).toBe(true);
  });

  it("mesma chave duas vezes vira uma linha (o upsert recusaria o lote)", () => {
    const linhas = linhasGranulares(
      entrada({
        estrutura: estruturaDaLista({ campanhas: [], conjuntos: [], anuncios: [] }, "USD"),
        insights: {
          campanha: [
            { date_start: "2026-10-01", campaign_id: "c1", spend: "1" },
            { date_start: "2026-10-01", campaign_id: "c1", spend: "2" },
          ],
          grupo: [],
          anuncio: [],
        },
      })
    );
    expect(linhas).toHaveLength(1);
    expect(linhas[0].gasto).toBe(2);
  });
});

describe("limpeza e erro", () => {
  it("so limpa os niveis que vieram inteiros", () => {
    expect(niveisGranularesParaLimpar({ campanha: true, grupo: true, anuncio: true })).toEqual([
      "campanha",
      "grupo",
      "anuncio",
    ]);
    expect(niveisGranularesParaLimpar({ campanha: true, grupo: false, anuncio: false })).toEqual(["campanha"]);
    expect(niveisGranularesParaLimpar({ campanha: false, grupo: false, anuncio: false })).toEqual([]);
  });

  it("guarda 100 dias: o corte e hoje - 100", () => {
    expect(corteDaRetencaoGranular("2026-10-24")).toBe("2026-07-16");
  });

  it("texto do erro diz que o gasto foi gravado", () => {
    expect(textoDoErroGranular(80000, "x")).toMatch(/limite de taxa/);
    expect(textoDoErroGranular(200, "x")).toMatch(/ads_read/);
    expect(textoDoErroGranular(null, "falha de rede ao falar com o Meta")).toBe(
      "Detalhe da aba Campanhas não atualizou (o gasto sim): falha de rede ao falar com o Meta"
    );
  });
});

// ---------------------------------------------------------------------------
// Sync com banco falso em memoria
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

const CHAVES: Record<string, (l: Linha) => string> = {
  ad_spend_daily: (l) => `${l.ad_account_id}|${l.data}|${l.nivel}|${l.campanha_id}`,
  ad_insights_granular: (l) => `${l.ad_account_id}|${l.data}|${l.nivel}|${l.objeto_id}`,
  ad_accounts: (l) => String(l.id),
};

function bancoFalso(inicial: { granular?: Linha[]; gasto?: Linha[]; falharUpsert?: string } = {}) {
  const tabelas: Record<string, Linha[]> = {
    ad_spend_daily: (inicial.gasto ?? []).map((g) => ({ ...g })),
    ad_insights_granular: (inicial.granular ?? []).map((g) => ({ ...g })),
    ad_accounts: [{ id: "conta-1" }],
  };

  function from(tabela: string) {
    const filtros: ((l: Linha) => boolean)[] = [];
    let op: "delete" | "update" | null = null;
    let patch: Linha = {};
    const builder = {
      upsert(rows: Linha[]) {
        if (inicial.falharUpsert === tabela) return Promise.resolve({ error: { message: "banco fora" } });
        const t = tabelas[tabela];
        const chave = CHAVES[tabela];
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

function granularVelha(p: Linha): Linha {
  return {
    ad_account_id: "conta-1",
    user_id: "user-1",
    plataforma: "meta",
    data: "2026-10-01",
    nivel: "anuncio",
    objeto_id: "a-velho",
    objeto_nome: "Velho",
    objeto_status: "ACTIVE",
    gasto: 9,
    moeda: "USD",
    sincronizado_em: VELHO,
    ...p,
  };
}

type Respostas = Partial<Record<"account" | "campaign" | "adset" | "ad", InsightMeta[] | Error>>;

/** Responde por nivel (nao por ordem): os pedidos de conjunto e anuncio vao em paralelo. */
function responder(r: Respostas, extra: { throttleCampanha?: unknown; completo?: Partial<Record<string, boolean>> } = {}) {
  graph.buscarInsightsDetalhado.mockImplementation(
    async (_id: string, _t: string, _d: string, _a: string, nivel: keyof Respostas) => {
      const v = r[nivel] ?? [];
      if (v instanceof Error) throw v;
      return {
        rows: v,
        throttle: nivel === "campaign" ? (extra.throttleCampanha ?? null) : null,
        completo: extra.completo?.[nivel] ?? true,
      };
    }
  );
}

const LISTA = {
  campanhas: [{ id: "c1", name: "Campanha 1", effective_status: "ACTIVE", daily_budget: "5000" }],
  conjuntos: [{ id: "g1", name: "Conjunto 1", effective_status: "ACTIVE", campaign_id: "c1" }],
  anuncios: [{ id: "a1", name: "Anuncio 1", effective_status: "ACTIVE", adset_id: "g1", campaign_id: "c1" }],
  completa: { campanhas: true, conjuntos: true, anuncios: true },
};

const TOTAL = [{ date_start: "2026-10-01", spend: "20", account_currency: "USD" }];
const CAMPANHA = [{ date_start: "2026-10-01", campaign_id: "c1", campaign_name: "Campanha 1", spend: "20" }];
const CONJUNTO = [
  { date_start: "2026-10-01", campaign_id: "c1", adset_id: "g1", adset_name: "Conjunto 1", spend: "20" },
];
const ANUNCIO = [
  {
    date_start: "2026-10-01",
    campaign_id: "c1",
    adset_id: "g1",
    ad_id: "a1",
    ad_name: "Anuncio 1",
    spend: "20",
    video_play_actions: [{ action_type: "video_view", value: "100" }],
    video_p75_watched_actions: [{ action_type: "video_view", value: "10" }],
  },
];

describe("sincronizarContaMeta + ad_insights_granular", () => {
  const agora = new Date("2026-10-02T12:00:00Z");

  beforeEach(() => {
    graph.buscarConta.mockReset();
    graph.buscarInsightsDetalhado.mockReset();
    graph.buscarEstruturaMeta.mockReset();
    graph.buscarEstruturaMeta.mockResolvedValue(LISTA);
  });

  it("grava os tres niveis, apaga da janela o que nao voltou e deixa o que esta fora dela", async () => {
    const { admin, tabelas } = bancoFalso({
      granular: [granularVelha({}), granularVelha({ objeto_id: "a-fora", data: "2026-09-20" })],
    });
    responder({ account: TOTAL, campaign: CAMPANHA, adset: CONJUNTO, ad: ANUNCIO });

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    // O pedido de campanha e o do gasto, com os campos da aba (nao pede de novo).
    const niveis = graph.buscarInsightsDetalhado.mock.calls.map((c) => [c[4], c[5]?.granular ?? false]);
    expect(niveis.sort()).toEqual([
      ["account", false],
      ["ad", true],
      ["adset", true],
      ["campaign", true],
    ]);
    expect(r.erroGranular).toBeNull();
    // 3 linhas de ontem + as 3 zeradas de hoje (tudo ativo, sem entrega hoje).
    expect(r.granular).toBe(6);
    const g = tabelas.ad_insights_granular;
    expect(g.find((l) => l.objeto_id === "a-velho")).toBeUndefined();
    expect(g.find((l) => l.objeto_id === "a-fora")?.gasto).toBe(9);
    expect(g.find((l) => l.data === "2026-10-01" && l.objeto_id === "a1")).toMatchObject({
      retencao_75: 10,
      vis_video: 100,
      plataforma: "meta",
      objeto_status: "ACTIVE",
      tipo: "CBO",
      orcamento: 0,
      grupo_nome: "Conjunto 1",
    });
    expect(g.find((l) => l.data === "2026-10-01" && l.objeto_id === "c1")?.orcamento).toBe(50);
    // O gasto segue como antes.
    expect(tabelas.ad_spend_daily.filter((l) => l.nivel === "campanha").map((l) => l.campanha_id)).toEqual(["c1"]);
    expect(tabelas.ad_accounts[0]).toMatchObject({ ultimo_erro: null, ultimo_sync_ok_em: agora.toISOString() });
  });

  it("falha no detalhe nao derruba o gasto nem apaga o detalhe que ja estava", async () => {
    const { ErroGraph } = await import("@/lib/ads/meta-graph");
    const { admin, tabelas } = bancoFalso({ granular: [granularVelha({})] });
    responder({ account: TOTAL, campaign: CAMPANHA, adset: CONJUNTO, ad: new ErroGraph("limite", 80000, null) });

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    expect(r.erroGranular).toMatch(/limite de taxa/);
    expect(r.granular).toBe(0);
    expect(tabelas.ad_insights_granular).toHaveLength(1);
    expect(tabelas.ad_insights_granular[0].gasto).toBe(9);
    expect(tabelas.ad_spend_daily.some((l) => l.nivel === "campanha" && l.campanha_id === "c1")).toBe(true);
    // O alerta de gasto parado le ultimo_erro: o detalhe nao o suja.
    expect(tabelas.ad_accounts[0]).toMatchObject({ ultimo_erro: null, ultimo_sync_ok_em: agora.toISOString() });
  });

  it("banco recusando o detalhe tambem so vira erro do detalhe", async () => {
    const { admin, tabelas } = bancoFalso({ falharUpsert: "ad_insights_granular" });
    responder({ account: TOTAL, campaign: CAMPANHA, adset: CONJUNTO, ad: ANUNCIO });

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    expect(r.erroGranular).toMatch(/falha ao gravar o detalhe: banco fora/);
    expect(tabelas.ad_spend_daily.length).toBeGreaterThan(0);
    expect(tabelas.ad_accounts[0].ultimo_erro).toBeNull();
  });

  it("Meta recusando os campos novos: refaz o pedido de antes para o gasto por campanha", async () => {
    const { ErroGraph } = await import("@/lib/ads/meta-graph");
    const { admin, tabelas } = bancoFalso({ granular: [granularVelha({})] });
    graph.buscarInsightsDetalhado.mockImplementation(
      async (_id: string, _t: string, _d: string, _a: string, nivel: string, opcoes?: { granular?: boolean }) => {
        if (nivel === "account") return { rows: TOTAL, throttle: null, completo: true };
        if (nivel === "campaign" && opcoes?.granular) throw new ErroGraph("(#100) campo invalido", 100, null);
        if (nivel === "campaign") return { rows: CAMPANHA, throttle: null, completo: true };
        throw new Error("nao devia pedir " + nivel);
      }
    );

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    expect(r.erroGranular).toMatch(/campo invalido/);
    expect(graph.buscarEstruturaMeta).not.toHaveBeenCalled();
    expect(tabelas.ad_spend_daily.filter((l) => l.nivel === "campanha").map((l) => l.campanha_id)).toEqual(["c1"]);
    expect(tabelas.ad_insights_granular).toHaveLength(1);
  });

  it("cota perto do fim no pedido de campanha: pula o detalhe sem erro", async () => {
    const { admin, tabelas } = bancoFalso({ granular: [granularVelha({})] });
    responder(
      { account: TOTAL, campaign: CAMPANHA },
      { throttleCampanha: { app_id_util_pct: 10, acc_id_util_pct: 90 } }
    );

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    expect(graph.buscarInsightsDetalhado).toHaveBeenCalledTimes(2);
    expect(graph.buscarEstruturaMeta).not.toHaveBeenCalled();
    expect(r.erroGranular).toBeNull();
    expect(tabelas.ad_insights_granular).toHaveLength(1);
  });

  it("lista cortada nao grava status errado: nada muda no detalhe", async () => {
    const { admin, tabelas } = bancoFalso({ granular: [granularVelha({})] });
    graph.buscarEstruturaMeta.mockResolvedValue({ ...LISTA, completa: { ...LISTA.completa, anuncios: false } });
    responder({ account: TOTAL, campaign: CAMPANHA, adset: CONJUNTO, ad: ANUNCIO });

    const r = await sincronizarContaMeta(admin, CONTA, "tok", agora);

    expect(r.erroGranular).toMatch(/não coube numa passada/);
    expect(tabelas.ad_insights_granular).toEqual([granularVelha({})]);
  });

  it("Insights de anuncio incompleto: grava o que veio e nao limpa esse nivel", async () => {
    const { admin, tabelas } = bancoFalso({
      granular: [granularVelha({}), granularVelha({ nivel: "grupo", objeto_id: "g-velho" })],
    });
    responder({ account: TOTAL, campaign: CAMPANHA, adset: CONJUNTO, ad: ANUNCIO }, { completo: { ad: false } });

    await sincronizarContaMeta(admin, CONTA, "tok", agora);

    const g = tabelas.ad_insights_granular;
    expect(g.find((l) => l.objeto_id === "a-velho")?.gasto).toBe(9);
    expect(g.find((l) => l.objeto_id === "g-velho")).toBeUndefined();
    expect(g.find((l) => l.data === "2026-10-01" && l.objeto_id === "a1")).toBeDefined();
    // Sem linha zerada de hoje no nivel incompleto.
    expect(g.some((l) => l.data === "2026-10-02" && l.nivel === "anuncio")).toBe(false);
  });

  it("no reprocesso apaga o que passou de 100 dias e guarda o resto", async () => {
    const { admin, tabelas } = bancoFalso({
      granular: [
        granularVelha({ objeto_id: "muito-velho", data: "2026-06-20" }),
        granularVelha({ objeto_id: "no-limite", data: "2026-06-24" }),
        granularVelha({ objeto_id: "fora-da-janela", data: "2026-08-01" }),
        granularVelha({ objeto_id: "de-outra-conta", data: "2026-06-01", ad_account_id: "conta-2" }),
      ],
    });
    graph.buscarConta.mockResolvedValue({ nome: "Conta", moeda: "USD", fuso: "UTC", status: "ativa" });
    responder({ account: TOTAL, campaign: CAMPANHA, adset: CONJUNTO, ad: ANUNCIO });

    await sincronizarContaMeta(admin, { ...CONTA, ultimo_reprocesso_em: "2026-10-01T00:00:00Z" }, "tok", agora);

    const ids = tabelas.ad_insights_granular.map((l) => l.objeto_id);
    // Corte: 2026-10-02 - 100 = 2026-06-24.
    expect(ids).not.toContain("muito-velho");
    expect(ids).toContain("no-limite");
    expect(ids).toContain("fora-da-janela");
    expect(ids).toContain("de-outra-conta");
  });
});
