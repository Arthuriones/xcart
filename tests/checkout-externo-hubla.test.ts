import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ID_TESTE,
  assinarHubla,
  autenticarHubla,
  exemploHubla,
  hubla,
  lerTodosHubla,
} from "@/lib/checkouts-externos/plataformas/hubla";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import type { EventoNormalizado } from "@/lib/checkouts-externos/plataformas";
import {
  receberEvento,
  type CheckoutParaReceber,
  type MarcaCheckout,
  type PedidoGravado,
  type RepositorioCheckout,
} from "@/lib/checkouts-externos/receber";
import { vidDoRastreio, type DestinoDoCheckout, type EnvioGravado, type EnvioNovo, type RastreioCheckout } from "@/lib/checkouts-externos/compra";
import { vendaDoPedidoExterno } from "@/lib/checkouts-externos/notificar";
import { estadoDaVenda } from "@/lib/checkouts-externos/venda";
import {
  HOST_DO_CHECKOUT,
  MOEDA_PADRAO,
  PLATAFORMAS_CHECKOUT,
  modeloDaPlataforma,
  rastreiaCompra,
  rotuloDoEvento,
  scriptDaPonteDoCheckout,
  usaSegredo,
} from "@/lib/checkouts-externos/tipos";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import type { EventoTiktok } from "@/lib/tracking/tiktok-evento";

// A Hubla: o segundo checkout de VENDA PROPRIA. O webhook de fatura (em
// centavos, uma fatura por aviso no modo "Integracao recomendada") vira um
// pedido com faturamento, taxa, comissoes e liquido; a origem e o token fixo
// do x-hubla-token; o sandbox e o nosso teste nunca viram pedido; o
// status_updated so vale para o que nao tem evento proprio; os avisos
// fabricados do modo de compatibilidade nao entram; renovacao entra no lucro
// mas nao vai ao Meta/TikTok; dado pessoal do comprador nunca e gravado.

const AGORA = new Date("2026-10-21T15:00:00.000Z");
const TOKEN = "hbl_9f1c4e2a7b3d4c8ea1f52d6b8e0c3a71";
const FATURA = "7614b1bb-1d1a-43ba-890c-50d74216eb56";

const CRIADA = "2026-10-21T14:35:22.671Z";
const PAGA = "2026-10-21T14:35:33.512Z";

/** O que nunca pode aparecer em nada que o xcart grava ou loga. */
const DADOS_DO_COMPRADOR = ["Ana", "Souza", "ana.souza", "provedor.com.br", "5534988887777", "39053344705", "Av. Paulista", "01310-200", "Bela Vista"];

type Dados = Record<string, unknown>;

/** A fatura do exemplo da doc (R$ 341,00 em Pix, principal + 2 order bumps), com dado pessoal ficticio. */
function fatura(extra: Dados = {}): Dados {
  return {
    id: FATURA,
    orderId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    parentInvoiceId: null,
    childInvoiceIds: [`${FATURA}-offer-1`, `${FATURA}-offer-2`, `${FATURA}-offer-3`],
    subscriptionId: "d7ab5027-5bca-476c-ac29-68f1359ee6ca",
    payerId: "J0kmLJmCj1TO4m3pqW0GDlEjROQ2",
    sellerId: "onVILjt4hEhXIdCrvCXBUpcBuvk2",
    payer: {
      id: "J0kmLJmCj1TO4m3pqW0GDlEjROQ2",
      firstName: "Ana",
      lastName: "Souza",
      document: "39053344705",
      email: "Ana.Souza@provedor.com.br",
      phone: "+5534988887777",
    },
    installments: 1,
    paymentMethod: "pix",
    currency: "BRL",
    type: "sell",
    status: "paid",
    statusAt: [
      { status: "unpaid", when: CRIADA },
      { status: "paid", when: PAGA },
    ],
    amount: {
      subtotalCents: 34100,
      subtotal: 341,
      discountCents: 0,
      discount: 0,
      prorataCents: 0,
      prorata: 0,
      installmentFeeCents: 0,
      installmentFee: 0,
      totalCents: 34100,
      total: 341,
    },
    receivers: [
      { id: "platform-identity", name: "Hubla Tecnologia LTDA", role: "platform", paysForFees: false, totalCents: 7843, currency: "BRL" },
      { id: "onVILjt4hEhXIdCrvCXBUpcBuvk2", name: "Vendedor", role: "seller", paysForFees: true, totalCents: 26257, currency: "BRL" },
    ],
    paymentSession: {
      ip: "220.172.165.140",
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/123.0.0.0 Safari/537.36",
      url: "https://pay.hub.la/inAVzweR0QYw5y03K5mq?utm_source=FB&email=ana.souza%40provedor.com.br&sck=lista-quente",
      cookies: {
        fbp: "fb.1.1761057322671.1234567890",
        fbclid: "IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
        gclid: "Cj0KCQjw1a6CBhCXARIsAGP1kWg9xY2vN5mP6qR8sT0uV2wX4yZ6aB8cD0eF",
        hbId: "hb_7f3a9c2e1b4d8e6a",
        ttclid: "E.C.P.1234567890abcdef1234567890abcdef",
        ttp: "01HN8K2M3P4Q5R6S7T8U9V0W1X",
      },
      utm: { source: "FB", medium: "120211234567890123", campaign: "Campanha X|120219876543210987", content: "Anuncio Y|120215555555555555", term: "Instagram_Feed" },
      params: { SCK: "lista-quente" },
    },
    billingAddress: {
      countryCode: "BR",
      state: "São Paulo",
      city: "São Paulo",
      neighborhood: "Bela Vista",
      street: "Av. Paulista",
      number: "1578",
      postalCode: "01310-200",
    },
    saleDate: CRIADA,
    dueDate: "2026-10-21T14:35:16.350Z",
    createdAt: CRIADA,
    modifiedAt: PAGA,
    version: 6,
    ...extra,
  };
}

/** A fatura em aberto (o Pix acabou de ser gerado). */
function aberta(extra: Dados = {}): Dados {
  return fatura({ status: "unpaid", statusAt: [{ status: "unpaid", when: CRIADA }], modifiedAt: CRIADA, ...extra });
}

