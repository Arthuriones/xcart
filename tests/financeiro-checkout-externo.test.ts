import { describe, expect, it } from "vitest";
import { calcularFinanceiro, type EntradaFinanceiro, type LojaFinanceira, type PedidoExternoFin } from "@/lib/financeiro/calculo";
import { contarAmostraExterna } from "@/lib/checkouts-externos/financeiro";
import { montarPedidosExternos } from "@/lib/checkouts-externos/pedidos";
import { montarSerieDiaria } from "@/lib/leitura/serie-diaria";
import { intervaloDaAmostra } from "@/lib/financeiro/contra-entrega";
import type { PedidoExternoRow } from "@/lib/checkouts-externos/tipos";
import type { AdAccountRow, AdSpendDailyRow, FinOrderRow, FxRateRow } from "@/lib/financeiro/tipos";

// Checkout externo (Sphere) no Dashboard: uma "loja" de comissao. Recebido =
// comissao aprovada + paga; A receber = pendente; Perdido = expirada ou
// revertida; Previsto = recebido + pendente x taxa de aprovacao; lucro =
// comissao - anuncio ligado ao checkout. A loja Shopify ao lado nao muda.

const LOJA = "11111111-1111-4111-8111-111111111111";
const CK = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

const INTERVALOS = {
  atual: { desde: "2026-09-23", ate: "2026-09-29" },
  anterior: { desde: "2026-09-16", ate: "2026-09-22" },
};

const LOJA_SHOPIFY: LojaFinanceira = { id: LOJA, nome: "Lumen", dominio: "lumen.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" };
const CHECKOUT: LojaFinanceira = {
  id: CK,
  nome: "Sphere Itália",
  dominio: "Sphere Affiliates",
  tipo: "checkout",
  fuso: "Europe/Rome",
  moeda: "EUR",
  taxaPadraoPct: 70,
};

/** 1 USD = 5 BRL = 0,8 EUR (1 EUR = 6,25 BRL). */
const CAMBIO: FxRateRow[] = [
  { data: "2026-09-20", moeda: "BRL", por_usd: 5, fonte: "frankfurter" },
  { data: "2026-09-20", moeda: "EUR", por_usd: 0.8, fonte: "frankfurter" },
];

function externo(situacao: PedidoExternoFin["situacao"], receita: number, dia = "2026-09-28", extra: Partial<PedidoExternoFin> = {}): PedidoExternoFin {
  return { checkout_id: CK, situacao, moeda: "EUR", valor: 89.9, receita, moeda_receita: null, dia_local: dia, ...extra };
}

function conta(id: string, destino: { store_id?: string | null; checkout_id?: string | null }): AdAccountRow {
  return {
    id,
    user_id: USER,
    store_id: destino.store_id ?? null,
    checkout_id: destino.checkout_id ?? null,
    plataforma: "meta",
    external_id: "123456",
    nome: id,
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
  };
}

function gasto(conta: string, data: string, valor: number, moeda = "BRL"): AdSpendDailyRow {
  return {
    ad_account_id: conta,
    user_id: USER,
    data,
    nivel: "conta",
    campanha_id: "",
    campanha_nome: null,
    moeda,
    gasto: valor,
    impressoes: 0,
    cliques: 0,
    compras: 0,
    valor_compras: 0,
    fonte: "api",
    sincronizado_em: "2026-09-29T12:00:00Z",
  };
}

function pedidoShopify(dia = "2026-09-28"): FinOrderRow {
  return {
    store_id: LOJA,
    user_id: USER,
    shopify_order_id: "1",
    nome: "#1",
    processado_em: `${dia}T12:00:00Z`,
    dia_local: dia,
    criado_em: `${dia}T12:00:00Z`,
    atualizado_em: `${dia}T12:00:00Z`,
    cancelado_em: null,
    tipo: "venda",
    status_financeiro: "PAID",
    origem: "web",
    moeda: "BRL",
    moeda_cliente: "BRL",
    total_bruto: 200,
    total_atual: 200,
    imposto_atual: 0,
    taxas_alfandega: 0,
    gorjeta: 0,
    descontos: 0,
    frete_cobrado: 0,
    recebido: 200,
    reembolsado: 0,
    liquido_pago: 200,
    total_cliente: 200,
    gateways: ["shopify_payments"],
    linhas: [{ sku: "A", qtd: 1, qtd_atual: 1, qtd_nao_enviada: 0, preco: 200 }],
  };
}

function entrada(e: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [CHECKOUT],
    pedidos: [],
    custos: [],
    configs: [],
    contas: [],
    gastos: [],
    cambio: CAMBIO,
    intervalos: INTERVALOS,
    moeda: "EUR",
    hoje: "2026-09-29",
    ...e,
  };
}

const EXTERNOS = [
  externo("aprovado", 75),
  externo("pago", 50),
  externo("pendente", 40),
  externo("pendente", 60),
  externo("expirado", 30),
  externo("revertido", 20),
];

