import { describe, expect, it } from "vitest";
import { calcularFinanceiro, type EntradaFinanceiro, type Totais } from "@/lib/financeiro/calculo";
import {
  AMOSTRA_MINIMA,
  aReceberCod,
  contarAmostra,
  ehPedidoCod,
  gatewayEhCod,
  intervaloDaAmostra,
  situacaoCod,
  sugerirContraEntrega,
  tagEhCod,
  tagEhRecusa,
  taxaDeEntrega,
  valorCod,
} from "@/lib/financeiro/contra-entrega";
import { mapearPedido, resumirEntregas, semCamposDeEnvio, type NoPedidoShopify } from "@/lib/financeiro/mapear-pedido";
import type {
  AdAccountRow,
  AdSpendDailyRow,
  FinOrderRow,
  FinStoreSettingsRow,
  FxRateRow,
  LinhaPedido,
  ProductCostRow,
} from "@/lib/financeiro/tipos";
import {
  formRecebimentoDe,
  recebimentoMudou,
  textoSugestaoCod,
  validarRecebimento,
} from "../src/app/(dashboard)/financeiro/custos/apresentar";
import { derivar } from "../src/app/(dashboard)/financeiro/lucro-dados";

// ---------------------------------------------------------------------------
// Fixtures no molde de tests/financeiro-calculo.test.ts
// ---------------------------------------------------------------------------

const LOJA = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const COD = ["Cash on Delivery (COD)"];

function linha(sku: string, qtd: number, preco: number, extra: Partial<LinhaPedido> = {}): LinhaPedido {
  return { sku, qtd, qtd_atual: qtd, qtd_nao_enviada: 0, preco, ...extra };
}

let seq = 0;
function pedido(p: Partial<FinOrderRow> = {}): FinOrderRow {
  seq += 1;
  return {
    store_id: LOJA,
    user_id: USER,
    shopify_order_id: String(seq),
    nome: `#${seq}`,
    processado_em: "2026-09-29T12:00:00Z",
    dia_local: "2026-09-29",
    criado_em: "2026-09-29T12:00:00Z",
    atualizado_em: "2026-09-29T12:00:00Z",
    cancelado_em: null,
    tipo: "venda",
    status_financeiro: "PAID",
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
    linhas: [linha("SKU-1", 1, 100)],
    ...p,
  };
}

/** Contra entrega sem pagamento, nada enviado (como os do Releasit em 09/10). */
function cod(p: Partial<FinOrderRow> = {}): FinOrderRow {
  return pedido({
    gateways: COD,
    status_financeiro: "PENDING",
    recebido: 0,
    liquido_pago: 0,
    linhas: [linha("SKU-1", 1, 100, { qtd_nao_enviada: 1 })],
    ...p,
  });
}

function config(p: Partial<FinStoreSettingsRow> = {}): FinStoreSettingsRow {
  return { store_id: LOJA, user_id: USER, taxa_pct: 0, taxa_fixa: 0, custo_padrao_pct: null, ...p };
}

const CUSTO: ProductCostRow = {
  id: "c1",
  store_id: LOJA,
  user_id: USER,
  sku: "SKU-1",
  custo_unitario: 30,
  frete_unitario: 10,
  moeda: "BRL",
  valido_desde: "2026-09-01",
  origem: "manual",
};

