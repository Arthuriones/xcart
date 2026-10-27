import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BaseLucro } from "@/lib/leitura/base-lucro";
import type { FinOrderRow } from "@/lib/financeiro/tipos";

// ============================================================================
// Leitura da tela Campanhas (src/lib/leitura/campanhas.ts). Ela pede a base do
// Lucro so do periodo atual (lerBaseLucro soAtual): a base deixa de trazer a
// cotacao do periodo anterior. O detalhe de antes do periodo (campanha
// pausada que ainda tem venda no periodo) converte o orcamento no dia dele --
// a cotacao desse dia vem da propria leitura de Campanhas, na janela que a
// base lia antes (desde o anterior - 10 dias). Sem isso, a moeda da conta
// aparecia como "sem cotacao" e o orcamento sumia.
// ============================================================================

type Linha = Record<string, unknown>;
type Estado = {
  tabela: string;
  select: string;
  eq: [string, unknown][];
  in: [string, unknown[]][];
  gte: [string, string][];
  lte: [string, string][];
  lt: [string, string][];
};

const tabelas: Record<string, Linha[]> = {};
const consultas: Estado[] = [];

function consulta(tabela: string) {
  const e: Estado = { tabela, select: "", eq: [], in: [], gte: [], lte: [], lt: [] };
  const linhas = () =>
    (tabelas[tabela] ?? []).filter(
      (l) =>
        e.eq.every(([c, v]) => l[c] === v) &&
        e.in.every(([c, vs]) => vs.includes(l[c])) &&
        e.gte.every(([c, v]) => String(l[c]) >= v) &&
        e.lte.every(([c, v]) => String(l[c]) <= v) &&
        e.lt.every(([c, v]) => String(l[c]) < v)
    );
  const b: Record<string, unknown> = {
    select: (c: string) => ((e.select = c), b),
    eq: (col: string, v: unknown) => (e.eq.push([col, v]), b),
    in: (col: string, vs: unknown[]) => (e.in.push([col, vs]), b),
    gte: (col: string, v: string) => (e.gte.push([col, v]), b),
    lte: (col: string, v: string) => (e.lte.push([col, v]), b),
    lt: (col: string, v: string) => (e.lt.push([col, v]), b),
    maybeSingle: async () => (consultas.push(e), { data: linhas()[0] ?? null, error: null }),
    then: (ok: (v: unknown) => unknown, falha: (x: unknown) => unknown) => {
      consultas.push(e);
      return Promise.resolve({ data: linhas(), error: null }).then(ok, falha);
    },
  };
  for (const m of ["or", "order", "range", "limit", "overrideTypes"]) b[m] = () => b;
  return b;
}

const USER = "u1";
const LOJA = "loja-1";
const CONTA = "conta-1";
const C_VELHA = "120246483388030139";

const intervalos = {
  atual: { desde: "2026-10-14", ate: "2026-10-20" },
  anterior: { desde: "2026-10-07", ate: "2026-10-13" },
};

const pedido = {
  store_id: LOJA,
  user_id: USER,
  shopify_order_id: "1001",
  nome: "#1001",
  processado_em: "2026-10-18T12:00:00Z",
  dia_local: "2026-10-18",
  criado_em: "2026-10-18T12:00:00Z",
  atualizado_em: "2026-10-18T12:00:00Z",
  cancelado_em: null,
  tipo: "venda",
  status_financeiro: "paid",
  origem: "web",
  moeda: "BRL",
  moeda_cliente: "BRL",
  total_bruto: 100,
  total_atual: 100,
  imposto_atual: 0,
  taxas_alfandega: 0,
  gorjeta: 0,
  descontos: 0,
  frete_cobrado: 0,
  recebido: 100,
  reembolsado: 0,
  liquido_pago: 100,
  total_cliente: 100,
  gateways: ["shopify_payments"],
  linhas: [{ sku: "SKU-1", qtd: 1, qtd_atual: 1, qtd_nao_enviada: 0, preco: 100 }],
} as unknown as FinOrderRow;

const base = {
  entrada: {
    lojas: [{ id: LOJA, nome: "Loja", dominio: "loja.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" }],
    pedidos: [pedido],
    custos: [],
    configs: [{ store_id: LOJA, user_id: USER, taxa_pct: 0, taxa_fixa: 0, custo_padrao_pct: null }],
    contas: [],
    gastos: [],
    // A base soAtual so tem cotacao do periodo; aqui nenhuma, para isolar a de antes.
    cambio: [],
    intervalos,
    moeda: "BRL",
    hoje: "2026-10-20",
    agoraMs: Date.parse("2026-10-20T20:00:00Z"),
    externos: [],
  },
  filtro: { lojaId: LOJA, periodo: "7d", moeda: "BRL" },
  lojas: [{ id: LOJA, nome: "Loja", dominio: "loja.myshopify.com" }],
  lojaIds: [LOJA],
  checkouts: [],
  checkoutIds: [],
  estados: [],
  fuso: "America/Sao_Paulo",
  contas: [
    {
      id: CONTA,
      user_id: USER,
      store_id: LOJA,
      checkout_id: null,
      plataforma: "meta",
      external_id: "111",
      nome: "CA 01",
      moeda: "EUR",
      status_externo: "ativa",
    },
  ],
  gastosCampanha: [],
  erroCampanha: null,
} as unknown as BaseLucro;

