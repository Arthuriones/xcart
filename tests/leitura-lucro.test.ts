import { describe, expect, it } from "vitest";
import { calcularFinanceiro, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import { montarSerieDiaria } from "@/lib/leitura/serie-diaria";
import { montarPorProduto } from "@/lib/leitura/por-produto";
import { montarPorCampanha } from "@/lib/leitura/por-campanha";
import type {
  AdAccountRow,
  AdSpendDailyRow,
  FinOrderRow,
  LinhaPedido,
  ProductCostRow,
} from "@/lib/financeiro/tipos";

// ---------------------------------------------------------------------------
// Fixtures: duas lojas em BRL, periodo atual 01-03/10/2026 e anterior
// 28-30/09/2026. Tudo em BRL para a conta ficar de cabeca.
// ---------------------------------------------------------------------------

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

const linha = (sku: string, qtd: number, preco: number, extra: Partial<LinhaPedido> = {}): LinhaPedido => ({
  sku,
  qtd,
  qtd_atual: qtd,
  qtd_nao_enviada: 0,
  preco,
  ...extra,
});

let seq = 0;
function pedido(p: Partial<FinOrderRow> & { dia_local: string }): FinOrderRow {
  seq += 1;
  return {
    store_id: A,
    user_id: USER,
    shopify_order_id: String(seq),
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
    linhas: [],
    ...p,
  };
}

function custo(sku: string, custo_unitario: number, extra: Partial<ProductCostRow> = {}): ProductCostRow {
  seq += 1;
  return {
    id: `c${seq}`,
    store_id: A,
    user_id: USER,
    sku,
    custo_unitario,
    frete_unitario: 0,
    moeda: "BRL",
    valido_desde: "2026-01-01",
    origem: "manual",
    ...extra,
  };
}

function conta(p: Partial<AdAccountRow> & { id: string }): AdAccountRow {
  return {
    user_id: USER,
    store_id: A,
    plataforma: "meta",
    external_id: "act_1",
    nome: "Conta Meta",
    moeda: "BRL",
    fuso: "America/Sao_Paulo",
    status_externo: null,
    fonte: "api",
    ativo: true,
    sincronizando_desde: null,
    ultimo_sync_em: null,
    ultimo_sync_ok_em: null,
    ultimo_reprocesso_em: null,
    ultimo_dado_gerado_em: null,
    ultimo_erro: null,
    ...p,
  };
}

function gasto(p: Partial<AdSpendDailyRow> & { ad_account_id: string; data: string; gasto: number }): AdSpendDailyRow {
  return {
    user_id: USER,
    nivel: "conta",
    campanha_id: "",
    campanha_nome: null,
    moeda: "BRL",
    impressoes: 0,
    cliques: 0,
    compras: 0,
    valor_compras: 0,
    fonte: "api",
    sincronizado_em: "2026-10-03T12:00:00Z",
    ...p,
  };
}

function entrada(p: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [
      { id: A, nome: "Loja A", dominio: "a.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" },
      { id: B, nome: "Loja B", dominio: "b.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" },
    ],
    pedidos: [],
    custos: [],
    configs: [],
    contas: [],
    gastos: [],
    cambio: [],
    intervalos: {
      atual: { desde: "2026-10-01", ate: "2026-10-03" },
      anterior: { desde: "2026-09-28", ate: "2026-09-30" },
    },
    moeda: "BRL",
    hoje: "2026-10-03",
    ...p,
  };
}

// ---------------------------------------------------------------------------

