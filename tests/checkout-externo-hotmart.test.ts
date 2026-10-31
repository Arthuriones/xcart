import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ID_TESTE,
  assinarHotmart,
  autenticarHotmart,
  exemploHotmart,
  formatoDoAvisoHotmart,
  hotmart,
  lerTodosHotmart,
} from "@/lib/checkouts-externos/plataformas/hotmart";
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
  nomeDoSegredo,
  rastreiaCompra,
  rotuloDoEvento,
  scriptDaPonteDoCheckout,
  usaSegredo,
} from "@/lib/checkouts-externos/tipos";
import type { IdentidadeGuardada } from "@/lib/tracking/purchase";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import type { EventoTiktok } from "@/lib/tracking/tiktok-evento";

// A Hotmart: o quarto checkout de VENDA PROPRIA. O webhook 2.0.0 do produtor
// (uma transacao por aviso, valores decimais, datas em ms) vira um pedido com
// faturamento (price), taxa, comissoes e liquido (a comissao PRODUCER); a
// origem e o hottok fixo do X-HOTMART-HOTTOK; o "Enviar teste" (o payload de
// exemplo da doc) e o nosso nunca viram pedido; o order bump cai na cobranca
// da principal; renovacao entra no lucro mas nao vai ao Meta/TikTok; o sck
// leva o visitante da ponte, e o pedido herda a campanha dele; o que nao e
// erro de verdade responde 200 (a Hotmart desativa o webhook que da erro);
// dado pessoal do comprador nunca e gravado.

const AGORA = new Date("2026-10-31T15:00:00.000Z");
const HOTTOK = "hmt9f1c4e2a7b3d4c8ea1f52d6b8e0c3a71xyz";
const TRANSACAO = "HP17715690036014";

const PEDIDO = "2026-10-31T14:20:00.000Z";
const APROVADA = "2026-10-31T14:21:30.000Z";
const AVISO = "2026-10-31T14:21:31.000Z";
const VID = "lz3k9q2a.8f7a6b5c";

/** O que nunca pode aparecer em nada que o Panda Track grava ou loga. */
const DADOS_DO_COMPRADOR = ["Ana", "Souza", "ana.souza", "provedor.com.br", "988887777", "39053344705", "Assis Chateaubriand", "30150101", "Floresta"];

type Dados = Record<string, unknown>;

/** A compra aprovada no Pix (R$ 197,00: taxa da Hotmart, afiliado e produtor), com dado pessoal ficticio. */
function compra(extra: Dados = {}): Dados {
  return {
    transaction: TRANSACAO,
    order_date: Date.parse(PEDIDO),
    approved_date: Date.parse(APROVADA),
    status: "APPROVED",
    price: { value: 197, currency_value: "BRL" },
    full_price: { value: 197, currency_value: "BRL" },
    original_offer_price: { value: 197, currency_value: "BRL" },
    offer: { code: "n82b9jqz" },
    recurrence_number: 1,
    subscription_anticipation_purchase: false,
    checkout_country: { name: "Brasil", iso: "BR" },
    origin: { sck: `xc.${VID}`, src: "vsl", xcod: "lista" },
    order_bump: { is_order_bump: false },
    payment: { type: "PIX", installments_number: 1 },
    is_funnel: false,
    business_model: "I",
    buyer_ip: "200.150.10.20",
    ...extra,
  };
}

/** O aviso inteiro: { id, creation_date, event, version, data }. */
function aviso(event: string, purchase: Dados = compra(), dados: Dados = {}, envelope: Dados = {}): Dados {
  return {
    id: "8f2d1c3e-0000-4000-8000-000000000001",
    creation_date: Date.parse(AVISO),
    event,
    version: "2.0.0",
    data: {
      product: { id: 4774438, ucode: "559fef42-3406-4d82-b775-d09bd33936b1", name: "Curso Método X", has_co_production: false },
      affiliates: [{ affiliate_code: "Q58388177J", name: "Afiliado" }],
      buyer: {
        ucode: "f6ebb124-863f-4a94-a843-5c57c0b1b607",
        email: "Ana.Souza@provedor.com.br",
        name: "Ana Souza",
        first_name: "Ana",
        last_name: "Souza",
        checkout_phone: "988887777",
        checkout_phone_code: "31",
        document: "39053344705",
        document_type: "CPF",
        address: {
          zipcode: "30150101",
          country: "Brasil",
          number: "499",
          address: "Avenida Assis Chateaubriand",
          city: "Belo Horizonte",
          state: "MG",
          neighborhood: "Floresta",
          country_iso: "BR",
        },
      },
      producer: { name: "Produtor", legal_nature: "Pessoa Física", document: "12345678965" },
      commissions: [
        { value: 19.6, currency_value: "BRL", source: "MARKETPLACE" },
        { value: 50, currency_value: "BRL", source: "AFFILIATE" },
        { value: 127.4, currency_value: "BRL", source: "PRODUCER" },
      ],
      purchase,
      ...dados,
    },
    ...envelope,
  };
}

function ler(c: unknown): EventoNormalizado[] {
  const r = lerTodosHotmart(c, AGORA);
  if (!r.ok) throw new Error(r.erro);
  return r.eventos;
}

function lerUm(c: unknown): EventoNormalizado {
  const evs = ler(c);
  expect(evs).toHaveLength(1);
  return evs[0];
}

/** Pix gerado: aguardando pagamento, sem aprovacao. */
function pixGerado(extra: Dados = {}): Dados {
  return compra({ status: "WAITING_PAYMENT", approved_date: null, payment: { type: "PIX", pix_expiration_date: Date.parse("2026-11-01T14:20:00.000Z") }, ...extra });
}

// ---------------------------------------------------------------------------
// O adaptador
// ---------------------------------------------------------------------------

