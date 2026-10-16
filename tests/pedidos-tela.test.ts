import { describe, expect, it } from "vitest";
import { calcularFinanceiro, criarConversor, type EntradaFinanceiro } from "@/lib/financeiro/calculo";
import type { FinOrderRow, FinStoreSettingsRow, LinhaPedido, ProductCostRow } from "@/lib/financeiro/tipos";
import {
  compraDeTeste,
  estadoGoogle,
  estadoMeta,
  montarPedidos,
  origemDoPedido,
  origemNaTela,
  quandoCurto,
  statusDoPedido,
  urlNaShopify,
  valoresDoPedido,
  type EventoCompra,
  type OrigemGravada,
} from "@/lib/leitura/pedidos";
import {
  CABECALHO_CSV,
  buscaCasa,
  corEnvio,
  jornadaDoPedido,
  linhaCsv,
  passaNoFiltro,
  textoCsv,
} from "../src/app/(dashboard)/pedidos/filtros";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LOJA = "11111111-1111-4111-8111-111111111111";
const USER = "99999999-9999-4999-8999-999999999999";
const HOJE = "2026-10-04";

function linha(sku: string | null, qtd: number, preco: number, extra: Partial<LinhaPedido> = {}): LinhaPedido {
  return { sku, qtd, qtd_atual: qtd, qtd_nao_enviada: 0, preco, ...extra };
}

let seq = 1000;
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
    total_bruto: 105,
    total_atual: 105,
    imposto_atual: 0,
    taxas_alfandega: 0,
    gorjeta: 0,
    descontos: 5,
    frete_cobrado: 10,
    recebido: 105,
    reembolsado: 0,
    liquido_pago: 105,
    total_cliente: 105,
    gateways: ["shopify_payments"],
    linhas: [linha("CIL-01", 2, 50)],
    ...p,
  };
}

function custo(sku: string, custo_unitario: number, frete_unitario = 0): ProductCostRow {
  return {
    id: `c-${sku}`,
    store_id: LOJA,
    user_id: USER,
    sku,
    custo_unitario,
    frete_unitario,
    moeda: "USD",
    valido_desde: "2026-01-01",
    origem: "manual",
  };
}

const CFG: FinStoreSettingsRow = { store_id: LOJA, user_id: USER, taxa_pct: 4, taxa_fixa: 0.3, custo_padrao_pct: null };

function entrada(pedidos: FinOrderRow[], extra: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [{ id: LOJA, nome: "Lash Bestie", dominio: "qkgknv-w3.myshopify.com", fuso: "America/Sao_Paulo", moeda: "USD" }],
    pedidos,
    custos: [custo("CIL-01", 15, 5)],
    configs: [CFG],
    contas: [],
    gastos: [],
    cambio: [],
    intervalos: {
      atual: { desde: "2026-09-28", ate: HOJE },
      anterior: { desde: "2026-09-21", ate: "2026-09-27" },
    },
    moeda: "USD",
    hoje: HOJE,
    ...extra,
  };
}

function evento(order_id: string, e: Partial<EventoCompra> = {}): EventoCompra {
  return {
    store_id: LOJA,
    order_id,
    destination_id: "d-meta",
    status: "enviado",
    attempts: 1,
    last_error: null,
    created_at: "2026-10-03T15:01:00Z",
    sent_at: "2026-10-03T15:01:01Z",
    fbc: null,
    url: null,
    ...e,
  };
}

const AGORA = Date.parse("2026-10-04T12:00:00Z");

// ---------------------------------------------------------------------------
// Origem
// ---------------------------------------------------------------------------

