import { describe, expect, it } from "vitest";
import {
  ehCustoExcedido,
  ehNegado,
  maiorAtualizado,
  mapearPedido,
  paginarPedidos,
  type NoPedidoShopify,
  type PaginaPedidos,
} from "@/lib/financeiro/mapear-pedido";
import { qtdParaCusto, receitaDoPedido } from "@/lib/financeiro/tipos";

// Fixtures montadas a mao, no formato que a query FinPedidos devolve. Elas
// provam o MAPEAMENTO, nao o comportamento real da Shopify: a primeira chamada
// a /api/jobs/financeiro/pedidos depois do deploy e a verificacao de verdade.

const din = (amount: string | number) => ({ shopMoney: { amount: String(amount) } });

function pedido(extra: Partial<NoPedidoShopify> = {}): NoPedidoShopify {
  return {
    id: "gid://shopify/Order/5551234567",
    name: "#1001",
    createdAt: "2026-10-01T15:00:00Z",
    processedAt: "2026-10-01T15:00:00Z",
    updatedAt: "2026-10-01T15:05:00Z",
    cancelledAt: null,
    test: false,
    sourceName: "web",
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    currencyCode: "USD",
    presentmentCurrencyCode: "EUR",
    paymentGatewayNames: ["shopify_payments"],
    totalPriceSet: din("59.90"),
    currentTotalPriceSet: {
      shopMoney: { amount: "59.90" },
      presentmentMoney: { amount: "55.10" },
    },
    currentTotalTaxSet: din("0.00"),
    currentTotalDutiesSet: din("0.00"),
    totalTipReceivedSet: din("0.00"),
    totalDiscountsSet: din("5.00"),
    totalShippingPriceSet: din("4.90"),
    totalReceivedSet: din("59.90"),
    totalRefundedSet: din("0.00"),
    netPaymentSet: din("59.90"),
    lineItems: {
      nodes: [
        {
          sku: " LASH-01 ",
          quantity: 2,
          currentQuantity: 2,
          unfulfilledQuantity: 2,
          originalUnitPriceSet: din("30.00"),
        },
      ],
    },
    ...extra,
  };
}

const ctx = { storeId: "loja-1", userId: "user-1", fuso: "America/Sao_Paulo" };