describe("lerTodosHotmart: a transacao vira o pedido", () => {
  it("compra aprovada: faturamento = price, liquido = PRODUCER, comissoes = afiliado, taxa = o resto; datas em ms", () => {
    const ev = lerUm(aviso("PURCHASE_APPROVED"));
    expect(ev).toMatchObject({
      evento: "PURCHASE_APPROVED",
      dataEvento: APROVADA,
      pedidoId: TRANSACAO,
      pedido: { status: "APPROVED", metodo: "pix", produto: "Curso Método X", pais: "BR", moeda: "BRL", valor: 197, criadoEm: PEDIDO },
      receita: { valor: 127.4, moeda: "BRL", situacao: "pago", statusOriginal: "approved" },
      conta: null,
      teste: false,
      venda: {
        taxa: 19.6,
        comissoes: 50,
        referencia: null,
        grupo: TRANSACAO,
        produtoId: "4774438",
        ofertaTipo: "main",
        venceEm: null,
        reembolsadoEm: null,
        chargebackEm: null,
        reembolsoPedidoEm: null,
        cobrancaGerada: false,
        recorrencia: false,
      },
    });
    // So o sck e o IP: a Hotmart nao manda UTM, cookie, click id nem user agent.
    expect(ev.rastreio).toEqual({
      utm: {},
      sck: `xc.${VID}`,
      callback: null,
      fbc: null,
      fbp: null,
      fbclid: null,
      ttclid: null,
      checkoutUrl: null,
      vidNaUrl: null,
      ip: "200.150.10.20",
      userAgent: null,
      ttp: null,
    });
    expect(vidDoRastreio(ev.rastreio)).toBe(VID);
  });

  it("aguardando pagamento no Pix: pendente na criacao do pedido, cobranca gerada, vencimento do pix_expiration_date", () => {
    const ev = lerUm(aviso("PURCHASE_BILLET_PRINTED", pixGerado()));
    expect(ev).toMatchObject({ evento: "PURCHASE_BILLET_PRINTED", dataEvento: PEDIDO, receita: { situacao: "pendente" } });
    expect(ev.venda).toMatchObject({ cobrancaGerada: true, venceEm: "2026-11-01T14:20:00.000Z" });
  });

  it("boleto: BILLET vira 'boleto' (o nome de venda.ts), sem vencimento (a doc nao traz): a janela padrao", () => {
    const ev = lerUm(aviso("PURCHASE_BILLET_PRINTED", compra({ status: "PRINTED_BILLET", approved_date: null, payment: { type: "BILLET", billet_url: "https://x" } })));
    expect(ev.pedido.metodo).toBe("boleto");
    expect(ev.venda).toMatchObject({ cobrancaGerada: true, venceEm: null });
    expect(estadoDaVenda({ situacao: "pendente", criado_em: PEDIDO, metodo_pagamento: "boleto", vence_em: null }, AGORA.getTime())).toBe("aguardando");
  });

  it("cartao aguardando (em analise): pendente, mas nao e cobranca gerada (nao manda a compra nem avisa 'Pix gerado')", () => {
    const ev = lerUm(aviso("PURCHASE_BILLET_PRINTED", compra({ status: "UNDER_ANALISYS", approved_date: null, payment: { type: "CREDIT_CARD" } })));
    expect(ev.receita.situacao).toBe("pendente");
    expect(ev.venda?.cobrancaGerada).toBe(false);
  });

  it("order bump: o grupo e a transacao principal; is_order_bump sem pai (ou com ele mesmo) e a principal", () => {
    const bump = lerUm(aviso("PURCHASE_APPROVED", compra({ transaction: "HP99990000000001", order_bump: { is_order_bump: true, parent_purchase_transaction: TRANSACAO } })));
    expect(bump.venda).toMatchObject({ grupo: TRANSACAO, ofertaTipo: "orderbump" });
    const semPai = lerUm(aviso("PURCHASE_APPROVED", compra({ order_bump: { is_order_bump: true, parent_purchase_transaction: "" } })));
    expect(semPai.venda).toMatchObject({ grupo: TRANSACAO, ofertaTipo: "main" });
    const eleMesmo = lerUm(aviso("PURCHASE_APPROVED", compra({ order_bump: { is_order_bump: true, parent_purchase_transaction: TRANSACAO } })));
    expect(eleMesmo.venda).toMatchObject({ grupo: TRANSACAO, ofertaTipo: "main" });
  });

  it("cancelada, expirada, reembolso, chargeback e pedido de reembolso: na hora do aviso; completa confirma o pago", () => {
    const cancelada = lerUm(aviso("PURCHASE_CANCELED", compra({ status: "CANCELLED", payment: { type: "CREDIT_CARD" } })));
    expect(cancelada).toMatchObject({ dataEvento: AVISO, receita: { situacao: "expirado", statusOriginal: "cancelled" } });
    expect(estadoDaVenda({ situacao: "expirado", metodo_pagamento: "credit_card", status_comissao: "cancelled" }, AGORA.getTime())).toBe("recusada");

    // Expirada no Pix: "Vencida", nao "Recusada" (mesmo sem o status no aviso).
    const expirada = lerUm(aviso("PURCHASE_EXPIRED", pixGerado({ status: null })));
    expect(expirada).toMatchObject({ dataEvento: AVISO, receita: { situacao: "expirado", statusOriginal: "expired" } });
    expect(estadoDaVenda({ situacao: "expirado", metodo_pagamento: "pix", status_comissao: "expired" }, AGORA.getTime())).toBe("vencida");

    const reembolso = lerUm(aviso("PURCHASE_REFUNDED", compra({ status: "REFUNDED" })));
    expect(reembolso).toMatchObject({ dataEvento: AVISO, receita: { situacao: "revertido" }, venda: { reembolsadoEm: AVISO, chargebackEm: null } });

    const cb = lerUm(aviso("PURCHASE_CHARGEBACK", compra({ status: "CHARGEBACK" })));
    expect(cb).toMatchObject({ receita: { situacao: "revertido" }, venda: { chargebackEm: AVISO, reembolsadoEm: null } });

    // O pedido de reembolso segue pago, sem o "em risco" (o reembolso_pedido_em nunca sairia).
    const protesto = lerUm(aviso("PURCHASE_PROTEST", compra({ status: "DISPUTE" })));
    expect(protesto).toMatchObject({ dataEvento: AVISO, receita: { situacao: "pago" }, venda: { reembolsoPedidoEm: null } });

    const completa = lerUm(aviso("PURCHASE_COMPLETE", compra({ status: "COMPLETE" })));
    expect(completa).toMatchObject({ dataEvento: APROVADA, receita: { situacao: "pago" }, venda: { reembolsoPedidoEm: null } });
  });

  it("a situacao sai do evento, nunca do status: a aprovacao atrasada com status REFUNDED nao poe data no reembolso", () => {
    const atrasada = lerUm(aviso("PURCHASE_APPROVED", compra({ status: "REFUNDED" })));
    expect(atrasada).toMatchObject({ dataEvento: APROVADA, receita: { situacao: "pago" }, venda: { reembolsadoEm: null } });
  });

  it("reembolso parcial, abandono, assinatura, compra atrasada, logistica e evento novo: 200 ignorado", () => {
    expect(lerTodosHotmart(aviso("PURCHASE_REFUNDED", compra({ status: "PARTIALLY_REFUNDED" })), AGORA)).toEqual({ ok: true, eventos: [], ignorado: "reembolso parcial" });
    for (const e of ["PURCHASE_OUT_OF_SHOPPING_CART", "SUBSCRIPTION_CANCELLATION", "SWITCH_PLAN", "PURCHASE_DELAYED", "ORDER_FULFILLMENT", "CLUB_FIRST_ACCESS", "ALGO_NOVO"]) {
      expect(lerTodosHotmart({ event: e, data: {} }, AGORA), e).toEqual({ ok: true, eventos: [], ignorado: e });
    }
  });

  it("transacao de mais de 400 dias (reembolso de venda antiga): 200 ignorado, nunca 400 (a Hotmart desativa o webhook que da erro)", () => {
    const velha = Date.parse("2025-01-10T12:00:00.000Z");
    expect(lerTodosHotmart(aviso("PURCHASE_REFUNDED", compra({ order_date: velha, approved_date: velha })), AGORA)).toEqual({
      ok: true,
      eventos: [],
      ignorado: "transacao de mais de 400 dias",
    });
  });

  it("order_date em segundos ou ISO tambem vale; creation_date torto cai na hora da chegada", () => {
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ order_date: Math.floor(Date.parse(PEDIDO) / 1000) }))).pedido.criadoEm).toBe(PEDIDO);
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ order_date: PEDIDO }))).pedido.criadoEm).toBe(PEDIDO);
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ order_date: String(Date.parse(PEDIDO)) }))).pedido.criadoEm).toBe(PEDIDO);
    expect(lerUm(aviso("PURCHASE_REFUNDED", compra(), {}, { creation_date: "ontem" })).dataEvento).toBe(AGORA.toISOString());
    // Sem order_date: a aprovacao.
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ order_date: null }))).pedido.criadoEm).toBe(APROVADA);
  });

  it("corpo torto, transacao torta e valor negativo: recusa com o motivo", () => {
    expect(lerTodosHotmart("x", AGORA)).toMatchObject({ ok: false });
    expect(lerTodosHotmart({ data: {} }, AGORA)).toEqual({ ok: false, erro: "event ausente" });
    expect(lerTodosHotmart({ event: "PURCHASE_APPROVED", data: {} }, AGORA)).toEqual({ ok: false, erro: "data.purchase ausente" });
    expect(lerTodosHotmart(aviso("PURCHASE_APPROVED", compra({ transaction: "HP 1;drop" })), AGORA)).toEqual({ ok: false, erro: "purchase.transaction invalido" });
    expect(lerTodosHotmart(aviso("PURCHASE_APPROVED", compra({ price: { value: -5, currency_value: "BRL" } })), AGORA)).toEqual({
      ok: false,
      erro: "purchase.price.value invalido",
    });
    // Sem price COM a linha do produtor: o aviso dele veio torto.
    expect(lerTodosHotmart(aviso("PURCHASE_APPROVED", compra({ price: undefined })), AGORA)).toEqual({ ok: false, erro: "purchase.price ausente" });
  });

  it("o aviso do afiliado (sem price, so a comissao AFFILIATE): 200 ignorado -- a conta produtora e afiliada recebe os dois", () => {
    const afiliado = aviso("PURCHASE_APPROVED", compra({ price: undefined, full_price: undefined }), {
      buyer: undefined,
      commissions: [{ value: 50, currency_value: "BRL", source: "AFFILIATE" }],
    });
    expect(lerTodosHotmart(afiliado, AGORA)).toEqual({ ok: true, eventos: [], ignorado: "aviso de afiliado" });
    // Com price, mas so a linha do afiliado: tambem nao e venda nossa.
    const comPreco = aviso("PURCHASE_APPROVED", compra(), { commissions: [{ value: 50, currency_value: "BRL", source: "AFFILIATE" }] });
    expect(lerTodosHotmart(comPreco, AGORA)).toEqual({ ok: true, eventos: [], ignorado: "aviso de afiliado" });
  });

  it("FlexPay: a cobranca depois da adesao e recorrencia (sem Purchase); a da adesao, nao", () => {
    const parcela = lerUm(aviso("PURCHASE_APPROVED", compra({ transaction: "HP30000000000002", flexPayPlan: { signupTransactionReference: TRANSACAO } })));
    expect(parcela.venda?.recorrencia).toBe(true);
    // O exemplo da doc poe o bloco em data, nao em purchase.
    const noData = lerUm(aviso("PURCHASE_APPROVED", compra({ transaction: "HP30000000000003" }), { flexPayPlan: { signupTransactionReference: TRANSACAO } }));
    expect(noData.venda?.recorrencia).toBe(true);
    const adesao = lerUm(aviso("PURCHASE_APPROVED", compra({ flexPayPlan: { signupTransactionReference: TRANSACAO } })));
    expect(adesao.venda?.recorrencia).toBe(false);
  });
});

