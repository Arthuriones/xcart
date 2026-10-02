import { describe, expect, it } from "vitest";
import { TAXAS_BRL } from "@/lib/sales/cambio";
import {
  LIMITE_AMARELO,
  calcularFinanceiro,
  criarConversor,
  semaforoDe,
  type EntradaFinanceiro,
} from "@/lib/financeiro/calculo";
import type {
  AdAccountRow,
  AdSpendDailyRow,
  FinOrderRow,
  FinStoreSettingsRow,
  FxRateRow,
  LinhaPedido,
  ProductCostRow,
} from "@/lib/financeiro/tipos";

// ---------------------------------------------------------------------------
// Fixtures pequenas. Datas de setembro/outubro de 2026; 26 e 27/09 sao sabado
// e domingo, sem cotacao -- vale a de sexta (25/09).
// ---------------------------------------------------------------------------

const LOJA_A = "11111111-1111-4111-8111-111111111111";
const LOJA_B = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";

function fx(data: string, moeda: string, por_usd: number): FxRateRow {
  return { data, moeda, por_usd, fonte: "frankfurter" };
}

function linha(sku: string, qtd: number, preco: number, extra: Partial<LinhaPedido> = {}): LinhaPedido {
  return { sku, qtd, qtd_atual: qtd, qtd_nao_enviada: 0, preco, ...extra };
}

