import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CALLBACK_TESTE,
  ID_TESTE,
  assinarCakto,
  autenticarCakto,
  cakto,
  exemploCakto,
  lerTodosCakto,
} from "@/lib/checkouts-externos/plataformas/cakto";
import { lerData as lerDataSphere, sphere } from "@/lib/checkouts-externos/plataformas/sphere";
import { plataformaDe } from "@/lib/checkouts-externos/plataformas";
import type { EventoNormalizado } from "@/lib/checkouts-externos/plataformas";
import {
  receberEvento,
  type CheckoutParaReceber,
  type MarcaCheckout,
  type Notificacao,
  type PedidoGravado,
  type RepositorioCheckout,
} from "@/lib/checkouts-externos/receber";
import { vendaDoPedidoExterno } from "@/lib/checkouts-externos/notificar";
import { mensagemDaVenda } from "@/lib/alertas/venda-webhook";
import { estadoDaVenda, pendenteVencida } from "@/lib/checkouts-externos/venda";
import { CAMPOS_VENDA } from "@/lib/checkouts-externos/estado";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IndicadoresKpiCod, IndicadoresTopoCod, type BaseIndicadores } from "@/app/(dashboard)/financeiro/indicadores";
import { composicaoCod } from "@/app/(dashboard)/financeiro/lucro-dados";
import { calcularFinanceiro, type EntradaFinanceiro, type LojaFinanceira, type PedidoExternoFin } from "@/lib/financeiro/calculo";
import { montarPedidosExternos } from "@/lib/checkouts-externos/pedidos";
import type { PedidoExternoRow } from "@/lib/checkouts-externos/tipos";
import type { AdAccountRow, AdSpendDailyRow, FxRateRow } from "@/lib/financeiro/tipos";

// A Cakto: o checkout de VENDA PROPRIA. O webhook (V1 objeto, V2 lista)
// vira pedidos com faturamento, taxa, comissoes e liquido; a origem e
// conferida pelo HMAC do corpo cru; o teste da Cakto e o nosso nunca viram
// pedido; dado pessoal do comprador nunca e gravado. No Dashboard, a venda
// conta como loja online (fora do contra entrega) e o pedido e a cobranca.

const AGORA = new Date("2026-10-18T15:00:00.000Z");
const SECRET = "b3f1a9c2-7b4d-4a8e-9f01-2c6d5b8a4e37";

/** O que nunca pode aparecer em nada que o xcart grava ou loga. */
const DADOS_DO_COMPRADOR = [
  "Ana Souza",
  "ana.souza",
  "provedor.com.br",
  "5534988887777",
  "34988887777",
  "39053344705",
  "Rua das Palmeiras",
  "38400-000",
  "Uberlândia",
  "ANA S LIMA",
];

type Dados = Record<string, unknown>;

/** Uma venda aprovada no cartao, no formato da doc (45 campos), com dado pessoal ficticio. */
function venda(extra: Dados = {}): Dados {
  return {
    id: "b3df956e-1998-4322-b091-ac0c54f7b4ba",
    refId: "4852F91",
    status: "paid",
    offer_type: "main",
    // O id da PAGINA de checkout: igual em toda venda dela.
    checkout: 1101387,
    parent_order: "",
    affiliate: "",
    checkoutUrl:
      "https://pay.cakto.com.br/a8BcHrY_1101387?utm_source=FB&email=ana.souza%40provedor.com.br&name=Ana%20Souza",
    callback: null,
    sck: null,
    fbc: "fb.1.1760799000000.IwAR0abc",
    fbp: "fb.1.1760799000000.1234567890",
    utm_source: "FB",
    utm_medium: "Conjunto A|120222222222222222",
    utm_campaign: "Campanha X|120211111111111111",
    utm_content: "Anuncio 1|120233333333333333",
    utm_term: "Instagram_Feed",
    baseAmount: 97.0,
    amount: 97.99,
    currency: "BRL",
    fees: 6.78,
    discount: "0.00",
    charged_fees: "0.99",
    interest: null,
    additionalInstallmentInterest: "0.00",
    installments: 1,
    couponCode: null,
    reason: null,
    refund_reason: null,
    paymentMethod: "credit_card",
    paymentMethodName: "Cartão de Crédito",
    customer: {
      id: 481920,
      name: "Ana Souza Lima",
      email: "ana.souza@provedor.com.br",
      phone: "5534988887777",
      birthDate: null,
      docType: "cpf",
      docNumber: "39053344705",
    },
    address: {
      country: "BR",
      state: "MG",
      city: "Uberlândia",
      zipcode: "38400-000",
      street: "Rua das Palmeiras",
      number: "123",
      neighborhood: "Centro",
      complement: "",
    },
    shipping: null,
    product: { id: "cd287b31-d4b7-4e94-858a-96e05ce2f4a2", short_id: "42bruPi", name: "Curso Método X", type: "unique" },
    offer: { id: "a8BcHrY", name: "Oferta principal", price: 97.0, currency: "BRL" },
    commissions: [{ user: "produtor@provedor.com.br", type: "producer", percentage: 100, totalAmount: 90.22 }],
    subscription: null,
    subscription_period: null,
    createdAt: "2026-10-18T11:58:00.123456-03:00",
    paidAt: "2026-10-18T11:59:30.654321-03:00",
    refundedAt: null,
    chargedbackAt: null,
    canceledAt: null,
    due_date: null,
    card: { holderName: "ANA S LIMA", lastDigits: "4242", brand: "visa" },
    ...extra,
  };
}

/** O mesmo pedido como Pix gerado (sem o bloco card, com o bloco pix). */
function pix(extra: Dados = {}): Dados {
  const d = venda({
    status: "waiting_payment",
    paymentMethod: "pix",
    paymentMethodName: "Pix",
    paidAt: null,
    pix: { qrCode: "00020101021226770014BR.GOV.BCB.PIX", expirationDate: "2026-10-19 14:58:00.387619+00:00" },
    ...extra,
  });
  delete d.card;
  return d;
}

/** O envelope { secret, event, data }, passado por JSON (como chega). */
function corpo(event: string, data: unknown, secret: string = SECRET): Dados {
  return JSON.parse(JSON.stringify({ secret, event, data }));
}

function ler(c: unknown): EventoNormalizado[] {
  const r = lerTodosCakto(c, AGORA);
  if (!r.ok) throw new Error(r.erro);
  return r.eventos;
}

// ---------------------------------------------------------------------------
// Adaptador
// ---------------------------------------------------------------------------