/** O aviso inteiro: { type, event, version }, no modo "Integracao recomendada". */
function aviso(type: string, invoice: Dados, event: Dados = {}): Dados {
  return {
    type,
    event: {
      product: { id: "inAVzweR0QYw5y03K5mq", name: "Integrações com Webhook 2.0" },
      products: [
        {
          id: "9f1c4e2a-7b3d-4c8e-a1f5-2d6b8e0c3a71",
          name: "Integrações com Webhook 2.0 - Anual",
          offers: [{ id: "inAVzweR0QYw5y03K5mq", name: "Principal", amountCents: 19700, isOrderBump: false }],
        },
        {
          id: "4a7d9c1e-2f5b-48a3-9c6d-7e1b3f8a5d02",
          name: "Templates de Automação",
          offers: [{ id: "bmpTPL1aX9Kq2wRt4Ns7", name: "Oferta única", amountCents: 4700, isOrderBump: true }],
        },
      ],
      hasOrderBump: true,
      invoice,
      subscriptions: [{ id: "d7ab5027-5bca-476c-ac29-68f1359ee6ca", type: "recurring", billingCycleMonths: 12, quantity: 1 }],
      user: { id: "J0kmLJmCj1TO4m3pqW0GDlEjROQ2", firstName: "Ana", lastName: "Souza", document: "39053344705", email: "ana.souza@provedor.com.br", phone: "+5534988887777" },
      ...event,
    },
    version: "2.0.0",
  };
}

function headersDe(extra: Record<string, string> = {}): Headers {
  return new Headers({ "x-hubla-token": TOKEN, "x-hubla-sandbox": "FALSE", "x-hubla-delivery-mode": "standard", ...extra });
}

function ler(c: unknown, headers: Headers = headersDe()): EventoNormalizado[] {
  const r = lerTodosHubla(c, AGORA, headers);
  if (!r.ok) throw new Error(r.erro);
  return r.eventos;
}

function lerUm(c: unknown, headers?: Headers): EventoNormalizado {
  const evs = ler(c, headers);
  expect(evs).toHaveLength(1);
  return evs[0];
}

// ---------------------------------------------------------------------------
// O adaptador
// ---------------------------------------------------------------------------

