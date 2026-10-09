import { describe, expect, it } from "vitest";
import { calcularFinanceiro, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import type { FinOrderRow, FinStoreSettingsRow, LinhaPedido, ProductCostRow } from "@/lib/financeiro/tipos";
import { montarPedidos, nomeGateway, statusDoPedido } from "@/lib/leitura/pedidos";
import {
  FILTROS_COD,
  jornadaDoPedido,
  passaNoFiltro,
  passaNoFiltroCod,
} from "../src/app/(dashboard)/pedidos/filtros";

// Tela Pedidos com contra entrega: a situacao de cada pedido, o filtro, o
// que falta receber e a soma batendo com o Dashboard.

const LOJA = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const HOJE = "2026-10-04";
const AGORA = Date.parse("2026-10-04T12:00:00Z");
const COD = ["Cash on Delivery (COD)"];

function linha(sku: string, qtd: number, preco: number, extra: Partial<LinhaPedido> = {}): LinhaPedido {
  return { sku, qtd, qtd_atual: qtd, qtd_nao_enviada: 0, preco, ...extra };
}

let seq = 5000;
function pedido(p: Partial<FinOrderRow> = {}): FinOrderRow {
  seq += 1;
  return {
    store_id: LOJA,
    user_id: USER,
    shopify_order_id: String(seq),
    nome: `#${seq}`,
    processado_em: "2026-10-03T15:00:00Z",
    dia_local: "2026-10-03",
    criado_em: "2026-10-03T15:00:00Z",
    atualizado_em: "2026-10-03T15:00:00Z",
    cancelado_em: null,
    tipo: "venda",
    status_financeiro: "PAID",
    origem: "web",
    moeda: "USD",
    moeda_cliente: "USD",
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
    linhas: [linha("CIL-01", 1, 100)],
    ...p,
  };
}

function cod(p: Partial<FinOrderRow> = {}): FinOrderRow {
  return pedido({
    gateways: COD,
    status_financeiro: "PENDING",
    recebido: 0,
    liquido_pago: 0,
    linhas: [linha("CIL-01", 1, 100, { qtd_nao_enviada: 1 })],
    ...p,
  });
}

const CUSTO: ProductCostRow = {
  id: "c-1",
  store_id: LOJA,
  user_id: USER,
  sku: "CIL-01",
  custo_unitario: 30,
  frete_unitario: 10,
  moeda: "USD",
  valido_desde: "2026-01-01",
  origem: "manual",
};

const CFG: FinStoreSettingsRow = {
  store_id: LOJA,
  user_id: USER,
  taxa_pct: 4,
  taxa_fixa: 0.3,
  custo_padrao_pct: null,
  contra_entrega: true,
  cod_taxa_entrega: 70,
  cod_custo_devolucao: 8,
};

function entrada(pedidos: FinOrderRow[]): EntradaFinanceiro {
  return {
    lojas: [{ id: LOJA, nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com", fuso: "America/Sao_Paulo", moeda: "USD" }],
    pedidos,
    custos: [CUSTO],
    configs: [CFG],
    contas: [],
    gastos: [],
    cambio: [],
    intervalos: { atual: { desde: "2026-09-28", ate: HOJE }, anterior: { desde: "2026-09-21", ate: "2026-09-27" } },
    moeda: "USD",
    hoje: HOJE,
  };
}

function montar(pedidos: FinOrderRow[]) {
  const e = entrada(pedidos);
  return montarPedidos({ entrada: e, lojas: e.lojas, fuso: "America/Sao_Paulo", eventos: [], destinos: [], lojasLigadas: [], agoraMs: AGORA });
}

describe("status do pedido contra entrega", () => {
  it("cada situacao com o rotulo da tela", () => {
    expect(statusDoPedido(cod())).toMatchObject({ id: "cod_aguardando_envio", rotulo: "Aguardando envio" });
    expect(statusDoPedido(cod({ linhas: [linha("CIL-01", 1, 100)] }))).toMatchObject({ id: "cod_em_transito", rotulo: "Em trânsito" });
    expect(statusDoPedido(cod({ entrega: "entregue", linhas: [linha("CIL-01", 1, 100)] }))).toMatchObject({
      id: "cod_entregue",
      rotulo: "Entregue · a receber",
    });
    expect(statusDoPedido(cod({ recebido: 100, liquido_pago: 100 }))).toMatchObject({ id: "cod_pago", tom: "ok" });
    expect(statusDoPedido(cod({ entrega: "falhou" }))).toMatchObject({ id: "cod_recusado", rotulo: "Recusado/Devolvido", tom: "err" });
    expect(statusDoPedido(cod({ cancelado_em: "2026-10-03T16:00:00Z" }))).toMatchObject({ id: "cod_cancelado" });
  });

  it("pedido online continua com o status de sempre", () => {
    expect(statusDoPedido(pedido({ recebido: 0, liquido_pago: 0 })).id).toBe("aguardando_pagamento");
    expect(statusDoPedido(pedido({ cancelado_em: "2026-10-03T16:00:00Z" })).id).toBe("cancelado");
    // Sem gateway (linha antiga, chamada parcial): online.
    expect(statusDoPedido({ cancelado_em: null, reembolsado: 0, liquido_pago: 0, recebido: 0, tipo: "venda", linhas: [] }).id).toBe(
      "aguardando_pagamento"
    );
  });

  it("gateway de COD aparece como Contra entrega", () => {
    expect(nomeGateway(COD)).toBe("Contra entrega");
    expect(nomeGateway(["shopify_payments", "Cash on Delivery (COD)"])).toBe("Shopify Payments + Contra entrega");
    expect(nomeGateway(["shopify_payments"])).toBe("Shopify Payments");
  });
});

describe("lista e resumo", () => {
  const pedidos = () => [
    cod(), // aguardando
    cod({ linhas: [linha("CIL-01", 1, 100)], enviado_em: "2026-10-03T20:00:00Z", entrega: "em_transito" }), // em transito
    cod({ entrega: "falhou", linhas: [linha("CIL-01", 1, 100)] }), // recusado
    cod({ recebido: 100, liquido_pago: 100, status_financeiro: "PAID" }), // pago
    pedido(), // online
  ];

  it("a receber e o lucro somam como o Dashboard", () => {
    const { pedidos: lista, resumo } = montar(pedidos());
    const dash = calcularFinanceiro(entrada(pedidos())).atual;
    expect(resumo.aReceber).toBeCloseTo(dash.cod.aReceber);
    expect(resumo.aReceber).toBeCloseTo(200);
    expect(resumo.codAbertos).toBe(2);
    expect(resumo.faturamento).toBeCloseTo(dash.receita);
    expect(resumo.lucro).toBeCloseTo(dash.receita - dash.cmv - dash.taxas - dash.devolucoes);
    const recusado = lista.find((p) => p.cod === "recusado");
    expect(recusado?.valores?.devolucao).toBeCloseTo(8);
    expect(recusado?.valores?.lucro).toBeCloseTo(-48);
    const aguardando = lista.find((p) => p.cod === "aguardando_envio");
    expect(aguardando?.valores).toMatchObject({ aReceber: 100, cmv: 0, receita: 0 });
    expect(aguardando?.gateway).toBe("Contra entrega");
    expect(lista.find((p) => !p.cod)?.cod).toBeNull();
  });

  it("filtro de contra entrega e pela situacao", () => {
    const { pedidos: lista } = montar(pedidos());
    expect(lista.filter((p) => passaNoFiltro(p, "contra_entrega"))).toHaveLength(4);
    expect(lista.filter((p) => passaNoFiltroCod(p, "todos"))).toHaveLength(4);
    expect(lista.filter((p) => passaNoFiltroCod(p, "em_transito"))).toHaveLength(1);
    expect(lista.filter((p) => passaNoFiltroCod(p, "recusado"))).toHaveLength(1);
    expect(lista.filter((p) => passaNoFiltroCod(p, "entregue"))).toHaveLength(0);
    // COD nao entra em Reembolsos (cancelado/recusado tem a situacao propria).
    expect(lista.filter((p) => passaNoFiltro(p, "reembolsos"))).toHaveLength(0);
    expect(FILTROS_COD.map((f) => f.rotulo)).toEqual([
      "Todos",
      "Aguardando envio",
      "Em trânsito",
      "Entregue · a receber",
      "Pago",
      "Recusado/Devolvido",
      "Cancelado",
    ]);
  });

  it("jornada do contra entrega: pago na entrega, enviado, recusado", () => {
    const { pedidos: lista } = montar(pedidos());
    const transito = lista.find((p) => p.cod === "em_transito")!;
    const j = jornadaDoPedido(transito, String);
    expect(j.some((x) => x.titulo === "Pedido contra entrega" && x.detalhe === "Paga na entrega")).toBe(true);
    expect(j.some((x) => x.titulo === "Enviado")).toBe(true);
    expect(j.some((x) => x.detalhe === "Sem pagamento recebido")).toBe(false);
    const recusado = lista.find((p) => p.cod === "recusado")!;
    expect(jornadaDoPedido(recusado, String).some((x) => x.titulo === "Recusado ou devolvido" && x.tom === "err")).toBe(true);
  });
});