const CONTA: AdAccountRow = {
  id: "conta-1",
  user_id: USER,
  store_id: LOJA,
  plataforma: "meta",
  external_id: "1",
  nome: "Meta",
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

function gasto(valor: number): AdSpendDailyRow {
  return {
    ad_account_id: CONTA.id,
    user_id: USER,
    data: "2026-09-29",
    nivel: "conta",
    campanha_id: "",
    campanha_nome: null,
    moeda: "BRL",
    gasto: valor,
    impressoes: 0,
    cliques: 0,
    compras: 0,
    valor_compras: 0,
    fonte: "api",
    sincronizado_em: "2026-09-30T00:00:00Z",
  };
}

function entrada(p: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [{ id: LOJA, nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" }],
    pedidos: [],
    custos: [CUSTO],
    configs: [config({ contra_entrega: true, cod_taxa_entrega: 70, cod_custo_devolucao: 10 })],
    contas: [CONTA],
    gastos: [],
    cambio: [],
    intervalos: {
      atual: { desde: "2026-09-28", ate: "2026-09-30" },
      anterior: { desde: "2026-09-25", ate: "2026-09-27" },
    },
    moeda: "BRL",
    hoje: "2026-09-30",
    ...p,
  };
}

// ---------------------------------------------------------------------------

describe("gateway e tags de contra entrega", () => {
  it("reconhece os nomes de COD, em qualquer caixa e separador", () => {
    for (const g of [
      "Cash on Delivery (COD)",
      "cash_on_delivery",
      "COD",
      "Contra entrega",
      "Pago contra entrega",
      "Pagamento na entrega",
      "Contrareembolso",
      "Paiement à la livraison",
      "Nachnahme",
      "Dobírka",
      "Contrassegno",
      "Płatność za pobraniem",
    ]) {
      expect(gatewayEhCod(g), g).toBe(true);
    }
  });

  it("nao confunde com gateway online", () => {
    for (const g of ["shopify_payments", "paypal", "Gift card", "manual", "bogus", "mercado_pago", "QR Code", "Encoder Pay", ""]) {
      expect(gatewayEhCod(g), g).toBe(false);
    }
    expect(gatewayEhCod(null)).toBe(false);
  });

  it("tag do app de COD e tags de recusa", () => {
    expect(tagEhCod("releasit_cod_form")).toBe(true);
    expect(tagEhCod("vip")).toBe(false);
    for (const t of ["returned", "rts-1", "RTO", "Recusado", "devolvido", "refused"]) expect(tagEhRecusa(t), t).toBe(true);
    for (const t of ["sorts", "vip", "frete gratis", "cod"]) expect(tagEhRecusa(t), t).toBe(false);
  });

  it("pedido COD pelo gateway ou pela marca gravada; loja mista funciona", () => {
    expect(ehPedidoCod({ gateways: COD })).toBe(true);
    expect(ehPedidoCod({ gateways: ["shopify_payments"] })).toBe(false);
    expect(ehPedidoCod({ gateways: ["manual"], cod: true })).toBe(true);
    expect(ehPedidoCod({ gateways: [] })).toBe(false);
  });
});

describe("situacao do pedido contra entrega", () => {
  it("aguardando envio: pendente e nada enviado", () => {
    expect(situacaoCod(cod())).toBe("aguardando_envio");
  });

  it("em transito: unidade enviada ou envio registrado, sem pagamento", () => {
    expect(situacaoCod(cod({ linhas: [linha("SKU-1", 1, 100)] }))).toBe("em_transito");
    expect(situacaoCod(cod({ entrega: "em_transito", enviado_em: "2026-09-30T10:00:00Z" }))).toBe("em_transito");
    expect(situacaoCod(cod({ status_envio: "FULFILLED" }))).toBe("em_transito");
  });

  it("entregue sem pagamento marcado: entregue (a receber)", () => {
    expect(situacaoCod(cod({ entrega: "entregue", linhas: [linha("SKU-1", 1, 100)] }))).toBe("entregue");
  });

  it("pago quando recebeu; reembolso total vira devolvido", () => {
    expect(situacaoCod(cod({ recebido: 100, liquido_pago: 100, status_financeiro: "PAID" }))).toBe("pago");
    expect(situacaoCod(cod({ recebido: 100, reembolsado: 100, liquido_pago: 0 }))).toBe("recusado");
    expect(situacaoCod(cod({ recebido: 100, reembolsado: 30, liquido_pago: 70 }))).toBe("pago");
  });

  it("recusado: entrega falhou, tag de recusa ou devolucao andando", () => {
    expect(situacaoCod(cod({ entrega: "falhou" }))).toBe("recusado");
    expect(situacaoCod(cod({ marca_recusa: true }))).toBe("recusado");
    expect(situacaoCod(cod({ devolucao: "RETURNED" }))).toBe("recusado");
    expect(situacaoCod(cod({ devolucao: "IN_PROGRESS", entrega: "entregue" }))).toBe("recusado");
    // So pedido de devolucao ainda nao conta.
    expect(situacaoCod(cod({ devolucao: "RETURN_REQUESTED" }))).toBe("aguardando_envio");
  });

  it("cancelado antes do envio e cancelado; depois do envio e recusado", () => {
    expect(situacaoCod(cod({ cancelado_em: "2026-09-30T10:00:00Z" }))).toBe("cancelado");
    expect(situacaoCod(cod({ status_financeiro: "VOIDED" }))).toBe("cancelado");
    expect(
      situacaoCod(cod({ cancelado_em: "2026-09-30T10:00:00Z", entrega: "em_transito", enviado_em: "2026-09-29T20:00:00Z" }))
    ).toBe("recusado");
  });

  it("valor e a receber sem imposto, alfandega e gorjeta", () => {
    const p = cod({ total_atual: 120, imposto_atual: 15, gorjeta: 5 });
    expect(valorCod(p)).toBe(100);
    expect(aReceberCod(p, "em_transito")).toBe(100);
    expect(aReceberCod(p, "pago")).toBe(0);
    expect(aReceberCod(p, "recusado")).toBe(0);
  });
});

describe("taxa de entrega", () => {
  it("sem amostra suficiente vale a padrao da loja (vazio = 70%)", () => {
    expect(taxaDeEntrega(undefined, null)).toEqual({ taxa: 0.7, fonte: "padrao", amostra: 0 });
    expect(taxaDeEntrega({ entregues: 10, recusados: 1 }, 80)).toEqual({ taxa: 0.8, fonte: "padrao", amostra: 11 });
    expect(taxaDeEntrega(undefined, 150).taxa).toBe(1);
  });

  it(`com ${AMOSTRA_MINIMA} finalizados vale a da loja`, () => {
    expect(taxaDeEntrega({ entregues: 15, recusados: 5 }, 70)).toEqual({ taxa: 0.75, fonte: "historico", amostra: 20 });
  });

  it("amostra: COD finalizados entre 60 e 7 dias atras, por loja", () => {
    const janela = intervaloDaAmostra("2026-10-09");
    expect(janela).toEqual({ desde: "2026-08-10", ate: "2026-10-02" });
    const conta = contarAmostra(
      [
        cod({ dia_local: "2026-09-20", recebido: 100, liquido_pago: 100 }), // pago
        cod({ dia_local: "2026-09-20", entrega: "entregue", linhas: [linha("SKU-1", 1, 100)] }), // entregue
        cod({ dia_local: "2026-09-21", entrega: "falhou" }), // recusado
        cod({ dia_local: "2026-09-21", cancelado_em: "2026-09-21T10:00:00Z" }), // cancelado: fora
        cod({ dia_local: "2026-09-22" }), // aguardando: fora
        cod({ dia_local: "2026-10-05", recebido: 100, liquido_pago: 100 }), // ultima semana: fora
        pedido({ dia_local: "2026-09-20" }), // online: fora
      ],
      janela
    );
    expect(conta).toEqual({ [LOJA]: { entregues: 2, recusados: 1 } });
  });
});

describe("sugestao do modo contra entrega", () => {
  it("a maioria dos ultimos 7 dias e COD (o caso da AmpleStep em 09/10)", () => {
    const pedidos = [
      cod({ dia_local: "2026-10-09" }),
      cod({ dia_local: "2026-10-09" }),
      cod({ dia_local: "2026-10-09" }),
      pedido({ dia_local: "2026-10-09" }),
      pedido({ dia_local: "2026-10-01" }), // fora da janela
      pedido({ dia_local: "2026-09-29" }),
    ];
    const s = sugerirContraEntrega(pedidos, "2026-10-09");
    expect(s).toEqual({ cod: 3, total: 4, sugere: true });
    expect(textoSugestaoCod(s, "online")).toBe("3 de 4 pedidos dos últimos 7 dias foram contra entrega.");
    expect(textoSugestaoCod(s, "cod")).toBeNull();
  });

  it("um COD so, ou minoria, nao sugere", () => {
    expect(sugerirContraEntrega([cod({ dia_local: "2026-10-09" })], "2026-10-09").sugere).toBe(false);
    const minoria = [cod({ dia_local: "2026-10-09" }), cod({ dia_local: "2026-10-08" }), pedido({ dia_local: "2026-10-09" }), pedido({ dia_local: "2026-10-09" })];
    expect(sugerirContraEntrega(minoria, "2026-10-09").sugere).toBe(false);
  });
});

describe("sync: envios e campos de contra entrega", () => {
  it("resume os envios: falhou vence, entregue so com todos entregues, cancelado nao conta", () => {
    expect(resumirEntregas([])).toEqual({ entrega: null, enviado_em: null, entregue_em: null });
    expect(resumirEntregas([{ status: "CANCELLED", displayStatus: "IN_TRANSIT", createdAt: "2026-09-01T00:00:00Z" }]).entrega).toBeNull();
    expect(
      resumirEntregas([
        { status: "SUCCESS", displayStatus: "DELIVERED", createdAt: "2026-09-01T11:08:15Z", deliveredAt: "2026-09-16T14:56:00Z" },
      ])
    ).toEqual({ entrega: "entregue", enviado_em: "2026-09-01T11:08:15.000Z", entregue_em: "2026-09-16T14:56:00.000Z" });
    expect(
      resumirEntregas([
        { status: "SUCCESS", displayStatus: "DELIVERED", createdAt: "2026-09-02T00:00:00Z", deliveredAt: "2026-09-05T00:00:00Z" },
        { status: "SUCCESS", displayStatus: "IN_TRANSIT", createdAt: "2026-09-01T00:00:00Z" },
      ])
    ).toEqual({ entrega: "em_transito", enviado_em: "2026-09-01T00:00:00.000Z", entregue_em: null });
    expect(
      resumirEntregas([
        { status: "SUCCESS", displayStatus: "DELIVERED", createdAt: "2026-09-02T00:00:00Z", deliveredAt: "2026-09-05T00:00:00Z" },
        { status: "SUCCESS", displayStatus: "NOT_DELIVERED", createdAt: "2026-09-02T00:00:00Z" },
      ]).entrega
    ).toBe("falhou");
    expect(resumirEntregas([{ status: "SUCCESS", displayStatus: "FULFILLED", createdAt: "2026-09-01T00:00:00Z" }]).entrega).toBe(
      "em_transito"
    );
  });

  const din = (amount: string) => ({ shopMoney: { amount } });
  const releasit: NoPedidoShopify = {
    id: "gid://shopify/Order/9001",
    name: "#NM101099",
    createdAt: "2026-10-09T17:01:42Z",
    processedAt: "2026-10-09T17:01:42Z",
    updatedAt: "2026-10-09T17:01:45Z",
    cancelledAt: null,
    test: false,
    sourceName: "5690175",
    displayFinancialStatus: "PENDING",
    displayFulfillmentStatus: "UNFULFILLED",
    currencyCode: "CZK",
    presentmentCurrencyCode: "CZK",
    paymentGatewayNames: ["Cash on Delivery (COD)"],
    totalPriceSet: din("1459.0"),
    currentTotalPriceSet: { shopMoney: { amount: "1459.0" }, presentmentMoney: { amount: "1459.0" } },
    currentTotalTaxSet: din("0"),
    currentTotalDutiesSet: din("0"),
    totalTipReceivedSet: din("0"),
    totalDiscountsSet: din("0"),
    totalShippingPriceSet: din("0"),
    totalReceivedSet: din("0.0"),
    totalRefundedSet: din("0"),
    netPaymentSet: din("0"),
    lineItems: { nodes: [{ sku: "SONVITAL-CZ-3", quantity: 1, currentQuantity: 1, unfulfilledQuantity: 1, originalUnitPriceSet: din("1459.0") }] },
    returnStatus: "NO_RETURN",
    tags: ["releasit_cod_form"],
    fulfillments: [],
  };

  it("pedido do Releasit vira COD aguardando envio, sem gravar as tags", () => {
    const r = mapearPedido(releasit, { storeId: LOJA, userId: USER, fuso: "America/Sao_Paulo" });
    expect(r).toMatchObject({
      cod: true,
      status_envio: "UNFULFILLED",
      entrega: null,
      enviado_em: null,
      devolucao: null,
      marca_recusa: false,
      moeda: "CZK",
      total_atual: 1459,
    });
    expect(JSON.stringify(r)).not.toContain("releasit_cod_form");
    expect(situacaoCod(r)).toBe("aguardando_envio");
  });

  it("COD pela tag quando o gateway tem outro nome; tag de recusa e devolucao", () => {
    const r = mapearPedido(
      { ...releasit, paymentGatewayNames: ["manual"], tags: ["releasit_cod_form", "rts-1"], returnStatus: "RETURNED" },
      { storeId: LOJA, userId: USER, fuso: null }
    );
    expect(r.cod).toBe(true);
    expect(r.marca_recusa).toBe(true);
    expect(r.devolucao).toBe("RETURNED");
  });

  it("sem a migration, o upsert vai sem os campos novos", () => {
    const r = semCamposDeEnvio(mapearPedido(releasit, { storeId: LOJA, userId: USER, fuso: null }));
    for (const c of ["cod", "status_envio", "entrega", "enviado_em", "entregue_em", "devolucao", "marca_recusa"]) {
      expect(c in r, c).toBe(false);
    }
    expect(r.gateways).toEqual(["Cash on Delivery (COD)"]);
  });
});

// ---------------------------------------------------------------------------
// Formulas do Dashboard contra entrega
// ---------------------------------------------------------------------------

/** Um de cada situacao, R$ 100 cada, custo R$ 40 por unidade, + 1 online pago. */
function lojaMista(): FinOrderRow[] {
  return [
    cod(), // A: aguardando envio
    cod({ linhas: [linha("SKU-1", 1, 100)] }), // B: em transito
    cod({ entrega: "entregue", linhas: [linha("SKU-1", 1, 100)] }), // C: entregue, a receber
    cod({ recebido: 100, liquido_pago: 100, status_financeiro: "PAID", linhas: [linha("SKU-1", 1, 100)] }), // D: pago
    cod({ entrega: "falhou", linhas: [linha("SKU-1", 1, 100)] }), // E: recusado enviado
    cod({ cancelado_em: "2026-09-29T18:00:00Z" }), // F: cancelado antes do envio
    pedido(), // G: online pago
  ];
}

describe("calculo contra entrega", () => {
  it("recebido, a receber, previsto (taxa padrao), custos dos enviados e lucro", () => {
    const r = calcularFinanceiro(entrada({ pedidos: lojaMista(), gastos: [gasto(100)] }));
    const t = r.atual;
    // Realizado: so o que entrou e o que ja saiu.
    expect(t.receita).toBe(200); // D + G
    expect(t.pedidos).toBe(2);
    expect(t.cmv).toBe(200); // B, C, D, E e G: 5 x 40 (A ainda nao saiu, F cancelou)
    expect(t.devolucoes).toBe(10); // E
    expect(t.lucro).toBe(200 - 200 - 10 - 100);
    expect(t.roas).toBe(2);
    // A receber e previsto.
    expect(t.cod.abertos).toBe(3);
    expect(t.cod.recusados).toBe(1);
    expect(t.cod.cancelados).toBe(1);
    expect(t.cod.gerados).toBe(6); // A..E + G
    expect(t.cod.aReceber).toBe(300); // A, B, C
    expect(t.cod.previsto).toBeCloseTo(200 + 70 + 70 + 100); // entregue conta inteiro
    expect(t.cod.taxaEntrega).toBeCloseTo(0.7);
    expect(t.cod.custoPrevisto).toBe(240); // + A quando sair
    expect(t.cod.devolucoesPrevistas).toBeCloseTo(10 + 3 + 3); // A e B: 10 x 30%
    expect(t.cod.lucroPrevisto).toBeCloseTo(440 - 240 - 16 - 100);
    expect(t.cod.roasPrevisto).toBeCloseTo(4.4);
    expect(t.cod.roasEquilibrioPrevisto).toBeCloseTo(440 / (440 - 240 - 16));
    expect(t.cod.cpa).toBeCloseTo(100 / 6);
    expect(r.lojasContraEntrega).toEqual([LOJA]);
    expect(r.entrega).toMatchObject({ taxa: 0.7, fonte: "padrao", amostra: 0 });
  });

  it("previsto com a taxa historica da loja", () => {
    const r = calcularFinanceiro(
      entrada({ pedidos: lojaMista(), gastos: [gasto(100)], amostraEntrega: { [LOJA]: { entregues: 18, recusados: 2 } } })
    );
    expect(r.atual.cod.previsto).toBeCloseTo(200 + 90 + 90 + 100);
    expect(r.atual.cod.taxaEntrega).toBeCloseTo(0.9);
    expect(r.atual.cod.devolucoesPrevistas).toBeCloseTo(10 + 1 + 1);
    expect(r.entrega).toMatchObject({ taxa: 0.9, fonte: "historico", amostra: 20 });
    // O realizado nao muda com a taxa.
    expect(r.atual.receita).toBe(200);
    expect(r.atual.lucro).toBe(-110);
  });

  it("taxa de pagamento prevista sobre o que se espera receber", () => {
    const r = calcularFinanceiro(
      entrada({
        pedidos: lojaMista(),
        configs: [config({ contra_entrega: true, cod_taxa_entrega: 70, taxa_pct: 10, taxa_fixa: 1 })],
      })
    );
    expect(r.atual.taxas).toBeCloseTo(22); // D e G: 10% de 100 + 1
    // A e B: 11 x 70%; C: 11 x 100%.
    expect(r.atual.cod.taxasPrevistas).toBeCloseTo(22 + 7.7 + 7.7 + 11);
  });

  it("recusado que voltou ao estoque continua custando o que foi enviado", () => {
    const r = calcularFinanceiro(
      entrada({
        pedidos: [
          cod({
            entrega: "falhou",
            enviado_em: "2026-09-29T20:00:00Z",
            status_envio: "RESTOCKED",
            linhas: [linha("SKU-1", 2, 50, { qtd_atual: 0, qtd_nao_enviada: 2 })],
          }),
        ],
      })
    );
    expect(r.atual.cmv).toBe(80);
    expect(r.atual.devolucoes).toBe(10);
  });

  it("recusado sem envio nenhum (tag na confirmacao) nao custa produto nem devolucao", () => {
    const r = calcularFinanceiro(entrada({ pedidos: [cod({ marca_recusa: true })] }));
    expect(r.atual.cod.recusados).toBe(1);
    expect(r.atual.cmv).toBe(0);
    expect(r.atual.devolucoes).toBe(0);
    expect(r.atual.cod.aReceber).toBe(0);
  });

  it("valor fixo na moeda da loja vira a moeda do pedido (Releasit cria em CZK)", () => {
    const cambio: FxRateRow[] = [{ data: "2026-09-28", moeda: "CZK", por_usd: 20, fonte: "frankfurter" }];
    const r = calcularFinanceiro(
      entrada({
        lojas: [{ id: LOJA, nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com", fuso: "America/Sao_Paulo", moeda: "USD" }],
        custos: [],
        configs: [config({ contra_entrega: true, cod_custo_devolucao: 2 })],
        contas: [],
        cambio,
        moeda: "USD",
        pedidos: [
          cod({ moeda: "CZK", total_atual: 1460, linhas: [linha("X", 1, 1460, { qtd_nao_enviada: 1 })] }),
          cod({ moeda: "CZK", total_atual: 730, entrega: "falhou", linhas: [linha("X", 1, 730)] }),
        ],
      })
    );
    expect(r.atual.cod.aReceber).toBeCloseTo(73); // 1460 CZK
    expect(r.atual.devolucoes).toBeCloseTo(2); // 40 CZK de volta em USD
    expect(r.atual.cod.devolucoesPrevistas).toBeCloseTo(2 + 2 * 0.3);
  });

  it("COD de 09/10 da AmpleStep: nada enviado, previsto = recebido + 70% do a receber", () => {
    const cambio: FxRateRow[] = [{ data: "2026-10-09", moeda: "CZK", por_usd: 21.8, fonte: "frankfurter" }];
    const dia = { dia_local: "2026-10-09", processado_em: "2026-10-09T12:00:00Z" };
    const r = calcularFinanceiro(
      entrada({
        lojas: [{ id: LOJA, nome: "AmpleStep", dominio: "qkgknv-w3.myshopify.com", fuso: "America/Sao_Paulo", moeda: "USD" }],
        custos: [],
        configs: [config({ contra_entrega: true })],
        contas: [],
        cambio,
        moeda: "USD",
        intervalos: { atual: { desde: "2026-10-09", ate: "2026-10-09" }, anterior: { desde: "2026-10-08", ate: "2026-10-08" } },
        hoje: "2026-10-09",
        pedidos: [
          cod({ ...dia, moeda: "CZK", total_atual: 1459 }),
          cod({ ...dia, moeda: "CZK", total_atual: 729 }),
          cod({ ...dia, moeda: "CZK", total_atual: 729 }),
          pedido({ ...dia, moeda: "USD", total_atual: 33.47, recebido: 33.47, liquido_pago: 33.47, linhas: [linha("X", 1, 33.47, { qtd_nao_enviada: 1 })] }),
        ],
      })
    );
    const aReceber = 2917 / 21.8;
    expect(r.atual.receita).toBeCloseTo(33.47);
    expect(r.atual.cod.aReceber).toBeCloseTo(aReceber);
    expect(r.atual.cod.previsto).toBeCloseTo(33.47 + aReceber * 0.7);
    expect(r.atual.cmv).toBe(0);
    expect(r.atual.cod.abertos).toBe(3);
    expect(r.atual.cod.gerados).toBe(4);
  });
});

describe("loja online nao muda", () => {
  const online = () => [
    pedido(),
    pedido({ recebido: 100, reembolsado: 40, liquido_pago: 60 }),
    pedido({ status_financeiro: "PENDING", recebido: 0, liquido_pago: 0, linhas: [linha("SKU-1", 1, 100, { qtd_nao_enviada: 1 })] }),
    pedido({ status_financeiro: "PENDING", recebido: 0, liquido_pago: 0 }), // enviado antes de pagar
    pedido({ cancelado_em: "2026-09-29T15:00:00Z", liquido_pago: 0, reembolsado: 100, linhas: [linha("SKU-1", 1, 100, { qtd_atual: 0, qtd_nao_enviada: 1 })] }),
    pedido({ tipo: "reenvio", total_bruto: 0, recebido: 0, liquido_pago: 0 }),
  ];

  const semCod = (t: Totais) => {
    const { cod: _cod, ...resto } = t;
    void _cod;
    return resto;
  };

  it("os ajustes de contra entrega nao mexem em nenhum numero de pedido online", () => {
    const base = { pedidos: online(), gastos: [gasto(50)] };
    const antes = calcularFinanceiro(entrada({ ...base, configs: [config({ taxa_pct: 4, taxa_fixa: 0.5 })] }));
    const depois = calcularFinanceiro(
      entrada({
        ...base,
        configs: [config({ taxa_pct: 4, taxa_fixa: 0.5, contra_entrega: true, cod_taxa_entrega: 20, cod_custo_devolucao: 99 })],
        amostraEntrega: { [LOJA]: { entregues: 1, recusados: 99 } },
      })
    );
    expect(semCod(depois.atual)).toEqual(semCod(antes.atual));
    expect(depois.porDia.map((d) => d.lucro)).toEqual(antes.porDia.map((d) => d.lucro));
    expect(depois.atual.devolucoes).toBe(0);
  });

  it("sem contra entrega, o previsto e o realizado", () => {
    const r = calcularFinanceiro(entrada({ pedidos: online(), gastos: [gasto(50)], configs: [config()] }));
    expect(r.atual.cod.aReceber).toBe(0);
    expect(r.atual.cod.previsto).toBe(r.atual.receita);
    expect(r.atual.cod.lucroPrevisto).toBeCloseTo(r.atual.lucro);
    expect(r.atual.cod.gerados).toBe(r.atual.pedidos);
    expect(r.lojasContraEntrega).toEqual([]);
  });

  it("o grafico desconta a devolucao; sem ela, a conta de sempre", () => {
    const soma = { pedidos: 1, receita: 100, cmv: 40, taxas: 5, gastoMeta: 20, gastoGoogle: 0 };
    expect(derivar(soma).lucro).toBe(35);
    expect(derivar({ ...soma, devolucoes: 10 }).lucro).toBe(25);
  });
});

describe("formulario Como a loja recebe", () => {
  it("le o gravado e o padrao", () => {
    expect(formRecebimentoDe(null)).toEqual({ modo: "online", entrega: "70", devolucao: "0" });
    expect(formRecebimentoDe({ contra_entrega: true, cod_taxa_entrega: 82.5, cod_custo_devolucao: 3.2 })).toEqual({
      modo: "cod",
      entrega: "82,5",
      devolucao: "3,2",
    });
  });

  it("valida nos limites da rota; vazio vale o padrao", () => {
    expect(validarRecebimento({ modo: "cod", entrega: "", devolucao: "" })).toEqual({
      erros: {},
      corpo: { contra_entrega: true, cod_taxa_entrega: 70, cod_custo_devolucao: 0 },
    });
    const r = validarRecebimento({ modo: "online", entrega: "120", devolucao: "abc" });
    expect(r.corpo).toBeNull();
    expect(r.erros).toEqual({ entrega: "Use um número de 0 a 100", devolucao: "Não é um número" });
  });

  it("alteracao compara o valor", () => {
    const base = formRecebimentoDe(null);
    expect(recebimentoMudou({ ...base, entrega: "70,0" }, base)).toBe(false);
    expect(recebimentoMudou({ ...base, entrega: "" }, base)).toBe(false);
    expect(recebimentoMudou({ ...base, modo: "cod" }, base)).toBe(true);
    expect(recebimentoMudou({ ...base, devolucao: "1" }, base)).toBe(true);
  });
});