describe("checkout externo no calculo", () => {
  it("Recebido, A receber, Perdido e Previsto pela taxa padrao (70%)", () => {
    const r = calcularFinanceiro(entrada({ externos: EXTERNOS }));
    const t = r.atual;
    expect(t.receita).toBeCloseTo(125); // 75 + 50
    expect(t.pedidos).toBe(2);
    expect(t.cod.aReceber).toBeCloseTo(100); // 40 + 60
    expect(t.cod.previsto).toBeCloseTo(125 + 100 * 0.7);
    expect(t.cod.taxaEntrega).toBeCloseTo(0.7);
    expect(t.cod.gerados).toBe(6);
    expect(t.cod.abertos).toBe(2);
    expect(t.cod.recusados).toBe(2);
    expect(t.externo).toEqual({
      pedidos: 6,
      pendentes: 2,
      aprovados: 1,
      pagos: 1,
      perdidos: 2,
      perdido: 50,
      valorPedidos: expect.closeTo(6 * 89.9, 6),
    });
    // Sem custo de produto nem taxa: o valor do pedido nao e receita.
    expect(t.cmv).toBe(0);
    expect(t.taxas).toBe(0);
    expect(r.lojasContraEntrega).toEqual([CK]);
    expect(r.entrega.taxa).toBeCloseTo(0.7);
    expect(r.entrega.fonte).toBe("padrao");
  });

  it("lucro e ROAS: comissao menos o anuncio ligado ao checkout", () => {
    const r = calcularFinanceiro(
      entrada({
        externos: EXTERNOS,
        contas: [conta("c1", { checkout_id: CK })],
        // 250 BRL = 40 EUR
        gastos: [gasto("c1", "2026-09-28", 250)],
      })
    );
    const t = r.atual;
    expect(t.gasto).toBeCloseTo(40);
    expect(t.lucro).toBeCloseTo(125 - 40);
    expect(t.cod.lucroPrevisto).toBeCloseTo(125 + 70 - 40);
    expect(t.roas).toBeCloseTo(125 / 40);
    expect(t.cod.roasPrevisto).toBeCloseTo(195 / 40);
    expect(r.porLoja[0]).toMatchObject({ storeId: CK, receita: 125, gastoMeta: expect.closeTo(40, 6) });
  });

  it("converte a comissao pela cotacao do dia (EUR -> BRL)", () => {
    const r = calcularFinanceiro(entrada({ externos: [externo("aprovado", 10)], moeda: "BRL" }));
    expect(r.atual.receita).toBeCloseTo(62.5);
    expect(r.avisos.cambioAproximado).toBe(false);
  });

  it("moeda da comissao do proprio pedido vence a do checkout; sem cotacao fica de fora com aviso", () => {
    const usd = calcularFinanceiro(entrada({ externos: [externo("pago", 10, "2026-09-28", { moeda_receita: "USD" })] }));
    expect(usd.atual.receita).toBeCloseTo(8);
    const xyz = calcularFinanceiro(entrada({ externos: [externo("pago", 10, "2026-09-28", { moeda_receita: "XYZ" })] }));
    expect(xyz.atual.receita).toBe(0);
    expect(xyz.avisos.moedasSemCotacao).toEqual(["XYZ"]);
  });

  it("taxa de aprovacao do historico com amostra suficiente", () => {
    const janela = intervaloDaAmostra("2026-09-29");
    const amostra: Pick<PedidoExternoRow, "checkout_id" | "situacao" | "dia_local">[] = [
      ...Array.from({ length: 15 }, () => ({ checkout_id: CK, situacao: "pago" as const, dia_local: "2026-09-01" })),
      ...Array.from({ length: 3 }, () => ({ checkout_id: CK, situacao: "expirado" as const, dia_local: "2026-09-01" })),
      // Pendente ha mais de 21 dias conta como perdido; o recente nao entra.
      ...Array.from({ length: 2 }, () => ({ checkout_id: CK, situacao: "pendente" as const, dia_local: "2026-08-20" })),
      { checkout_id: CK, situacao: "pendente" as const, dia_local: "2026-09-20" },
    ];
    const contada = contarAmostraExterna(amostra, janela, "2026-09-29");
    expect(contada[CK]).toEqual({ entregues: 15, recusados: 3, semRetorno: 2 });
    const r = calcularFinanceiro(entrada({ externos: [externo("pendente", 100)], amostraEntrega: contada }));
    expect(r.entrega.fonte).toBe("historico");
    expect(r.atual.cod.previsto).toBeCloseTo(100 * 0.75);
  });

  it("taxa padrao ajustavel do checkout", () => {
    const r = calcularFinanceiro(entrada({ lojas: [{ ...CHECKOUT, taxaPadraoPct: 50 }], externos: [externo("pendente", 100)] }));
    expect(r.atual.cod.previsto).toBeCloseTo(50);
  });

  it("pedido fora do periodo nao conta; o do periodo anterior vai para a comparacao", () => {
    const r = calcularFinanceiro(entrada({ externos: [externo("pago", 10, "2026-09-20"), externo("pago", 99, "2026-08-01")] }));
    expect(r.atual.receita).toBe(0);
    expect(r.anterior.receita).toBeCloseTo(10);
  });
});

