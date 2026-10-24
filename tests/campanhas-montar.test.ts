import { beforeAll, describe, expect, it } from "vitest";
import { calcularFinanceiro, type EntradaFinanceiro, type PedidoExternoFin } from "@/lib/financeiro/calculo";
import type { FinOrderRow, FinStoreSettingsRow, FxRateRow, LinhaPedido, ProductCostRow } from "@/lib/financeiro/tipos";
import {
  idsFaltando,
  montarCampanhas,
  type ContaCampanhas,
  type EntradaCampanhas,
  type GastoDiarioRow,
  type InsightGranularRow,
  type ResultadoCampanhas,
} from "@/lib/campanhas/montar";
import { derivar, somasVazias, type LinhaCampanha } from "@/lib/campanhas/metricas";
import { contextoDaRota } from "@/components/layout/navegacao";
import { TODAS_AS_COLUNAS } from "@/app/(dashboard)/campanhas/colunas-config";
import { diaLocal, somarDia } from "@/lib/demonstracao/plano";
import { custosDosProdutos, type LinhaGranular } from "@/lib/demonstracao/linhas";
import { configLoja, contasDaLoja, granularDe, lojaFinanceira, montar, type Semeadura } from "@/lib/demonstracao/semeadura";

// ============================================================================
// Tela Campanhas (src/lib/campanhas/montar.ts). O que trava aqui:
//   - soma por nivel no periodo, convertendo a moeda da conta pela cotacao do
//     dia, e as derivadas das somas (nunca media de razoes; sem base = null);
//   - a conta pelo ad_spend_daily nivel conta (a verdade do gasto);
//   - o dia sem detalhe cai no gasto por campanha, sem somar em dobro, e
//     conjunto/anuncio so existem com detalhe;
//   - a venda pelos ids do pedido em cada nivel, com a conta do Lucro
//     (calcularFinanceiro), e o que nao bate vai para "sem campanha";
//   - a loja de demonstracao: os ids dos pedidos batem com os do granular.
// ============================================================================

const LOJA = "11111111-1111-4111-8111-111111111111";
const CHECKOUT = "33333333-3333-4333-8333-333333333333";
const USER = "99999999-9999-4999-8999-999999999999";
const META = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const GOOGLE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const META_SEM_DETALHE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const D1 = "2026-10-20";
const D2 = "2026-10-21";
const C1 = "120246483388030139";
const G1 = "120246483388030200";
const A1 = "120246483388030300";
const A2 = "120246483388030301";

const fx = (data: string, moeda: string, por_usd: number): FxRateRow => ({ data, moeda, por_usd, fonte: "frankfurter" });
const CAMBIO = [fx(D1, "BRL", 5), fx(D2, "BRL", 5.5)];

const contas: ContaCampanhas[] = [
  { id: META, nome: "CA 01", plataforma: "meta", external_id: "111", status_externo: "ativa" },
  { id: GOOGLE, nome: null, plataforma: "google", external_id: "222" },
  { id: META_SEM_DETALHE, nome: "CA 03", plataforma: "meta", external_id: "333", status_externo: "fechada" },
];

function granular(p: Partial<InsightGranularRow> & Pick<InsightGranularRow, "nivel" | "objeto_id" | "data">): InsightGranularRow {
  return {
    ad_account_id: META,
    objeto_nome: `Nome ${p.objeto_id}`,
    objeto_status: "ACTIVE",
    campanha_id: null,
    campanha_nome: null,
    grupo_id: null,
    grupo_nome: null,
    tipo: "CBO",
    orcamento: 0,
    cpa_desejado: null,
    gasto: 0,
    impressoes: 0,
    cliques: 0,
    ic: 0,
    vis_video: 0,
    vis_3s: 0,
    retencao_75: 0,
    frequencia: 0,
    moeda: "USD",
    sincronizado_em: `${p.data}T23:00:00Z`,
    ...p,
  };
}

function gasto(p: Partial<GastoDiarioRow> & Pick<GastoDiarioRow, "ad_account_id" | "data" | "nivel">): GastoDiarioRow {
  return { campanha_id: "", campanha_nome: null, moeda: "USD", gasto: 0, impressoes: 0, cliques: 0, ...p };
}

const linhaItem = (sku: string, qtd: number, preco: number): LinhaPedido => ({ sku, qtd, qtd_atual: qtd, qtd_nao_enviada: 0, preco });