describe("origemDoPedido", () => {
  it("sem evento de rastreamento: Sem dado, nunca Direto", () => {
    expect(origemDoPedido(null)).toMatchObject({ id: "sem_dado", rotulo: "Sem dado" });
  });

  it("click id na URL de chegada vence tudo", () => {
    expect(origemDoPedido({ url: "https://loja.com/p?gclid=Cj0K&utm_source=facebook", fbc: "fb.1.1.x" }).id).toBe("google");
    expect(origemDoPedido({ url: "https://loja.com/p?fbclid=IwAR1" }).id).toBe("meta");
    expect(origemDoPedido({ url: "https://loja.com/?wbraid=abc" }).id).toBe("google");
  });

  it("utm_source decide quando nao ha click id, com a campanha", () => {
    const o = origemDoPedido({ url: "https://loja.com/?utm_source=facebook&utm_campaign=cilios+abo" });
    expect(o).toMatchObject({ id: "meta", rotulo: "Meta Ads", campanha: "cilios abo" });
    expect(origemDoPedido({ url: "https://loja.com/?utm_source=google" }).id).toBe("google");
    expect(origemDoPedido({ url: "https://loja.com/?utm_source=klaviyo" }).id).toBe("email");
    expect(origemDoPedido({ url: "https://loja.com/?utm_source=x&utm_medium=email" }).id).toBe("email");
    expect(origemDoPedido({ url: "https://loja.com/?utm_source=tiktok" })).toMatchObject({ id: "tiktok", rotulo: "TikTok Ads" });
    expect(origemDoPedido({ url: "https://loja.com/?utm_source=pinterest" })).toMatchObject({ id: "outra", rotulo: "pinterest" });
  });

  it("clique do TikTok (ttclid) sem UTM nao vira Direto", () => {
    expect(origemDoPedido({ url: "https://loja.com/p?ttclid=E.C.P.abc" })).toMatchObject({
      id: "tiktok",
      pista: "Clique do TikTok na URL de chegada",
    });
  });

  it("so o cookie de clique do Meta: Meta", () => {
    expect(origemDoPedido({ url: "https://loja.com/", fbc: "fb.1.1700000000.IwAR" })).toMatchObject({
      id: "meta",
      pista: "Cookie de clique do Meta (fbc)",
    });
  });

  it("fbc so conta ate 7 dias antes do pedido (a janela da origem gravada)", () => {
    const pedidoEm = "2026-10-03T15:00:00Z";
    const fbc = (dias: number) => `fb.1.${Date.parse(pedidoEm) - dias * 864e5}.IwAR`;
    expect(origemDoPedido({ url: "https://loja.com/", fbc: fbc(2), pedidoEm }).id).toBe("meta");
    expect(origemDoPedido({ url: "https://loja.com/", fbc: fbc(20), pedidoEm }).id).toBe("direto");
    // A URL de chegada e da sessao: o fbclid nela vale sem janela.
    expect(origemDoPedido({ url: "https://loja.com/?fbclid=IwAR", fbc: fbc(20), pedidoEm }).id).toBe("meta");
  });

  it("evento sem sinal nenhum: Direto, e URL torta nao lanca", () => {
    expect(origemDoPedido({ url: "https://loja.com/", fbc: null }).id).toBe("direto");
    expect(origemDoPedido({ url: "https://loja.com/?utm_source=%E0%A4%A&fbcl" }).id).not.toBe("meta");
  });
});

// ---------------------------------------------------------------------------
// Estado de envio
// ---------------------------------------------------------------------------

describe("estadoMeta", () => {
  const base = {
    eventos: [] as ("enviado" | "falhou" | "pendente")[],
    aplica: true,
    metaDesde: "2026-09-01T00:00:00Z",
    processadoEm: "2026-10-03T15:00:00Z",
    agoraMs: AGORA,
  };

  it("o que a fila diz vale primeiro", () => {
    expect(estadoMeta({ ...base, eventos: ["enviado"] })).toBe("enviado");
    expect(estadoMeta({ ...base, eventos: ["enviado", "falhou"] })).toBe("falhou");
    expect(estadoMeta({ ...base, eventos: ["enviado", "pendente"] })).toBe("pendente");
    // Pixel desligado depois: o envio que existiu continua aparecendo.
    expect(estadoMeta({ ...base, metaDesde: null, eventos: ["enviado"] })).toBe("enviado");
  });

  it("loja com Meta e nenhum Purchase: vermelho", () => {
    expect(estadoMeta(base)).toBe("faltou");
  });

  it("sem pixel, pixel criado depois do pedido ou pedido que nao vira conversao: cinza", () => {
    expect(estadoMeta({ ...base, metaDesde: null })).toBe("sem_pixel");
    expect(estadoMeta({ ...base, metaDesde: "2026-10-03T16:00:00Z" })).toBe("sem_pixel");
    expect(estadoMeta({ ...base, aplica: false })).toBe("nao_se_aplica");
  });

  it("pedido de menos de 15 minutos ainda esta a caminho", () => {
    expect(estadoMeta({ ...base, processadoEm: "2026-10-04T11:50:00Z" })).toBe("aguardando");
  });

  it("Google pela tag nunca e verde nem vermelho", () => {
    expect(corEnvio("tag")).toBe("neutro");
    expect(corEnvio("enviado")).toBe("ok");
    expect(corEnvio("faltou")).toBe("err");
    expect(corEnvio("sem_pixel")).toBe("apagado");
  });
});

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