let seq = 0;
function pedido(p: Partial<FinOrderRow> & { dia_local: string }): FinOrderRow {
  seq += 1;
  return {
    store_id: LOJA_A,
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

function custo(p: Partial<ProductCostRow> & { sku: string; valido_desde: string }): ProductCostRow {
  seq += 1;
  return {
    id: `c${seq}`,
    store_id: LOJA_A,
    user_id: USER,
    custo_unitario: 10,
    frete_unitario: 0,
    moeda: "BRL",
    origem: "manual",
    ...p,
  };
}

function config(p: Partial<FinStoreSettingsRow> = {}): FinStoreSettingsRow {
  return { store_id: LOJA_A, user_id: USER, taxa_pct: 0, taxa_fixa: 0, custo_padrao_pct: null, ...p };
}

function conta(p: Partial<AdAccountRow> & { id: string }): AdAccountRow {
  return {
    user_id: USER,
    store_id: LOJA_A,
    plataforma: "meta",
    external_id: "1234567",
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
    sincronizado_em: "2026-10-01T00:00:00Z",
    ...p,
  };
}

const INTERVALOS = {
  atual: { desde: "2026-09-28", ate: "2026-09-30" },
  anterior: { desde: "2026-09-25", ate: "2026-09-27" },
};

function entrada(p: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [
      { id: LOJA_A, nome: "Lash Bestie", dominio: "qkgknv-w3.myshopify.com", fuso: "America/Sao_Paulo", moeda: "BRL" },
    ],
    pedidos: [],
    custos: [],
    configs: [config()],
    contas: [],
    gastos: [],
    cambio: [],
    intervalos: INTERVALOS,
    moeda: "BRL",
    hoje: "2026-09-30",
    ...p,
  };
}

// ---------------------------------------------------------------------------

describe("conversao de moeda", () => {
  const cambio = [fx("2026-09-25", "BRL", 5.3), fx("2026-09-28", "BRL", 5.2), fx("2026-09-28", "EUR", 0.9)];
  const conv = criarConversor(cambio);

  it("USD -> BRL pela cotacao do dia", () => {
    expect(conv(100, "USD", "BRL", "2026-09-28")).toEqual({ valor: 520, aproximado: false });
  });

  it("mesma moeda devolve o valor", () => {
    expect(conv(42, "BRL", "BRL", "2026-09-28")).toEqual({ valor: 42, aproximado: false });
  });

  it("fim de semana usa a cotacao de sexta", () => {
    const r = conv(100, "USD", "BRL", "2026-09-27");
    expect(r?.aproximado).toBe(false);
    expect(r?.valor).toBeCloseTo(530, 6);
  });

  it("cruzada passa pelo dolar", () => {
    // 90 EUR = 100 USD = 520 BRL
    expect(conv(90, "EUR", "BRL", "2026-09-28")?.valor).toBeCloseTo(520, 6);
  });

  it("cotacao com mais de 10 dias nao vale; cai na tabela fixa", () => {
    const r = conv(100, "USD", "BRL", "2026-10-20");
    expect(r?.aproximado).toBe(true);
  });

  it("sem cotacao cai em TAXAS_BRL com aproximado=true", () => {
    const r = criarConversor([])(100, "USD", "BRL", "2026-09-28");
    expect(r?.aproximado).toBe(true);
    expect(r?.valor).toBeCloseTo((100 * TAXAS_BRL.USD) / TAXAS_BRL.BRL, 6);
  });

  it("moeda desconhecida sem cotacao devolve null", () => {
    expect(criarConversor([])(100, "XYZ", "BRL", "2026-09-28")).toBeNull();
  });

  it("moeda desconhecida vai para moedasSemCotacao e nao soma", () => {
    const r = calcularFinanceiro(
      entrada({
        pedidos: [
          pedido({ dia_local: "2026-09-29", liquido_pago: 100, recebido: 100 }),
          pedido({ dia_local: "2026-09-29", moeda: "XYZ", liquido_pago: 999999, recebido: 999999 }),
        ],
      })
    );
    expect(r.atual.receita).toBe(100);
    expect(r.atual.pedidos).toBe(1);
    expect(r.avisos.moedasSemCotacao).toEqual(["XYZ"]);
  });

  it("valor convertido pela tabela fixa liga o aviso de cambio aproximado", () => {
    const r = calcularFinanceiro(
      entrada({ moeda: "USD", pedidos: [pedido({ dia_local: "2026-09-29" })] })
    );
    expect(r.avisos.cambioAproximado).toBe(true);
    expect(r.atual.receita).toBeCloseTo((100 * TAXAS_BRL.BRL) / TAXAS_BRL.USD, 6);
  });
});

describe("custo do produto", () => {
  const versoes = [
    custo({ sku: "CIL-01", valido_desde: "2026-09-01", custo_unitario: 10 }),
    custo({ sku: "CIL-01", valido_desde: "2026-10-01", custo_unitario: 20 }),
  ];

  it("versao de setembro vale para pedido de setembro", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: versoes,
        pedidos: [pedido({ dia_local: "2026-09-29", linhas: [linha("CIL-01", 2, 50)] })],
      })
    );
    expect(r.atual.cmv).toBe(20);
  });

  it("versao nova de outubro nao altera pedido de setembro", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [...versoes, custo({ sku: "CIL-01", valido_desde: "2026-10-15", custo_unitario: 99 })],
        pedidos: [pedido({ dia_local: "2026-09-30", linhas: [linha("CIL-01", 1, 50)] })],
      })
    );
    expect(r.atual.cmv).toBe(10);
  });

  it("SKU so com versao futura vale para pedido antigo (retroativo)", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-02", valido_desde: "2026-10-01", custo_unitario: 7, frete_unitario: 3 })],
        pedidos: [pedido({ dia_local: "2026-09-28", linhas: [linha("CIL-02", 1, 50)] })],
      })
    );
    expect(r.atual.cmv).toBe(10);
    expect(r.atual.coberturaCusto).toBe(1);
  });

  it("custo em CNY convertido para a moeda da loja", () => {
    // 7 CNY = 1 USD = 5 BRL; 14 CNY por unidade -> R$ 10
    const r = calcularFinanceiro(
      entrada({
        cambio: [fx("2026-09-29", "CNY", 7), fx("2026-09-29", "BRL", 5)],
        custos: [custo({ sku: "CIL-03", valido_desde: "2026-09-01", custo_unitario: 12, frete_unitario: 2, moeda: "CNY" })],
        pedidos: [pedido({ dia_local: "2026-09-29", linhas: [linha("CIL-03", 1, 50)] })],
      })
    );
    expect(r.atual.cmv).toBeCloseTo(10, 6);
    expect(r.avisos.cambioAproximado).toBe(false);
  });

  it("custo_padrao_pct usado quando falta custo", () => {
    const r = calcularFinanceiro(
      entrada({
        configs: [config({ custo_padrao_pct: 30 })],
        pedidos: [pedido({ dia_local: "2026-09-29", linhas: [linha("SEM-CUSTO", 2, 50)] })],
      })
    );
    expect(r.atual.cmv).toBe(30);
    expect(r.avisos.lojasSemCustoPadraoComFalta).toEqual([]);
    expect(r.atual.coberturaCusto).toBe(0);
  });

  it("sem custo e sem custo padrao: loja entra no aviso", () => {
    const r = calcularFinanceiro(
      entrada({ pedidos: [pedido({ dia_local: "2026-09-29", linhas: [linha("SEM-CUSTO", 1, 50)] })] })
    );
    expect(r.atual.cmv).toBe(0);
    expect(r.avisos.lojasSemCustoPadraoComFalta).toEqual(["Lash Bestie · qkgknv-w3"]);
  });

  it("cobertura calculada sobre o valor vendido", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "COM", valido_desde: "2026-09-01" })],
        pedidos: [
          pedido({ dia_local: "2026-09-29", linhas: [linha("COM", 3, 50), linha("SEM", 1, 50)] }),
        ],
      })
    );
    // 150 com custo, 50 sem -> 75%
    expect(r.atual.coberturaCusto).toBeCloseTo(0.75, 6);
  });

  it("cancelado sem envio nao custa nada", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-01", valido_desde: "2026-09-01" })],
        pedidos: [
          pedido({
            dia_local: "2026-09-29",
            cancelado_em: "2026-09-29T15:00:00Z",
            liquido_pago: 0,
            reembolsado: 100,
            linhas: [linha("CIL-01", 2, 50, { qtd_atual: 0, qtd_nao_enviada: 2 })],
          }),
        ],
      })
    );
    expect(r.atual.cmv).toBe(0);
    expect(r.atual.receita).toBe(0);
    expect(r.atual.pedidos).toBe(0);
  });

  it("PIX/boleto pendente, nada recebido e nada enviado: sem custo", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-01", valido_desde: "2026-09-01", custo_unitario: 30, frete_unitario: 10 })],
        pedidos: [
          pedido({
            dia_local: "2026-09-29",
            status_financeiro: "pending",
            recebido: 0,
            liquido_pago: 0,
            linhas: [linha("CIL-01", 2, 50, { qtd_nao_enviada: 2 })],
          }),
        ],
      })
    );
    expect(r.atual.cmv).toBe(0);
    expect(r.atual.receita).toBe(0);
    expect(r.atual.coberturaCusto).toBeNull();
  });

  it("COD enviado antes de receber: custo cheio", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-01", valido_desde: "2026-09-01", custo_unitario: 30, frete_unitario: 10 })],
        pedidos: [
          pedido({
            dia_local: "2026-09-29",
            status_financeiro: "pending",
            recebido: 0,
            liquido_pago: 0,
            linhas: [linha("CIL-01", 2, 50, { qtd_nao_enviada: 0 })],
          }),
        ],
      })
    );
    expect(r.atual.cmv).toBe(80);
  });

  it("pago, enviado e reembolsado depois: custo cheio", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-01", valido_desde: "2026-09-01", custo_unitario: 30, frete_unitario: 10 })],
        pedidos: [
          pedido({
            dia_local: "2026-09-29",
            recebido: 100,
            reembolsado: 100,
            liquido_pago: 0,
            linhas: [linha("CIL-01", 2, 50, { qtd_atual: 0, qtd_nao_enviada: 0 })],
          }),
        ],
      })
    );
    expect(r.atual.cmv).toBe(80);
  });
});