let seq = 0;
function pedido(p: Partial<FinOrderRow> & { dia_local: string }): FinOrderRow {
  seq += 1;
  return {
    store_id: LOJA,
    user_id: USER,
    shopify_order_id: String(1000 + seq),
    nome: `#${seq}`,
    processado_em: `${p.dia_local}T12:00:00Z`,
    criado_em: `${p.dia_local}T12:00:00Z`,
    atualizado_em: `${p.dia_local}T12:00:00Z`,
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
    linhas: [linhaItem("SKU-1", 1, 100)],
    ...p,
  };
}

const custos: ProductCostRow[] = [
  { id: "c1", store_id: LOJA, user_id: USER, sku: "SKU-1", custo_unitario: 30, frete_unitario: 0, moeda: "BRL", origem: "manual", valido_desde: "2026-01-01" },
];
const configs: FinStoreSettingsRow[] = [{ store_id: LOJA, user_id: USER, taxa_pct: 5, taxa_fixa: 0, custo_padrao_pct: null }];

function financeiro(p: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [
      { id: LOJA, nome: "Loja", dominio: "loja.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" },
      { id: CHECKOUT, nome: "Eve", dominio: "Eve", tipo: "checkout", modelo: "venda", fuso: "America/Sao_Paulo", moeda: "BRL" },
    ],
    pedidos: [],
    custos,
    configs,
    contas: [],
    gastos: [],
    cambio: CAMBIO,
    intervalos: { atual: { desde: D1, ate: D2 }, anterior: { desde: "2026-10-18", ate: "2026-10-19" } },
    moeda: "BRL",
    hoje: D2,
    agoraMs: Date.parse(`${D2}T20:00:00Z`),
    externos: [],
    ...p,
  };
}

function entrada(p: Partial<EntradaCampanhas> = {}): EntradaCampanhas {
  return { financeiro: financeiro(), contas, granular: [], gastos: [], origens: [], origensExternas: [], ...p };
}

const achar = (r: ResultadoCampanhas, nivel: LinhaCampanha["nivel"], objetoId: string) =>
  r.linhas.find((l) => l.nivel === nivel && l.objetoId === objetoId);

/** A estrutura da conta META com detalhe nos dois dias. */
const ESTRUTURA: InsightGranularRow[] = [
  granular({ nivel: "campanha", objeto_id: C1, data: D1, objeto_nome: "Campanha velha", objeto_status: "PAUSED", gasto: 10, impressoes: 1000, cliques: 20, ic: 4, vis_video: 400, vis_3s: 300, retencao_75: 50, frequencia: 1.2, orcamento: 30 }),
  granular({ nivel: "campanha", objeto_id: C1, data: D2, objeto_nome: "Campanha nova", objeto_status: "ACTIVE", gasto: 20, impressoes: 3000, cliques: 40, ic: 6, vis_video: 600, vis_3s: 900, retencao_75: 150, frequencia: 1.6, orcamento: 40 }),
  granular({ nivel: "grupo", objeto_id: G1, data: D1, campanha_id: C1, campanha_nome: "Campanha velha", gasto: 10, impressoes: 1000, cliques: 20, tipo: "CBO" }),
  granular({ nivel: "grupo", objeto_id: G1, data: D2, campanha_id: C1, campanha_nome: "Campanha nova", gasto: 20, impressoes: 3000, cliques: 40 }),
  granular({ nivel: "anuncio", objeto_id: A1, data: D1, campanha_id: C1, grupo_id: G1, gasto: 6, impressoes: 600, cliques: 12 }),
  granular({ nivel: "anuncio", objeto_id: A1, data: D2, campanha_id: C1, grupo_id: G1, gasto: 12, impressoes: 1800, cliques: 24 }),
  granular({ nivel: "anuncio", objeto_id: A2, data: D2, campanha_id: C1, grupo_id: G1, gasto: 8, impressoes: 1200, cliques: 16 }),
];