describe("lerTodosCakto: V1 (data objeto)", () => {
  it("compra aprovada: faturamento, taxa, liquido, datas em UTC e UTMs", () => {
    const [ev] = ler(corpo("purchase_approved", venda()));
    expect(ev).toMatchObject({
      evento: "purchase_approved",
      dataEvento: "2026-10-18T14:59:30.654Z",
      pedidoId: "b3df956e-1998-4322-b091-ac0c54f7b4ba",
      pedido: { status: "paid", metodo: "credit_card", produto: "Curso Método X", pais: "BR", moeda: "BRL", valor: 97, criadoEm: "2026-10-18T14:58:00.123Z" },
      receita: { valor: 90.22, moeda: "BRL", situacao: "pago", statusOriginal: "paid" },
      conta: null,
      programa: null,
      teste: false,
      venda: { taxa: 6.78, comissoes: 0, referencia: "4852F91", grupo: "4852F91", ofertaTipo: "main", venceEm: null },
    });
    expect(ev.rastreio).toEqual({
      utm: {
        source: "FB",
        medium: "Conjunto A|120222222222222222",
        campaign: "Campanha X|120211111111111111",
        content: "Anuncio 1|120233333333333333",
        term: "Instagram_Feed",
      },
      sck: null,
      callback: null,
      fbc: "fb.1.1760799000000.IwAR0abc",
      fbp: "fb.1.1760799000000.1234567890",
      // Da query, so os click ids (nenhum aqui).
      fbclid: null,
      ttclid: null,
      // Sem a query: o pre-preenchimento levava e-mail e nome.
      checkoutUrl: "https://pay.cakto.com.br/a8BcHrY_1101387",
      // O vid da ponte na query (callback/sck = xc.<vid>): nenhum aqui.
      vidNaUrl: null,
    });
    expect(ev.venda?.produtoId).toBe("cd287b31-d4b7-4e94-858a-96e05ce2f4a2");
  });

  it("o grupo NAO e o data.checkout (id da pagina, igual em toda venda): e o refId, ou o parent_order", () => {
    const [principal] = ler(corpo("purchase_approved", venda()));
    const [bump] = ler(
      corpo("purchase_approved", venda({ id: "c1111111-1111-4111-8111-111111111111", refId: "9BUMP01", offer_type: "orderbump", parent_order: "4852F91" }))
    );
    const [outraVenda] = ler(corpo("purchase_approved", venda({ id: "d2222222-2222-4222-8222-222222222222", refId: "7OUTRA2" })));
    expect(principal.venda?.grupo).toBe("4852F91");
    expect(bump.venda).toMatchObject({ grupo: "4852F91", ofertaTipo: "orderbump", referencia: "9BUMP01" });
    expect(outraVenda.venda?.grupo).toBe("7OUTRA2");
  });

  it("valores em string e numero; comissao de afiliado vira `comissoes`", () => {
    const [ev] = ler(
      corpo(
        "purchase_approved",
        venda({
          baseAmount: "100.00",
          discount: "10.00",
          fees: "8.10",
          commissions: [
            { type: "producer", totalAmount: "51.90" },
            { type: "affiliate", totalAmount: 30 },
          ],
        })
      )
    );
    expect(ev.pedido.valor).toBe(90);
    expect(ev.receita.valor).toBe(51.9);
    expect(ev.venda).toMatchObject({ taxa: 8.1, comissoes: 30 });
  });

  it("sem baseAmount: o valor cobrado menos a taxa que o comprador paga a Cakto", () => {
    const [ev] = ler(corpo("purchase_approved", venda({ baseAmount: null, amount: 5.99, charged_fees: "0.99" })));
    expect(ev.pedido.valor).toBe(5);
  });

  it("Pix gerado: pendente, com o vencimento que vem com espaco e microssegundos", () => {
    const [ev] = ler(corpo("pix_gerado", pix()));
    expect(ev.receita.situacao).toBe("pendente");
    expect(ev.dataEvento).toBe("2026-10-18T14:58:00.123Z");
    expect(ev.venda?.venceEm).toBe("2026-10-19T14:58:00.387Z");
    // A Sphere segue sem aceitar o espaco: o leitor comum nao mudou o dela.
    expect(lerDataSphere("2026-10-18 14:58:00", AGORA)).toBeNull();
    expect(lerDataSphere("2026-10-18T14:58:00Z", AGORA)).toBe("2026-10-18T14:58:00.000Z");
  });

  it("boleto: o due_date so com o dia vale ate o fim dele em Brasilia", () => {
    const [ev] = ler(corpo("boleto_gerado", pix({ paymentMethod: "boleto", pix: undefined, due_date: "2026-10-21" })));
    expect(ev.receita.situacao).toBe("pendente");
    expect(ev.venda?.venceEm).toBe("2026-10-22T02:59:59.000Z");
  });

  it("reembolso, chargeback, recusa e reembolso pedido", () => {
    const [reembolso] = ler(corpo("refund", venda({ status: "refunded", refundedAt: "2026-10-18T12:30:00-03:00" })));
    expect(reembolso.receita.situacao).toBe("revertido");
    expect(reembolso.dataEvento).toBe("2026-10-18T15:30:00.000Z");
    expect(reembolso.venda).toMatchObject({ reembolsadoEm: "2026-10-18T15:30:00.000Z", chargebackEm: null });

    const [cb] = ler(corpo("chargeback", venda({ status: "chargedback", chargedbackAt: "2026-10-18T13:00:00-03:00" })));
    expect(cb.receita.situacao).toBe("revertido");
    expect(cb.venda).toMatchObject({ chargebackEm: "2026-10-18T16:00:00.000Z", reembolsadoEm: null });

    const [recusa] = ler(corpo("purchase_refused", venda({ status: "refused", paidAt: null })));
    expect(recusa.receita.situacao).toBe("expirado");
    // Sem canceledAt, a data e a da criacao, nunca a da chegada.
    expect(recusa.dataEvento).toBe("2026-10-18T14:58:00.123Z");
    const [comData] = ler(corpo("purchase_refused", venda({ status: "refused", paidAt: null, canceledAt: "2026-10-18T12:00:00-03:00" })));
    expect(comData.dataEvento).toBe("2026-10-18T15:00:00.000Z");

    const [pedido] = ler(
      corpo("refund_requested", venda({ status: "refund_requested", refundRequest: { requestedAt: "2026-10-18T12:00:00-03:00" } }))
    );
    // Segue paga, "em risco"; a data do evento e a do pagamento.
    expect(pedido.receita.situacao).toBe("pago");
    expect(pedido.dataEvento).toBe("2026-10-18T14:59:30.654Z");
    expect(pedido.venda?.reembolsoPedidoEm).toBe("2026-10-18T15:00:00.000Z");
  });

  it("os status da doc antiga (chargeback, processing, authorized, in_protest)", () => {
    const situacao = (status: string, evento = "purchase_approved") =>
      ler(corpo(evento, venda({ status, chargedbackAt: status === "chargeback" ? "2026-10-18T13:00:00-03:00" : null })))[0];
    expect(situacao("chargeback", "chargeback").venda?.chargebackEm).toBe("2026-10-18T16:00:00.000Z");
    expect(situacao("chargeback", "chargeback").receita.situacao).toBe("revertido");
    // Status vence o evento so quando vai mais longe: o pix_gerado atrasado ja pago vira pago.
    expect(ler(corpo("pix_gerado", pix({ status: "paid", paidAt: "2026-10-18T12:05:00-03:00" })))[0].receita.situacao).toBe("pago");
    expect(ler(corpo("pix_gerado", pix({ status: "processing" })))[0].receita.situacao).toBe("pendente");
    expect(ler(corpo("pix_gerado", pix({ status: "authorized" })))[0].receita.situacao).toBe("pendente");
    expect(situacao("in_protest").receita.situacao).toBe("pago");
  });

  it("abandono e assinatura: 200 ignorado, antes de ler data (o abandono nem tem id)", () => {
    expect(lerTodosCakto(corpo("checkout_abandonment", { offer: {}, customerEmail: "x@y.z" }), AGORA)).toEqual({
      ok: true,
      eventos: [],
      ignorado: "checkout_abandonment",
    });
    expect(lerTodosCakto(corpo("subscription_renewed", venda()), AGORA)).toMatchObject({ ok: true, eventos: [], ignorado: "subscription_renewed" });
  });

  it("evento desconhecido, id torto, valor negativo e data fora da janela: recusa", () => {
    expect(lerTodosCakto(corpo("evento_novo", venda({ status: "xyz" })), AGORA)).toMatchObject({ ok: false });
    expect(lerTodosCakto(corpo("purchase_approved", venda({ id: "não é id" })), AGORA)).toMatchObject({ ok: false, erro: "data.id invalido" });
    expect(lerTodosCakto(corpo("purchase_approved", venda({ fees: -1 })), AGORA)).toMatchObject({ ok: false, erro: "fees invalido" });
    expect(lerTodosCakto(corpo("purchase_approved", venda({ paidAt: "2024-01-01T00:00:00-03:00" })), AGORA)).toMatchObject({ ok: false });
  });
});