describe("lerTodosHubla: a fatura vira o pedido", () => {
  it("pagamento aprovado: faturamento, taxa e liquido em centavos -> reais, datas da transicao e a sessao do pagamento", () => {
    const ev = lerUm(aviso("invoice.payment_succeeded", fatura()));
    expect(ev).toMatchObject({
      evento: "invoice.payment_succeeded",
      dataEvento: PAGA,
      pedidoId: FATURA,
      pedido: { status: "paid", metodo: "pix", produto: "Integrações com Webhook 2.0", pais: "BR", moeda: "BRL", valor: 341, criadoEm: CRIADA },
      receita: { valor: 262.57, moeda: "BRL", situacao: "pago", statusOriginal: "paid" },
      conta: null,
      teste: false,
      venda: {
        taxa: 78.43,
        comissoes: 0,
        referencia: null,
        grupo: FATURA,
        // O id da oferta principal: o mesmo nos dois modos de envio.
        produtoId: "inAVzweR0QYw5y03K5mq",
        ofertaTipo: "main",
        venceEm: null,
        cobrancaGerada: false,
        recorrencia: false,
      },
    });
    expect(ev.rastreio).toMatchObject({
      utm: { source: "FB", medium: "120211234567890123", campaign: "Campanha X|120219876543210987" },
      sck: "lista-quente",
      fbp: "fb.1.1761057322671.1234567890",
      fbclid: "IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
      ttclid: "E.C.P.1234567890abcdef1234567890abcdef",
      ttp: "01HN8K2M3P4Q5R6S7T8U9V0W1X",
      ip: "220.172.165.140",
      // Sem a query: o pre-preenchimento leva o e-mail.
      checkoutUrl: "https://pay.hub.la/inAVzweR0QYw5y03K5mq",
    });
    expect(ev.rastreio?.userAgent).toMatch(/^Mozilla\/5\.0/);
  });

  it("fatura criada no Pix: pendente na data da criacao, cobranca gerada; o dueDate antes da criacao nao vira vencimento", () => {
    const ev = lerUm(aviso("invoice.created", aberta()));
    expect(ev).toMatchObject({ evento: "invoice.created", dataEvento: CRIADA, receita: { situacao: "pendente" } });
    expect(ev.venda).toMatchObject({ cobrancaGerada: true, venceEm: null });
    // Sem vence_em, a janela padrao do Pix (1 dia) decide: segue aguardando.
    expect(estadoDaVenda({ situacao: "pendente", criado_em: CRIADA, metodo_pagamento: "pix", vence_em: null }, AGORA.getTime())).toBe("aguardando");
  });

  it("boleto: bank_slip vira 'boleto' (o nome de venda.ts) e o vencimento depois da criacao fica", () => {
    const ev = lerUm(aviso("invoice.created", aberta({ paymentMethod: "bank_slip", dueDate: "2026-10-24T23:59:59.000Z" })));
    expect(ev.pedido.metodo).toBe("boleto");
    expect(ev.venda).toMatchObject({ cobrancaGerada: true, venceEm: "2026-10-24T23:59:59.000Z" });
  });

  it("fatura criada no cartao: 200 sem gravar (a recusa no checkout nao tem evento; o pedido nasce no pagamento)", () => {
    expect(lerTodosHubla(aviso("invoice.created", aberta({ paymentMethod: "credit_card" })), AGORA, headersDe())).toEqual({
      ok: true,
      eventos: [],
      ignorado: "invoice.created:credit_card",
    });
    // O created atrasado que ja chega pago entra (vale o status).
    expect(lerUm(aviso("invoice.created", fatura({ paymentMethod: "credit_card" }))).receita.situacao).toBe("pago");
  });

  it("saleDate so vale sem o createdAt: a renovacao com saleDate antigo entra", () => {
    const ev = lerUm(aviso("invoice.payment_succeeded", fatura({ type: "renewal", saleDate: "2025-01-10T12:00:00.000Z" })));
    expect(ev.pedido.criadoEm).toBe(CRIADA);
    expect(lerUm(aviso("invoice.payment_succeeded", fatura({ createdAt: null }))).pedido.criadoEm).toBe(CRIADA);
  });

  it("invoice.created atrasado que ja chega pago: vale o status, na hora do pagamento", () => {
    const ev = lerUm(aviso("invoice.created", fatura()));
    expect(ev).toMatchObject({ evento: "invoice.created", dataEvento: PAGA, receita: { situacao: "pago" } });
  });

  it("expirada, pagamento falhou e reembolso", () => {
    const vencida = "2026-10-21T14:50:00.000Z";
    const expirada = lerUm(aviso("invoice.expired", aberta({ status: "overdue", statusAt: [{ status: "unpaid", when: CRIADA }, { status: "overdue", when: vencida }] })));
    expect(expirada).toMatchObject({ dataEvento: vencida, receita: { situacao: "expirado" } });

    const falhou = lerUm(aviso("invoice.payment_failed", aberta({ paymentMethod: "credit_card", status: "overdue", statusAt: [{ status: "overdue", when: vencida }] })));
    expect(falhou.receita.situacao).toBe("expirado");

    const devolvida = "2026-10-21T14:55:00.000Z";
    const reembolso = lerUm(
      aviso("invoice.refunded", fatura({ status: "refunded", statusAt: [{ status: "unpaid", when: CRIADA }, { status: "paid", when: PAGA }, { status: "refunded", when: devolvida }] }))
    );
    expect(reembolso).toMatchObject({ dataEvento: devolvida, receita: { situacao: "revertido" }, venda: { reembolsadoEm: devolvida, chargebackEm: null } });
  });

  it("status_updated: so chargeback, disputa e cancelamento, com o status no nome (a trava e por evento)", () => {
    const quando = "2026-10-21T14:58:00.000Z";
    const com = (status: string) => fatura({ status, statusAt: [{ status: "paid", when: PAGA }, { status, when: quando }] });

    const cb = lerUm(aviso("invoice.status_updated", com("chargeback")));
    expect(cb).toMatchObject({ evento: "invoice.status_updated:chargeback", dataEvento: quando, receita: { situacao: "revertido" }, venda: { chargebackEm: quando, reembolsadoEm: null } });

    // A disputa aberta segue paga, sem "em risco": a Hubla so a resolve pelo
    // status_updated "paid" (ignorado), e o "em risco" nunca sairia.
    const disputa = lerUm(aviso("invoice.status_updated", com("disputed")));
    expect(disputa).toMatchObject({ evento: "invoice.status_updated:disputed", receita: { situacao: "pago" }, venda: { reembolsoPedidoEm: null } });

    const cancelada = lerUm(aviso("invoice.status_updated", com("canceled")));
    expect(cancelada).toMatchObject({ evento: "invoice.status_updated:canceled", receita: { situacao: "expirado" } });

    // O resto repete um evento proprio: 200 sem gravar. O reembolso parcial
    // (so pelo status_updated) tambem fica de fora: a doc nao diz quanto voltou.
    for (const status of ["paid", "unpaid", "overdue", "refunded"]) {
      const r = lerTodosHubla(aviso("invoice.status_updated", com(status)), AGORA, headersDe());
      expect(r, status).toEqual({ ok: true, eventos: [], ignorado: `invoice.status_updated:${status}` });
    }
    // Os nomes cabem no CHECK de 40 de checkout_externo_eventos.evento.
    for (const e of [cb, disputa, cancelada]) expect(e.evento.length).toBeLessThanOrEqual(40);
  });

  it("lead, assinatura, membro, solicitacao de reembolso e evento novo: 200 ignorado, antes de ler o corpo", () => {
    for (const type of ["lead.abandoned_checkout", "subscription.created", "customer.member_added", "refund_request.created", "invoice.algo_novo"]) {
      expect(lerTodosHubla({ type, event: {} }, AGORA, headersDe()), type).toEqual({ ok: true, eventos: [], ignorado: type });
    }
  });

  it("corpo torto, id torto, centavos negativos, moeda dos receivers diferente e data fora da janela: recusa", () => {
    const erro = (c: unknown) => {
      const r = lerTodosHubla(c, AGORA, headersDe());
      return r.ok ? null : r.erro;
    };
    expect(erro("x")).toMatch(/objeto/);
    expect(erro({ event: {} })).toMatch(/type/);
    expect(erro({ type: "invoice.payment_succeeded", event: {} })).toMatch(/invoice/);
    expect(erro(aviso("invoice.payment_succeeded", fatura({ id: "com espaco" })))).toMatch(/invoice.id/);
    expect(erro(aviso("invoice.payment_succeeded", fatura({ amount: { totalCents: -100 } })))).toMatch(/totalCents/);
    expect(erro(aviso("invoice.payment_succeeded", fatura({ amount: { totalCents: "abc" } })))).toMatch(/totalCents/);
    expect(erro(aviso("invoice.payment_succeeded", fatura({ amount: { totalCents: 1e12 } })))).toMatch(/totalCents/);
    expect(
      erro(aviso("invoice.payment_succeeded", fatura({ receivers: [{ role: "seller", totalCents: 100, currency: "USD" }] })))
    ).toMatch(/receivers em USD/);
    expect(erro(aviso("invoice.payment_succeeded", fatura({ createdAt: "2024-03-28T20:35:22.671Z", saleDate: null })))).toMatch(/createdAt/);
  });
});

describe("dinheiro: juros, comissoes e venda internacional", () => {
  it("juros do parcelamento: o comprador paga a Hubla, fica fora do faturamento e da taxa", () => {
    const ev = lerUm(
      aviso(
        "invoice.payment_succeeded",
        fatura({
          paymentMethod: "credit_card",
          installments: 12,
          amount: { subtotalCents: 34100, discountCents: 0, prorataCents: 0, installmentFeeCents: 4100, totalCents: 38200 },
          receivers: [
            { role: "platform", totalCents: 11943, currency: "BRL" },
            { role: "seller", totalCents: 26257, currency: "BRL" },
          ],
        })
      )
    );
    expect(ev.pedido.valor).toBe(341);
    expect(ev.receita.valor).toBe(262.57);
    expect(ev.venda).toMatchObject({ taxa: 78.43, comissoes: 0 });
  });

  it("afiliado ou coprodutor: o papel que nao e vendedor nem plataforma vira comissoes", () => {
    const ev = lerUm(
      aviso(
        "invoice.payment_succeeded",
        fatura({
          receivers: [
            { role: "platform", totalCents: 7843, currency: "BRL" },
            { role: "affiliate", totalCents: 10000, currency: "BRL" },
            { role: "seller", totalCents: 16257, currency: "BRL" },
          ],
        })
      )
    );
    expect(ev.receita.valor).toBe(162.57);
    expect(ev.venda).toMatchObject({ taxa: 78.43, comissoes: 100 });
  });

  it("venda internacional (cobrada em EUR, liquidada em USD): tudo na moeda de liquidacao, onde os receivers fecham", () => {
    const ev = lerUm(
      aviso(
        "invoice.payment_succeeded",
        fatura({
          currency: "EUR",
          amount: {
            subtotalCents: 10000,
            discountCents: 0,
            prorataCents: 0,
            installmentFeeCents: 0,
            totalCents: 10000,
            settlement: { subtotalCents: 10000, taxAmountCents: 800, totalCents: 10800, currency: "USD" },
          },
          receivers: [
            { role: "platform", totalCents: 2484, currency: "USD" },
            { role: "seller", totalCents: 8316, currency: "USD" },
          ],
          currencyConversion: { presentmentCurrency: "EUR", settlementCurrency: "USD", rate: 1.08, rateAt: "2026-10-21T12:00:00.000Z" },
        })
      )
    );
    expect(ev.pedido).toMatchObject({ moeda: "USD", valor: 108 });
    expect(ev.receita).toMatchObject({ moeda: "USD", valor: 83.16 });
    expect(ev.venda?.taxa).toBe(24.84);
  });
});