describe("metricas de anuncio por nivel", () => {
  it("soma o periodo convertendo a moeda da conta pela cotacao do dia", () => {
    const r = montarCampanhas(entrada({ granular: ESTRUTURA }));
    const c = achar(r, "campanha", C1)!;
    // USD 10 a 5,00 + USD 20 a 5,50 = 50 + 110
    expect(c.gastos).toBeCloseTo(160, 6);
    expect(c.impressoes).toBe(4000);
    expect(c.cliques).toBe(60);
    expect(c.cpc).toBeCloseTo(160 / 60, 6);
    expect(c.cpm).toBeCloseTo((160 / 4000) * 1000, 6);
    expect(c.ctr).toBeCloseTo(1.5, 6);
    expect(c.ic).toBe(10);
    expect(c.cpi).toBeCloseTo(16, 6);
    // Hook = vis 3 s / impressoes; hold = 75% / impressoes; retencao = 75% / reproducoes.
    expect(c.hookRate).toBeCloseTo((1200 / 4000) * 100, 6);
    expect(c.holdRate).toBeCloseTo((200 / 4000) * 100, 6);
    expect(c.retencao75).toBeCloseTo((200 / 1000) * 100, 6);
    // Frequencia: media dos dias pesada pelas impressoes.
    expect(c.frequencia).toBeCloseTo((1.2 * 1000 + 1.6 * 3000) / 4000, 6);
    const g = achar(r, "grupo", G1)!;
    expect(g.gastos).toBeCloseTo(160, 6);
    expect(achar(r, "anuncio", A1)!.gastos).toBeCloseTo(6 * 5 + 12 * 5.5, 6);
    expect(achar(r, "anuncio", A2)!.gastos).toBeCloseTo(44, 6);
  });

  it("status, nome e orcamento sao os do dia mais recente; 0 de orcamento = sem orcamento", () => {
    const r = montarCampanhas(entrada({ granular: ESTRUTURA }));
    const c = achar(r, "campanha", C1)!;
    expect(c.nome).toBe("Campanha nova");
    expect(c.status).toBe("ACTIVE");
    expect(c.orcamento).toBeCloseTo(40 * 5.5, 6);
    expect(c.tipo).toBe("CBO");
    const g = achar(r, "grupo", G1)!;
    expect(g.orcamento).toBeNull();
    expect(g.campanhaNome).toBe("Campanha nova");
    expect(achar(r, "anuncio", A1)!.grupoId).toBe(G1);
  });

  it("ids grandes do Meta comparam como texto: dois anuncios vizinhos nao viram um", () => {
    expect(Number(A1) === Number("120246483388030302")).toBe(true); // o double nao separa
    const r = montarCampanhas(
      entrada({
        granular: [
          granular({ nivel: "anuncio", objeto_id: A1, data: D1, gasto: 1 }),
          granular({ nivel: "anuncio", objeto_id: "120246483388030302", data: D1, gasto: 2 }),
        ],
      })
    );
    expect(r.linhas.filter((l) => l.nivel === "anuncio")).toHaveLength(2);
  });

  it("a conta: gasto do nivel conta do ad_spend_daily (a verdade), senao a soma das campanhas; IC das campanhas", () => {
    const r = montarCampanhas(
      entrada({
        granular: ESTRUTURA,
        gastos: [
          // D1 tem o nivel conta (inclui anuncio apagado); D2 nao.
          gasto({ ad_account_id: META, data: D1, nivel: "conta", gasto: 11, impressoes: 1100, cliques: 21 }),
          // Campanha do dia com detalhe: o detalhe vale, esta linha nao soma.
          gasto({ ad_account_id: META, data: D1, nivel: "campanha", campanha_id: C1, gasto: 10, impressoes: 1000, cliques: 20 }),
        ],
      })
    );
    const conta = achar(r, "conta", "111")!;
    expect(conta.gastos).toBeCloseTo(11 * 5 + 20 * 5.5, 6);
    expect(conta.impressoes).toBe(1100 + 3000);
    expect(conta.ic).toBe(10);
    expect(conta.status).toBe("ACTIVE");
    expect(conta.nome).toBe("CA 01");
    expect(achar(r, "campanha", C1)!.gastos).toBeCloseTo(160, 6);
    expect(r.semDetalhe).toEqual([]);
  });
});