describe("lerTodosCakto: V2 (data lista)", () => {
  it("principal e order bump numa entrega: dois pedidos no grupo do principal", () => {
    const evs = ler(
      corpo("purchase_approved", [
        venda(),
        venda({
          id: "c1111111-1111-4111-8111-111111111111",
          refId: "9BUMP01",
          offer_type: "orderbump",
          parent_order: "",
          baseAmount: 27,
          fees: "1.89",
          commissions: [{ type: "producer", totalAmount: "25.11" }],
          product: { name: "Bônus Y" },
        }),
      ])
    );
    expect(evs.map((e) => e.pedidoId)).toEqual(["b3df956e-1998-4322-b091-ac0c54f7b4ba", "c1111111-1111-4111-8111-111111111111"]);
    expect(evs.map((e) => e.venda?.grupo)).toEqual(["4852F91", "4852F91"]);
    expect(evs[1]).toMatchObject({ pedido: { valor: 27, produto: "Bônus Y" }, receita: { valor: 25.11 } });
  });

  it("um item torto recusa a entrega inteira (a Cakto mostra a falha, nada entra pela metade)", () => {
    const r = lerTodosCakto(corpo("purchase_approved", [venda(), venda({ id: "c1", baseAmount: "abc" })]), AGORA);
    expect(r).toMatchObject({ ok: false });
  });
});

describe("teste: o da Cakto e o nosso nunca viram pedido", () => {
  it("o exemplo fixo do 'Testar webhook' (card, pix, boleto e picpay juntos; e-mail @example.com)", () => {
    const fixo = venda({
      customer: { name: "John Doe", email: "john.doe@example.com", phone: "5534999999999" },
      pix: { qrCode: "x", expirationDate: "2026-10-19 14:58:00+00:00" },
      boleto: { barcode: "x" },
      picpay: { qrCode: "x" },
    });
    expect(ler(corpo("purchase_approved", fixo))[0].teste).toBe(true);
    // So os quatro blocos, sem o e-mail de exemplo, ja e o teste.
    expect(ler(corpo("purchase_approved", { ...fixo, customer: venda().customer }))[0].teste).toBe(true);
    // Uma venda real nao.
    expect(ler(corpo("purchase_approved", venda()))[0].teste).toBe(false);
  });

  it("o nosso exemplo leva o callback de teste e o secret salvo", () => {
    const c = exemploCakto(AGORA, SECRET) as { secret: string; data: { id: string; callback: string } };
    expect(c.secret).toBe(SECRET);
    expect(c.data.callback).toBe(CALLBACK_TESTE);
    expect(c.data.id).toBe(ID_TESTE);
    expect(ler(c)[0].teste).toBe(true);
  });

  it("o callback de teste sozinho e venda de verdade: ele vem da URL do checkout, qualquer um poe", () => {
    const [ev] = ler(corpo("purchase_approved", venda({ callback: CALLBACK_TESTE })));
    expect(ev.teste).toBe(false);
    expect(ev.receita.valor).toBe(90.22);
    // Na V2, a cobranca inteira continua de verdade.
    const evs = ler(corpo("purchase_approved", [venda({ callback: CALLBACK_TESTE }), venda({ id: "c1111111-1111-4111-8111-111111111111", offer_type: "orderbump" })]));
    expect(evs.map((e) => e.teste)).toEqual([false, false]);
  });

  it("os quatro blocos como null (a chave vem, o meio nao): venda de verdade", () => {
    const [ev] = ler(corpo("purchase_approved", venda({ pix: null, boleto: null, picpay: null })));
    expect(ev.teste).toBe(false);
  });

  it("so o e-mail de exemplo nao e teste (um comprador pode digitar); com John Doe e", () => {
    expect(ler(corpo("purchase_approved", venda({ customer: { name: "Ana Souza", email: "ana@example.com" } })))[0].teste).toBe(false);
    expect(ler(corpo("purchase_approved", venda({ customer: { name: "John Doe", email: "john.doe@example.com" } })))[0].teste).toBe(true);
  });

  it("o 'Testar webhook' com a data fixa de 2025 (fora da janela) e com valor torto: teste, nunca 400", () => {
    const fixo = venda({
      customer: { name: "John Doe", email: "john.doe@example.com" },
      createdAt: "2025-11-06T16:01:53.935243-03:00",
      paidAt: "2025-11-06T16:01:55.741948-03:00",
      fees: 6.62,
      baseAmount: 5,
      pix: { qrCode: "x" },
      boleto: { barcode: "x" },
      picpay: { qrCode: "x" },
    });
    const daqui = new Date("2026-12-20T12:00:00Z");
    expect(lerTodosCakto(corpo("purchase_approved", fixo), daqui)).toMatchObject({ ok: true, eventos: [{ teste: true }] });
    expect(lerTodosCakto(corpo("pix_gerado", { ...fixo, baseAmount: "abc" }), daqui)).toMatchObject({ ok: true, eventos: [{ teste: true }] });
    // Sem os sinais do teste, a mesma data recusa.
    expect(lerTodosCakto(corpo("purchase_approved", venda({ createdAt: fixo.createdAt, paidAt: fixo.paidAt })), daqui)).toMatchObject({ ok: false });
  });
});

// ---------------------------------------------------------------------------
// Autenticacao (HMAC do corpo cru)
// ---------------------------------------------------------------------------

function assinado(raw: string, segredo = SECRET, ts = String(Math.floor(AGORA.getTime() / 1000))) {
  const sig = createHmac("sha256", segredo).update(`${ts}.${raw}`).digest("hex");
  return new Headers({ "X-Cakto-Timestamp": ts, "X-Cakto-Signature": `v1=${sig}` });
}