describe("statusDoPedido", () => {
  it("cancelado, reembolsado e reembolso parcial", () => {
    expect(statusDoPedido(pedido({ cancelado_em: "2026-10-03T16:00:00Z" })).id).toBe("cancelado");
    expect(statusDoPedido(pedido({ reembolsado: 105, liquido_pago: 0 })).id).toBe("reembolsado");
    expect(statusDoPedido(pedido({ reembolsado: 20, liquido_pago: 85 })).id).toBe("reembolso_parcial");
  });

  it("envio pelas quantidades nao enviadas", () => {
    expect(statusDoPedido(pedido()).id).toBe("enviado");
    expect(statusDoPedido(pedido({ linhas: [linha("A", 2, 10, { qtd_nao_enviada: 1 })] })).id).toBe("parcial");
    expect(statusDoPedido(pedido({ linhas: [linha("A", 2, 10, { qtd_nao_enviada: 2 })] })).id).toBe("nao_enviado");
    expect(statusDoPedido(pedido({ recebido: 0, liquido_pago: 0 })).id).toBe("aguardando_pagamento");
  });
});

// ---------------------------------------------------------------------------
// Lucro do pedido = conta do Dashboard
// ---------------------------------------------------------------------------

describe("valoresDoPedido", () => {
  const ctx = (custos: ProductCostRow[] = [custo("CIL-01", 15, 5)], cfg: FinStoreSettingsRow | undefined = CFG) => ({
    moeda: "USD",
    converter: criarConversor([]),
    cfg,
    custosPorSku: new Map(custos.map((c) => [c.sku, [c]])),
  });

  it("receita - produto e frete do fornecedor - taxa", () => {
    const { valores, itens } = valoresDoPedido(pedido(), ctx());
    expect(valores).toMatchObject({ produtos: 100, frete: 10, desconto: 5, valorPago: 105, receita: 105, reembolso: 0 });
    expect(valores!.cmv).toBeCloseTo(40);
    expect(valores!.taxa).toBeCloseTo(4.5);
    expect(valores!.lucro).toBeCloseTo(60.5);
    expect(itens[0]).toMatchObject({ sku: "CIL-01", qtd: 2, custoTipo: "sku" });
    expect(itens[0].custo).toBeCloseTo(40);
  });

  it("SKU sem custo nem custo padrao: lucro desconhecido na linha", () => {
    const { valores, itens } = valoresDoPedido(pedido({ linhas: [linha("NOVO", 1, 105)] }), ctx());
    expect(valores!.lucro).toBeNull();
    expect(valores!.semCusto).toBe(true);
    expect(valores!.lucroComoDashboard).toBeCloseTo(105 - 4.5);
    expect(itens[0].custoTipo).toBe("sem");
  });

  it("custo padrao da loja estima o que falta", () => {
    const { valores, itens } = valoresDoPedido(
      pedido({ linhas: [linha("NOVO", 1, 100)] }),
      ctx([], { ...CFG, custo_padrao_pct: 30 })
    );
    expect(itens[0].custoTipo).toBe("estimado");
    expect(valores!.cmv).toBeCloseTo(30);
    expect(valores!.lucro).toBeCloseTo(105 - 30 - 4.5);
  });

  it("reembolso total: valor pago - reembolso = receita, e o custo enviado fica", () => {
    const { valores } = valoresDoPedido(pedido({ reembolsado: 105, liquido_pago: 0 }), ctx());
    expect(valores).toMatchObject({ valorPago: 105, reembolso: 105, receita: 0, taxa: 0 });
    expect(valores!.lucro).toBeCloseTo(-40);
  });

  it("a soma dos pedidos bate com o Dashboard", () => {
    const pedidos = [
      pedido(),
      pedido({ linhas: [linha("NOVO", 1, 105)] }),
      pedido({ reembolsado: 105, liquido_pago: 0 }),
      pedido({ cancelado_em: "2026-10-02T10:00:00Z", recebido: 0, liquido_pago: 0, linhas: [linha("CIL-01", 1, 50, { qtd_nao_enviada: 1 })] }),
      pedido({ tipo: "reenvio", total_bruto: 0, recebido: 0, liquido_pago: 0, origem: "shopify_draft_order" }),
      pedido({ tipo: "teste" }),
    ];
    const e = entrada(pedidos);
    const dash = calcularFinanceiro(e).atual;
    const { resumo } = montarPedidos({ entrada: e, lojas: e.lojas, fuso: "America/Sao_Paulo", eventos: [], destinos: [], lojasLigadas: [], agoraMs: AGORA });
    expect(resumo.faturamento).toBeCloseTo(dash.receita);
    expect(resumo.lucro).toBeCloseTo(dash.receita - dash.cmv - dash.taxas);
    expect(resumo.pedidos).toBe(dash.pedidos);
    expect(resumo.semCusto).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Montagem
// ---------------------------------------------------------------------------

describe("montarPedidos", () => {
  const destinos = [
    { id: "d-meta", store_id: LOJA, plataforma: "meta" as const, nome: "Pixel principal", ativo: true, created_at: "2026-09-01T00:00:00Z" },
    { id: "d-google", store_id: LOJA, plataforma: "google" as const, nome: null, ativo: true, created_at: "2026-09-01T00:00:00Z" },
  ];

  it("ordem, periodo, envio, origem e link da Shopify", () => {
    const a = pedido({ processado_em: "2026-10-04T10:00:00Z", dia_local: "2026-10-04" });
    const b = pedido();
    const c = pedido({ processado_em: "2026-10-01T10:00:00Z", dia_local: "2026-10-01" });
    const fora = pedido({ dia_local: "2026-09-20" });
    const pdv = pedido({ tipo: "pdv" });
    const e = entrada([b, c, a, fora, pdv]);
    const { pedidos, resumo } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [
        evento(b.shopify_order_id, { url: "https://loja.com/?utm_source=facebook&utm_campaign=abo" }),
        evento(c.shopify_order_id, { status: "falhou", attempts: 3, last_error: "token invalido" }),
      ],
      destinos,
      lojasLigadas: [LOJA],
      agoraMs: AGORA,
    });
    expect(pedidos.map((p) => p.id)).toEqual([a.shopify_order_id, b.shopify_order_id, c.shopify_order_id]);
    const [pa, pb, pc] = pedidos;
    expect(pa.meta).toBe("faltou");
    expect(pa.origem.id).toBe("sem_dado");
    expect(pb.meta).toBe("enviado");
    expect(pb.origem).toMatchObject({ id: "meta", campanha: "abo" });
    expect(pc.meta).toBe("falhou");
    expect(pa.google).toBe("tag");
    expect(pb.urlShopify).toBe(`https://admin.shopify.com/store/qkgknv-w3/orders/${b.shopify_order_id}`);
    const din = (v: number) => `US$ ${v}`;
    expect(
      jornadaDoPedido(pb, din).some((j) => j.titulo === "Compra enviada ao Meta" && j.detalhe.includes("Pixel principal"))
    ).toBe(true);
    expect(jornadaDoPedido(pc, din).some((j) => j.tom === "err" && j.detalhe.includes("3 tentativas"))).toBe(true);
    expect(jornadaDoPedido(pa, din).some((j) => j.titulo === "Sem clique de anúncio")).toBe(false);
    expect(resumo.rastreadas).toBeCloseTo(1 / 3);
    expect(passaNoFiltro(pa, "falha")).toBe(true);
    expect(passaNoFiltro(pb, "falha")).toBe(false);
    expect(passaNoFiltro(pb, "meta")).toBe(true);
  });

  it("loja com rastreamento desligado: cinza, nunca vermelho", () => {
    const p = pedido();
    const e = entrada([p]);
    const { pedidos, resumo } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [],
      destinos,
      lojasLigadas: [],
      agoraMs: AGORA,
    });
    expect(pedidos[0].meta).toBe("sem_pixel");
    expect(pedidos[0].google).toBe("sem_pixel");
    expect(resumo.rastreadas).toBeNull();
  });
});