describe("sem detalhe: a campanha pelo ad_spend_daily", () => {
  const GASTOS: GastoDiarioRow[] = [
    gasto({ ad_account_id: META_SEM_DETALHE, data: D1, nivel: "conta", gasto: 30, impressoes: 900, cliques: 9 }),
    gasto({ ad_account_id: META_SEM_DETALHE, data: D1, nivel: "campanha", campanha_id: "555", campanha_nome: "Velho", gasto: 29, impressoes: 880, cliques: 9 }),
    gasto({ ad_account_id: META_SEM_DETALHE, data: D2, nivel: "campanha", campanha_id: "555", campanha_nome: "Novo", gasto: 10, impressoes: 100, cliques: 0 }),
    gasto({ ad_account_id: GOOGLE, data: D2, nivel: "campanha", campanha_id: "777", campanha_nome: "PMax", moeda: "BRL", gasto: 50, impressoes: 0, cliques: 25 }),
  ];

  it("campanha e conta saem do gasto; conjunto e anuncio nao existem; IC e video ficam null", () => {
    const r = montarCampanhas(entrada({ gastos: GASTOS }));
    const c = achar(r, "campanha", "555")!;
    expect(c.gastos).toBeCloseTo(29 * 5 + 10 * 5.5, 6);
    expect(c.nome).toBe("Novo");
    expect(c.status).toBeNull();
    expect(c.tipo).toBeNull();
    expect(c.orcamento).toBeNull();
    expect(c.detalhe).toBe(false);
    expect(c.cpi).toBeNull();
    expect(c.hookRate).toBeNull();
    expect(c.frequencia).toBeNull();
    // A conta: D1 pelo nivel conta (30), D2 pela soma das campanhas (10).
    expect(achar(r, "conta", "333")!.gastos).toBeCloseTo(30 * 5 + 10 * 5.5, 6);
    expect(achar(r, "conta", "333")!.status).toBe("CLOSED");
    // Google em BRL num relatorio em BRL: sem conversao. Impressao zero = CPM/CTR sem base.
    const pmax = achar(r, "campanha", "777")!;
    expect(pmax.gastos).toBe(50);
    expect(pmax.cpm).toBeNull();
    expect(pmax.ctr).toBeNull();
    expect(pmax.cpc).toBe(2);
    expect(achar(r, "conta", "222")!.nome).toBe("Conta 222");
    expect(r.linhas.filter((l) => l.nivel === "grupo" || l.nivel === "anuncio")).toEqual([]);
    expect(r.semDetalhe).toEqual([
      { contaId: META_SEM_DETALHE, contaNome: "CA 03", dias: 2 },
      { contaId: GOOGLE, contaNome: "Conta 222", dias: 1 },
    ]);
  });

  it("dia com detalhe nao soma o gasto por campanha em dobro; o dia sem detalhe entra pelo gasto", () => {
    const r = montarCampanhas(
      entrada({
        granular: ESTRUTURA.filter((g) => g.data === D2),
        gastos: [
          gasto({ ad_account_id: META, data: D1, nivel: "campanha", campanha_id: C1, campanha_nome: "Do gasto", gasto: 10, impressoes: 1000, cliques: 20 }),
          gasto({ ad_account_id: META, data: D2, nivel: "campanha", campanha_id: C1, gasto: 20, impressoes: 3000, cliques: 40 }),
        ],
      })
    );
    const c = achar(r, "campanha", C1)!;
    expect(c.gastos).toBeCloseTo(160, 6);
    expect(c.nome).toBe("Campanha nova"); // o detalhe vence o nome do gasto
    // IC e CPI so do dia com detalhe.
    expect(c.ic).toBe(6);
    expect(c.cpi).toBeCloseTo(110 / 6, 6);
    expect(c.hookRate).toBeCloseTo((900 / 3000) * 100, 6);
    expect(r.semDetalhe).toEqual([{ contaId: META, contaNome: "CA 01", dias: 1 }]);
  });

  it("sem cotacao: o valor fica de fora e a moeda e avisada", () => {
    const r = montarCampanhas(
      entrada({ gastos: [gasto({ ad_account_id: META_SEM_DETALHE, data: D1, nivel: "campanha", campanha_id: "555", moeda: "XYZ", gasto: 10, impressoes: 5 })] })
    );
    expect(achar(r, "campanha", "555")!.gastos).toBe(0);
    expect(achar(r, "campanha", "555")!.impressoes).toBe(5);
    expect(r.moedasSemCotacao).toEqual(["XYZ"]);
  });
});