describe("autenticarCakto", () => {
  const raw = JSON.stringify(corpo("purchase_approved", venda()));

  it("HMAC certo: ok; com o corpo em bytes tambem", () => {
    expect(autenticarCakto(raw, assinado(raw), SECRET, AGORA)).toEqual({ ok: true });
    expect(autenticarCakto(Buffer.from(raw, "utf8"), assinado(raw), SECRET, AGORA)).toEqual({ ok: true });
  });

  it("HMAC errado, corpo mexido, timestamp fora da janela: recusa", () => {
    expect(autenticarCakto(raw, assinado(raw, "outro-secret-qualquer"), SECRET, AGORA)).toMatchObject({ ok: false, erro: "assinatura nao confere" });
    expect(autenticarCakto(raw.replace("97.99", "1.00"), assinado(raw), SECRET, AGORA)).toMatchObject({ ok: false });
    const velho = String(Math.floor(AGORA.getTime() / 1000) - 40 * 86400);
    expect(autenticarCakto(raw, assinado(raw, SECRET, velho), SECRET, AGORA)).toMatchObject({ ok: false, erro: "X-Cakto-Timestamp fora da janela" });
  });

  it("sem secret salvo: recusa, avisando que falta colar", () => {
    expect(autenticarCakto(raw, assinado(raw), null, AGORA)).toMatchObject({ ok: false, semSegredo: true });
  });

  it("sem assinatura no header: vale o secret do corpo (entrega de antes de 04/09/2026)", () => {
    expect(autenticarCakto(raw, new Headers(), SECRET, AGORA)).toEqual({ ok: true });
    const outro = JSON.stringify(corpo("purchase_approved", venda(), "secret-de-outra-conta"));
    expect(autenticarCakto(outro, new Headers(), SECRET, AGORA)).toMatchObject({ ok: false, erro: "secret do corpo nao confere" });
  });

  it("assinatura certa com o secret do corpo errado: recusa", () => {
    const outro = JSON.stringify(corpo("purchase_approved", venda(), "secret-de-outra-conta"));
    expect(autenticarCakto(outro, assinado(outro), SECRET, AGORA)).toMatchObject({ ok: false, erro: "secret do corpo nao confere" });
  });

  it("varias versoes no header: so a v1 conta; o assinar do teste passa no autenticar", () => {
    const h = assinado(raw);
    h.set("X-Cakto-Signature", `v2=deadbeef, ${h.get("X-Cakto-Signature")}`);
    expect(autenticarCakto(raw, h, SECRET, AGORA)).toEqual({ ok: true });
    expect(autenticarCakto(raw, new Headers(assinarCakto(raw, SECRET, AGORA)), SECRET, AGORA)).toEqual({ ok: true });
  });

  it("o registro: Cakto e Sphere, cada uma com o seu reenvio", () => {
    expect(plataformaDe("cakto")).toBe(cakto);
    expect(cakto).toMatchObject({ modelo: "venda", autenticacao: "hmac_header", reenvio: "timeout", eventoDeVenda: "purchase_approved" });
    expect(sphere).toMatchObject({ modelo: "comissao", reenvio: "status", eventoDeVenda: "pedido.criado" });
    expect(sphere.autenticar).toBeUndefined();
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
  soltos: string[];
  /** O que foi gravado com `venda: true`. */
  comVenda: number;
}

function memoria(opcoes: { falharInsert?: number; falharUpdate?: number; falharSoltar?: number } = {}): Memoria {
  let falhas = opcoes.falharInsert ?? 0;
  let falhasUpdate = opcoes.falharUpdate ?? 0;
  let falhasSoltar = opcoes.falharSoltar ?? 0;
  const m: Memoria = { eventos: new Set(), pedidos: new Map(), marcas: [], soltos: [], comVenda: 0, repo: undefined as never };
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
      m.soltos.push(`${x.pedido_id}|${x.evento}`);
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
      if (x.venda) m.comVenda += 1;
      m.pedidos.set(x.pedido_id, { ...x.pedido, versao: 0 });
      return "ok";
    },
    async atualizarPedido(x) {
      if (falhasUpdate > 0) {
        falhasUpdate -= 1;
        throw new Error("banco fora");
      }
      const atual = m.pedidos.get(x.pedido_id);
      if (!atual || atual.versao !== x.versao) return false;
      if (x.venda) m.comVenda += 1;
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
  id: "ck-cakto",
  user_id: "u-1",
  plataforma: "cakto",
  nome: "Cakto Curso",
  ativo: true,
  fuso: "America/Sao_Paulo",
  moeda_receita: "BRL",
  notificar_aprovada: false,
  notificar_pendente: false,
  notificar_estorno: false,
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

/** A entrega como a rota passa: corpo cru, headers assinados e o secret salvo. */
async function receber(m: Memoria, c: Dados, opcoes: { checkout?: Partial<CheckoutParaReceber>; segredo?: string | null; assinar?: boolean } = {}) {
  const raw = JSON.stringify(c);
  const headers = opcoes.assinar === false ? new Headers() : assinado(raw);
  return receberEvento(m.repo, { ...CHECKOUT, ...opcoes.checkout }, cakto, JSON.parse(raw), AGORA, {
    raw,
    headers,
    segredo: opcoes.segredo === undefined ? SECRET : opcoes.segredo,
  });
}

const ID = "b3df956e-1998-4322-b091-ac0c54f7b4ba";
const REEMBOLSO = venda({ status: "refunded", refundedAt: "2026-10-18T12:30:00-03:00" });

describe("receberEvento (Cakto): origem, idempotencia e ordem", () => {
  it("sem secret salvo: 401, o erro fica no checkout com o caminho, e nada trava", async () => {
    const m = memoria();
    const r = await receber(m, corpo("purchase_approved", venda()), { segredo: null });
    expect(r).toEqual({ status: 401, corpo: { ok: false, erro: "nao autorizado" }, notificar: null });
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/Cole aqui o secret do webhook da Cakto/);
    expect(m.eventos.size).toBe(0);
  });

  it("assinatura de outro secret: 401", async () => {
    const m = memoria();
    const raw = JSON.stringify(corpo("purchase_approved", venda()));
    const r = await receberEvento(m.repo, CHECKOUT, cakto, JSON.parse(raw), AGORA, {
      raw,
      headers: assinado(raw, "secret-errado-1234"),
      segredo: SECRET,
    });
    expect(r.status).toBe(401);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/não confere/);
  });

  it("Pix gerado -> aprovado -> reembolso: cada etapa uma vez, com as datas", async () => {
    const m = memoria();
    expect((await receber(m, corpo("pix_gerado", pix()))).status).toBe(200);
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "pendente", vence_em: "2026-10-19T14:58:00.387Z", metodo_pagamento: "pix" });

    const aprovado = corpo("purchase_approved", { ...pix(), status: "paid", paidAt: "2026-10-18T12:05:00-03:00" });
    const a = await receber(m, aprovado);
    expect(a.status).toBe(200);
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "pago", pago_em: "2026-10-18T15:05:00.000Z", taxa: 6.78, receita: 90.22, valor: 97 });
    expect(a.notificar).toMatchObject({ tipo: "venda", pedido: "#4852F91", valor: 97, comissao: 90.22, moeda: "BRL" });

    // A retentativa da mesma entrega: duplicado, sem notificar de novo.
    expect(await receber(m, aprovado)).toEqual({ status: 200, corpo: { ok: true, duplicado: true }, notificar: null });

    await receber(m, corpo("refund", { ...REEMBOLSO, paymentMethod: "pix" }));
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "revertido", reembolsado_em: "2026-10-18T15:30:00.000Z" });
    expect([...m.eventos].sort()).toEqual([`${ID}|pix_gerado`, `${ID}|purchase_approved`, `${ID}|refund`]);
    // Toda gravacao da Cakto leva as colunas da venda.
    expect(m.comVenda).toBe(3);
  });

  it("aprovado antes do Pix gerado: o Pix atrasado nao volta para pendente (so completa o vencimento)", async () => {
    const m = memoria();
    await receber(m, corpo("purchase_approved", { ...pix(), status: "paid", paidAt: "2026-10-18T12:05:00-03:00" }));
    await receber(m, corpo("pix_gerado", pix()));
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "pago", vence_em: "2026-10-19T14:58:00.387Z" });
  });

  it("reembolso pedido depois do reembolso nao desfaz o reembolso; antes dele, a venda fica em risco", async () => {
    const pedido = corpo("refund_requested", venda({ status: "refund_requested", refundRequest: { requestedAt: "2026-10-18T12:20:00-03:00" } }));
    const m = memoria();
    await receber(m, corpo("purchase_approved", venda()));
    await receber(m, pedido);
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "pago", reembolso_pedido_em: "2026-10-18T15:20:00.000Z" });
    expect(estadoDaVenda(m.pedidos.get(ID)!, AGORA.getTime())).toBe("em_risco");
    await receber(m, corpo("refund", REEMBOLSO));
    expect(m.pedidos.get(ID)?.situacao).toBe("revertido");

    const m2 = memoria();
    await receber(m2, corpo("refund", REEMBOLSO));
    await receber(m2, pedido);
    expect(m2.pedidos.get(ID)?.situacao).toBe("revertido");
  });

  it("recusa reenviada sem canceledAt depois do pagamento: o pedido segue pago", async () => {
    // Boleto pago (paidAt antes da chegada) e uma recusa do mesmo pedido que
    // chega atrasada (retentativa por timeout ou Reenviar).
    const m = memoria();
    await receber(m, corpo("boleto_gerado", pix({ paymentMethod: "boleto", pix: undefined, due_date: "2026-10-21" })));
    await receber(m, corpo("purchase_approved", { ...pix({ paymentMethod: "boleto", pix: undefined }), status: "paid", paidAt: "2026-10-18T11:59:00-03:00" }));
    const r = await receber(m, corpo("purchase_refused", pix({ paymentMethod: "boleto", pix: undefined, status: "refused" })));
    expect(r.status).toBe(200);
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "pago", pago_em: "2026-10-18T14:59:00.000Z", perdido_em: null });
    expect(estadoDaVenda(m.pedidos.get(ID)!, AGORA.getTime())).toBe("paga");

    // Ainda vence o pendente: Pix gerado e recusado, nada pago.
    const m2 = memoria();
    await receber(m2, corpo("pix_gerado", pix()));
    await receber(m2, corpo("purchase_refused", pix({ status: "refused" })));
    expect(m2.pedidos.get(ID)?.situacao).toBe("expirado");
  });

  it("chargeback depois da venda: revertido com a data do chargeback", async () => {
    const m = memoria();
    await receber(m, corpo("purchase_approved", venda()));
    await receber(m, corpo("chargeback", venda({ status: "chargedback", chargedbackAt: "2026-10-18T13:00:00-03:00" })));
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "revertido", chargeback_em: "2026-10-18T16:00:00.000Z" });
    expect(estadoDaVenda(m.pedidos.get(ID)!, AGORA.getTime())).toBe("chargeback");
  });

  it("order bump no V1 (entregas separadas) e no V2 (uma so): o mesmo grupo", async () => {
    const bump = venda({
      id: "c1111111-1111-4111-8111-111111111111",
      refId: "9BUMP01",
      offer_type: "orderbump",
      parent_order: "4852F91",
      baseAmount: 27,
      fees: 1.89,
      commissions: [{ type: "producer", totalAmount: 25.11 }],
      product: { name: "Bônus Y" },
    });
    const v1 = memoria();
    await receber(v1, corpo("purchase_approved", venda()));
    await receber(v1, corpo("purchase_approved", bump));
    expect([...v1.pedidos.values()].map((p) => p.grupo)).toEqual(["4852F91", "4852F91"]);

    const v2 = memoria();
    const r = await receber(v2, corpo("purchase_approved", [venda(), { ...bump, parent_order: "" }]));
    expect([...v2.pedidos.values()].map((p) => p.grupo)).toEqual(["4852F91", "4852F91"]);
    // Uma notificacao pela cobranca: os valores somados, o principal primeiro.
    expect(r.notificar).toMatchObject({ tipo: "venda", pedido: "#4852F91", valor: 124, comissao: 115.33, produtos: ["Curso Método X", "Bônus Y"] });
  });

  it("falha nossa: a trava sai, o erro fica com a instrucao de reenvio e a rota segura a resposta", async () => {
    const m = memoria({ falharInsert: 1 });
    const a = await receber(m, corpo("purchase_approved", venda()));
    expect(a).toMatchObject({ status: 503, segurar: true, notificar: null });
    expect(m.soltos).toEqual([`${ID}|purchase_approved`]);
    expect(m.marcas.at(-1)?.ultimo_erro).toMatch(/Reenviar no painel/);
    // A retentativa da Cakto (por timeout) passa pelo caminho normal.
    const b = await receber(m, corpo("purchase_approved", venda()));
    expect(b.status).toBe(200);
    expect(m.pedidos.get(ID)?.situacao).toBe("pago");
  });

  it("a trava presa (gravar e soltar falharam): a retentativa e o Reenviar refazem, e avisam uma vez", async () => {
    const logs: unknown[] = [];
    vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => void logs.push(a));
    try {
      // Pedido novo: a trava ficou, o pedido nao existe.
      const m = memoria({ falharInsert: 1, falharSoltar: 1 });
      const a = await receber(m, corpo("purchase_approved", venda()));
      expect(a).toMatchObject({ status: 503, segurar: true });
      expect(m.eventos.has(`${ID}|purchase_approved`)).toBe(true);
      expect(JSON.stringify(logs)).toMatch(/a trava nao saiu/);
      const b = await receber(m, corpo("purchase_approved", venda()));
      expect(b.status).toBe(200);
      expect(b.notificar).toMatchObject({ tipo: "venda", pedido: "#4852F91" });
      expect(m.pedidos.get(ID)?.situacao).toBe("pago");
      // Agora sim duplicado: o pedido ja tem o evento.
      expect(await receber(m, corpo("purchase_approved", venda()))).toEqual({ status: 200, corpo: { ok: true, duplicado: true }, notificar: null });

      // Pedido que ja existia (o Pix gerado): a aprovacao falhou e a trava ficou.
      const m2 = memoria({ falharUpdate: 1, falharSoltar: 1 });
      await receber(m2, corpo("pix_gerado", pix()));
      const aprovado = corpo("purchase_approved", { ...pix(), status: "paid", paidAt: "2026-10-18T12:05:00-03:00" });
      expect((await receber(m2, aprovado)).status).toBe(503);
      expect(m2.pedidos.get(ID)?.situacao).toBe("pendente");
      const c = await receber(m2, aprovado);
      expect(c.status).toBe(200);
      expect(c.notificar?.tipo).toBe("venda");
      expect(m2.pedidos.get(ID)).toMatchObject({ situacao: "pago", pago_em: "2026-10-18T15:05:00.000Z" });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("retentativa de evento sem data (cai na hora da chegada): duplicado, sem regravar nem avisar de novo", async () => {
    const m = memoria();
    const semData = corpo("purchase_approved", venda({ paidAt: null }));
    expect((await receber(m, semData)).notificar?.tipo).toBe("venda");
    const versao = m.pedidos.get(ID)?.versao;
    const depois = new Date(AGORA.getTime() + 60_000);
    const raw = JSON.stringify(semData);
    const r = await receberEvento(m.repo, CHECKOUT, cakto, JSON.parse(raw), depois, { raw, headers: assinado(raw), segredo: SECRET });
    expect(r).toEqual({ status: 200, corpo: { ok: true, duplicado: true }, notificar: null });
    expect(m.pedidos.get(ID)?.versao).toBe(versao);
  });

  it("V2 com um item falhando: o que entrou fica (e avisa); a retentativa so grava o que faltou", async () => {
    const m = memoria();
    const bump = venda({ id: "c1111111-1111-4111-8111-111111111111", refId: "9BUMP01", offer_type: "orderbump" });
    let chamadas = 0;
    const inserir = m.repo.inserirPedido.bind(m.repo);
    m.repo.inserirPedido = async (x) => {
      chamadas += 1;
      if (chamadas === 2) throw new Error("banco fora");
      return inserir(x);
    };
    const entrega = corpo("purchase_approved", [venda(), bump]);
    const a = await receber(m, entrega);
    expect(a).toMatchObject({ status: 503, segurar: true });
    expect(a.notificar?.tipo).toBe("venda");
    expect(m.pedidos.size).toBe(1);
    const b = await receber(m, entrega);
    expect(b.status).toBe(200);
    expect(m.pedidos.size).toBe(2);
  });

  it("teste da Cakto e o nosso: 200 teste, nada travado nem gravado", async () => {
    const m = memoria();
    const nosso = exemploCakto(AGORA, SECRET) as Dados;
    expect(await receber(m, nosso)).toEqual({ status: 200, corpo: { ok: true, teste: true }, notificar: null });
    const fixo = corpo("purchase_approved", venda({ customer: { name: "John Doe", email: "john.doe@example.com" } }));
    expect((await receber(m, fixo)).corpo).toEqual({ ok: true, teste: true });
    expect(m.pedidos.size).toBe(0);
    expect(m.eventos.size).toBe(0);
    expect(m.marcas.at(-1)).toMatchObject({ ultimo_evento_teste: true, ultimo_erro: null });
  });

  it("abandono: 200 ignorado, sem trava nem marca", async () => {
    const m = memoria();
    const r = await receber(m, corpo("checkout_abandonment", { offer: { id: "a" }, customerEmail: "ana.souza@provedor.com.br" }));
    expect(r).toEqual({ status: 200, corpo: { ok: true, ignorado: "checkout_abandonment" }, notificar: null });
    expect(m.eventos.size).toBe(0);
    expect(m.marcas).toHaveLength(0);
  });

  it("pausado: pedido novo nao entra; o que ja existe segue atualizando", async () => {
    const m = memoria();
    const pausado = { checkout: { ativo: false } };
    expect((await receber(m, corpo("pix_gerado", pix()), pausado)).corpo).toEqual({ ok: true, ignorado: "checkout pausado" });
    await receber(m, corpo("pix_gerado", pix()));
    const r = await receber(m, corpo("purchase_approved", { ...pix(), status: "paid", paidAt: "2026-10-18T12:05:00-03:00" }), pausado);
    expect(r.notificar).toBeNull();
    expect(m.pedidos.get(ID)?.situacao).toBe("pago");
  });
});