describe("compra de teste", () => {
  const destinos = [
    { id: "d-meta", store_id: LOJA, plataforma: "meta" as const, nome: null, ativo: true, created_at: "2026-09-01T00:00:00Z" },
    { id: "d-google", store_id: LOJA, plataforma: "google" as const, nome: null, ativo: true, created_at: "2026-09-01T00:00:00Z" },
  ];

  it("enviado sem sent_at, payload teste ou fbc TEST e teste", () => {
    expect(compraDeTeste(evento("1", { sent_at: null }))).toBe(true);
    expect(compraDeTeste(evento("1", { teste: true }))).toBe(true);
    expect(compraDeTeste(evento("1", { fbc: "fb.1.1.TESTE" }))).toBe(true);
    expect(compraDeTeste(evento("1"))).toBe(false);
    expect(compraDeTeste(evento("1", { status: "pendente", sent_at: null }))).toBe(false);
  });

  it("ponto cinza, fora de Compras rastreadas e jornada neutra", () => {
    const t = pedido();
    const real = pedido();
    const e = entrada([t, real]);
    const { pedidos, resumo } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [evento(t.shopify_order_id, { sent_at: null }), evento(real.shopify_order_id)],
      destinos,
      lojasLigadas: [LOJA],
      agoraMs: AGORA,
    });
    const pt = pedidos.find((p) => p.id === t.shopify_order_id)!;
    expect(pt.meta).toBe("teste");
    expect(pt.google).toBe("teste");
    expect(corEnvio(pt.meta)).toBe("apagado");
    expect(passaNoFiltro(pt, "falha")).toBe(false);
    expect(resumo.rastreadas).toBe(1);
    const j = jornadaDoPedido(pt, String);
    expect(j.some((x) => x.titulo === "Compra de teste: não enviada" && x.tom === "neutral")).toBe(true);
    expect(j.some((x) => x.titulo === "Compra enviada ao Meta")).toBe(false);
  });
});