describe("mapearPedido", () => {
  it("venda paga simples", () => {
    const r = mapearPedido(pedido(), ctx);
    expect(r).toMatchObject({
      store_id: "loja-1",
      user_id: "user-1",
      shopify_order_id: "5551234567",
      nome: "#1001",
      tipo: "venda",
      status_financeiro: "PAID",
      origem: "web",
      moeda: "USD",
      moeda_cliente: "EUR",
      total_bruto: 59.9,
      total_atual: 59.9,
      descontos: 5,
      frete_cobrado: 4.9,
      recebido: 59.9,
      reembolsado: 0,
      liquido_pago: 59.9,
      total_cliente: 55.1,
      gateways: ["shopify_payments"],
      dia_local: "2026-10-01",
    });
    expect(r.linhas).toEqual([
      { sku: "LASH-01", qtd: 2, qtd_atual: 2, qtd_nao_enviada: 2, preco: 30 },
    ]);
    expect(receitaDoPedido(r)).toBe(59.9);
  });

  it("reembolso parcial entra com o liquido", () => {
    const r = mapearPedido(
      pedido({
        displayFinancialStatus: "PARTIALLY_REFUNDED",
        displayFulfillmentStatus: "FULFILLED",
        totalRefundedSet: din("20.00"),
        netPaymentSet: din("39.90"),
        currentTotalPriceSet: { shopMoney: { amount: "39.90" } },
        lineItems: {
          nodes: [
            {
              sku: "LASH-01",
              quantity: 2,
              currentQuantity: 1,
              unfulfilledQuantity: 0,
              originalUnitPriceSet: din("30.00"),
            },
          ],
        },
      }),
      ctx
    );
    expect(r.status_financeiro).toBe("PARTIALLY_REFUNDED");
    expect(r.liquido_pago).toBe(39.9);
    expect(r.reembolsado).toBe(20);
    expect(r.tipo).toBe("venda");
    expect(r.total_cliente).toBeNull();
    // As duas ja tinham saido: reembolso depois do envio nao devolve o custo.
    expect(qtdParaCusto(r.linhas[0])).toBe(2);
    expect(receitaDoPedido(r)).toBe(39.9);
  });

  it("draft de valor zero vira reenvio", () => {
    const r = mapearPedido(
      pedido({
        totalPriceSet: din("0.00"),
        netPaymentSet: din("0.00"),
        totalReceivedSet: din("0.00"),
        sourceName: "shopify_draft_order",
      }),
      ctx
    );
    expect(r.tipo).toBe("reenvio");
    expect(receitaDoPedido(r)).toBe(0);
  });

  it("test=true vira teste", () => {
    expect(mapearPedido(pedido({ test: true }), ctx).tipo).toBe("teste");
  });

  it("sourceName pos vira pdv", () => {
    expect(mapearPedido(pedido({ sourceName: "pos" }), ctx).tipo).toBe("pdv");
  });

  it("dia_local segue o fuso da loja", () => {
    const r = mapearPedido(
      pedido({ processedAt: "2026-10-02T02:00:00Z", createdAt: "2026-10-02T02:00:00Z" }),
      ctx
    );
    expect(r.dia_local).toBe("2026-10-01");
    expect(r.processado_em).toBe("2026-10-02T02:00:00Z");
  });

  it("sem processedAt usa createdAt; fuso nulo cai em UTC", () => {
    const r = mapearPedido(
      pedido({ processedAt: null, createdAt: "2026-10-02T02:00:00Z" }),
      { ...ctx, fuso: null }
    );
    expect(r.processado_em).toBe("2026-10-02T02:00:00Z");
    expect(r.dia_local).toBe("2026-10-02");
  });

  it("currentTotalDutiesSet null vira 0", () => {
    expect(mapearPedido(pedido({ currentTotalDutiesSet: null }), ctx).taxas_alfandega).toBe(0);
  });

  it("linha sem sku da sku null; currentQuantity ausente usa quantity", () => {
    const r = mapearPedido(
      pedido({
        displayFulfillmentStatus: "PARTIALLY_FULFILLED",
        lineItems: {
          nodes: [
            { sku: null, quantity: 3, unfulfilledQuantity: 1, originalUnitPriceSet: din("10") },
            { sku: "   ", quantity: 1, currentQuantity: null, unfulfilledQuantity: null },
          ],
        },
      }),
      ctx
    );
    expect(r.linhas).toEqual([
      { sku: null, qtd: 3, qtd_atual: 3, qtd_nao_enviada: 1, preco: 10 },
      { sku: null, qtd: 1, qtd_atual: 1, qtd_nao_enviada: 0, preco: 0 },
    ]);
  });

  it("id gid convertido para o numero", () => {
    expect(mapearPedido(pedido({ id: "gid://shopify/Order/42" }), ctx).shopify_order_id).toBe("42");
  });

  it("cancelado com displayFulfillmentStatus UNFULFILLED e unfulfilledQuantity 0 -> qtdParaCusto(linha, true) = 0", () => {
    const r = mapearPedido(
      pedido({
        cancelledAt: "2026-10-01T18:00:00Z",
        displayFinancialStatus: "REFUNDED",
        displayFulfillmentStatus: "UNFULFILLED",
        lineItems: {
          nodes: [
            {
              sku: "LASH-01",
              quantity: 2,
              currentQuantity: 0,
              unfulfilledQuantity: 0,
              originalUnitPriceSet: din("30.00"),
            },
          ],
        },
      }),
      ctx
    );
    expect(r.cancelado_em).toBe("2026-10-01T18:00:00Z");
    expect(r.linhas[0].qtd_nao_enviada).toBe(2);
    expect(qtdParaCusto(r.linhas[0], true)).toBe(0);
  });

  it("pedido parcialmente enviado usa unfulfilledQuantity", () => {
    const r = mapearPedido(
      pedido({
        displayFulfillmentStatus: "PARTIALLY_FULFILLED",
        lineItems: {
          nodes: [{ sku: "A", quantity: 3, currentQuantity: 3, unfulfilledQuantity: 1 }],
        },
      }),
      ctx
    );
    expect(r.linhas[0].qtd_nao_enviada).toBe(1);
    expect(qtdParaCusto(r.linhas[0], true)).toBe(2);
  });

  it("o objeto mapeado nao tem nenhuma chave de dado pessoal", () => {
    const r = mapearPedido(pedido(), ctx);
    const chaves = Object.keys(r).map((k) => k.toLowerCase());
    for (const proibida of ["email", "customer", "address", "phone", "endereco", "telefone"]) {
      expect(chaves.some((k) => k.includes(proibida))).toBe(false);
    }
  });
});

describe("classificacao de erro", () => {
  it("ehNegado reconhece falta de read_orders", () => {
    expect(
      ehNegado(new Error('Shopify GraphQL error: [{"message":"Access denied for orders field. Required access: `read_orders`","extensions":{"code":"ACCESS_DENIED"}}]'))
    ).toBe(true);
    expect(ehNegado(new Error("Shopify API error: 500 Internal Server Error"))).toBe(false);
    expect(ehNegado(null)).toBe(false);
  });

  it("ehCustoExcedido reconhece MAX_COST_EXCEEDED", () => {
    expect(
      ehCustoExcedido(new Error('Shopify GraphQL error: [{"extensions":{"code":"MAX_COST_EXCEEDED","cost":1980,"maxCost":1000}}]'))
    ).toBe(true);
    expect(ehCustoExcedido(new Error("THROTTLED"))).toBe(false);
  });
});