describe("Venda no celular (Cakto)", () => {
  it("compra aprovada: 'Venda aprovada · R$ X' com o produto e o liquido", async () => {
    const m = memoria();
    const r = await receber(m, corpo("purchase_approved", venda()));
    expect(mensagemDaVenda(vendaDoPedidoExterno(r.notificar!))).toEqual({
      titulo: "Venda aprovada · R$97.00",
      texto: "Cakto Curso · #4852F91 · Curso Método X · líquido R$90.22",
    });
  });

  it("Pix gerado e estorno so com o checkout pedindo (desligados por padrao)", async () => {
    const sem = memoria();
    expect((await receber(sem, corpo("pix_gerado", pix()))).notificar).toBeNull();
    await receber(sem, corpo("purchase_approved", venda()));
    expect((await receber(sem, corpo("refund", REEMBOLSO))).notificar).toBeNull();

    const com = memoria();
    const pedindo = { checkout: { notificar_pendente: true, notificar_estorno: true } };
    const p = await receber(com, corpo("pix_gerado", pix()), pedindo);
    expect(mensagemDaVenda(vendaDoPedidoExterno(p.notificar!)).titulo).toBe("Pix gerado · R$97.00");
    await receber(com, corpo("purchase_approved", { ...pix(), status: "paid", paidAt: "2026-10-18T12:05:00-03:00" }), pedindo);
    const e = await receber(com, corpo("chargeback", venda({ status: "chargedback", chargedbackAt: "2026-10-18T13:00:00-03:00" })), pedindo);
    expect(mensagemDaVenda(vendaDoPedidoExterno(e.notificar!)).titulo).toBe("Chargeback · R$97.00");
  });

  it("a Sphere segue com o texto dela", () => {
    const n: Notificacao = {
      tipo: "criado",
      checkout: "Sphere Itália",
      pedido: "#12345",
      produto: "EVOX",
      valor: 89.9,
      moeda: "EUR",
      comissao: 75,
      moedaComissao: "EUR",
    };
    expect(mensagemDaVenda(vendaDoPedidoExterno(n))).toEqual({ titulo: "Novo pedido · €89.90", texto: "Sphere Itália · #12345 · EVOX · comissão €75.00" });
  });
});