describe("modo de compatibilidade: 2 x N avisos numa venda de N produtos", () => {
  it("o aviso de produto (fatura fabricada, -offer-N, centavos quebrados) nao entra", () => {
    const fabricada = fatura({
      id: `${FATURA}-offer-2`,
      parentInvoiceId: FATURA,
      childInvoiceIds: [],
      amount: { subtotalCents: 4700, totalCents: 4700 },
      receivers: [
        { role: "platform", totalCents: 1081, currency: "BRL" },
        { role: "seller", totalCents: 3618.9999999999995, currency: "BRL" },
      ],
    });
    expect(lerTodosHubla(aviso("invoice.payment_succeeded", fabricada), AGORA, headersDe({ "x-hubla-delivery-mode": "compatibility" }))).toEqual({
      ok: true,
      eventos: [],
      ignorado: "aviso de produto (modo de compatibilidade)",
    });
    // So o sufixo tambem basta.
    const soSufixo = lerTodosHubla(aviso("invoice.payment_succeeded", fatura({ id: `${FATURA}-offer-3` })), AGORA, headersDe());
    expect(soSufixo).toMatchObject({ ok: true, eventos: [] });
  });

  it("parentInvoiceId sem o sufixo e venda de verdade, nos dois modos (o invoice.expired da doc e assim)", () => {
    const real = fatura({ id: "8a1b2c3d-0000-4000-8000-0000000000aa", parentInvoiceId: "b2a7c4e8-3d51-4c9a-9f16-8e0d5a2b6c31" });
    for (const modo of ["standard", "compatibility"]) {
      const [ev] = ler(aviso("invoice.payment_succeeded", real), headersDe({ "x-hubla-delivery-mode": modo }));
      expect(ev, modo).toMatchObject({ pedidoId: "8a1b2c3d-0000-4000-8000-0000000000aa", venda: { grupo: "8a1b2c3d-0000-4000-8000-0000000000aa" } });
    }
  });

  it("os avisos da venda trazem a fatura real (o total): a trava junta, o pedido fica com 341", async () => {
    const m = memoria();
    const produto = (id: string, name: string) => ({ product: { id, name }, products: [{ id, name, offers: [{ id, name: "Oferta" }] }], hasOrderBump: undefined });
    const avisos = [
      aviso("invoice.payment_succeeded", fatura(), produto("inAVzweR0QYw5y03K5mq", "Integrações com Webhook 2.0")),
      aviso("invoice.payment_succeeded", fatura(), produto("tpl7Kq2wRt4Ns9XbY1Lm", "Templates de Automação")),
      aviso("invoice.payment_succeeded", fatura({ id: `${FATURA}-offer-2`, parentInvoiceId: FATURA }), produto("tpl7Kq2wRt4Ns9XbY1Lm", "Templates de Automação")),
    ];
    const status = [];
    for (const a of avisos) status.push((await receber(m, a, { modo: "compatibility" })).corpo);
    expect(status).toEqual([{ ok: true }, { ok: true, duplicado: true }, { ok: true, ignorado: "aviso de produto (modo de compatibilidade)" }]);
    expect(m.pedidos.size).toBe(1);
    expect(m.pedidos.get(FATURA)).toMatchObject({ valor: 341, receita: 262.57, situacao: "pago" });
  });
});

describe("recorrencia: entra no lucro, nao vai ao Meta/TikTok", () => {
  it("renovacao e upgrade (invoice.type) e a parcela 2+ do Parcelamento Inteligente", () => {
    expect(lerUm(aviso("invoice.payment_succeeded", fatura({ type: "renewal" }))).venda?.recorrencia).toBe(true);
    expect(lerUm(aviso("invoice.payment_succeeded", fatura({ type: "upgrade" }))).venda?.recorrencia).toBe(true);
    const parcela = (n: number) => fatura({ smartInstallment: { cycleId: "c1", cycleType: "direct", installment: n, installments: 12 } });
    expect(lerUm(aviso("invoice.payment_succeeded", parcela(2))).venda?.recorrencia).toBe(true);
    expect(lerUm(aviso("invoice.payment_succeeded", parcela(1))).venda?.recorrencia).toBe(false);
    expect(lerUm(aviso("invoice.payment_succeeded", fatura({ type: undefined }))).venda?.recorrencia).toBe(false);
  });

  it("renovacao sem paymentSession: a sessao da primeira compra (firstPaymentSession)", () => {
    const ev = lerUm(
      aviso("invoice.payment_succeeded", fatura({ type: "renewal", paymentSession: undefined, firstPaymentSession: { ip: "203.0.113.9", utm: { source: "email" } } }))
    );
    expect(ev.rastreio).toMatchObject({ ip: "203.0.113.9", utm: { source: "email" } });
  });
});