describe("Todas as lojas: loja Shopify + checkout", () => {
  const base = {
    pedidos: [pedidoShopify()],
    contas: [conta("loja", { store_id: LOJA }), conta("ck", { checkout_id: CK })],
    gastos: [gasto("loja", "2026-09-28", 50), gasto("ck", "2026-09-28", 25)],
    moeda: "BRL" as const,
  };

  it("os numeros da loja Shopify nao mudam com o checkout no filtro", () => {
    const so = calcularFinanceiro(entrada({ ...base, lojas: [LOJA_SHOPIFY] }));
    const junto = calcularFinanceiro(entrada({ ...base, lojas: [LOJA_SHOPIFY, CHECKOUT], externos: EXTERNOS }));
    const lojaSo = so.porLoja.find((l) => l.storeId === LOJA)!;
    const lojaJunto = junto.porLoja.find((l) => l.storeId === LOJA)!;
    for (const k of ["receita", "cmv", "taxas", "gasto", "lucro", "pedidos", "roas"] as const) {
      expect(lojaJunto[k]).toEqual(lojaSo[k]);
    }
    // O total soma os dois: a comissao do checkout (125 EUR = 781,25 BRL) e o gasto dele.
    expect(junto.atual.receita).toBeCloseTo(so.atual.receita + 125 * 6.25);
    expect(junto.atual.gasto).toBeCloseTo(75);
    expect(junto.lojasContraEntrega).toEqual([CK]);
  });

  it("sem o checkout no filtro, a conta ligada a ele fica de fora", () => {
    const r = calcularFinanceiro(entrada({ ...base, lojas: [LOJA_SHOPIFY], externos: EXTERNOS }));
    expect(r.atual.gasto).toBeCloseTo(50);
    expect(r.atual.receita).toBeCloseTo(200);
  });

  it("serie por loja traz o checkout com o lucro dele", () => {
    const serie = montarSerieDiaria(entrada({ ...base, lojas: [LOJA_SHOPIFY, CHECKOUT], externos: EXTERNOS }));
    const ck = serie.porLoja.find((l) => l.storeId === CK)!;
    expect(ck.lucro.reduce((s, v) => s + v, 0)).toBeCloseTo(125 * 6.25 - 25);
    const dia = serie.atual.find((d) => d.dia === "2026-09-28")!;
    expect(dia.receita).toBeCloseTo(200 + 125 * 6.25);
  });
});

describe("tela Pedidos do checkout", () => {
  function row(id: string, situacao: PedidoExternoRow["situacao"], receita: number, dia = "2026-09-28"): PedidoExternoRow {
    return {
      checkout_id: CK,
      user_id: USER,
      pedido_id: id,
      situacao,
      status_comissao: null,
      status_pedido: "created",
      metodo_pagamento: "cod",
      produto: "EVOX",
      pais: "IT",
      programa: null,
      moeda: "EUR",
      valor: "89.90",
      receita: String(receita),
      moeda_receita: null,
      criado_em: `${dia}T10:00:00Z`,
      dia_local: dia,
      aprovado_em: null,
      pago_em: null,
      perdido_em: null,
      atualizado_em: `${dia}T10:00:00Z`,
      versao: 0,
    };
  }

  it("linhas com produto, pais, valor, comissao convertida e situacao; resumo bate com o Dashboard", () => {
    const { linhas, resumo } = montarPedidosExternos({
      pedidos: [row("1", "aprovado", 75), row("2", "pendente", 40, "2026-09-29"), row("3", "expirado", 30), row("4", "pago", 50, "2026-08-01")],
      checkouts: [{ id: CK, nome: "Sphere Itália", fuso: "Europe/Rome", moeda_receita: "EUR" }],
      cambio: CAMBIO,
      moeda: "BRL",
      intervalo: INTERVALOS.atual,
      agoraMs: Date.parse("2026-09-29T15:00:00Z"),
    });
    expect(linhas.map((l) => l.pedido)).toEqual(["#2", "#1", "#3"]);
    expect(linhas[1]).toMatchObject({
      produto: "EVOX",
      pais: "IT",
      valor: 89.9,
      moedaPedido: "EUR",
      comissao: expect.closeTo(75 * 6.25, 6),
      rotulo: "Aprovada",
      tom: "ok",
    });
    expect(linhas[0]).toMatchObject({ rotulo: "Pendente", tom: "info" });
    expect(linhas[2]).toMatchObject({ rotulo: "Expirada", tom: "err" });
    expect(resumo).toMatchObject({
      pedidos: 3,
      recebido: expect.closeTo(75 * 6.25, 6),
      aReceber: expect.closeTo(40 * 6.25, 6),
      perdido: expect.closeTo(30 * 6.25, 6),
      pendentes: 1,
      perdidos: 1,
      semCotacao: 0,
    });
  });
});