describe("dado pessoal do comprador nunca e gravado nem logado", () => {
  afterEach(() => vi.restoreAllMocks());

  it("nada do comprador no pedido, na trava, no checkout, na notificacao ou no log", async () => {
    const logs: unknown[] = [];
    for (const nivel of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, nivel).mockImplementation((...a: unknown[]) => void logs.push(a));
    }
    const m = memoria({ falharInsert: 1 });
    const pedindo = { checkout: { notificar_pendente: true, notificar_estorno: true } };
    const notificacoes: unknown[] = [];
    for (const c of [
      corpo("pix_gerado", pix()),
      corpo("pix_gerado", pix()),
      corpo("purchase_approved", { ...pix(), status: "paid", paidAt: "2026-10-18T12:05:00-03:00" }),
      corpo("refund_requested", venda({ status: "refund_requested", refundRequest: { requestedAt: "2026-10-18T12:20:00-03:00", reason: "Ana Souza desistiu" } })),
      corpo("refund", REEMBOLSO),
      corpo("checkout_abandonment", { customerName: "Ana Souza", customerEmail: "ana.souza@provedor.com.br", customerCellphone: "34988887777" }),
      corpo("purchase_approved", venda({ baseAmount: "abc" })),
    ]) {
      const r = await receber(m, c, pedindo);
      if (r.notificar) notificacoes.push(vendaDoPedidoExterno(r.notificar));
    }
    const gravado = JSON.stringify({ pedidos: [...m.pedidos.values()], eventos: [...m.eventos], marcas: m.marcas, notificacoes, logs });
    expect(m.pedidos.size).toBe(1);
    for (const dado of DADOS_DO_COMPRADOR) expect(gravado, dado).not.toContain(dado);
    // E o CPF nem e lido pelo adaptador.
    const [ev] = ler(corpo("purchase_approved", venda()));
    expect(JSON.stringify(ev)).not.toContain("39053344705");
    expect(ev.comprador).toMatchObject({ email: "ana.souza@provedor.com.br", pais: "BR" });
  });

  it("migration 072: o secret sem policy, Cakto nos CHECKs e nenhuma coluna de dado pessoal", () => {
    const sql = readFileSync(path.resolve(__dirname, "../supabase/migrations/072_checkout_cakto.sql"), "utf8")
      .split("\n")
      .filter((l) => !l.trim().startsWith("--"))
      .join("\n");
    expect(sql).not.toMatch(/create policy/i);
    expect(sql).toMatch(/revoke all on table public\.checkout_externo_segredos from public, anon, authenticated;/);
    const grants = sql.match(/grant [^;]*on table public\.checkout_externo_segredos to [^;]*;/g) ?? [];
    expect(grants).toEqual(["grant select, insert, update, delete on table public.checkout_externo_segredos to service_role;"]);
    expect(sql).toMatch(/checkouts_externos_plataforma_check check \(plataforma in \('sphere', 'cakto'\)\)/);
    expect(sql).toMatch(/checkout_externo_contas_plataforma_check check \(plataforma in \('sphere', 'cakto'\)\)/);
    const colunas = [...sql.matchAll(/add column if not exists (\w+)/g)].map((x) => x[1]);
    expect(colunas).toContain("segredo_plataforma");
    // O custo opcional ja tem coluna; o webhook nao a grava (nao apaga o que o lojista puser).
    expect(colunas).toContain("custo");
    expect(CAMPOS_VENDA as readonly string[]).not.toContain("custo");
    expect(colunas.filter((c) => /mail|nome|name|fone|phone|cpf|doc|endereco|address|cliente|comprador|customer|ip\b/i.test(c))).toEqual([]);
    expect(sql).toMatch(/pedidos_externos_utm_sem_email/);
  });
});