describe("vendas pelos ids do pedido", () => {
  const P1 = pedido({ dia_local: D1 }); // anuncio + conjunto + campanha
  const P2 = pedido({ dia_local: D2 }); // so a campanha
  const P3 = pedido({ dia_local: D2 }); // so o anuncio: conjunto e campanha vem do anuncio
  const P4 = pedido({ dia_local: D2 }); // sem origem
  const P5 = pedido({ dia_local: D2 }); // campanha de conta fora do filtro
  // Reembolsado antes de enviar: sem receita e sem custo (as regras do Lucro).
  const P6 = pedido({
    dia_local: D2,
    liquido_pago: 0,
    reembolsado: 100,
    status_financeiro: "refunded",
    linhas: [{ sku: "SKU-1", qtd: 1, qtd_atual: 0, qtd_nao_enviada: 1, preco: 100 }],
  });
  const P7 = pedido({ dia_local: "2026-10-19" }); // fora do periodo
  const pedidos = [P1, P2, P3, P4, P5, P6, P7];
  const origens = [
    { store_id: LOJA, shopify_order_id: P1.shopify_order_id, campanha_id: C1, conjunto_id: G1, anuncio_id: A1 },
    { store_id: LOJA, shopify_order_id: P2.shopify_order_id, campanha_id: C1, conjunto_id: null, anuncio_id: null },
    { store_id: LOJA, shopify_order_id: P3.shopify_order_id, campanha_id: null, conjunto_id: null, anuncio_id: A2 },
    { store_id: LOJA, shopify_order_id: P5.shopify_order_id, campanha_id: "999999999", conjunto_id: null, anuncio_id: null },
    { store_id: LOJA, shopify_order_id: P6.shopify_order_id, campanha_id: C1, conjunto_id: G1, anuncio_id: A1 },
    { store_id: LOJA, shopify_order_id: P7.shopify_order_id, campanha_id: C1, conjunto_id: G1, anuncio_id: A1 },
  ];
  let r: ResultadoCampanhas;
  beforeAll(() => {
    r = montarCampanhas(entrada({ granular: ESTRUTURA, financeiro: financeiro({ pedidos }), origens }));
  });

  it("cada nivel pelo id do proprio pedido (o que falta vem do objeto achado)", () => {
    expect(achar(r, "anuncio", A1)!.vendas).toBe(1); // P1 (P6 reembolsado nao conta)
    expect(achar(r, "anuncio", A2)!.vendas).toBe(1); // P3
    expect(achar(r, "grupo", G1)!.vendas).toBe(2); // P1 + P3
    expect(achar(r, "campanha", C1)!.vendas).toBe(3); // P1 + P2 + P3
    expect(achar(r, "conta", "111")!.vendas).toBe(3);
  });

  it("receita, custo, taxa e lucro com a conta do Lucro, menos o gasto do objeto", () => {
    const sozinho = calcularFinanceiro({ ...financeiro({ pedidos: [P1, P6] }), contas: [], gastos: [] }).atual;
    const a1 = achar(r, "anuncio", A1)!;
    expect(a1.faturamento).toBeCloseTo(sozinho.receita, 6);
    expect(a1.custoProduto).toBeCloseTo(30, 6);
    // 100 - 30 de custo - 5% de taxa; P6 (reembolsado antes de enviar) nao soma receita, custo nem taxa.
    expect(a1.lucroPedidos).toBeCloseTo(sozinho.lucro, 6);
    expect(a1.lucroPedidos).toBeCloseTo(65, 6);
    expect(a1.lucro).toBeCloseTo(65 - a1.gastos, 6);
    expect(a1.roas).toBeCloseTo(100 / a1.gastos, 6);
    expect(a1.cpa).toBeCloseTo(a1.gastos, 6);
    expect(a1.margem).toBeCloseTo(((65 - a1.gastos) / 100) * 100, 6);
    expect(a1.roi).toBeCloseTo(((65 - a1.gastos) / (a1.gastos + 30)) * 100, 6);
  });

  it("o que nao bate vai para o resumo, e a soma fecha com o Lucro", () => {
    expect(r.atribuicao.identificadas.vendas).toBe(3);
    expect(r.atribuicao.semId.vendas).toBe(1); // P4
    expect(r.atribuicao.idDesconhecido.vendas).toBe(1); // P5
    expect(r.atribuicao.semId.faturamento).toBeCloseTo(100, 6);
    const tudo = calcularFinanceiro({ ...financeiro({ pedidos }), contas: [], gastos: [] }).atual;
    const { identificadas, semId, idDesconhecido } = r.atribuicao;
    expect(identificadas.vendas + semId.vendas + idDesconhecido.vendas).toBe(tudo.pedidos);
    expect(identificadas.faturamento + semId.faturamento + idDesconhecido.faturamento).toBeCloseTo(tudo.receita, 6);
  });

  it("dia sem detalhe: a venda fica so na campanha (o conjunto/anuncio nao tem gasto nesse dia)", () => {
    const so2 = montarCampanhas(
      entrada({
        granular: ESTRUTURA.filter((g) => g.data === D2),
        gastos: [gasto({ ad_account_id: META, data: D1, nivel: "campanha", campanha_id: C1, gasto: 10, impressoes: 1000 })],
        financeiro: financeiro({ pedidos }),
        origens,
      })
    );
    expect(achar(so2, "anuncio", A1)!.vendas).toBe(0); // P1 e de D1, sem detalhe
    expect(achar(so2, "grupo", G1)!.vendas).toBe(1); // so P3
    expect(achar(so2, "campanha", C1)!.vendas).toBe(3);
    expect(so2.atribuicao.identificadas.vendas).toBe(3);
  });

  it("campanha sem linha no periodo: o nome vem das linhas de antes, com gasto zero", () => {
    const P8 = pedido({ dia_local: D2 });
    const ori = [{ store_id: LOJA, shopify_order_id: P8.shopify_order_id, campanha_id: "888", conjunto_id: null, anuncio_id: null }];
    const base = { financeiro: financeiro({ pedidos: [P8] }), granular: [], gastos: [], origens: ori, origensExternas: [] };
    expect(idsFaltando(base)).toEqual(["888"]);
    const r2 = montarCampanhas(
      entrada({
        ...base,
        anteriores: {
          granular: [],
          gastos: [gasto({ ad_account_id: META_SEM_DETALHE, data: "2026-10-01", nivel: "campanha", campanha_id: "888", campanha_nome: "Pausada ontem", gasto: 5 })],
        },
      })
    );
    const c = achar(r2, "campanha", "888")!;
    expect(c.nome).toBe("Pausada ontem");
    expect(c.gastos).toBe(0);
    expect(c.vendas).toBe(1);
    expect(c.roas).toBeNull();
    expect(c.cpa).toBeNull();
    expect(c.lucro).toBeCloseTo(c.lucroPedidos, 6);
    expect(r2.atribuicao.idDesconhecido.vendas).toBe(0);
  });

  it("checkout de venda (Eve): pago e venda, Pix aguardando e pendente", () => {
    const externos: PedidoExternoFin[] = [
      { checkout_id: CHECKOUT, pedido_id: "e1", situacao: "pago", moeda: "BRL", valor: 197, receita: 197, moeda_receita: "BRL", dia_local: D2, criado_em: `${D2}T10:00:00Z`, metodo_pagamento: "pix", grupo: "e1" },
      { checkout_id: CHECKOUT, pedido_id: "e2", situacao: "pendente", moeda: "BRL", valor: 197, receita: 197, moeda_receita: "BRL", dia_local: D2, criado_em: `${D2}T19:00:00Z`, metodo_pagamento: "pix", grupo: "e2", vence_em: `${D2}T23:59:00Z` },
    ];
    const r3 = montarCampanhas(
      entrada({
        granular: ESTRUTURA,
        financeiro: financeiro({ externos }),
        origensExternas: [
          { checkout_id: CHECKOUT, pedido_id: "e1", campanha_id: C1, conjunto_id: G1, anuncio_id: A2 },
          { checkout_id: CHECKOUT, pedido_id: "e2", campanha_id: C1, conjunto_id: G1, anuncio_id: A2 },
        ],
      })
    );
    const a2 = achar(r3, "anuncio", A2)!;
    expect(a2.vendas).toBe(1);
    expect(a2.vendasPendentes).toBe(1);
    expect(a2.vendasTotais).toBe(2);
    expect(a2.faturamento).toBeCloseTo(197, 6);
    expect(a2.cpp).toBeCloseTo(a2.gastos, 6);
    expect(a2.cpt).toBeCloseTo(a2.gastos / 2, 6);
  });
});