describe("estadoGoogle", () => {
  const base = { googleDesde: "2026-10-01T00:00:00Z", processadoEm: "2026-10-03T15:00:00Z", aplica: true, teste: false };

  it("pela tag so com destino ativo na hora do pedido", () => {
    expect(estadoGoogle(base)).toBe("tag");
    expect(estadoGoogle({ ...base, processadoEm: "2026-09-29T15:00:00Z" })).toBe("sem_pixel");
    expect(estadoGoogle({ ...base, googleDesde: null })).toBe("sem_pixel");
  });

  it("pedido que nao vira conversao nao e 'sem pixel'", () => {
    expect(estadoGoogle({ ...base, aplica: false })).toBe("nao_se_aplica");
    expect(estadoGoogle({ ...base, teste: true })).toBe("teste");
  });
});

describe("fuso da loja", () => {
  it("hora e data no fuso da loja do pedido, nao no do relatorio", () => {
    // 23h30 em Chicago do dia 03 = 04h30 UTC do dia 04 = 01h30 em Sao Paulo.
    const p = pedido({ processado_em: "2026-10-04T04:30:00Z", dia_local: "2026-10-03" });
    const e = entrada([p], {
      lojas: [{ id: LOJA, nome: "Softnook", dominio: "kphigm-76.myshopify.com", fuso: "America/Chicago", moeda: "USD" }],
    });
    const { pedidos } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [],
      destinos: [],
      lojasLigadas: [],
      agoraMs: AGORA,
    });
    expect(pedidos[0].quando).toBe("Ontem, 23:30");
    expect(pedidos[0].quandoLongo).toBe("03/10/2026 às 23:30");
  });
});