describe("dinheiro: comissoes e venda em outra moeda", () => {
  it("coprodutor e addon tambem sao comissoes; sem a linha do produtor, sem taxa e o liquido e o que sobra", () => {
    const ev = lerUm(
      aviso("PURCHASE_APPROVED", compra(), {
        commissions: [
          { value: 19.6, currency_value: "BRL", source: "MARKETPLACE" },
          { value: 30, currency_value: "BRL", source: "COPRODUCER" },
          { value: 7.4, currency_value: "BRL", source: "ADDON" },
          { value: 140, currency_value: "BRL", source: "PRODUCER" },
        ],
      })
    );
    expect(ev).toMatchObject({ pedido: { valor: 197 }, receita: { valor: 140 }, venda: { comissoes: 37.4, taxa: 19.6 } });

    const semProdutor = lerUm(aviso("PURCHASE_APPROVED", compra(), { commissions: [{ value: 19.6, currency_value: "BRL", source: "MARKETPLACE" }] }));
    expect(semProdutor).toMatchObject({ receita: { valor: 197 }, venda: { taxa: null, comissoes: 0 } });
  });

  it("venda em USD com a conversao da comissao do produtor para BRL: tudo em BRL, o price e as comissoes pela mesma taxa", () => {
    const ev = lerUm(
      aviso("PURCHASE_APPROVED", compra({ price: { value: 20, currency_value: "USD" }, checkout_country: { name: "United States", iso: "US" } }), {
        commissions: [
          { value: 2, currency_value: "USD", source: "MARKETPLACE" },
          { value: 5, currency_value: "USD", source: "AFFILIATE" },
          { value: 13, currency_value: "USD", source: "PRODUCER", currency_conversion: { converted_value: 68.51, converted_to_currency: "BRL", conversion_rate: 5.27 } },
        ],
      })
    );
    expect(ev.pedido).toMatchObject({ moeda: "BRL", valor: 105.4 });
    expect(ev.receita).toMatchObject({ valor: 68.51, moeda: "BRL" });
    expect(ev.venda).toMatchObject({ comissoes: 26.35, taxa: 10.54 });
  });

  it("venda em COP (o numero cru passa de 100 mil): o teto vale depois da conversao, e a venda entra em BRL", () => {
    const ev = lerUm(
      aviso("PURCHASE_APPROVED", compra({ price: { value: 380000, currency_value: "COP" }, checkout_country: { name: "Colombia", iso: "CO" } }), {
        commissions: [
          { value: 50000, currency_value: "COP", source: "MARKETPLACE" },
          { value: 330000, currency_value: "COP", source: "PRODUCER", currency_conversion: { converted_value: 429, converted_to_currency: "BRL", conversion_rate: 0.0013 } },
        ],
      })
    );
    expect(ev.pedido).toMatchObject({ moeda: "BRL", valor: 494 });
    expect(ev.receita).toMatchObject({ valor: 429, moeda: "BRL" });
    expect(ev.venda).toMatchObject({ taxa: 65, comissoes: 0 });
  });

  it("acima do teto ja na moeda de quem recebe: 200 ignorado, nunca 400 (a Hotmart desativa o webhook que da erro)", () => {
    const r = lerTodosHotmart(aviso("PURCHASE_APPROVED", compra({ price: { value: 250000, currency_value: "BRL" } }), { commissions: [{ value: 225000, currency_value: "BRL", source: "PRODUCER" }] }), AGORA);
    expect(r).toEqual({ ok: true, eventos: [], ignorado: "valor acima do teto" });
  });

  it("o aviso do coprodutor (sem PRODUCER): o liquido e a comissao dele, a taxa so a da Hotmart, o resto e comissao", () => {
    const ev = lerUm(
      aviso("PURCHASE_APPROVED", compra(), {
        commissions: [
          { value: 19.6, currency_value: "BRL", source: "MARKETPLACE" },
          { value: 40, currency_value: "BRL", source: "COPRODUCER" },
        ],
      })
    );
    expect(ev).toMatchObject({ pedido: { valor: 197 }, receita: { valor: 40 }, venda: { taxa: 19.6, comissoes: 137.4 } });
  });

  it("price em EUR e comissoes ja em BRL, sem conversao: o faturamento e a soma das comissoes (elas repartem o price)", () => {
    const ev = lerUm(aviso("PURCHASE_APPROVED", compra({ price: { value: 34, currency_value: "EUR" } })));
    expect(ev.pedido).toMatchObject({ moeda: "BRL", valor: 197 });
    expect(ev.receita.valor).toBe(127.4);
  });

  it("comissao do produtor em outra moeda sem conversao: recusa (o liquido iria na moeda errada)", () => {
    const r = lerTodosHotmart(
      aviso("PURCHASE_APPROVED", compra(), {
        commissions: [
          { value: 19.6, currency_value: "BRL", source: "MARKETPLACE" },
          { value: 20, currency_value: "USD", source: "PRODUCER" },
        ],
      }),
      AGORA
    );
    // O alvo e a moeda do produtor (USD): o price em BRL nao tem cambio, e a soma mistura moedas.
    expect(r).toMatchObject({ ok: false });
  });
});