const lerBaseLucro = vi.fn(async (..._args: unknown[]) => base);

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: consulta }) }));
vi.mock("@/lib/supabase/current-user", () => ({ getCurrentUser: async () => ({ id: USER }) }));
vi.mock("@/lib/leitura/base-lucro", () => ({ lerBaseLucro: (...a: unknown[]) => lerBaseLucro(...a) }));
vi.mock("@/lib/filtro-global", () => ({
  filtroResolvido: async () => {
    throw new Error("com base, o filtro vem dela");
  },
}));
vi.mock("@/lib/tracking/origem-banco", () => ({ semMigration071: () => false }));

const { lerCampanhas } = await import("../src/lib/leitura/campanhas");

beforeEach(() => {
  for (const k of Object.keys(tabelas)) delete tabelas[k];
  consultas.length = 0;
  lerBaseLucro.mockClear();
  // Campanha pausada antes do periodo: o detalhe so existe no anterior.
  tabelas.ad_insights_granular = [
    {
      ad_account_id: CONTA,
      data: "2026-10-09",
      nivel: "campanha",
      objeto_id: C_VELHA,
      objeto_nome: "Campanha pausada",
      objeto_status: "PAUSED",
      campanha_id: C_VELHA,
      campanha_nome: "Campanha pausada",
      grupo_id: null,
      grupo_nome: null,
      tipo: "CBO",
      orcamento: 100,
      cpa_desejado: null,
      gasto: 10,
      impressoes: 1000,
      cliques: 10,
      ic: 1,
      vis_video: 0,
      vis_3s: 0,
      retencao_75: 0,
      frequencia: 1,
      moeda: "EUR",
      sincronizado_em: "2026-10-09T23:00:00Z",
    },
  ];
  tabelas.ad_spend_daily = [];
  // A venda do periodo veio de um clique nela.
  tabelas.fin_order_origem = [
    {
      store_id: LOJA,
      shopify_order_id: "1001",
      campanha_id: C_VELHA,
      conjunto_id: null,
      anuncio_id: null,
      pedido_em: "2026-10-18T12:00:00Z",
    },
  ];
  // Cotacao so antes do periodo atual - 10 dias (04/10): a janela que a base
  // completa lia (desde o anterior - 10 = 27/09).
  tabelas.fx_rates = [
    { data: "2026-10-01", moeda: "EUR", por_usd: 0.9, fonte: "frankfurter" },
    { data: "2026-10-01", moeda: "BRL", por_usd: 5, fonte: "frankfurter" },
  ];
});

describe("lerCampanhas", () => {
  it("pede a base do Lucro so do periodo atual", async () => {
    await lerCampanhas();

    expect(lerBaseLucro).toHaveBeenCalledTimes(1);
    expect(lerBaseLucro).toHaveBeenCalledWith(false, true);
  });

  it("detalhe de antes do periodo converte pela cotacao do dia dele", async () => {
    const { resultado } = await lerCampanhas();

    const deAntes = consultas.filter((c) => c.tabela === "fx_rates" && c.lt.length > 0);
    expect(deAntes).toHaveLength(1);
    expect(deAntes[0].gte).toEqual([["data", "2026-09-27"]]);
    expect(deAntes[0].lt).toEqual([["data", "2026-10-04"]]);
    expect(deAntes[0].in.find(([c]) => c === "moeda")![1]).toEqual(expect.arrayContaining(["BRL", "EUR"]));

    const c = resultado!.linhas.find((l) => l.nivel === "campanha" && l.objetoId === C_VELHA)!;
    expect(c.nome).toBe("Campanha pausada");
    expect(c.orcamento).toBeCloseTo((100 / 0.9) * 5, 6);
    expect(c.vendas).toBe(1);
    expect(resultado!.moedasSemCotacao).toEqual([]);
    expect(resultado!.cambioAproximado).toBe(false);
  });

  it("sem detalhe de antes, nenhuma leitura de cotacao de antes", async () => {
    tabelas.fin_order_origem = [];

    await lerCampanhas();

    expect(consultas.some((c) => c.tabela === "fx_rates" && c.lt.length > 0)).toBe(false);
  });
});