// ---------------------------------------------------------------------------
// Dashboard e Pedidos
// ---------------------------------------------------------------------------

const CK_VENDA = "33333333-3333-4333-8333-333333333333";
const CK_SPHERE = "22222222-2222-4222-8222-222222222222";
const USER = "99999999-9999-4999-8999-999999999999";
const AGORA_MS = Date.parse("2026-09-29T15:00:00Z");

const INTERVALOS = {
  atual: { desde: "2026-09-23", ate: "2026-09-29" },
  anterior: { desde: "2026-09-16", ate: "2026-09-22" },
};

/** 1 USD = 5 BRL = 0,8 EUR. */
const CAMBIO: FxRateRow[] = [
  { data: "2026-09-20", moeda: "BRL", por_usd: 5, fonte: "frankfurter" },
  { data: "2026-09-20", moeda: "EUR", por_usd: 0.8, fonte: "frankfurter" },
];

const CAKTO_LOJA: LojaFinanceira = {
  id: CK_VENDA,
  nome: "Cakto Curso",
  dominio: "Cakto",
  tipo: "checkout",
  modelo: "venda",
  fuso: "America/Sao_Paulo",
  moeda: "BRL",
  taxaPadraoPct: 70,
};
const SPHERE_LOJA: LojaFinanceira = {
  id: CK_SPHERE,
  nome: "Sphere Itália",
  dominio: "Sphere Affiliates",
  tipo: "checkout",
  fuso: "Europe/Rome",
  moeda: "EUR",
  taxaPadraoPct: 70,
};

function vendaFin(
  pedido: string,
  situacao: PedidoExternoFin["situacao"],
  valor: number,
  liquido: number,
  extra: Partial<PedidoExternoFin> = {}
): PedidoExternoFin {
  return {
    checkout_id: CK_VENDA,
    pedido_id: pedido,
    grupo: pedido,
    situacao,
    moeda: "BRL",
    moeda_receita: "BRL",
    valor,
    receita: liquido,
    taxa: Math.round((valor - liquido) * 100) / 100,
    comissoes: 0,
    dia_local: "2026-09-28",
    criado_em: "2026-09-28T13:00:00Z",
    metodo_pagamento: "pix",
    ...extra,
  };
}

const VENDAS: PedidoExternoFin[] = [
  vendaFin("A1", "pago", 97, 90.22, { taxa: 6.78, metodo_pagamento: "credit_card" }),
  // Order bump da A1: mesmo grupo, nao dobra Pedidos.
  vendaFin("B1", "pago", 27, 25.11, { grupo: "A1", taxa: 1.89 }),
  // Com afiliado: 100 - 8 de taxa - 32 de comissao = 60.
  vendaFin("A2", "pago", 100, 60, { taxa: 8, comissoes: 32 }),
  // Pix aguardando (vence amanha) e Pix vencido.
  vendaFin("A3", "pendente", 50, 45, { vence_em: "2026-09-30T13:00:00Z" }),
  vendaFin("A4", "pendente", 50, 45, { vence_em: "2026-09-28T14:00:00Z" }),
  vendaFin("A5", "revertido", 97, 90.22, { reembolsado_em: "2026-09-29T10:00:00Z" }),
  vendaFin("A6", "revertido", 97, 90.22, { chargeback_em: "2026-09-29T11:00:00Z" }),
  vendaFin("A7", "expirado", 97, 90.22, { metodo_pagamento: "credit_card" }),
  // Reembolso pedido: ainda conta, em risco.
  vendaFin("A8", "pago", 40, 36, { reembolso_pedido_em: "2026-09-29T09:00:00Z" }),
];