describe("pedidos", () => {
  it("reenvio tem custo e receita 0", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-01", valido_desde: "2026-09-01" })],
        pedidos: [
          pedido({
            dia_local: "2026-09-29",
            tipo: "reenvio",
            liquido_pago: 0,
            recebido: 0,
            linhas: [linha("CIL-01", 1, 50)],
          }),
        ],
      })
    );
    expect(r.atual.receita).toBe(0);
    expect(r.atual.cmv).toBe(10);
    expect(r.atual.reenvios).toBe(1);
    expect(r.atual.pedidos).toBe(0);
  });

  it("reembolso parcial entra com o liquido", () => {
    const r = calcularFinanceiro(
      entrada({
        pedidos: [
          pedido({ dia_local: "2026-09-29", recebido: 100, reembolsado: 30, liquido_pago: 70, imposto_atual: 5 }),
        ],
      })
    );
    expect(r.atual.receita).toBe(65);
    expect(r.atual.pedidos).toBe(1);
  });

  it("pedido 'teste' e PDV ignorados", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "CIL-01", valido_desde: "2026-09-01" })],
        pedidos: [
          pedido({ dia_local: "2026-09-29", tipo: "teste", linhas: [linha("CIL-01", 1, 50)] }),
          pedido({ dia_local: "2026-09-29", tipo: "pdv", linhas: [linha("CIL-01", 1, 50)] }),
        ],
      })
    );
    expect(r.atual.receita).toBe(0);
    expect(r.atual.cmv).toBe(0);
    expect(r.atual.pedidos).toBe(0);
  });

  it("taxa = % do recebido + fixo, so em pedido que conta", () => {
    const r = calcularFinanceiro(
      entrada({
        configs: [config({ taxa_pct: 4, taxa_fixa: 0.5 })],
        pedidos: [
          pedido({ dia_local: "2026-09-29", recebido: 200, liquido_pago: 200 }),
          // pendente: nada recebido, nao conta
          pedido({ dia_local: "2026-09-29", recebido: 0, liquido_pago: 0, status_financeiro: "pending" }),
        ],
      })
    );
    expect(r.atual.taxas).toBeCloseTo(8.5, 6);
    expect(r.avisos.lojasSemTaxa).toEqual([]);
  });

  it("loja sem config com pedido entra em lojasSemTaxa", () => {
    const r = calcularFinanceiro(
      entrada({ configs: [], pedidos: [pedido({ dia_local: "2026-09-29" })] })
    );
    expect(r.atual.taxas).toBe(0);
    expect(r.avisos.lojasSemTaxa).toEqual(["Lash Bestie · qkgknv-w3"]);
  });

  it("numeric que chega como string vira numero", () => {
    const r = calcularFinanceiro(
      entrada({
        configs: [config({ taxa_pct: "10" as unknown as number })],
        pedidos: [pedido({ dia_local: "2026-09-29", recebido: "100.00" as unknown as number })],
      })
    );
    expect(r.atual.taxas).toBeCloseTo(10, 6);
  });
});