describe("resumo e CSV", () => {
  it("Valor pago - Reembolso = Faturamento, e a soma do Faturamento bate com o KPI", () => {
    const pedidos = [pedido(), pedido({ reembolsado: 49, liquido_pago: 56 })];
    const e = entrada(pedidos);
    const { pedidos: lista, resumo } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [],
      destinos: [],
      lojasLigadas: [],
      agoraMs: AGORA,
    });
    const i = (nome: string) => CABECALHO_CSV.indexOf(nome);
    const linhas = lista.map(linhaCsv);
    const soma = linhas.reduce((s, l) => s + Number(l[i("Faturamento")]), 0);
    expect(soma).toBeCloseTo(resumo.faturamento);
    for (const l of linhas) {
      expect(Number(l[i("Valor pago")]) - Number(l[i("Reembolso")])).toBeCloseTo(Number(l[i("Faturamento")]));
    }
  });

  it("valores em centavos e texto do visitante sem formula", () => {
    const p = pedido();
    const e = entrada([p], { configs: [{ ...CFG, taxa_pct: 2.5111 }] });
    const { pedidos } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [evento(p.shopify_order_id, { url: "https://loja.com/?utm_source=%3DHYPERLINK(1)&utm_campaign=-2%2B3" })],
      destinos: [],
      lojasLigadas: [],
      agoraMs: AGORA,
    });
    const l = linhaCsv(pedidos[0]);
    const taxa = Number(l[CABECALHO_CSV.indexOf("Taxa de pagamento")]);
    expect(taxa).toBe(Math.round(taxa * 100) / 100);
    expect(l[CABECALHO_CSV.indexOf("Origem")]).toBe("'=HYPERLINK(1)");
    expect(l[CABECALHO_CSV.indexOf("Campanha")]).toBe("'-2 3");
    expect(textoCsv("@x")).toBe("'@x");
    expect(textoCsv("normal")).toBe("normal");
  });

  it("cambio aproximado e pedido sem cotacao aparecem no resumo", () => {
    const brl = pedido({ moeda: "BRL" });
    const xyz = pedido({ moeda: "XYZ" });
    const e = entrada([brl, xyz]);
    const { resumo } = montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [],
      destinos: [],
      lojasLigadas: [],
      agoraMs: AGORA,
    });
    expect(resumo.cambioAproximado).toBe(true);
    expect(resumo.semCotacao).toBe(1);
  });
});

describe("pecas de tela", () => {
  it("link do pedido no admin", () => {
    expect(urlNaShopify("kphigm-76.myshopify.com", "123")).toBe("https://admin.shopify.com/store/kphigm-76/orders/123");
    expect(urlNaShopify("loja.com.br", "123")).toBe("https://loja.com.br/admin/orders/123");
    expect(urlNaShopify("kphigm-76.myshopify.com", "gid://x")).toBeNull();
  });

  it("busca por numero do pedido ou SKU", () => {
    const p = { nome: "#1480", id: "5551234", itens: [{ sku: "CIL-01-BK" }] };
    expect(buscaCasa(p, "#1480")).toBe(true);
    expect(buscaCasa(p, "148")).toBe(true);
    expect(buscaCasa(p, "cil-01")).toBe(true);
    expect(buscaCasa(p, "outro")).toBe(false);
    expect(buscaCasa(p, "  ")).toBe(true);
  });

  it("data curta no fuso do relatorio", () => {
    expect(quandoCurto("2026-10-04T13:05:00Z", "America/Sao_Paulo", HOJE)).toBe("Hoje, 10:05");
    expect(quandoCurto("2026-10-04T02:00:00Z", "America/Sao_Paulo", HOJE)).toBe("Ontem, 23:00");
    expect(quandoCurto("2026-10-01T12:00:00Z", "America/Sao_Paulo", HOJE)).toBe("01/10, 09:00");
  });
});

// ---------------------------------------------------------------------------
// Origem gravada no pedido (fin_order_origem, 071)
// ---------------------------------------------------------------------------