describe("recorrencia: entra no lucro, nao vai ao Meta/TikTok", () => {
  it("renovacao (recurrence_number > 1) e antecipacao de assinatura", () => {
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ recurrence_number: 3 }))).venda?.recorrencia).toBe(true);
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ subscription_anticipation_purchase: true }))).venda?.recorrencia).toBe(true);
    expect(lerUm(aviso("PURCHASE_APPROVED", compra({ recurrence_number: 1 }))).venda?.recorrencia).toBe(false);
  });
});

describe("teste: o 'Enviar teste' da Hotmart e o nosso nunca viram pedido", () => {
  /** O exemplo da doc, que o "Enviar teste" manda: datas sem sentido, comprador buyer@email.com. */
  const EXEMPLO_DA_DOC = {
    id: "1234567890123456789",
    creation_date: 12345678,
    event: "PURCHASE_APPROVED",
    version: "2.0.0",
    data: {
      product: { id: 213344, ucode: "2e9c43a9-0aeb-48ed-9464-630f845c23af", name: "Product Name" },
      buyer: { email: "buyer@email.com", name: "Buyer Name", checkout_phone: "999999999" },
      commissions: [
        { value: 0.65, currency_value: "BRL", source: "MARKETPLACE" },
        { value: 3.1, currency_value: "USD", source: "PRODUCER", currency_conversion: { converted_value: 16.34, converted_to_currency: "BRL", conversion_rate: 5.271103 } },
      ],
      purchase: { approved_date: 1231241434453, price: { value: 150.6, currency_value: "BRL" }, order_date: "123243546", status: "STARTED", transaction: "HP02316330308193" },
    },
  };

  it("o exemplo da doc: teste, antes das datas e do dinheiro", () => {
    expect(lerUm(EXEMPLO_DA_DOC)).toMatchObject({ teste: true, evento: "PURCHASE_APPROVED" });
    // Com outra transacao, o comprador da doc ainda marca (buyer@email.com + Buyer Name).
    const outro = structuredClone(EXEMPLO_DA_DOC);
    outro.data.purchase.transaction = "HP11112222333344";
    expect(lerUm(outro).teste).toBe(true);
  });

  it("comprador @example.com e teste; buyer@email.com com outro nome nao e", () => {
    expect(lerUm(aviso("PURCHASE_APPROVED", compra(), { buyer: { email: "testeComprador271101postman15@example.com", name: "Teste Comprador" } })).teste).toBe(true);
    expect(lerUm(aviso("PURCHASE_APPROVED", compra(), { buyer: { email: "buyer@email.com", name: "Joana Lima" } })).teste).toBe(false);
  });

  it("o nosso exemplo: transacao fixa, e o header do assinar passa no autenticar", () => {
    const raw = JSON.stringify(exemploHotmart(AGORA));
    expect(lerUm(JSON.parse(raw))).toMatchObject({ teste: true, pedidoId: ID_TESTE });
    expect(autenticarHotmart(raw, new Headers(assinarHotmart(raw, HOTTOK)), HOTTOK)).toEqual({ ok: true });
  });
});