function conta(id: string, checkout: string): AdAccountRow {
  return {
    id,
    user_id: USER,
    store_id: null,
    checkout_id: checkout,
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

function gasto(contaId: string, data: string, valor: number): AdSpendDailyRow {
  return {
    ad_account_id: contaId,
    user_id: USER,
    data,
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
    sincronizado_em: "2026-09-29T12:00:00Z",
  };
}

function entrada(e: Partial<EntradaFinanceiro> = {}): EntradaFinanceiro {
  return {
    lojas: [CAKTO_LOJA],
    pedidos: [],
    custos: [],
    configs: [],
    contas: [],
    gastos: [],
    cambio: CAMBIO,
    intervalos: INTERVALOS,
    moeda: "BRL",
    hoje: "2026-09-29",
    agoraMs: AGORA_MS,
    externos: VENDAS,
    ...e,
  };
}

describe("checkout de venda no Dashboard", () => {
  it("faturamento, taxa, comissoes e liquido; pedido pela cobranca", () => {
    const r = calcularFinanceiro(entrada());
    const t = r.atual;
    // Pagos: 97 + 27 + 100 + 40 = 264; liquido 90.22 + 25.11 + 60 + 36 = 211.33.
    expect(t.receita).toBeCloseTo(264);
    expect(t.taxas).toBeCloseTo(264 - 211.33);
    expect(t.lucro).toBeCloseTo(211.33);
    expect(t.cmv).toBe(0);
    // A1+B1 sao uma cobranca; A2; A8.
    expect(t.pedidos).toBe(3);
    expect(t.ticket).toBeCloseTo(264 / 3);
    expect(t.venda).toMatchObject({
      vendas: 3,
      itens: 4,
      faturamento: expect.closeTo(264, 6),
      taxa: expect.closeTo(6.78 + 1.89 + 8 + 4, 6),
      comissoes: expect.closeTo(32, 6),
      liquido: expect.closeTo(211.33, 6),
      aguardando: 1,
      aReceber: expect.closeTo(45, 6),
      vencidas: 1,
      recusadas: 1,
      reembolsos: 1,
      chargebacks: 1,
      estornado: expect.closeTo(194, 6),
      emRisco: 1,
    });
    expect(t.venda.taxa + t.venda.comissoes).toBeCloseTo(t.taxas);
  });

  it("nao entra nos cartoes de contra entrega: Pix aguardando nao e A receber de COD", () => {
    const r = calcularFinanceiro(entrada());
    expect(r.lojasContraEntrega).toEqual([]);
    expect(r.atual.cod.aReceber).toBe(0);
    expect(r.atual.cod.abertos).toBe(0);
    expect(r.atual.externo.pedidos).toBe(0);
  });

  it("vencido conta pelo agora: o mesmo Pix ainda vale antes do vencimento", () => {
    const antes = calcularFinanceiro(entrada({ agoraMs: Date.parse("2026-09-28T13:30:00Z") }));
    expect(antes.atual.venda).toMatchObject({ aguardando: 2, vencidas: 0, aReceber: expect.closeTo(90, 6) });
    // Sem vence_em, vale a janela do metodo (Pix: 1 dia; boleto: 3 + 4 de compensacao).
    expect(pendenteVencida({ situacao: "pendente", metodo_pagamento: "pix", criado_em: "2026-09-27T10:00:00Z" }, AGORA_MS)).toBe(true);
    expect(pendenteVencida({ situacao: "pendente", metodo_pagamento: "boleto", criado_em: "2026-09-27T10:00:00Z" }, AGORA_MS)).toBe(false);
  });

  it("custo de produto (072): null e 0; com valor, entra no custo e sai do lucro", () => {
    expect(calcularFinanceiro(entrada()).atual.cmv).toBe(0);
    const comCusto = VENDAS.map((v) => (v.pedido_id === "A1" ? { ...v, custo: "12.50" } : v.pedido_id === "A3" ? { ...v, custo: 99 } : v));
    const r = calcularFinanceiro(entrada({ externos: comCusto }));
    // So a venda paga conta (A3 e Pix aguardando).
    expect(r.atual.cmv).toBeCloseTo(12.5);
    expect(r.atual.lucro).toBeCloseTo(211.33 - 12.5);
    expect(r.atual.receita).toBeCloseTo(264);
  });

  it("lucro e ROAS: liquido menos o anuncio ligado ao checkout", () => {
    const r = calcularFinanceiro(entrada({ contas: [conta("c1", CK_VENDA)], gastos: [gasto("c1", "2026-09-28", 50)] }));
    expect(r.atual.gasto).toBeCloseTo(50);
    expect(r.atual.lucro).toBeCloseTo(211.33 - 50);
    expect(r.atual.roas).toBeCloseTo(264 / 50);
    expect(r.atual.cpa).toBeCloseTo(50 / 3);
  });

  it("a Sphere ao lado nao muda: os numeros dela sao os mesmos com e sem a Cakto", () => {
    const sphereSo: PedidoExternoFin[] = [
      { checkout_id: CK_SPHERE, situacao: "aprovado", moeda: "EUR", valor: 89.9, receita: 75, moeda_receita: null, dia_local: "2026-09-28" },
      { checkout_id: CK_SPHERE, situacao: "pendente", moeda: "EUR", valor: 89.9, receita: 40, moeda_receita: null, dia_local: "2026-09-28" },
    ];
    const so = calcularFinanceiro(entrada({ lojas: [SPHERE_LOJA], externos: sphereSo }));
    const junto = calcularFinanceiro(entrada({ lojas: [SPHERE_LOJA, CAKTO_LOJA], externos: [...sphereSo, ...VENDAS] }));
    const a = so.porLoja.find((l) => l.storeId === CK_SPHERE)!;
    const b = junto.porLoja.find((l) => l.storeId === CK_SPHERE)!;
    for (const k of ["receita", "taxas", "lucro", "pedidos", "externo", "cod"] as const) expect(b[k]).toEqual(a[k]);
    expect(junto.atual.externo).toEqual(so.atual.externo);
    expect(junto.lojasContraEntrega).toEqual([CK_SPHERE]);
    expect(junto.atual.receita).toBeCloseTo(so.atual.receita + 264);
  });
});

describe("cartoes de contra entrega com Sphere e Cakto, sem loja Shopify", () => {
  const sphereSo: PedidoExternoFin[] = [
    { checkout_id: CK_SPHERE, situacao: "aprovado", moeda: "EUR", valor: 89.9, receita: 75, moeda_receita: null, dia_local: "2026-09-28" },
    { checkout_id: CK_SPHERE, situacao: "expirado", moeda: "EUR", valor: 89.9, receita: 40, moeda_receita: null, dia_local: "2026-09-28" },
  ];

  function cartoes(lojaIds: string[], semLoja: boolean): string {
    const r = calcularFinanceiro(entrada({ lojas: [SPHERE_LOJA, CAKTO_LOJA], externos: [...sphereSo, ...VENDAS] }));
    // Como a tela monta (financeiro-screen.tsx): a venda junto das lojas, a comissao a parte.
    const base: BaseIndicadores = {
      moeda: "BRL",
      atual: r.atual,
      anterior: r.anterior,
      compara: false,
      dicas: {},
      composicao: composicaoCod([...lojaIds, CK_VENDA], [CK_SPHERE], r.lojasContraEntrega),
      venda: "junto",
      semLoja,
    };
    return renderToStaticMarkup(createElement(IndicadoresKpiCod, base)) + renderToStaticMarkup(createElement(IndicadoresTopoCod, base));
  }

  // A definicao de cada cartao abre num popover (fora do HTML estatico): aqui
  // so o que aparece -- os rotulos e o detalhe.
  it("os cartoes do checkout de comissao (Perdido, Valor dos pedidos), nao os de produto e devolucao", () => {
    const html = cartoes([], true);
    expect(html).toContain(">Perdido<");
    expect(html).toContain(">Valor dos pedidos<");
    expect(html).not.toContain(">Devoluções<");
    expect(html).not.toContain(">Custo de produto<");
    expect(html).toContain("Não entra no lucro");
  });

  it("com loja Shopify no filtro, nada muda: produto e devolucoes", () => {
    const html = cartoes(["44444444-4444-4444-8444-444444444444"], false);
    expect(html).toContain(">Devoluções<");
    expect(html).toContain(">Custo de produto<");
    expect(html).not.toContain(">Valor dos pedidos<");
  });
});

describe("tela Pedidos do checkout de venda", () => {
  function row(p: PedidoExternoFin, extra: Partial<PedidoExternoRow> = {}): PedidoExternoRow {
    return {
      user_id: USER,
      status_comissao: null,
      status_pedido: null,
      produto: "Curso Método X",
      pais: "BR",
      programa: null,
      aprovado_em: null,
      pago_em: null,
      perdido_em: null,
      atualizado_em: "2026-09-28T13:00:00Z",
      versao: 0,
      referencia: `R${p.pedido_id}`,
      oferta_tipo: p.grupo !== p.pedido_id ? "orderbump" : "main",
      utm_campaign: "Campanha X|120211111111111111",
      utm_content: "Anuncio 1|120233333333333333",
      campanha_id: "120211111111111111",
      anuncio_id: "120233333333333333",
      ...p,
      pedido_id: p.pedido_id!,
      criado_em: p.criado_em!,
      metodo_pagamento: p.metodo_pagamento ?? null,
      ...extra,
    };
  }

  it("metodo, valor, taxa, liquido, situacao e campanha; o resumo conta a cobranca", () => {
    const { linhas, resumo } = montarPedidosExternos({
      pedidos: VENDAS.map((v) => row(v)),
      checkouts: [{ id: CK_VENDA, nome: "Cakto Curso", fuso: "America/Sao_Paulo", moeda_receita: "BRL", modelo: "venda" }],
      cambio: CAMBIO,
      moeda: "BRL",
      intervalo: INTERVALOS.atual,
      agoraMs: AGORA_MS,
    });
    const porPedido = new Map(linhas.map((l) => [l.pedido, l]));
    expect(porPedido.get("#RA1")).toMatchObject({
      metodo: "Cartão",
      valorRelatorio: 97,
      taxa: 6.78,
      comissao: 90.22,
      rotulo: "Paga",
      tom: "ok",
      campanha: "Campanha X",
      anuncio: "Anuncio 1",
      modelo: "venda",
    });
    expect(porPedido.get("#RB1")).toMatchObject({ oferta: "order bump", metodo: "Pix" });
    expect(porPedido.get("#RA2")).toMatchObject({ taxa: 8, comissoes: 32, comissao: 60 });
    expect(porPedido.get("#RA3")).toMatchObject({ rotulo: "Aguardando pagamento", tom: "info" });
    expect(porPedido.get("#RA4")?.rotulo).toBe("Vencida");
    expect(porPedido.get("#RA5")?.rotulo).toBe("Reembolsada");
    expect(porPedido.get("#RA6")?.rotulo).toBe("Chargeback");
    expect(porPedido.get("#RA7")?.rotulo).toBe("Recusada");
    expect(porPedido.get("#RA8")?.rotulo).toBe("Reembolso pedido");
    // 9 itens, 8 cobrancas (B1 e da A1).
    expect(resumo).toMatchObject({
      pedidos: 8,
      recebido: expect.closeTo(211.33, 6),
      faturamento: expect.closeTo(264, 6),
      taxas: expect.closeTo(264 - 211.33, 6),
      aReceber: expect.closeTo(45, 6),
      pendentes: 1,
      perdidos: 4,
    });
  });
});