describe("origem gravada no pedido", () => {
  const CAMP = "120252293723770706";
  const CONJ = "120252293728570706";
  const ANUN = "120252293729160706";

  function gravada(shopify_order_id: string, o: Partial<OrigemGravada> = {}): OrigemGravada {
    return {
      store_id: LOJA,
      shopify_order_id,
      fonte: "jornada",
      sessao: true,
      plataforma: "meta",
      clique: "meta",
      utm_source: "fb",
      utm_medium: "paid",
      utm_campaign: CAMP,
      utm_content: ANUN,
      utm_term: CONJ,
      campanha_id: CAMP,
      conjunto_id: CONJ,
      anuncio_id: ANUN,
      posicionamento: null,
      toque_em: "2026-10-03T14:50:00Z",
      pagina_entrada: "/products/blanket",
      ...o,
    };
  }

  function montar(pedidos: FinOrderRow[], extra: Partial<Parameters<typeof montarPedidos>[0]> = {}) {
    const e = entrada(pedidos);
    return montarPedidos({
      entrada: e,
      lojas: e.lojas,
      fuso: "America/Sao_Paulo",
      eventos: [],
      destinos: [],
      lojasLigadas: [],
      agoraMs: AGORA,
      ...extra,
    }).pedidos;
  }

  it("loja sem pixel do Meta: a origem gravada vale, nunca 'Sem dado'", () => {
    const p = pedido();
    const [pt] = montar([p], {
      origens: [gravada(p.shopify_order_id)],
      nomesAnuncio: { [CAMP]: "CBO Mantas" },
    });
    expect(pt.origem).toMatchObject({ id: "meta", rotulo: "Meta Ads", campanha: "CBO Mantas", pista: "Pela jornada da Shopify" });
    expect(pt.origem.detalhe).toMatchObject({
      campanha: { id: CAMP, nome: "CBO Mantas" },
      conjunto: { id: CONJ, nome: null },
      anuncio: { id: ANUN, nome: null },
      pagina: "/products/blanket",
      quando: "Ontem, 11:50",
    });
    // Jornada: nome quando ha, o fim do id quando nao.
    const [clique] = jornadaDoPedido(pt, String);
    expect(clique).toMatchObject({
      titulo: "Clique no anúncio · Meta Ads",
      detalhe: "Campanha CBO Mantas · Conjunto …570706 · Anúncio …160706",
      hora: "Ontem, 11:50",
      marca: "meta",
    });
    // Planilha: o id inteiro (e por ele que se acha no gerenciador).
    const l = linhaCsv(pt);
    expect(l[CABECALHO_CSV.indexOf("Campanha")]).toBe("CBO Mantas");
    expect(l[CABECALHO_CSV.indexOf("Conjunto")]).toBe(CONJ);
    expect(l[CABECALHO_CSV.indexOf("Anúncio")]).toBe(ANUN);
  });

  it("a gravada vence o Purchase da fila", () => {
    const p = pedido();
    const [pt] = montar([p], {
      eventos: [evento(p.shopify_order_id, { url: "https://loja.com/?utm_source=google&utm_campaign=velha" })],
      origens: [gravada(p.shopify_order_id)],
    });
    expect(pt.origem.id).toBe("meta");
  });

  it("formato Utmify sem nome do sync: o nome vem da propria UTM", () => {
    const p = pedido();
    const [pt] = montar([p], {
      origens: [
        gravada(p.shopify_order_id, {
          utm_campaign: `Escala|${CAMP}`,
          utm_medium: `Publico frio|${CONJ}`,
          utm_content: `Video 3|${ANUN}`,
          utm_term: "Instagram_Reels",
          posicionamento: "Instagram_Reels",
        }),
      ],
    });
    expect(pt.origem.detalhe).toMatchObject({
      campanha: { id: CAMP, nome: "Escala" },
      conjunto: { id: CONJ, nome: "Publico frio" },
      anuncio: { id: ANUN, nome: "Video 3" },
      posicionamento: "Instagram_Reels",
      rotuloPosicionamento: "Posicionamento",
    });
  });

  it("TikTok e Google: rotulo proprio; no Google o utm_term e a palavra-chave", () => {
    const a = pedido();
    const b = pedido();
    const [pa, pb] = montar([a, b], {
      origens: [
        gravada(a.shopify_order_id, { plataforma: "tiktok", clique: "tiktok", utm_source: "tiktok" }),
        gravada(b.shopify_order_id, {
          plataforma: "google",
          clique: "google",
          utm_source: "google",
          campanha_id: "21000000001",
          conjunto_id: null,
          anuncio_id: null,
          posicionamento: "cilios",
        }),
      ],
    });
    const porId = new Map([pa, pb].map((x) => [x.id, x]));
    expect(porId.get(a.shopify_order_id)?.origem).toMatchObject({ id: "tiktok", rotulo: "TikTok Ads" });
    expect(porId.get(b.shopify_order_id)?.origem.detalhe).toMatchObject({
      posicionamento: "cilios",
      rotuloPosicionamento: "Palavra-chave",
    });
  });

  it("so o click id: a plataforma, sem campanha", () => {
    const p = pedido();
    const [pt] = montar([p], {
      origens: [
        gravada(p.shopify_order_id, {
          fonte: "atributo",
          sessao: false,
          plataforma: "meta",
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          campanha_id: null,
          conjunto_id: null,
          anuncio_id: null,
          toque_em: null,
        }),
      ],
    });
    expect(pt.origem).toMatchObject({ id: "meta", campanha: null, pista: "Clique do Meta sem UTM" });
  });

  it("visita registrada sem anuncio: Direto, com a pagina de entrada", () => {
    const p = pedido();
    const [pt] = montar([p], {
      origens: [
        gravada(p.shopify_order_id, {
          fonte: "landing",
          plataforma: null,
          clique: null,
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          campanha_id: null,
          conjunto_id: null,
          anuncio_id: null,
          toque_em: null,
          pagina_entrada: "/collections/all",
        }),
      ],
    });
    expect(pt.origem).toMatchObject({ id: "direto", rotulo: "Direto" });
    expect(pt.origem.detalhe?.pagina).toBe("/collections/all");
  });

  it("pedido de app de COD sem visita (Releasit): 'Sem dado' com o motivo, nunca 'Direto'", () => {
    const releasit = { origem: "5690175", gateways: ["Cash on Delivery (COD)"], recebido: 0 };
    const a = pedido(releasit);
    const b = pedido(releasit);
    const [pa, pb] = montar([a, b], {
      // O Purchase do Releasit leva a URL da loja sem caminho: parecia Direto.
      eventos: [evento(a.shopify_order_id, { url: "https://loja.com/" })],
    });
    for (const pt of [pa, pb]) {
      expect(pt.origem).toMatchObject({ id: "sem_dado", pista: "Pedido de app (COD) sem visita registrada" });
    }
    // Pedido web sem origem e sem Purchase continua "Sem dado" (pedido de antes do rastreamento).
    const web = pedido();
    expect(montar([web])[0].origem).toMatchObject({ id: "sem_dado", pista: "Sem evento de rastreamento deste pedido" });
  });

  it("gravada com click id sem hora: Direto, e o clique nao vira plataforma", () => {
    const p = pedido();
    const [pt] = montar([p], {
      origens: [
        gravada(p.shopify_order_id, {
          fonte: "landing",
          plataforma: null,
          clique: "google",
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          campanha_id: null,
          conjunto_id: null,
          anuncio_id: null,
          toque_em: null,
          pagina_entrada: "/",
        }),
      ],
    });
    expect(pt.origem).toMatchObject({ id: "direto", pista: "Clique do Google sem data: não conta" });
  });

  it("gravada sem anuncio perde para o Purchase com clique (a passada dos 60 dias nao tem a identidade)", () => {
    const p = pedido();
    const direta = gravada(p.shopify_order_id, {
      fonte: "jornada",
      plataforma: null,
      clique: null,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      campanha_id: null,
      conjunto_id: null,
      anuncio_id: null,
    });
    const fbc = `fb.1.${Date.parse(p.criado_em) - 2 * 864e5}.IwAR`;
    const [comClique] = montar([p], { origens: [direta], eventos: [evento(p.shopify_order_id, { url: "https://loja.com/", fbc })] });
    expect(comClique.origem).toMatchObject({ id: "meta", pista: "Cookie de clique do Meta (fbc)" });
    // fbc fora da janela: fica a gravada (Direto).
    const velho = `fb.1.${Date.parse(p.criado_em) - 20 * 864e5}.IwAR`;
    const [semClique] = montar([p], { origens: [direta], eventos: [evento(p.shopify_order_id, { url: "https://loja.com/", fbc: velho })] });
    expect(semClique.origem).toMatchObject({ id: "direto", pista: "Visita sem clique de anúncio" });
  });

  it("gravada so com click id sem hora e sem visita (app de COD): Sem dado, nunca Direto nem Google", () => {
    const releasit = { origem: "5690175", gateways: ["Cash on Delivery (COD)"], recebido: 0 };
    const p = pedido(releasit);
    const [pt] = montar([p], {
      origens: [
        gravada(p.shopify_order_id, {
          fonte: "identidade",
          sessao: false,
          plataforma: null,
          clique: "google",
          utm_source: null,
          utm_medium: null,
          utm_campaign: null,
          utm_content: null,
          utm_term: null,
          campanha_id: null,
          conjunto_id: null,
          anuncio_id: null,
          toque_em: null,
          pagina_entrada: null,
        }),
      ],
      eventos: [evento(p.shopify_order_id, { url: "https://loja.com/" })],
    });
    expect(pt.origem).toMatchObject({ id: "sem_dado", pista: "Pedido de app (COD) sem visita registrada" });
  });

  it("origemNaTela: reenvio continua reenvio, mesmo com origem gravada", () => {
    expect(origemNaTela({ tipo: "reenvio", origem: "web", gateways: [] }, gravada("1"), null).id).toBe("reenvio");
  });
});