describe("autenticarHotmart", () => {
  it("hottok certo no header: ok; no corpo (o teste antigo), tambem; errado, ausente ou sem hottok salvo: recusa", () => {
    const raw = JSON.stringify(aviso("PURCHASE_APPROVED"));
    expect(autenticarHotmart(raw, new Headers({ "X-HOTMART-HOTTOK": HOTTOK }), HOTTOK)).toEqual({ ok: true });
    expect(autenticarHotmart(JSON.stringify({ ...aviso("PURCHASE_APPROVED"), hottok: HOTTOK }), new Headers(), HOTTOK)).toEqual({ ok: true });
    expect(autenticarHotmart(raw, new Headers({ "X-HOTMART-HOTTOK": "outro-hottok-qualquer" }), HOTTOK)).toMatchObject({ ok: false, erro: "X-HOTMART-HOTTOK nao confere" });
    expect(autenticarHotmart(raw, new Headers(), HOTTOK)).toMatchObject({ ok: false, erro: "X-HOTMART-HOTTOK ausente" });
    expect(autenticarHotmart(raw, new Headers({ "X-HOTMART-HOTTOK": HOTTOK }), null)).toMatchObject({ ok: false, semSegredo: true });
    // O header vence o corpo: o hottok do corpo nao conserta um header errado.
    expect(
      autenticarHotmart(JSON.stringify({ hottok: HOTTOK }), new Headers({ "X-HOTMART-HOTTOK": "outro-hottok-qualquer" }), HOTTOK)
    ).toMatchObject({ ok: false });
  });

  it("o registro: venda, token no header, reenvio por status (503 na hora), a tela e a ponte com o sck", () => {
    expect(plataformaDe("hotmart")).toBe(hotmart);
    expect(hotmart).toMatchObject({ modelo: "venda", autenticacao: "token_no_header", reenvio: "status", eventoDeVenda: "PURCHASE_APPROVED" });
    expect(modeloDaPlataforma("hotmart")).toBe("venda");
    expect(rastreiaCompra("hotmart")).toBe(true);
    expect(usaSegredo("hotmart")).toBe(true);
    expect(nomeDoSegredo("hotmart")).toBe("token");
    expect(MOEDA_PADRAO.hotmart).toBe("BRL");
    expect(PLATAFORMAS_CHECKOUT.find((p) => p.id === "hotmart")?.ativa).toBe(true);
    expect(HOST_DO_CHECKOUT.hotmart).toBe("pay.hotmart.com");
    expect(scriptDaPonteDoCheckout("https://user.xcart.app/", "ck-1", "hotmart")).toBe(
      '<script src="https://user.xcart.app/xcart-bridge.js" data-xcart-destinos="pay.hotmart.com" data-xcart-checkout="ck-1" data-xcart-param-vid="sck" defer></script>'
    );
    // A Cakto segue no callback (sem o atributo).
    expect(scriptDaPonteDoCheckout("https://user.xcart.app", "ck-1", "cakto")).not.toContain("data-xcart-param-vid");
    expect(rotuloDoEvento("PURCHASE_BILLET_PRINTED")).toBe("Aguardando pagamento");
    expect(rotuloDoEvento("PURCHASE_PROTEST")).toBe("Reembolso pedido");
    for (const g of hotmart.gatilhos) expect(g.length).toBeLessThanOrEqual(40);
  });
});