describe("o visitante da ponte (Fase D) na Hubla", () => {
  it("callback=xc.<vid> volta em paymentSession.params; ou na query da URL", () => {
    const nosParams = lerUm(aviso("invoice.payment_succeeded", fatura({ paymentSession: { url: "https://pay.hub.la/x", params: { callback: "xc.lq2x9k.ab12cd34" } } })));
    expect(vidDoRastreio(nosParams.rastreio)).toBe("lq2x9k.ab12cd34");
    const naUrl = lerUm(aviso("invoice.payment_succeeded", fatura({ paymentSession: { url: "https://pay.hub.la/x?callback=xc.lq2x9k.ab12cd34" } })));
    expect(naUrl.rastreio?.vidNaUrl).toBe("lq2x9k.ab12cd34");
    expect(vidDoRastreio(naUrl.rastreio)).toBe("lq2x9k.ab12cd34");
  });

  it("sem UTM no bloco: as da query da URL", () => {
    const ev = lerUm(aviso("invoice.payment_succeeded", fatura({ paymentSession: { url: "https://pay.hub.la/x?utm_source=tiktok&utm_campaign=Camp&email=a%40b.com" } })));
    expect(ev.rastreio?.utm).toEqual({ source: "tiktok", campaign: "Camp" });
  });

  it("a ponte para a pagina de vendas aponta para pay.hub.la", () => {
    expect(HOST_DO_CHECKOUT.hubla).toBe("pay.hub.la");
    expect(scriptDaPonteDoCheckout("https://app.xcart.com.br/", "ck-1", "hubla")).toBe(
      '<script src="https://app.xcart.com.br/xcart-bridge.js" data-xcart-destinos="pay.hub.la" data-xcart-checkout="ck-1" defer></script>'
    );
  });
});

describe("teste: o sandbox da Hubla e o nosso nunca viram pedido", () => {
  it("x-hubla-sandbox TRUE: teste, mesmo com data de 2024 e valor torto (sai antes das validacoes)", () => {
    const velha = fatura({ createdAt: "2024-03-28T20:35:22.671Z", amount: { totalCents: "abc" } });
    const [ev] = ler(aviso("invoice.payment_succeeded", velha), headersDe({ "x-hubla-sandbox": "TRUE" }));
    expect(ev).toMatchObject({ teste: true, pedido: { valor: 0 } });
    // Tambem o status_updated do sandbox (que fora dele seria ignorado).
    const [st] = ler(aviso("invoice.status_updated", fatura()), headersDe({ "x-hubla-sandbox": "true" }));
    expect(st).toMatchObject({ teste: true, evento: "invoice.status_updated:paid" });
  });

  it("o nosso exemplo: id fixo e os headers do assinar (que passam no autenticar)", () => {
    const raw = JSON.stringify(exemploHubla(AGORA));
    const h = new Headers(assinarHubla(raw, TOKEN));
    expect(autenticarHubla(raw, h, TOKEN)).toEqual({ ok: true });
    const [ev] = ler(JSON.parse(raw), h);
    expect(ev).toMatchObject({ teste: true, pedidoId: ID_TESTE });
    // Sem o header de sandbox, o id fixo basta.
    expect(ler(JSON.parse(raw), headersDe())[0].teste).toBe(true);
  });

  it("o comprador ficticio da doc (John Doe com e-mail @example.com) e teste; so o e-mail nao e", () => {
    const john = fatura({ payer: { firstName: "John", lastName: "Doe", email: "johndoe.payer@example.com" } });
    expect(ler(aviso("invoice.payment_succeeded", john))[0].teste).toBe(true);
    const soEmail = fatura({ payer: { firstName: "Ana", lastName: "Souza", email: "ana@example.com" } });
    expect(ler(aviso("invoice.payment_succeeded", soEmail))[0].teste).toBe(false);
  });
});

describe("autenticarHubla", () => {
  it("token certo: ok; errado, ausente ou sem token salvo: recusa", () => {
    expect(autenticarHubla("", headersDe(), TOKEN)).toEqual({ ok: true });
    expect(autenticarHubla("", headersDe(), `  ${TOKEN}  `)).toEqual({ ok: true });
    expect(autenticarHubla("", headersDe({ "x-hubla-token": `${TOKEN}x` }), TOKEN)).toMatchObject({ ok: false, erro: "x-hubla-token nao confere" });
    expect(autenticarHubla("", new Headers(), TOKEN)).toMatchObject({ ok: false, erro: "x-hubla-token ausente" });
    expect(autenticarHubla("", headersDe(), null)).toMatchObject({ ok: false, semSegredo: true });
  });

  it("o registro: venda, token no header, reenvio por status (503 na hora)", () => {
    expect(plataformaDe("hubla")).toBe(hubla);
    expect(hubla).toMatchObject({ modelo: "venda", autenticacao: "token_no_header", reenvio: "status", eventoDeVenda: "invoice.payment_succeeded" });
    expect(modeloDaPlataforma("hubla")).toBe("venda");
    expect(rastreiaCompra("hubla")).toBe(true);
    expect(usaSegredo("hubla")).toBe(true);
    expect(MOEDA_PADRAO.hubla).toBe("BRL");
    expect(PLATAFORMAS_CHECKOUT.find((p) => p.id === "hubla")?.ativa).toBe(true);
    expect(rotuloDoEvento("invoice.status_updated:chargeback")).toBe("Chargeback");
    // O do sandbox pode vir com qualquer status.
    expect(rotuloDoEvento("invoice.status_updated:paid")).toBe("Status atualizado");
  });
});

// ---------------------------------------------------------------------------
// receberEvento com um repositorio em memoria
// ---------------------------------------------------------------------------

interface Memoria {
  repo: RepositorioCheckout;
  eventos: Set<string>;
  pedidos: Map<string, PedidoGravado>;
  marcas: MarcaCheckout[];
}

function memoria(opcoes: { falharInsert?: number; falharSoltar?: number; travadoEm?: () => string } = {}): Memoria {
  let falhas = opcoes.falharInsert ?? 0;
  let falhasSoltar = opcoes.falharSoltar ?? 0;
  const m: Memoria = { eventos: new Set(), pedidos: new Map(), marcas: [], repo: undefined as never };
  m.repo = {
    async travarEvento(x) {
      const k = `${x.pedido_id}|${x.evento}`;
      if (m.eventos.has(k)) return "duplicado";
      m.eventos.add(k);
      return "ok";
    },
    async soltarEvento(x) {
      if (falhasSoltar > 0) {
        falhasSoltar -= 1;
        throw new Error("banco fora");
      }
      m.eventos.delete(`${x.pedido_id}|${x.evento}`);
    },
    ...(opcoes.travadoEm ? { travaRecebidaEm: async () => opcoes.travadoEm!() } : {}),
    async lerPedido(_ck, id) {
      const p = m.pedidos.get(id);
      return p ? { ...p } : null;
    },
    async inserirPedido(x) {
      if (falhas > 0) {
        falhas -= 1;
        throw new Error("banco fora");
      }
      if (m.pedidos.has(x.pedido_id)) return "existe";
      m.pedidos.set(x.pedido_id, { ...x.pedido, versao: 0 });
      return "ok";
    },
    async atualizarPedido(x) {
      const atual = m.pedidos.get(x.pedido_id);
      if (!atual || atual.versao !== x.versao) return false;
      m.pedidos.set(x.pedido_id, { ...x.pedido, versao: x.versao + 1 });
      return true;
    },
    async reivindicarConta() {
      return "ok";
    },
    async marcarCheckout(_ck, campos) {
      m.marcas.push(campos);
    },
  };
  return m;
}