function pagina(ids: number[], proxima: string | null): PaginaPedidos {
  return {
    shop: { ianaTimezone: "America/Sao_Paulo", currencyCode: "USD" },
    orders: {
      pageInfo: { hasNextPage: proxima !== null, endCursor: proxima },
      nodes: ids.map((id) => pedido({ id: `gid://shopify/Order/${id}` })),
    },
  };
}

const erroCusto = () =>
  new Error('Shopify GraphQL error: [{"extensions":{"code":"MAX_COST_EXCEEDED"}}]');

describe("paginarPedidos", () => {
  it("segue o cursor ate hasNextPage false", async () => {
    const chamadas: Array<[string | null, number]> = [];
    const recebidas: PaginaPedidos[] = [];
    const r = await paginarPedidos({
      maxPaginas: 25,
      buscar: async (cursor, n) => {
        chamadas.push([cursor, n]);
        return cursor === null ? pagina([1, 2], "c1") : pagina([3], null);
      },
      aoReceber: async (p) => {
        recebidas.push(p);
      },
    });
    expect(chamadas).toEqual([
      [null, 8],
      ["c1", 8],
    ]);
    expect(recebidas).toHaveLength(2);
    expect(r).toEqual({ paginas: 2, terminou: true, n: 8 });
  });

  it("erro MAX_COST_EXCEEDED reduz n e repete o cursor", async () => {
    const chamadas: Array<[string | null, number]> = [];
    const r = await paginarPedidos({
      maxPaginas: 25,
      buscar: async (cursor, n) => {
        chamadas.push([cursor, n]);
        if (cursor === null) return pagina([1], "c1");
        if (n > 2) throw erroCusto();
        return pagina([2], null);
      },
      aoReceber: async () => {},
    });
    // c1 com 8 falha, c1 com 4 falha, c1 com 2 passa -- o mesmo cursor.
    expect(chamadas).toEqual([
      [null, 8],
      ["c1", 8],
      ["c1", 4],
      ["c1", 2],
    ]);
    expect(r).toEqual({ paginas: 2, terminou: true, n: 2 });
  });

  it("com n = 2 ainda falhando, lanca o erro", async () => {
    const chamadas: number[] = [];
    await expect(
      paginarPedidos({
        maxPaginas: 25,
        buscar: async (_cursor, n) => {
          chamadas.push(n);
          throw erroCusto();
        },
        aoReceber: async () => {},
      })
    ).rejects.toThrow(/MAX_COST_EXCEEDED/);
    expect(chamadas).toEqual([8, 4, 2]);
  });

  it("outro erro nao reduz n: sobe direto", async () => {
    let chamadas = 0;
    await expect(
      paginarPedidos({
        maxPaginas: 25,
        buscar: async () => {
          chamadas += 1;
          throw new Error("ACCESS_DENIED");
        },
        aoReceber: async () => {},
      })
    ).rejects.toThrow(/ACCESS_DENIED/);
    expect(chamadas).toBe(1);
  });

  it("para em maxPaginas sem marcar a carga como terminada", async () => {
    let k = 0;
    const r = await paginarPedidos({
      maxPaginas: 3,
      buscar: async () => {
        k += 1;
        return pagina([k], `c${k}`);
      },
      aoReceber: async () => {},
    });
    expect(r).toEqual({ paginas: 3, terminou: false, n: 8 });
  });

  it("deveParar interrompe antes da proxima pagina", async () => {
    let k = 0;
    const r = await paginarPedidos({
      maxPaginas: 25,
      deveParar: () => k >= 1,
      buscar: async () => {
        k += 1;
        return pagina([k], `c${k}`);
      },
      aoReceber: async () => {},
    });
    expect(r).toEqual({ paginas: 1, terminou: false, n: 8 });
  });
});

describe("maiorAtualizado", () => {
  it("nunca volta o cursor", () => {
    const nos = [pedido({ updatedAt: "2026-10-01T10:00:00Z" })];
    expect(maiorAtualizado("2026-10-01T12:00:00.000Z", nos)).toBe("2026-10-01T12:00:00.000Z");
    expect(maiorAtualizado(null, nos)).toBe("2026-10-01T10:00:00.000Z");
    expect(maiorAtualizado(null, [])).toBeNull();
  });
});