describe("gasto e derivados", () => {
  const META = conta({ id: "acc-meta", plataforma: "meta" });

  it("conta EUR convertida", () => {
    const r = calcularFinanceiro(
      entrada({
        cambio: [fx("2026-09-29", "EUR", 0.9), fx("2026-09-29", "BRL", 5.4)],
        contas: [conta({ id: "acc-eur", moeda: "EUR" })],
        gastos: [gasto({ ad_account_id: "acc-eur", data: "2026-09-29", gasto: 90, moeda: "EUR" })],
      })
    );
    expect(r.atual.gastoMeta).toBeCloseTo(540, 6);
  });

  it("conta sem loja ignorada", () => {
    const r = calcularFinanceiro(
      entrada({
        contas: [conta({ id: "acc-solta", store_id: null })],
        gastos: [gasto({ ad_account_id: "acc-solta", data: "2026-09-29", gasto: 50 })],
      })
    );
    expect(r.atual.gasto).toBe(0);
  });

  it("nivel campanha nao soma por cima do nivel conta", () => {
    const r = calcularFinanceiro(
      entrada({
        contas: [META],
        gastos: [
          gasto({ ad_account_id: "acc-meta", data: "2026-09-29", gasto: 50 }),
          gasto({ ad_account_id: "acc-meta", data: "2026-09-29", gasto: 30, nivel: "campanha", campanha_id: "c1" }),
        ],
      })
    );
    expect(r.atual.gastoMeta).toBe(50);
  });

  it("google vai para gastoGoogle", () => {
    const r = calcularFinanceiro(
      entrada({
        contas: [conta({ id: "acc-g", plataforma: "google", fonte: "script" })],
        gastos: [gasto({ ad_account_id: "acc-g", data: "2026-09-29", gasto: 40, fonte: "script" })],
      })
    );
    expect(r.atual.gastoGoogle).toBe(40);
    expect(r.atual.gastoMeta).toBe(0);
    expect(r.atual.gasto).toBe(40);
  });

  it("roas null sem gasto", () => {
    const r = calcularFinanceiro(entrada({ pedidos: [pedido({ dia_local: "2026-09-29" })] }));
    expect(r.atual.roas).toBeNull();
    expect(r.atual.cpa).toBeNull();
    expect(r.atual.ticket).toBe(100);
    expect(r.atual.margem).toBe(1);
  });

  it("derivados batem com as formulas", () => {
    const r = calcularFinanceiro(
      entrada({
        custos: [custo({ sku: "X", valido_desde: "2026-09-01", custo_unitario: 30 })],
        configs: [config({ taxa_pct: 0, taxa_fixa: 10 })],
        contas: [META],
        pedidos: [
          pedido({ dia_local: "2026-09-29", linhas: [linha("X", 1, 100)] }),
          pedido({ dia_local: "2026-09-30", linhas: [linha("X", 1, 100)] }),
        ],
        gastos: [gasto({ ad_account_id: "acc-meta", data: "2026-09-29", gasto: 80 })],
      })
    );
    const t = r.atual;
    expect(t.receita).toBe(200);
    expect(t.cmv).toBe(60);
    expect(t.taxas).toBe(20);
    expect(t.lucro).toBe(40);
    expect(t.roas).toBe(2.5);
    expect(t.roasEquilibrio).toBeCloseTo(200 / 120, 6);
    expect(t.margem).toBe(0.2);
    expect(t.cpa).toBe(40);
  });

  it("semaforo nos quatro casos", () => {
    expect(semaforoDe({ gasto: 0, lucro: 100, roas: null, roasEquilibrio: 2 })).toBe("cinza");
    expect(semaforoDe({ gasto: 100, lucro: -1, roas: 1, roasEquilibrio: 2 })).toBe("vermelho");
    expect(
      semaforoDe({ gasto: 100, lucro: 10, roas: LIMITE_AMARELO * 2 - 0.01, roasEquilibrio: 2 })
    ).toBe("amarelo");
    expect(semaforoDe({ gasto: 100, lucro: 50, roas: 3, roasEquilibrio: 2 })).toBe("verde");
  });

  it("semaforo por loja no resultado", () => {
    const r = calcularFinanceiro(
      entrada({
        lojas: [
          { id: LOJA_A, nome: "A", dominio: "a.myshopify.com", fuso: null, moeda: "BRL" },
          { id: LOJA_B, nome: "B", dominio: "b.myshopify.com", fuso: null, moeda: "BRL" },
        ],
        configs: [config(), config({ store_id: LOJA_B })],
        contas: [conta({ id: "acc-b", store_id: LOJA_B })],
        pedidos: [pedido({ dia_local: "2026-09-29" })],
        gastos: [gasto({ ad_account_id: "acc-b", data: "2026-09-29", gasto: 10 })],
      })
    );
    expect(r.porLoja.map((l) => [l.storeId, l.semaforo])).toEqual([
      [LOJA_A, "cinza"],
      [LOJA_B, "vermelho"],
    ]);
  });

  it("atual vs anterior separados pela data", () => {
    const r = calcularFinanceiro(
      entrada({
        contas: [META],
        pedidos: [
          pedido({ dia_local: "2026-09-29", liquido_pago: 100 }),
          pedido({ dia_local: "2026-09-26", liquido_pago: 40 }),
          pedido({ dia_local: "2026-09-10", liquido_pago: 999 }),
        ],
        gastos: [
          gasto({ ad_account_id: "acc-meta", data: "2026-09-30", gasto: 20 }),
          gasto({ ad_account_id: "acc-meta", data: "2026-09-25", gasto: 15 }),
        ],
      })
    );
    expect(r.atual.receita).toBe(100);
    expect(r.atual.gasto).toBe(20);
    expect(r.anterior.receita).toBe(40);
    expect(r.anterior.gasto).toBe(15);
  });

  it("porDia cobre todos os dias com zeros e marca hoje como parcial", () => {
    const r = calcularFinanceiro(entrada({ pedidos: [pedido({ dia_local: "2026-09-29" })] }));
    expect(r.porDia.map((d) => d.dia)).toEqual(["2026-09-30", "2026-09-29", "2026-09-28"]);
    expect(r.porDia.map((d) => d.parcial)).toEqual([true, false, false]);
    expect(r.porDia.map((d) => d.receita)).toEqual([0, 100, 0]);
  });

  it("fusos diferentes entre conta e loja viram aviso", () => {
    const r = calcularFinanceiro(
      entrada({ contas: [conta({ id: "acc-la", fuso: "America/Los_Angeles", nome: "Meta EUA" })] })
    );
    expect(r.avisos.fusosDiferentes).toEqual([
      {
        conta: "Meta EUA",
        fusoConta: "America/Los_Angeles",
        loja: "Lash Bestie · qkgknv-w3",
        fusoLoja: "America/Sao_Paulo",
      },
    ]);
  });
});