const CHECKOUT: CheckoutParaReceber = {
  id: "ck-hubla",
  user_id: "u-1",
  plataforma: "hubla",
  nome: "Hubla Mentoria",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  notificar_pendente: false,
  notificar_estorno: false,
  compra_quando: "gerada",
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

async function receber(
  m: Memoria,
  c: Dados,
  opcoes: { checkout?: Partial<CheckoutParaReceber>; segredo?: string | null; token?: string; sandbox?: boolean; modo?: string; rastreio?: RastreioCheckout } = {}
) {
  const raw = JSON.stringify(c);
  const headers = headersDe({
    "x-hubla-token": opcoes.token ?? TOKEN,
    "x-hubla-sandbox": opcoes.sandbox ? "TRUE" : "FALSE",
    "x-hubla-delivery-mode": opcoes.modo ?? "standard",
  });
  return receberEvento(
    m.repo,
    { ...CHECKOUT, ...opcoes.checkout },
    hubla,
    JSON.parse(raw),
    AGORA,
    { raw, headers, segredo: opcoes.segredo === undefined ? TOKEN : opcoes.segredo },
    opcoes.rastreio
  );
}

describe("receberEvento (Hubla): origem, idempotencia e ordem", () => {
  it("sem token salvo: 401, o erro fala em token e no Reprocessar da Hubla", async () => {
    const m = memoria();
    const r = await receber(m, aviso("invoice.payment_succeeded", fatura()), { segredo: null });
    expect(r).toEqual({ status: 401, corpo: { ok: false, erro: "nao autorizado" }, notificar: null });
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/Cole aqui o token do webhook da Hubla e use Reprocessar/);
    expect(m.eventos.size).toBe(0);
  });

  it("token errado: 401 com 'O token da Hubla não confere'", async () => {
    const m = memoria();
    const r = await receber(m, aviso("invoice.payment_succeeded", fatura()), { token: "outro-token-qualquer" });
    expect(r.status).toBe(401);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/O token da Hubla não confere/);
  });

  it("criada -> paga -> reembolsada: cada etapa uma vez; o status_updated que acompanha cada uma nao duplica", async () => {
    const m = memoria();
    const devolvida = "2026-10-21T14:55:00.000Z";
    const reembolsada = fatura({ status: "refunded", statusAt: [{ status: "unpaid", when: CRIADA }, { status: "paid", when: PAGA }, { status: "refunded", when: devolvida }] });
    const corpos = [
      (await receber(m, aviso("invoice.created", aberta()))).corpo,
      (await receber(m, aviso("invoice.status_updated", aberta()))).corpo,
      (await receber(m, aviso("invoice.payment_succeeded", fatura()))).corpo,
      (await receber(m, aviso("invoice.status_updated", fatura()))).corpo,
      // A retentativa da Hubla (o mesmo aviso de novo).
      (await receber(m, aviso("invoice.payment_succeeded", fatura()))).corpo,
      (await receber(m, aviso("invoice.refunded", reembolsada))).corpo,
    ];
    expect(corpos).toEqual([
      { ok: true },
      { ok: true, ignorado: "invoice.status_updated:unpaid" },
      { ok: true },
      { ok: true, ignorado: "invoice.status_updated:paid" },
      { ok: true, duplicado: true },
      { ok: true },
    ]);
    expect([...m.eventos].sort()).toEqual([`${FATURA}|invoice.created`, `${FATURA}|invoice.payment_succeeded`, `${FATURA}|invoice.refunded`].sort());
    expect(m.pedidos.get(FATURA)).toMatchObject({ situacao: "revertido", pago_em: PAGA, reembolsado_em: devolvida, criado_em: CRIADA, metodo_pagamento: "pix" });
  });

  it("pago antes do criado (a Hubla nao garante a ordem): o criado atrasado nao volta para pendente", async () => {
    const m = memoria();
    await receber(m, aviso("invoice.payment_succeeded", fatura()));
    await receber(m, aviso("invoice.created", aberta()));
    expect(m.pedidos.get(FATURA)?.situacao).toBe("pago");
  });

  it("chargeback depois da disputa: revertido com a data do chargeback; a disputa sozinha deixa a venda paga", async () => {
    const m = memoria();
    const disputa = "2026-10-21T14:57:00.000Z";
    const cb = "2026-10-21T14:59:00.000Z";
    await receber(m, aviso("invoice.payment_succeeded", fatura()));
    await receber(m, aviso("invoice.status_updated", fatura({ status: "disputed", statusAt: [{ status: "paid", when: PAGA }, { status: "disputed", when: disputa }] })));
    const p1 = m.pedidos.get(FATURA)!;
    expect(estadoDaVenda(p1, AGORA.getTime())).toBe("paga");
    // Resolvida a favor do vendedor (so o status_updated "paid", ignorado): segue paga, nada preso.
    await receber(m, aviso("invoice.status_updated", fatura({ statusAt: [{ status: "paid", when: PAGA }, { status: "disputed", when: disputa }, { status: "paid", when: "2026-10-21T14:58:00.000Z" }] })));
    expect(estadoDaVenda(m.pedidos.get(FATURA)!, AGORA.getTime())).toBe("paga");
    await receber(
      m,
      aviso("invoice.status_updated", fatura({ status: "chargeback", statusAt: [{ status: "paid", when: PAGA }, { status: "disputed", when: disputa }, { status: "chargeback", when: cb }] }))
    );
    expect(m.pedidos.get(FATURA)).toMatchObject({ situacao: "revertido", chargeback_em: cb });
    expect(estadoDaVenda(m.pedidos.get(FATURA)!, AGORA.getTime())).toBe("chargeback");
  });

  it("falha nossa: 503 na hora (a Hubla reenvia), sem segurar; o erro fica na tela ate a retentativa gravar", async () => {
    const m = memoria({ falharInsert: 1 });
    const r = await receber(m, aviso("invoice.payment_succeeded", fatura()));
    expect(r.status).toBe(503);
    expect(r.segurar).toBeUndefined();
    expect(m.eventos.size).toBe(0);
    // Depois das 5 tentativas (~75 s) ela desiste: o caminho de volta e o Reprocessar.
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/A Hubla tenta de novo por cerca de 1 minuto; se o erro ficar, use Reprocessar/);
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()))).corpo).toEqual({ ok: true });
    expect(m.pedidos.size).toBe(1);
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_erro: null });
  });

  it("Pix/boleto que a Hubla avisa que venceu: 'Vencida', nao 'Recusada'; o cartao que falhou segue recusado", async () => {
    const m = memoria();
    await receber(m, aviso("invoice.created", aberta()));
    await receber(m, aviso("invoice.expired", aberta({ status: "overdue", statusAt: [{ status: "unpaid", when: CRIADA }, { status: "overdue", when: "2026-10-21T14:50:00.000Z" }] })));
    const pix = m.pedidos.get(FATURA)!;
    expect(pix).toMatchObject({ situacao: "expirado", status_comissao: "overdue" });
    expect(estadoDaVenda(pix, AGORA.getTime())).toBe("vencida");

    const cartao = "8a1b2c3d-0000-4000-8000-000000000009";
    await receber(m, aviso("invoice.payment_failed", aberta({ id: cartao, paymentMethod: "credit_card", status: "overdue" })));
    expect(estadoDaVenda(m.pedidos.get(cartao)!, AGORA.getTime())).toBe("recusada");

    const cancelada = "8a1b2c3d-0000-4000-8000-00000000000a";
    await receber(m, aviso("invoice.status_updated", aberta({ id: cancelada, status: "canceled" })));
    expect(estadoDaVenda(m.pedidos.get(cancelada)!, AGORA.getTime())).toBe("recusada");
  });

  it("a trava presa (gravar e soltar falharam): as retentativas dentro de 60 s respondem 503, nao 'duplicado'; a de ~75 s refaz", async () => {
    let travadoEm = AGORA.toISOString();
    const m = memoria({ falharInsert: 1, falharSoltar: 1, travadoEm: () => travadoEm });
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()))).status).toBe(503);
    expect(m.eventos.size).toBe(1);
    // As retentativas em 5, 15 e 35 s: a trava e de agora e o pedido nao tem o evento.
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()))).corpo).toEqual({ ok: false, erro: "tente de novo" });
    expect(m.pedidos.size).toBe(0);
    // A de ~75 s: a trava ja passou da janela, refaz e grava.
    travadoEm = new Date(AGORA.getTime() - 75_000).toISOString();
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()))).corpo).toEqual({ ok: true });
    expect(m.pedidos.get(FATURA)?.situacao).toBe("pago");
    // E a entrega que chega com a trava recente e o evento ja no pedido e duplicado, como sempre.
    travadoEm = AGORA.toISOString();
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()))).corpo).toEqual({ ok: true, duplicado: true });
  });

  it("Venda no celular com o aviso de pendente ligado: Pix gerado avisa; o cartao nao passa por pendente", async () => {
    const m = memoria();
    const pedindo = { checkout: { notificar_pendente: true } };
    expect((await receber(m, aviso("invoice.created", aberta()), pedindo)).notificar).toMatchObject({ tipo: "pendente", metodo: "pix" });
    const cartao = "8a1b2c3d-0000-4000-8000-0000000000bb";
    expect((await receber(m, aviso("invoice.created", aberta({ id: cartao, paymentMethod: "credit_card" })), pedindo)).notificar).toBeNull();
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura({ id: cartao, paymentMethod: "credit_card" })), pedindo)).notificar).toMatchObject({ tipo: "venda" });
  });

  it("sandbox e o nosso teste: 200 teste, nada travado nem gravado", async () => {
    const m = memoria();
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()), { sandbox: true })).corpo).toEqual({ ok: true, teste: true });
    expect((await receber(m, exemploHubla(AGORA) as Dados)).corpo).toEqual({ ok: true, teste: true });
    expect(m.pedidos.size).toBe(0);
    expect(m.eventos.size).toBe(0);
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_evento_teste: true, ultimo_evento: "invoice.payment_succeeded" });
  });

  it("Venda no celular: o pagamento aprovado avisa uma vez, com o liquido", async () => {
    const m = memoria();
    const r = await receber(m, aviso("invoice.payment_succeeded", fatura()));
    expect(r.notificar).toMatchObject({ tipo: "venda", checkout: "Hubla Mentoria", produto: "Integrações com Webhook 2.0", valor: 341, comissao: 262.57, moeda: "BRL" });
    expect((await receber(m, aviso("invoice.payment_succeeded", fatura()))).notificar).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A compra pelo servidor (Meta e TikTok)
// ---------------------------------------------------------------------------

const META: DestinoDoCheckout = { id: "d-meta", plataforma: "meta", conta: "123456789012345", token: "EAAtoken123456", testEventCode: null, ativo: true };
const TIKTOK: DestinoDoCheckout = { id: "d-tt", plataforma: "tiktok", conta: "CUSG5HBC77UD11VVRQEG", token: "tt-token-1234567", testEventCode: null, ativo: true };

/** A fila com o indice unico (destino_id, event_id) da 073. */
function fila(destinos: DestinoDoCheckout[] = [META, TIKTOK]) {
  const linhas: EnvioGravado[] = [];
  const rastreio: RastreioCheckout = {
    async destinos() {
      return destinos;
    },
    async identidade() {
      return null;
    },
    async enfileirar(novas: EnvioNovo[]) {
      const entraram: EnvioGravado[] = [];
      for (const l of novas) {
        if (linhas.some((x) => x.destino_id === l.destino_id && x.event_id === l.event_id)) continue;
        const g = { ...l, id: `e${linhas.length + 1}`, attempts: 0 };
        linhas.push(g);
        entraram.push(g);
      }
      return entraram;
    },
  };
  return { rastreio, linhas };
}

const metaDe = (f: ReturnType<typeof fila>) => f.linhas.filter((l) => l.plataforma === "meta").map((l) => l.payload as EventoCapi);
const tiktokDe = (f: ReturnType<typeof fila>) => f.linhas.filter((l) => l.plataforma === "tiktok").map((l) => l.payload as EventoTiktok);

describe("a compra pelo servidor (Hubla)", () => {
  it("Pix gerado (padrao): uma compra na criacao, com IP, user agent, fbp, fbc do fbclid e _ttp da sessao; o pagamento nao manda de novo", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, aviso("invoice.created", aberta()), { rastreio: f.rastreio });
    await receber(m, aviso("invoice.payment_succeeded", fatura()), { rastreio: f.rastreio });
    expect(f.linhas.map((l) => l.event_id)).toEqual([`purchase_hubla_${FATURA}`, `purchase_hubla_${FATURA}`]);
    const [meta] = metaDe(f);
    expect(meta).toMatchObject({
      event_id: `purchase_hubla_${FATURA}`,
      event_time: Math.floor(Date.parse(CRIADA) / 1000),
      event_source_url: "https://pay.hub.la/inAVzweR0QYw5y03K5mq",
      custom_data: { currency: "BRL", value: 341, content_ids: ["inAVzweR0QYw5y03K5mq"], order_id: FATURA },
    });
    expect(meta.user_data).toMatchObject({
      client_ip_address: "220.172.165.140",
      fbp: "fb.1.1761057322671.1234567890",
      fbc: `fb.1.${Date.parse(CRIADA)}.IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ`,
    });
    expect(meta.user_data.client_user_agent).toMatch(/^Mozilla/);
    const [tt] = tiktokDe(f);
    expect(tt.user).toMatchObject({ ttclid: "E.C.P.1234567890abcdef1234567890abcdef", ttp: "01HN8K2M3P4Q5R6S7T8U9V0W1X", ip: "220.172.165.140" });
  });

  it("cartao: a fatura criada nao manda (pode nao aprovar); o pagamento manda, na hora dele", async () => {
    const m = memoria();
    const f = fila([META]);
    await receber(m, aviso("invoice.created", aberta({ paymentMethod: "credit_card" })), { rastreio: f.rastreio });
    expect(f.linhas).toHaveLength(0);
    await receber(m, aviso("invoice.payment_succeeded", fatura({ paymentMethod: "credit_card" })), { rastreio: f.rastreio });
    expect(metaDe(f)).toHaveLength(1);
    expect(metaDe(f)[0].event_time).toBe(Math.floor(Date.parse(PAGA) / 1000));
  });

  it("so aprovadas: o Pix gerado nao manda", async () => {
    const m = memoria();
    const f = fila([META]);
    await receber(m, aviso("invoice.created", aberta()), { rastreio: f.rastreio, checkout: { compra_quando: "aprovada" } });
    expect(f.linhas).toHaveLength(0);
    await receber(m, aviso("invoice.payment_succeeded", fatura()), { rastreio: f.rastreio, checkout: { compra_quando: "aprovada" } });
    expect(f.linhas).toHaveLength(1);
  });

  it("renovacao e parcela 2+ entram no lucro, mas nao mandam compra", async () => {
    const m = memoria();
    const f = fila([META]);
    await receber(m, aviso("invoice.payment_succeeded", fatura({ type: "renewal" })), { rastreio: f.rastreio });
    const parcela = fatura({ id: "8a1b2c3d-0000-4000-8000-000000000002", smartInstallment: { installment: 2, installments: 6 } });
    await receber(m, aviso("invoice.payment_succeeded", parcela), { rastreio: f.rastreio });
    expect(m.pedidos.size).toBe(2);
    expect(f.linhas).toHaveLength(0);
  });

  it("reembolso, chargeback, expirada e o teste nao mandam nada", async () => {
    const m = memoria();
    const f = fila([META]);
    await receber(m, aviso("invoice.refunded", fatura({ status: "refunded" })), { rastreio: f.rastreio });
    await receber(m, aviso("invoice.status_updated", fatura({ id: "8a1b2c3d-0000-4000-8000-000000000003", status: "chargeback" })), { rastreio: f.rastreio });
    await receber(m, aviso("invoice.expired", aberta({ id: "8a1b2c3d-0000-4000-8000-000000000004", status: "overdue" })), { rastreio: f.rastreio });
    await receber(m, aviso("invoice.payment_succeeded", fatura()), { rastreio: f.rastreio, sandbox: true });
    expect(f.linhas).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Dado pessoal
// ---------------------------------------------------------------------------

describe("dado pessoal do comprador nunca e gravado nem logado", () => {
  afterEach(() => vi.restoreAllMocks());

  it("nada do comprador no pedido, na trava, no checkout, na notificacao ou no log; o CPF nem e lido", async () => {
    const logs: unknown[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void logs.push(a));
    }
    const m = memoria({ falharInsert: 1 });
    const pedindo = { checkout: { notificar_pendente: true, notificar_estorno: true } };
    const notificacoes: unknown[] = [];
    for (const c of [
      aviso("invoice.created", aberta()),
      aviso("invoice.created", aberta()),
      aviso("invoice.payment_succeeded", fatura()),
      aviso("invoice.refunded", fatura({ status: "refunded" })),
      aviso("lead.abandoned_checkout", fatura()),
      aviso("invoice.payment_succeeded", fatura({ amount: { totalCents: "abc" } })),
    ]) {
      const r = await receber(m, c, pedindo);
      if (r.notificar) notificacoes.push(vendaDoPedidoExterno(r.notificar));
    }
    const gravado = JSON.stringify({ pedidos: [...m.pedidos.values()], eventos: [...m.eventos], marcas: m.marcas, notificacoes, logs });
    expect(m.pedidos.size).toBe(1);
    for (const dado of DADOS_DO_COMPRADOR) expect(gravado, dado).not.toContain(dado);
    const ev = lerUm(aviso("invoice.payment_succeeded", fatura()));
    expect(JSON.stringify(ev)).not.toContain("39053344705");
    expect(ev.comprador).toEqual({
      nome: "Ana Souza",
      email: "ana.souza@provedor.com.br",
      telefone: "+5534988887777",
      pais: "BR",
      estado: "São Paulo",
      cidade: "São Paulo",
      cep: "01310-200",
    });
  });

  it("migration 075: Hubla nos dois CHECKs de plataforma, sem coluna nova", () => {
    const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/075_checkout_hubla.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).toMatch(/checkouts_externos_plataforma_check check \(plataforma in \('sphere', 'cakto', 'hubla'\)\)/);
    expect(sql).toMatch(/checkout_externo_contas_plataforma_check check \(plataforma in \('sphere', 'cakto', 'hubla'\)\)/);
    expect(sql).not.toMatch(/add column/i);
  });
});