describe("montarSerieDiaria", () => {
  const e = entrada({
    pedidos: [
      pedido({ dia_local: "2026-09-28", liquido_pago: 50, recebido: 50 }),
      pedido({ dia_local: "2026-09-30", liquido_pago: 70, recebido: 70 }),
      pedido({ dia_local: "2026-10-01", liquido_pago: 100 }),
      pedido({ dia_local: "2026-10-03", liquido_pago: 200, recebido: 200, store_id: B }),
    ],
    contas: [conta({ id: "m1" })],
    gastos: [gasto({ ad_account_id: "m1", data: "2026-10-01", gasto: 30 })],
  });

  it("devolve o atual e o anterior dia a dia, do mais antigo para o mais novo", () => {
    const s = montarSerieDiaria(e);
    expect(s.atual.map((d) => d.dia)).toEqual(["2026-10-01", "2026-10-02", "2026-10-03"]);
    expect(s.anterior.map((d) => d.dia)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
    expect(s.anterior.map((d) => d.receita)).toEqual([50, 0, 70]);
    expect(s.atual.map((d) => d.parcial)).toEqual([false, false, true]);
    // Nenhum dia do anterior e "hoje".
    expect(s.anterior.some((d) => d.parcial)).toBe(false);
  });

  it("bate com os totais do calculo, sem mudar a conta", () => {
    const s = montarSerieDiaria(e);
    const r = calcularFinanceiro(e);
    const soma = (lista: { receita: number }[]) => lista.reduce((t, d) => t + d.receita, 0);
    expect(soma(s.atual)).toBe(r.atual.receita);
    expect(soma(s.anterior)).toBe(r.anterior.receita);
    expect(s.atual[0].gastoMeta).toBe(30);
  });

  it("lucro por loja por dia soma o lucro do dia", () => {
    const s = montarSerieDiaria(e);
    expect(s.porLoja.map((l) => l.storeId)).toEqual([A, B]);
    const a = s.porLoja.find((l) => l.storeId === A)!.lucro;
    const b = s.porLoja.find((l) => l.storeId === B)!.lucro;
    expect(a).toEqual([70, 0, 0]);
    expect(b).toEqual([0, 0, 200]);
  });

  it("sem serie por loja com uma loja so ou quando pedido", () => {
    expect(montarSerieDiaria(entrada({ lojas: entrada().lojas.slice(0, 1) })).porLoja).toEqual([]);
    expect(montarSerieDiaria(e, { porLoja: false }).porLoja).toEqual([]);
  });
});

describe("montarPorProduto", () => {
  it("divide a receita e a taxa do pedido pelo peso de cada item", () => {
    const r = montarPorProduto(
      entrada({
        // 30 + 70 de itens; o pedido recebeu 110 (com 10 de frete).
        pedidos: [
          pedido({
            dia_local: "2026-10-01",
            liquido_pago: 110,
            recebido: 110,
            linhas: [linha("SKU-A", 1, 30), linha("SKU-B", 1, 70)],
          }),
        ],
        custos: [custo("SKU-A", 10), custo("SKU-B", 20)],
        configs: [{ store_id: A, user_id: USER, taxa_pct: 10, taxa_fixa: 0, custo_padrao_pct: null }],
      })
    );
    const a = r.linhas.find((l) => l.sku === "SKU-A")!;
    const b = r.linhas.find((l) => l.sku === "SKU-B")!;
    expect(a.receita).toBeCloseTo(33);
    expect(b.receita).toBeCloseTo(77);
    expect(a.taxas).toBeCloseTo(3.3);
    expect(a.custo).toBe(10);
    expect(a.lucro).toBeCloseTo(33 - 10 - 3.3);
    expect(b.margem).toBeCloseTo((77 - 20 - 7.7) / 77);
    expect(a.unidades).toBe(1);
    // Mais lucrativo primeiro.
    expect(r.linhas[0].sku).toBe("SKU-B");
  });

  it("a soma da receita dos produtos bate com o faturamento", () => {
    const e = entrada({
      pedidos: [
        pedido({ dia_local: "2026-10-01", liquido_pago: 90, linhas: [linha("X", 2, 25), linha("Y", 1, 50)] }),
        pedido({ dia_local: "2026-10-02", liquido_pago: 40, store_id: B, linhas: [linha("X", 1, 40)] }),
      ],
    });
    const r = montarPorProduto(e);
    const soma = r.linhas.reduce((t, l) => t + l.receita, 0);
    expect(soma).toBeCloseTo(calcularFinanceiro(e).atual.receita);
    const x = r.linhas.find((l) => l.sku === "X")!;
    expect(x.lojas).toBe(2);
    expect(x.unidades).toBe(3);
  });

  it("SKU sem custo e sem custo padrao fica com lucro desconhecido, nunca zero", () => {
    const r = montarPorProduto(
      entrada({ pedidos: [pedido({ dia_local: "2026-10-01", linhas: [linha("SEM", 1, 100)] })] })
    );
    expect(r.linhas[0]).toMatchObject({ sku: "SEM", custo: null, lucro: null, margem: null });
  });

  it("usa o custo padrao da loja como estimado", () => {
    const r = montarPorProduto(
      entrada({
        pedidos: [pedido({ dia_local: "2026-10-01", linhas: [linha("P", 1, 100)] })],
        configs: [{ store_id: A, user_id: USER, taxa_pct: 0, taxa_fixa: 0, custo_padrao_pct: 40 }],
      })
    );
    expect(r.linhas[0]).toMatchObject({ custo: 40, custoEstimado: true, lucro: 60 });
  });

  it("reenvio custa sem vender; teste e fora do periodo ficam de fora", () => {
    const r = montarPorProduto(
      entrada({
        pedidos: [
          pedido({ dia_local: "2026-10-01", tipo: "reenvio", liquido_pago: 0, recebido: 0, linhas: [linha("R", 1, 50)] }),
          pedido({ dia_local: "2026-10-01", tipo: "teste", linhas: [linha("T", 1, 50)] }),
          pedido({ dia_local: "2026-09-29", linhas: [linha("VELHO", 1, 50)] }),
        ],
        custos: [custo("R", 12)],
      })
    );
    expect(r.linhas.map((l) => l.sku)).toEqual(["R"]);
    expect(r.linhas[0]).toMatchObject({ unidades: 0, receita: 0, custo: 12, lucro: -12 });
  });

  it("receita de pedido sem item com peso fica fora das linhas e e contada", () => {
    const r = montarPorProduto(
      entrada({ pedidos: [pedido({ dia_local: "2026-10-01", liquido_pago: 15, linhas: [] })] })
    );
    expect(r.linhas).toEqual([]);
    expect(r.receitaSemItem).toBe(15);
  });
});

describe("montarPorCampanha", () => {
  const contas = [
    conta({ id: "m1", nome: "Lumen · Principal" }),
    conta({ id: "g1", plataforma: "google", nome: "Lumen · Pesquisa", moeda: "USD" }),
    conta({ id: "outra", store_id: B }),
  ];
  const base = {
    contas,
    cambio: [
      { data: "2026-10-01", moeda: "BRL", por_usd: 5, fonte: "frankfurter" as const },
      { data: "2026-10-01", moeda: "USD", por_usd: 1, fonte: "frankfurter" as const },
    ],
    moeda: "BRL" as const,
    intervalo: { desde: "2026-10-01", ate: "2026-10-03" },
    lojaIds: [A],
  };

  it("soma por conta + campanha e calcula o ROAS da plataforma", () => {
    const linhas = montarPorCampanha({
      ...base,
      gastos: [
        gasto({ ad_account_id: "m1", data: "2026-10-01", gasto: 100, nivel: "campanha", campanha_id: "c1", campanha_nome: "Velho", impressoes: 1000, cliques: 30, compras: 2, valor_compras: 300 }),
        gasto({ ad_account_id: "m1", data: "2026-10-02", gasto: 50, nivel: "campanha", campanha_id: "c1", campanha_nome: "Novo", impressoes: 500, cliques: 10, compras: 1, valor_compras: 150 }),
        // Nivel conta nao entra (somaria em dobro).
        gasto({ ad_account_id: "m1", data: "2026-10-01", gasto: 999 }),
        // Conta de outra loja, fora do recorte.
        gasto({ ad_account_id: "outra", data: "2026-10-01", gasto: 77, nivel: "campanha", campanha_id: "x" }),
        // Fora do periodo.
        gasto({ ad_account_id: "m1", data: "2026-09-30", gasto: 40, nivel: "campanha", campanha_id: "c1" }),
      ],
    });
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toMatchObject({
      nome: "Novo",
      contaNome: "Lumen · Principal",
      plataforma: "meta",
      gasto: 150,
      impressoes: 1500,
      cliques: 40,
      compras: 3,
      valorCompras: 450,
      roasPlataforma: 3,
      semCotacao: false,
    });
  });

  it("converte pela cotacao do dia e ordena pelo gasto", () => {
    const linhas = montarPorCampanha({
      ...base,
      gastos: [
        gasto({ ad_account_id: "m1", data: "2026-10-01", gasto: 100, nivel: "campanha", campanha_id: "c1" }),
        gasto({ ad_account_id: "g1", data: "2026-10-01", gasto: 30, moeda: "USD", nivel: "campanha", campanha_id: "g", valor_compras: 60 }),
      ],
    });
    expect(linhas.map((l) => l.id)).toEqual(["g1:g", "m1:c1"]);
    expect(linhas[0].gasto).toBe(150);
    expect(linhas[0].roasPlataforma).toBe(2);
    expect(linhas[1].roasPlataforma).toBe(0);
  });

  it("sem cotacao marca a linha e nao soma o gasto", () => {
    const linhas = montarPorCampanha({
      ...base,
      gastos: [gasto({ ad_account_id: "m1", data: "2026-10-01", gasto: 10, moeda: "XYZ", nivel: "campanha", campanha_id: "c" })],
    });
    expect(linhas[0]).toMatchObject({ gasto: 0, semCotacao: true, roasPlataforma: null });
  });
});