describe("derivadas sem base", () => {
  it("divisao por zero e falta de detalhe dao null, nunca 0 ou Infinity", () => {
    const d = derivar(somasVazias());
    for (const v of Object.values(d)) expect(Number.isFinite(v as number) || v === null).toBe(true);
    expect(d.roas).toBeNull();
    expect(d.cpa).toBeNull();
    expect(d.cpm).toBeNull();
    expect(d.cpi).toBeNull();
    expect(d.margem).toBeNull();
    expect(d.lucro).toBe(0);
    // Com detalhe, mas sem nenhuma reproducao (anuncio de imagem): sem hook/hold.
    const imagem = derivar({ ...somasVazias(), detalhe: true, impressoesDetalhe: 1000, impressoes: 1000, gastos: 10, gastoDetalhe: 10 });
    expect(imagem.hookRate).toBeNull();
    expect(imagem.holdRate).toBeNull();
    expect(imagem.cpi).toBeNull(); // IC zero
    // Venda sem gasto: CPA sem base (como no Lucro), ROAS sem base.
    const semGasto = derivar({ ...somasVazias(), vendas: 2, faturamento: 200, lucroPedidos: 120 });
    expect(semGasto.cpa).toBeNull();
    expect(semGasto.roas).toBeNull();
    expect(semGasto.lucro).toBe(120);
  });
});