describe("o formato do aviso real (085)", () => {
  it("caminhos de chave, o valor so da origem, o evento e o tipo do order_date; nada do comprador nem o hottok", () => {
    const f = formatoDoAvisoHotmart({ ...aviso("PURCHASE_APPROVED"), hottok: HOTTOK }, AGORA) as Record<string, unknown>;
    expect(f).toMatchObject({
      em: AGORA.toISOString(),
      evento: "PURCHASE_APPROVED",
      status: "APPROVED",
      pagamento: "PIX",
      order_date: "number:13",
      origem: { "data.purchase.origin.sck": `xc.${VID}`, "data.purchase.origin.src": "vsl", "data.purchase.origin.xcod": "lista" },
    });
    expect(f.chaves).toContain("data.purchase.buyer_ip");
    expect(f.chaves).toContain("data.buyer.email");
    const texto = JSON.stringify(f);
    for (const dado of [...DADOS_DO_COMPRADOR, "200.150.10.20", HOTTOK]) expect(texto, dado).not.toContain(dado);
    expect(texto).not.toContain('"hottok"');
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

function memoria(opcoes: { falharInsert?: number } = {}): Memoria {
  let falhas = opcoes.falharInsert ?? 0;
  const m: Memoria = { eventos: new Set(), pedidos: new Map(), marcas: [], repo: undefined as never };
  m.repo = {
    async travarEvento(x) {
      const k = `${x.pedido_id}|${x.evento}`;
      if (m.eventos.has(k)) return "duplicado";
      m.eventos.add(k);
      return "ok";
    },
    async soltarEvento(x) {
      m.eventos.delete(`${x.pedido_id}|${x.evento}`);
    },
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
  id: "ck-hotmart",
  user_id: "u-1",
  plataforma: "hotmart",
  nome: "Hotmart Curso X",
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
  opcoes: { checkout?: Partial<CheckoutParaReceber>; segredo?: string | null; hottok?: string; rastreio?: RastreioCheckout } = {}
) {
  const raw = JSON.stringify(c);
  return receberEvento(
    m.repo,
    { ...CHECKOUT, ...opcoes.checkout },
    hotmart,
    JSON.parse(raw),
    AGORA,
    { raw, headers: new Headers({ "X-HOTMART-HOTTOK": opcoes.hottok ?? HOTTOK }), segredo: opcoes.segredo === undefined ? HOTTOK : opcoes.segredo },
    opcoes.rastreio
  );
}

describe("receberEvento (Hotmart): origem, idempotencia e ordem", () => {
  it("sem hottok salvo: 401, o erro fala em token e no reenvio do Historico", async () => {
    const m = memoria();
    const r = await receber(m, aviso("PURCHASE_APPROVED"), { segredo: null });
    expect(r.status).toBe(401);
    expect(String(m.marcas.at(-1)?.ultimo_erro)).toBe("Cole aqui o token do webhook da Hotmart e use o reenvio no Histórico do webhook dela.");
    expect(m.pedidos.size).toBe(0);
  });

  it("hottok errado: 401 com 'O token da Hotmart não confere'", async () => {
    const m = memoria();
    const r = await receber(m, aviso("PURCHASE_APPROVED"), { hottok: "outro-hottok-qualquer" });
    expect(r.status).toBe(401);
    expect(String(m.marcas.at(-1)?.ultimo_erro)).toMatch(/^O token da Hotmart não confere/);
  });

  it("Pix gerado -> aprovado -> reembolsado: cada etapa uma vez; a retentativa cai em duplicado", async () => {
    const m = memoria();
    expect((await receber(m, aviso("PURCHASE_BILLET_PRINTED", pixGerado()))).status).toBe(200);
    expect((await receber(m, aviso("PURCHASE_APPROVED"))).status).toBe(200);
    expect(await receber(m, aviso("PURCHASE_APPROVED"))).toMatchObject({ status: 200, corpo: { ok: true, duplicado: true } });
    await receber(m, aviso("PURCHASE_REFUNDED", compra({ status: "REFUNDED" })));
    const p = m.pedidos.get(TRANSACAO)!;
    expect(p).toMatchObject({ situacao: "revertido", valor: 197, receita: 127.4, taxa: 19.6, comissoes: 50, grupo: TRANSACAO, pago_em: APROVADA, reembolsado_em: AVISO, criado_em: PEDIDO });
    expect(m.eventos).toEqual(new Set([`${TRANSACAO}|PURCHASE_BILLET_PRINTED`, `${TRANSACAO}|PURCHASE_APPROVED`, `${TRANSACAO}|PURCHASE_REFUNDED`]));
  });

  it("aprovacao antes do 'aguardando' (a ordem nao e garantida): o atrasado nao volta para pendente", async () => {
    const m = memoria();
    await receber(m, aviso("PURCHASE_APPROVED"));
    await receber(m, aviso("PURCHASE_BILLET_PRINTED", pixGerado()));
    expect(m.pedidos.get(TRANSACAO)?.situacao).toBe("pago");
  });

  it("falha nossa: 503 na hora (a Hotmart reenvia ate 5 vezes) e o erro na tela com o reenvio do Historico", async () => {
    const m = memoria({ falharInsert: 1 });
    const r = await receber(m, aviso("PURCHASE_APPROVED"));
    expect(r).toMatchObject({ status: 503 });
    expect(r.segurar).toBeUndefined();
    expect(String(m.marcas.at(-1)?.ultimo_erro)).toBe(
      "Falha nossa ao gravar um evento. A Hotmart tenta de novo até 5 vezes; se o erro ficar, use o reenvio no Histórico do webhook dela."
    );
    expect((await receber(m, aviso("PURCHASE_APPROVED"))).status).toBe(200);
    expect(m.pedidos.size).toBe(1);
  });

  it("o 'Enviar teste' e o nosso: 200 teste, nada travado nem gravado", async () => {
    const m = memoria();
    const r = await receber(m, exemploHotmart(AGORA) as Dados);
    expect(r).toMatchObject({ status: 200, corpo: { ok: true, teste: true } });
    expect(m.eventos.size).toBe(0);
    expect(m.pedidos.size).toBe(0);
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_evento: "PURCHASE_APPROVED", ultimo_evento_teste: true });
  });

  it("Venda no celular: a aprovacao avisa uma vez, com o liquido; o formato do aviso real fica no checkout", async () => {
    const m = memoria();
    const r = await receber(m, aviso("PURCHASE_APPROVED"));
    expect(r.notificar).toMatchObject({ tipo: "venda", pedido: `#${TRANSACAO}`, produto: "Curso Método X", valor: 197, comissao: 127.4, moeda: "BRL" });
    expect((await receber(m, aviso("PURCHASE_APPROVED"))).notificar).toBeNull();
    expect(m.marcas.find((x) => x.ultimo_formato)?.ultimo_formato).toMatchObject({ evento: "PURCHASE_APPROVED" });
  });

  it("com o aviso de pendente ligado: o Pix gerado avisa; o cartao em analise nao", async () => {
    const pedindo = { checkout: { notificar_pendente: true } };
    const m = memoria();
    expect((await receber(m, aviso("PURCHASE_BILLET_PRINTED", pixGerado()), pedindo)).notificar).toMatchObject({ tipo: "pendente", metodo: "pix" });
    const cartao = compra({ transaction: "HP55550000000001", status: "UNDER_ANALISYS", approved_date: null, payment: { type: "CREDIT_CARD" } });
    expect((await receber(memoria(), aviso("PURCHASE_BILLET_PRINTED", cartao), pedindo)).notificar).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A compra pelo servidor e a campanha pela ponte
// ---------------------------------------------------------------------------

const META: DestinoDoCheckout = { id: "d-meta", plataforma: "meta", conta: "123456789012345", token: "EAAtoken123456", testEventCode: null, ativo: true };
const TIKTOK: DestinoDoCheckout = { id: "d-tt", plataforma: "tiktok", conta: "CUSG5HBC77UD11VVRQEG", token: "tt-token-1234567", testEventCode: null, ativo: true };

/** A identidade que a ponte gravou na VSL (Fase D), com a UTM do clique. */
const IDENTIDADE: IdentidadeGuardada = {
  visitorId: VID,
  fbp: "fb.1.1761900000000.1234567890",
  fbclid: "IwAR3xK9mP2qL8nR5vT7wY1zA4bC6dE8fG0hI2jK4lM6nO8pQ",
  ttclid: "E.C.P.1234567890abcdef1234567890abcdef",
  clientIp: "177.10.20.30",
  userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)",
  utm: { source: "facebook", medium: "120211234567890123", campaign: "Campanha X|120219876543210987", content: "Anuncio Y|120215555555555555" },
  utmEm: "2026-10-31T14:05:00.000Z",
};

/** A fila com o indice unico (destino_id, event_id) da 073. */
function fila(destinos: DestinoDoCheckout[] = [META, TIKTOK], identidade: IdentidadeGuardada | null = IDENTIDADE) {
  const linhas: EnvioGravado[] = [];
  const procurados: string[] = [];
  const rastreio: RastreioCheckout = {
    async destinos() {
      return destinos;
    },
    async identidade(checkoutId, vid) {
      procurados.push(`${checkoutId}|${vid}`);
      return vid === VID ? identidade : null;
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
  return { rastreio, linhas, procurados };
}

const metaDe = (f: ReturnType<typeof fila>) => f.linhas.filter((l) => l.plataforma === "meta").map((l) => l.payload as EventoCapi);
const tiktokDe = (f: ReturnType<typeof fila>) => f.linhas.filter((l) => l.plataforma === "tiktok").map((l) => l.payload as EventoTiktok);

describe("a compra pelo servidor (Hotmart)", () => {
  it("Pix gerado (padrao): uma compra na criacao, com o buyer_ip e o visitante da ponte pelo sck; a aprovacao nao manda de novo", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, aviso("PURCHASE_BILLET_PRINTED", pixGerado()), { rastreio: f.rastreio });
    await receber(m, aviso("PURCHASE_APPROVED"), { rastreio: f.rastreio });
    expect(f.linhas.map((l) => l.event_id)).toEqual([`purchase_hotmart_${TRANSACAO}`, `purchase_hotmart_${TRANSACAO}`]);
    const [meta] = metaDe(f);
    expect(meta).toMatchObject({
      event_name: "Purchase",
      event_id: `purchase_hotmart_${TRANSACAO}`,
      event_time: Math.floor(Date.parse(PEDIDO) / 1000),
      event_source_url: "https://pay.hotmart.com/",
      custom_data: { currency: "BRL", value: 197, content_ids: ["4774438"], order_id: TRANSACAO },
    });
    // O IP do webhook (quem pagou) vence o da ponte; user agent, _fbp e o clique sao da ponte.
    expect(meta.user_data).toMatchObject({
      client_ip_address: "200.150.10.20",
      client_user_agent: IDENTIDADE.userAgent,
      fbp: IDENTIDADE.fbp,
      fbc: `fb.1.${Date.parse(IDENTIDADE.utmEm!)}.${IDENTIDADE.fbclid}`,
    });
    expect(tiktokDe(f)[0].user).toMatchObject({ ttclid: IDENTIDADE.ttclid, ip: "200.150.10.20" });
    // A identidade foi lida uma vez por entrega (a campanha e a compra leem a mesma).
    expect(f.procurados).toEqual([`ck-hotmart|${VID}`, `ck-hotmart|${VID}`]);
  });

  it("o pedido herda a campanha do clique da ponte (o webhook nao manda UTM)", async () => {
    const m = memoria();
    await receber(m, aviso("PURCHASE_APPROVED"), { rastreio: fila().rastreio });
    expect(m.pedidos.get(TRANSACAO)).toMatchObject({
      utm_source: "facebook",
      utm_campaign: "Campanha X|120219876543210987",
      utm_content: "Anuncio Y|120215555555555555",
      campanha_id: "120219876543210987",
      anuncio_id: "120215555555555555",
    });
  });

  it("clique de mais de 7 dias antes do pedido, clique depois dele, ou sem o visitante no sck: o pedido fica sem campanha", async () => {
    const velho = memoria();
    await receber(velho, aviso("PURCHASE_APPROVED"), { rastreio: fila([META], { ...IDENTIDADE, utmEm: "2026-10-20T10:00:00.000Z" }).rastreio });
    expect(velho.pedidos.get(TRANSACAO)).toMatchObject({ utm_source: null, campanha_id: null });

    // Clique DEPOIS do pedido (o remarketing de quem gerou o Pix e pagou depois): nao e a origem da venda.
    const depois = memoria();
    await receber(depois, aviso("PURCHASE_APPROVED"), { rastreio: fila([META], { ...IDENTIDADE, utmEm: "2026-10-31T14:45:00.000Z" }).rastreio });
    expect(depois.pedidos.get(TRANSACAO)).toMatchObject({ utm_source: null });
    // Dentro da folga de 10 min do relogio, vale.
    const folga = memoria();
    await receber(folga, aviso("PURCHASE_APPROVED"), { rastreio: fila([META], { ...IDENTIDADE, utmEm: "2026-10-31T14:25:00.000Z" }).rastreio });
    expect(folga.pedidos.get(TRANSACAO)).toMatchObject({ utm_source: "facebook" });

    const semVid = memoria();
    const f = fila([META]);
    await receber(semVid, aviso("PURCHASE_APPROVED", compra({ origin: { src: "vsl" } })), { rastreio: f.rastreio });
    expect(semVid.pedidos.get(TRANSACAO)).toMatchObject({ utm_source: null });
    expect(f.procurados).toEqual([]);
  });

  it("a leitura da identidade que falha nao derruba a venda: o pedido entra sem campanha", async () => {
    const m = memoria();
    const f = fila([META]);
    f.rastreio.identidade = async () => {
      throw new Error("banco fora");
    };
    expect((await receber(m, aviso("PURCHASE_APPROVED"), { rastreio: f.rastreio })).status).toBe(200);
    expect(m.pedidos.get(TRANSACAO)).toMatchObject({ situacao: "pago", utm_source: null });
    expect(f.linhas).toHaveLength(1);
  });

  it("order bump em outro aviso, mesmo chegando ANTES: a compra sai so com a principal (valor e produto dela); o Dashboard junta pela principal", async () => {
    const m = memoria();
    const f = fila([META]);
    const bump = compra({ transaction: "HP99990000000001", price: { value: 47, currency_value: "BRL" }, order_bump: { is_order_bump: true, parent_purchase_transaction: TRANSACAO } });
    await receber(m, aviso("PURCHASE_APPROVED", bump, { commissions: [{ value: 4.7, currency_value: "BRL", source: "MARKETPLACE" }, { value: 42.3, currency_value: "BRL", source: "PRODUCER" }] }), {
      rastreio: f.rastreio,
    });
    expect(f.linhas).toHaveLength(0);
    await receber(m, aviso("PURCHASE_APPROVED"), { rastreio: f.rastreio });
    expect(m.pedidos.size).toBe(2);
    expect(m.pedidos.get("HP99990000000001")).toMatchObject({ grupo: TRANSACAO, oferta_tipo: "orderbump" });
    expect(metaDe(f).map((e) => e.event_id)).toEqual([`purchase_hotmart_${TRANSACAO}`]);
    expect(metaDe(f)[0].custom_data).toMatchObject({ value: 197, order_id: TRANSACAO });
  });

  it("so aprovadas: o Pix gerado nao manda; renovacao, reembolso, chargeback e o teste nunca mandam", async () => {
    const m = memoria();
    const f = fila([META]);
    await receber(m, aviso("PURCHASE_BILLET_PRINTED", pixGerado()), { rastreio: f.rastreio, checkout: { compra_quando: "aprovada" } });
    expect(f.linhas).toHaveLength(0);
    await receber(m, aviso("PURCHASE_APPROVED", compra({ transaction: "HP20000000000001", recurrence_number: 2 })), { rastreio: f.rastreio });
    await receber(m, aviso("PURCHASE_REFUNDED", compra({ transaction: "HP20000000000002", status: "REFUNDED" })), { rastreio: f.rastreio });
    await receber(m, aviso("PURCHASE_CHARGEBACK", compra({ transaction: "HP20000000000003", status: "CHARGEBACK" })), { rastreio: f.rastreio });
    await receber(m, exemploHotmart(AGORA) as Dados, { rastreio: f.rastreio });
    expect(f.linhas).toHaveLength(0);
    expect(m.pedidos.size).toBe(4);
  });

  it("venda da Cakto/Hubla que ja traz UTM: a ponte nao troca a campanha do webhook", async () => {
    const m = memoria();
    const f = fila([META]);
    // O adaptador da Hotmart nunca traz UTM; aqui o evento chega com ela, como o da Hubla.
    const comUtm: RastreioCheckout = f.rastreio;
    const r = await receberEvento(
      m.repo,
      CHECKOUT,
      {
        ...hotmart,
        lerTodos: (c, agora) => {
          const lido = lerTodosHotmart(c, agora);
          if (!lido.ok) return lido;
          return { ok: true, eventos: lido.eventos.map((e) => ({ ...e, rastreio: { ...e.rastreio!, utm: { source: "google", campaign: "Outra|999" } } })) };
        },
      },
      aviso("PURCHASE_APPROVED"),
      AGORA,
      { raw: JSON.stringify(aviso("PURCHASE_APPROVED")), headers: new Headers({ "X-HOTMART-HOTTOK": HOTTOK }), segredo: HOTTOK },
      comUtm
    );
    expect(r.status).toBe(200);
    expect(m.pedidos.get(TRANSACAO)).toMatchObject({ utm_source: "google", utm_campaign: "Outra|999" });
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
      aviso("PURCHASE_BILLET_PRINTED", pixGerado()),
      aviso("PURCHASE_BILLET_PRINTED", pixGerado()),
      aviso("PURCHASE_APPROVED"),
      aviso("PURCHASE_REFUNDED", compra({ status: "REFUNDED" })),
      aviso("PURCHASE_OUT_OF_SHOPPING_CART"),
      aviso("PURCHASE_APPROVED", compra({ price: { value: "abc", currency_value: "BRL" } })),
    ]) {
      const r = await receber(m, c, pedindo);
      if (r.notificar) notificacoes.push(vendaDoPedidoExterno(r.notificar));
    }
    const gravado = JSON.stringify({ pedidos: [...m.pedidos.values()], eventos: [...m.eventos], marcas: m.marcas, notificacoes, logs });
    expect(m.pedidos.size).toBe(1);
    for (const dado of DADOS_DO_COMPRADOR) expect(gravado, dado).not.toContain(dado);
    const ev = lerUm(aviso("PURCHASE_APPROVED"));
    expect(JSON.stringify(ev)).not.toContain("39053344705");
    // No Brasil o checkout_phone_code e o DDD.
    expect(ev.comprador).toEqual({
      nome: "Ana Souza",
      email: "ana.souza@provedor.com.br",
      telefone: "31988887777",
      pais: "BR",
      estado: "MG",
      cidade: "Belo Horizonte",
      cep: "30150101",
    });
  });

  it("telefone de fora do Brasil ja vem com o DDI: ganha o '+'", () => {
    const ev = lerUm(
      aviso("PURCHASE_APPROVED", compra({ checkout_country: { name: "Portugal", iso: "PT" } }), {
        buyer: { email: "joao@provedor.pt", name: "João", checkout_phone: "351912345678", address: { country_iso: "PT" } },
      })
    );
    expect(ev.comprador).toMatchObject({ telefone: "+351912345678", pais: "PT" });
  });

  it("migration 088: Hotmart nos dois CHECKs de plataforma, sem coluna nova", () => {
    const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/088_checkout_hotmart.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).toMatch(/checkouts_externos_plataforma_check check \(plataforma in \('sphere', 'cakto', 'hubla', 'eve', 'hotmart'\)\)/);
    expect(sql).toMatch(/checkout_externo_contas_plataforma_check check \(plataforma in \('sphere', 'cakto', 'hubla', 'eve', 'hotmart'\)\)/);
    expect(sql).not.toMatch(/add column/i);
  });
});