describe("colunas da tabela", () => {
  // Cada coluna do catalogo le um campo de verdade da linha (tabela-campanhas.tsx).
  const CAMPO: Record<string, keyof LinhaCampanha> = {
    tipo: "tipo",
    orcamento: "orcamento",
    custo_produto: "custoProduto",
    cpa_desejado: "cpaDesejado",
    cpt: "cpt",
    cpp: "cpp",
    cpa: "cpa",
    vendas_totais: "vendasTotais",
    vendas_pendentes: "vendasPendentes",
    vendas: "vendas",
    gastos: "gastos",
    faturamento: "faturamento",
    lucro: "lucro",
    roas: "roas",
    margem: "margem",
    roi: "roi",
    cpc: "cpc",
    impressoes: "impressoes",
    cliques: "cliques",
    ctr: "ctr",
    cpm: "cpm",
    ic: "ic",
    cpi: "cpi",
    vis_video: "visVideo",
    vis_3s: "vis3s",
    retencao_75: "retencao75",
    hook_rate: "hookRate",
    hold_rate: "holdRate",
    frequencia: "frequencia",
  };
  it("toda coluna tem um campo na linha montada", () => {
    expect(TODAS_AS_COLUNAS.map((c) => c.id).sort()).toEqual(Object.keys(CAMPO).sort());
    const linha = montarCampanhas(entrada({ granular: ESTRUTURA })).linhas[0];
    for (const campo of Object.values(CAMPO)) expect(campo in linha, campo).toBe(true);
  });
});

describe("a barra do topo", () => {
  it("Campanhas mostra loja, periodo e moeda, sem Comparar", () => {
    expect(contextoDaRota("/campanhas")).toEqual({ tipo: "completo", semComparar: true });
  });
});

describe("loja de demonstracao", () => {
  // O granular da demonstracao e so o de HOJE (src/lib/demonstracao/linhas.ts);
  // os outros dias tem o gasto por campanha. Valores do granular em BRL, conta
  // e pedidos em USD.
  const AGORA = Date.parse("2026-10-19T22:00:00Z");
  const BRL = 5.42;
  const hoje = diaLocal(AGORA);
  const desde7 = somarDia(hoje, -6);
  let s: Semeadura;
  let granularHoje: LinhaGranular[];
  const contasDemo: ContaCampanhas[] = contasDaLoja().map((c) => ({
    id: c.id,
    nome: c.nome,
    plataforma: c.plataforma,
    external_id: c.external_id,
    status_externo: c.status_externo,
    // Como a leitura passa: o imposto da Meta segue a moeda da CONTA (USD na
    // demonstracao), nao a da linha do granular, que o gerador grava em BRL.
    moeda: c.moeda,
  }));
  const rodar = (desde: string): ResultadoCampanhas => {
    const fxs: FxRateRow[] = [];
    for (let d = somarDia(desde, -3); d <= hoje; d = somarDia(d, 1)) fxs.push(fx(d, "BRL", BRL));
    return montarCampanhas({
      financeiro: {
        lojas: [lojaFinanceira],
        pedidos: s.pedidos,
        custos: custosDosProdutos(),
        configs: [configLoja],
        contas: [],
        gastos: [],
        cambio: fxs,
        intervalos: { atual: { desde, ate: hoje }, anterior: { desde: somarDia(desde, -1), ate: somarDia(desde, -1) } },
        moeda: "USD",
        hoje,
        agoraMs: AGORA,
      },
      contas: contasDemo,
      granular: granularHoje,
      gastos: s.linhasGasto,
      origens: s.origens,
      origensExternas: [],
    });
  };
  beforeAll(() => {
    s = montar(AGORA, (m) => (m === "BRL" ? BRL : 1), [], { dias: (d) => d >= desde7 });
    granularHoje = granularDe(s, BRL);
  }, 120_000);

  it("hoje: os ids dos pedidos batem com o granular, e o gasto com o ad_spend_daily", () => {
    const r = rodar(hoje);
    expect(granularHoje.length).toBeGreaterThan(10);
    expect(r.atribuicao.identificadas.vendas).toBeGreaterThan(20);
    // Pedido de anuncio sempre acha a campanha da demonstracao.
    expect(r.atribuicao.idDesconhecido.vendas).toBe(0);
    const soma = (nivel: LinhaCampanha["nivel"], k: "vendas" | "gastos") =>
      r.linhas.filter((l) => l.nivel === nivel).reduce((t, l) => t + l[k], 0);
    expect(soma("campanha", "vendas")).toBe(r.atribuicao.identificadas.vendas);
    expect(soma("conta", "vendas")).toBe(r.atribuicao.identificadas.vendas);
    // Meta sempre tem conjunto e anuncio no pedido: todo pedido Meta cai num anuncio.
    const meta = r.linhas.filter((l) => l.plataforma === "meta");
    const vMeta = (nivel: LinhaCampanha["nivel"]) => meta.filter((l) => l.nivel === nivel).reduce((t, l) => t + l.vendas, 0);
    expect(vMeta("anuncio")).toBe(vMeta("campanha"));
    expect(vMeta("grupo")).toBe(vMeta("campanha"));
    // Gasto: o granular (BRL, arredondado) volta ao USD do ad_spend_daily.
    const doDia = s.linhasGasto.filter((g) => g.data === hoje);
    const campanhas = doDia.filter((g) => g.nivel === "campanha").reduce((t, g) => t + Number(g.gasto), 0);
    const contaTotal = doDia.filter((g) => g.nivel === "conta").reduce((t, g) => t + Number(g.gasto), 0);
    expect(Math.abs(soma("campanha", "gastos") - campanhas)).toBeLessThan(0.05);
    expect(Math.abs(soma("conta", "gastos") - contaTotal)).toBeLessThan(0.01);
    // O que o gerador gravou em vendas (pedidos ligados, sem a regra do Lucro) fica perto da regra unica.
    const gravado = granularHoje.filter((g) => g.nivel === "anuncio").reduce((t, g) => t + g.vendas, 0);
    expect(Math.abs(soma("anuncio", "vendas") - gravado)).toBeLessThanOrEqual(Math.ceil(gravado * 0.05));
    // retencao_75 do gerador e CONTAGEM (o contrato do sync), nunca acima das reproducoes.
    const comVideo = granularHoje.filter((g) => g.vis_video > 0);
    expect(comVideo.length).toBeGreaterThan(0);
    for (const g of comVideo) {
      expect(Number.isInteger(g.retencao_75)).toBe(true);
      expect(g.retencao_75).toBeLessThanOrEqual(g.vis_video);
    }
    expect(r.semDetalhe).toEqual([]);
  });

  it("7 dias: campanha pelo gasto nos dias sem detalhe; conjunto e anuncio so com hoje", () => {
    const r = rodar(desde7);
    const hojeR = rodar(hoje);
    const campanhas = s.linhasGasto.filter((g) => g.nivel === "campanha" && g.data >= desde7).reduce((t, g) => t + Number(g.gasto), 0);
    const soma = (x: ResultadoCampanhas, nivel: LinhaCampanha["nivel"], k: "vendas" | "gastos") =>
      x.linhas.filter((l) => l.nivel === nivel).reduce((t, l) => t + l[k], 0);
    expect(Math.abs(soma(r, "campanha", "gastos") - campanhas)).toBeLessThan(0.05);
    expect(soma(r, "anuncio", "vendas")).toBe(soma(hojeR, "anuncio", "vendas"));
    expect(soma(r, "anuncio", "gastos")).toBeCloseTo(soma(hojeR, "anuncio", "gastos"), 6);
    expect(soma(r, "campanha", "vendas")).toBeGreaterThan(soma(hojeR, "campanha", "vendas") * 3);
    expect(r.semDetalhe.map((c) => c.dias)).toEqual([6, 6]);
    // A soma fecha com o Lucro do periodo.
    const tudo = calcularFinanceiro({
      lojas: [lojaFinanceira],
      pedidos: s.pedidos,
      custos: custosDosProdutos(),
      configs: [configLoja],
      contas: [],
      gastos: [],
      cambio: [],
      intervalos: { atual: { desde: desde7, ate: hoje }, anterior: { desde: somarDia(desde7, -1), ate: somarDia(desde7, -1) } },
      moeda: "USD",
      hoje,
      agoraMs: AGORA,
    }).atual;
    const { identificadas, semId, idDesconhecido } = r.atribuicao;
    expect(identificadas.vendas + semId.vendas + idDesconhecido.vendas).toBe(tudo.pedidos);
    expect(identificadas.faturamento + semId.faturamento + idDesconhecido.faturamento).toBeCloseTo(tudo.receita, 4);
  });
});
