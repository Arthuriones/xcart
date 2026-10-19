import { createHash, createHmac } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
const rede = { respostas: [] as Response[], chamadas: [] as { url: string; corpo: unknown; headers: Record<string, string> }[] };
vi.mock("@/lib/net/safe-url", () => ({
  safeFetch: async (url: string, init: { body?: string; headers?: Record<string, string> }) => {
    rede.chamadas.push({ url, corpo: JSON.parse(init.body || "null"), headers: init.headers || {} });
    const r = rede.respostas.shift();
    if (!r) throw new Error("sem resposta preparada");
    return r;
  },
}));

import { cakto } from "@/lib/checkouts-externos/plataformas/cakto";
import { sphere } from "@/lib/checkouts-externos/plataformas/sphere";
import {
  comprasDaEntrega,
  idDaCompra,
  montarCompraMeta,
  montarCompraTiktok,
  partesDoNome,
  telefoneDoComprador,
  vidDoRastreio,
  type DestinoDoCheckout,
  type EnvioGravado,
  type EnvioNovo,
  type RastreioCheckout,
} from "@/lib/checkouts-externos/compra";
import {
  receberEvento,
  type CheckoutParaReceber,
  type MarcaCheckout,
  type PedidoGravado,
  type RepositorioCheckout,
} from "@/lib/checkouts-externos/receber";
import { entregarEnvio } from "@/lib/checkouts-externos/rastreio";
import { enviarAoDestino } from "@/lib/tracking/envio";
import { chaveDoCheckout, conferirLigarRastreamento, lerUso } from "@/lib/billing/limites";
import { definicaoDoEvento } from "@/lib/tracking/eventos";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import type { EventoTiktok } from "@/lib/tracking/tiktok-evento";
import type { IdentidadeGuardada } from "@/lib/tracking/purchase";

// A compra das vendas da Cakto pelo SERVIDOR (Fase C, 073): o xcart manda ao
// Meta e ao TikTok. Uma compra por cobranca (event_id estavel), no primeiro
// evento de venda (padrao) ou so na aprovacao; teste, pausado, Sphere e
// reembolso nao mandam; dado do comprador so em hash; TikTok so vale com
// code 0; o checkout com rastreamento conta no limite do plano como uma loja.
// A fila das lojas Shopify segue igual (o envio comum mantem os avisos).

const AGORA = new Date("2026-10-18T15:00:00.000Z");
const SECRET = "b3f1a9c2-7b4d-4a8e-9f01-2c6d5b8a4e37";
const ID = "b3df956e-1998-4322-b091-ac0c54f7b4ba";
const sha = (v: string) => createHash("sha256").update(v, "utf8").digest("hex");

const DADOS_DO_COMPRADOR = [
  "Ana Souza",
  "ana.souza",
  "provedor.com.br",
  "5534988887777",
  "34988887777",
  "39053344705",
  "Rua das Palmeiras",
  "38400-000",
  "38400000",
  "Uberlândia",
  "uberlandia",
  "ANA S LIMA",
];

type Dados = Record<string, unknown>;

function venda(extra: Dados = {}): Dados {
  return {
    id: ID,
    refId: "4852F91",
    status: "paid",
    offer_type: "main",
    checkout: 1101387,
    parent_order: "",
    checkoutUrl:
      "https://pay.cakto.com.br/a8BcHrY_1101387?utm_source=FB&email=ana.souza%40provedor.com.br&name=Ana%20Souza",
    callback: null,
    sck: null,
    fbc: "fb.1.1760799000000.IwAR0abc",
    fbp: "fb.1.1760799000000.1234567890",
    utm_source: "FB",
    utm_campaign: "Campanha X|120211111111111111",
    baseAmount: 97.0,
    amount: 97.99,
    currency: "BRL",
    fees: 6.78,
    discount: "0.00",
    charged_fees: "0.99",
    paymentMethod: "credit_card",
    customer: {
      id: 481920,
      name: "Ana Souza Lima",
      email: "ana.souza@provedor.com.br",
      phone: "5534988887777",
      docType: "cpf",
      docNumber: "39053344705",
    },
    address: { country: "BR", state: "MG", city: "Uberlândia", zipcode: "38400-000", street: "Rua das Palmeiras", number: "123" },
    product: { id: "cd287b31-d4b7-4e94-858a-96e05ce2f4a2", short_id: "42bruPi", name: "Curso Método X", type: "unique" },
    offer: { id: "a8BcHrY", name: "Oferta principal", price: 97.0, currency: "BRL" },
    commissions: [{ type: "producer", totalAmount: 90.22 }],
    createdAt: "2026-10-18T11:58:00.123456-03:00",
    paidAt: "2026-10-18T11:59:30.654321-03:00",
    card: { holderName: "ANA S LIMA", lastDigits: "4242", brand: "visa" },
    ...extra,
  };
}

function pix(extra: Dados = {}): Dados {
  const d = venda({
    status: "waiting_payment",
    paymentMethod: "pix",
    paidAt: null,
    pix: { qrCode: "00020101021226770014BR.GOV.BCB.PIX", expirationDate: "2026-10-19 14:58:00.387619+00:00" },
    ...extra,
  });
  delete d.card;
  return d;
}

const PIX_PAGO = (extra: Dados = {}) => ({ ...pix(), status: "paid", paidAt: "2026-10-18T11:59:50-03:00", ...extra });

const BUMP = (extra: Dados = {}) =>
  venda({
    id: "c1111111-1111-4111-8111-111111111111",
    refId: "9BUMP01",
    offer_type: "orderbump",
    parent_order: "4852F91",
    baseAmount: 27,
    fees: 1.89,
    commissions: [{ type: "producer", totalAmount: 25.11 }],
    product: { id: "b0b0b0b0-0000-4000-8000-000000000001", name: "Bônus Y" },
    ...extra,
  });

function corpo(event: string, data: unknown): Dados {
  return JSON.parse(JSON.stringify({ secret: SECRET, event, data }));
}

function assinado(raw: string) {
  const ts = String(Math.floor(AGORA.getTime() / 1000));
  const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
  return new Headers({ "X-Cakto-Timestamp": ts, "X-Cakto-Signature": `v1=${sig}` });
}

// ---------------------------------------------------------------------------
// Repositorio e fila em memoria
// ---------------------------------------------------------------------------

function memoria() {
  const eventos = new Set<string>();
  const pedidos = new Map<string, PedidoGravado>();
  const marcas: MarcaCheckout[] = [];
  const soltos: string[] = [];
  const repo: RepositorioCheckout = {
    async travarEvento(x) {
      const k = `${x.pedido_id}|${x.evento}`;
      if (eventos.has(k)) return "duplicado";
      eventos.add(k);
      return "ok";
    },
    async soltarEvento(x) {
      eventos.delete(`${x.pedido_id}|${x.evento}`);
      soltos.push(`${x.pedido_id}|${x.evento}`);
    },
    async lerPedido(_ck, id) {
      const p = pedidos.get(id);
      return p ? { ...p } : null;
    },
    async inserirPedido(x) {
      if (pedidos.has(x.pedido_id)) return "existe";
      pedidos.set(x.pedido_id, { ...x.pedido, versao: 0 });
      return "ok";
    },
    async atualizarPedido(x) {
      const atual = pedidos.get(x.pedido_id);
      if (!atual || atual.versao !== x.versao) return false;
      pedidos.set(x.pedido_id, { ...x.pedido, versao: x.versao + 1 });
      return true;
    },
    async reivindicarConta() {
      return "ok";
    },
    async marcarCheckout(_ck, campos) {
      marcas.push(campos);
    },
  };
  return { repo, eventos, pedidos, marcas, soltos };
}

const META: DestinoDoCheckout = { id: "d-meta", plataforma: "meta", conta: "123456789012345", token: "EAAtoken123456", testEventCode: null, ativo: true };
const TIKTOK: DestinoDoCheckout = { id: "d-tt", plataforma: "tiktok", conta: "CUSG5HBC77UD11VVRQEG", token: "tt-token-1234567", testEventCode: null, ativo: true };

/** A fila com o indice unico (destino_id, event_id) da 073. */
function fila(
  destinos: DestinoDoCheckout[] = [META, TIKTOK],
  opcoes: { falharEnfileirar?: number; identidades?: Record<string, IdentidadeGuardada> } = {}
) {
  let falhas = opcoes.falharEnfileirar ?? 0;
  const linhas: EnvioGravado[] = [];
  /** Os vids que a compra procurou (checkout|vid). */
  const procurados: string[] = [];
  let lidas = 0;
  const rastreio: RastreioCheckout = {
    async destinos() {
      lidas += 1;
      return destinos;
    },
    async identidade(checkoutId, vid) {
      procurados.push(`${checkoutId}|${vid}`);
      return opcoes.identidades?.[vid] ?? null;
    },
    async enfileirar(novas: EnvioNovo[]) {
      if (falhas > 0) {
        falhas -= 1;
        throw new Error("banco fora");
      }
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
  return { rastreio, linhas, procurados, lidas: () => lidas };
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
  compra_quando: "gerada",
  ultimo_evento_em: null,
  ultimo_evento_teste: false,
};

async function receber(
  m: ReturnType<typeof memoria>,
  f: ReturnType<typeof fila>,
  c: Dados,
  checkout: Partial<CheckoutParaReceber> = {}
) {
  const raw = JSON.stringify(c);
  return receberEvento(m.repo, { ...CHECKOUT, ...checkout }, cakto, JSON.parse(raw), AGORA, { raw, headers: assinado(raw), segredo: SECRET }, f.rastreio);
}

const metaDe = (f: ReturnType<typeof fila>) => f.linhas.filter((l) => l.plataforma === "meta").map((l) => l.payload as EventoCapi);
const tiktokDe = (f: ReturnType<typeof fila>) => f.linhas.filter((l) => l.plataforma === "tiktok").map((l) => l.payload as EventoTiktok);

// ---------------------------------------------------------------------------
// Quando sai
// ---------------------------------------------------------------------------

describe("a compra pelo servidor: quando sai", () => {
  it("padrao: sai no Pix gerado, antes da resposta, e NAO sai de novo quando o Pix e pago", async () => {
    const m = memoria();
    const f = fila();
    const gerado = await receber(m, f, corpo("pix_gerado", pix()));
    expect(gerado.status).toBe(200);
    // Gravada antes de responder; a rota entrega em after().
    expect(gerado.entregar?.map((e) => e.envio.id)).toEqual(["e1", "e2"]);
    expect(gerado.entregar?.map((e) => e.destino.id)).toEqual(["d-meta", "d-tt"]);
    expect(f.linhas.map((l) => [l.plataforma, l.event_id, l.grupo, l.event_name])).toEqual([
      ["meta", "purchase_cakto_4852F91", "4852F91", "Purchase"],
      ["tiktok", "purchase_cakto_4852F91", "4852F91", "Purchase"],
    ]);
    const [compra] = metaDe(f);
    // A hora da geracao (createdAt), em segundos.
    expect(compra.event_time).toBe(Math.floor(Date.parse("2026-10-18T14:58:00.123Z") / 1000));
    expect(compra.custom_data).toMatchObject({ currency: "BRL", value: 97, order_id: "4852F91", num_items: 1 });

    const pago = await receber(m, f, corpo("purchase_approved", PIX_PAGO()));
    expect(pago.status).toBe(200);
    expect(pago.entregar).toBeUndefined();
    expect(f.linhas).toHaveLength(2);
    // A venda no celular continua saindo na aprovacao.
    expect(pago.notificar).toMatchObject({ tipo: "venda" });
  });

  it("so aprovadas: o Pix gerado nao manda; a aprovacao manda, com a hora do pagamento", async () => {
    const m = memoria();
    const f = fila();
    const gerado = await receber(m, f, corpo("pix_gerado", pix()), { compra_quando: "aprovada" });
    expect(gerado.entregar).toBeUndefined();
    expect(f.linhas).toHaveLength(0);
    await receber(m, f, corpo("boleto_gerado", pix({ id: "d2222222-2222-4222-8222-222222222222", refId: "BOL0001" })), { compra_quando: "aprovada" });
    expect(f.linhas).toHaveLength(0);

    const pago = await receber(m, f, corpo("purchase_approved", PIX_PAGO()), { compra_quando: "aprovada" });
    expect(pago.entregar).toHaveLength(2);
    expect(metaDe(f)[0].event_time).toBe(Math.floor(Date.parse("2026-10-18T14:59:50.000Z") / 1000));
    expect(tiktokDe(f)[0]).toMatchObject({ event: "Purchase", event_id: "purchase_cakto_4852F91", properties: { currency: "BRL", value: 97 } });
  });

  it("a hora nunca fica no futuro (relogio da Cakto adiantado)", () => {
    const r = cakto.lerTodos!(corpo("purchase_approved", venda({ paidAt: "2026-10-18T12:20:00-03:00" })), AGORA);
    if (!r.ok) throw new Error(r.erro);
    const [compra] = comprasDaEntrega(r.eventos.map((ev) => ({ ev, venceu: true })), "gerada", "purchase_approved");
    expect(montarCompraMeta(compra, { plataforma: "cakto", agoraMs: AGORA.getTime(), moedaPadrao: "BRL" }).event_time).toBe(AGORA.getTime() / 1000);
  });

  it("cartao aprovado direto: uma compra, e a retentativa da Cakto nao manda de novo", async () => {
    const m = memoria();
    const f = fila();
    const r = await receber(m, f, corpo("purchase_approved", venda()));
    expect(r.entregar).toHaveLength(2);
    expect(metaDe(f)[0].event_time).toBe(Math.floor(Date.parse("2026-10-18T14:59:30.654Z") / 1000));
    const de_novo = await receber(m, f, corpo("purchase_approved", venda()));
    expect(de_novo.corpo).toEqual({ ok: true, duplicado: true });
    expect(f.linhas).toHaveLength(2);
  });

  it("boleto gerado no dia 0 e pago no dia 10: a aprovacao tem o MESMO event_id e passa na janela de 7 dias -- so a linha guardada barra a 2a compra", async () => {
    const DIA_0 = new Date("2026-10-08T15:05:00.000Z");
    const em = (m: ReturnType<typeof memoria>, f: ReturnType<typeof fila>, c: Dados, agora: Date) => {
      const raw = JSON.stringify(c);
      const ts = String(Math.floor(agora.getTime() / 1000));
      const sig = createHmac("sha256", SECRET).update(`${ts}.${raw}`).digest("hex");
      const headers = new Headers({ "X-Cakto-Timestamp": ts, "X-Cakto-Signature": `v1=${sig}` });
      return receberEvento(m.repo, CHECKOUT, cakto, JSON.parse(raw), agora, { raw, headers, segredo: SECRET }, f.rastreio);
    };
    const boleto = (extra: Dados = {}) =>
      pix({
        id: "d3333333-3333-4333-8333-333333333333",
        refId: "BOL0010",
        paymentMethod: "boleto",
        createdAt: "2026-10-08T12:00:00-03:00",
        ...extra,
      });
    const pago = boleto({ status: "paid", paidAt: "2026-10-18T11:59:50-03:00" });

    // A linha da compra entregue guardada (o purge guarda 30 dias): a
    // aprovacao do dia 10 cai no unique e nao sai.
    const m = memoria();
    const f = fila([META]);
    await em(m, f, corpo("boleto_gerado", boleto()), DIA_0);
    expect(f.linhas.map((l) => l.event_id)).toEqual(["purchase_cakto_BOL0010"]);
    const comTrava = await em(m, f, corpo("purchase_approved", pago), AGORA);
    expect(comTrava.status).toBe(200);
    expect(comTrava.entregar ?? []).toHaveLength(0);
    expect(f.linhas).toHaveLength(1);

    // A linha apagada aos 8 dias (o purge antigo): a mesma aprovacao entra de
    // novo com o mesmo event_id -- e o Meta so descarta repetido em 48 h.
    const m2 = memoria();
    const f2 = fila([META]);
    await em(m2, f2, corpo("boleto_gerado", boleto()), DIA_0);
    f2.linhas.splice(0);
    const semTrava = await em(m2, f2, corpo("purchase_approved", pago), AGORA);
    expect(semTrava.entregar).toHaveLength(1);
    expect(f2.linhas.map((l) => l.event_id)).toEqual(["purchase_cakto_BOL0010"]);
  });

  it("Pix gerado que chega depois da aprovacao nao e venda nova", async () => {
    const m = memoria();
    const f = fila([META]);
    await receber(m, f, corpo("purchase_approved", PIX_PAGO()), { compra_quando: "aprovada" });
    await receber(m, f, corpo("pix_gerado", pix()));
    expect(f.linhas).toHaveLength(1);
  });

  it("reembolso, chargeback, reembolso pedido e recusa nao mandam nada", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_refused", venda({ status: "refused", paidAt: null })));
    expect(f.linhas).toHaveLength(0);
    const m2 = memoria();
    const f2 = fila();
    // Sem a compra antes (so o estorno chega): nada sai.
    await receber(m2, f2, corpo("refund", venda({ status: "refunded", refundedAt: "2026-10-18T12:30:00-03:00" })));
    await receber(m2, f2, corpo("chargeback", venda({ status: "chargedback", chargedbackAt: "2026-10-18T13:00:00-03:00" })));
    await receber(m2, f2, corpo("refund_requested", venda({ status: "refund_requested" })));
    expect(f2.linhas).toHaveLength(0);
  });
});

describe("order bump: uma compra por cobranca", () => {
  it("V2 (principal e bump na mesma entrega): um Purchase com a soma e os dois produtos", async () => {
    const m = memoria();
    const f = fila();
    const r = await receber(m, f, corpo("purchase_approved", [venda(), BUMP({ parent_order: "" })]));
    expect(r.entregar).toHaveLength(2);
    expect(f.linhas.map((l) => l.event_id)).toEqual(["purchase_cakto_4852F91", "purchase_cakto_4852F91"]);
    const [meta] = metaDe(f);
    expect(meta.custom_data).toMatchObject({
      value: 124,
      num_items: 2,
      content_ids: ["cd287b31-d4b7-4e94-858a-96e05ce2f4a2", "b0b0b0b0-0000-4000-8000-000000000001"],
      contents: [
        { id: "cd287b31-d4b7-4e94-858a-96e05ce2f4a2", quantity: 1, item_price: 97 },
        { id: "b0b0b0b0-0000-4000-8000-000000000001", quantity: 1, item_price: 27 },
      ],
    });
    expect(tiktokDe(f)[0].properties).toMatchObject({ value: 124, num_items: 2 });
  });

  it("V1 (entregas separadas): o bump do mesmo grupo nao vira um segundo Purchase", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_approved", venda()));
    const bump = await receber(m, f, corpo("purchase_approved", BUMP()));
    expect(bump.status).toBe(200);
    expect(bump.entregar).toBeUndefined();
    expect(f.linhas).toHaveLength(2);
    // O pedido do bump entra no Dashboard normalmente.
    expect(m.pedidos.size).toBe(2);
  });
});

describe("o que nunca manda", () => {
  it("teste da Cakto, o nosso e o checkout pausado: nem le os destinos", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_approved", venda({ card: {}, pix: {}, boleto: {}, picpay: {} })));
    const exemplo = cakto.exemplo(AGORA, SECRET) as Dados;
    await receber(m, f, exemplo);
    await receber(m, f, corpo("purchase_approved", venda()), { ativo: false });
    expect(f.linhas).toHaveLength(0);
    expect(f.lidas()).toBe(0);
  });

  it("destino desligado ou sem token nao entra; sem destino, o webhook segue igual", async () => {
    const m = memoria();
    const f = fila([{ ...META, ativo: false }, { ...TIKTOK, token: null }]);
    const r = await receber(m, f, corpo("purchase_approved", venda()));
    expect(r).toMatchObject({ status: 200, corpo: { ok: true } });
    expect(r.entregar).toBeUndefined();
    expect(f.linhas).toHaveLength(0);

    // Sem rastreio nenhum (o contrato antigo): o mesmo resultado de antes.
    const m2 = memoria();
    const raw = JSON.stringify(corpo("purchase_approved", venda()));
    const sem = await receberEvento(m2.repo, CHECKOUT, cakto, JSON.parse(raw), AGORA, { raw, headers: assinado(raw), segredo: SECRET });
    expect(sem.status).toBe(200);
    expect(sem.entregar).toBeUndefined();
  });

  it("a Sphere (comissao) nao manda compra", async () => {
    const m = memoria();
    const f = fila();
    const agora = AGORA.toISOString();
    const r = await receberEvento(
      m.repo,
      { ...CHECKOUT, plataforma: "sphere", moeda_receita: "EUR" },
      sphere,
      { evento: "pedido.criado", data_evento: agora, pedido: { id: 1, moeda: "EUR", valor: "10.00", criado_em: agora }, comissao: { valor: "5.00", status: "pending" }, afiliado: { codigo: "abc" } },
      AGORA,
      undefined,
      f.rastreio
    );
    expect(r.status).toBe(200);
    expect(f.lidas()).toBe(0);
    expect(f.linhas).toHaveLength(0);
  });

  it("reenvio antigo (mais de 7 dias): o Meta e o TikTok recusariam, entao nao entra", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_approved", venda({ createdAt: "2026-10-09T10:00:00-03:00", paidAt: "2026-10-09T10:01:00-03:00" })));
    expect(m.pedidos.size).toBe(1);
    expect(f.linhas).toHaveLength(0);
  });
});

describe("falha ao enfileirar", () => {
  it("solta as travas da compra, segura a resposta e nao avisa; a retentativa enfileira e avisa uma vez", async () => {
    const m = memoria();
    const f = fila([META], { falharEnfileirar: 1 });
    const r = await receber(m, f, corpo("purchase_approved", venda()));
    expect(r).toMatchObject({ status: 503, segurar: true, notificar: null });
    expect(m.soltos).toEqual([`${ID}|purchase_approved`]);
    expect(m.pedidos.get(ID)).toMatchObject({ situacao: "pago" });
    expect(String(m.marcas.at(-1)?.ultimo_erro)).toMatch(/Reenviar no painel/);

    const de_novo = await receber(m, f, corpo("purchase_approved", venda()));
    expect(de_novo.status).toBe(200);
    expect(de_novo.notificar).toMatchObject({ tipo: "venda", pedido: "#4852F91" });
    expect(f.linhas.map((l) => l.event_id)).toEqual(["purchase_cakto_4852F91"]);
  });
});

// ---------------------------------------------------------------------------
// O payload: hash certo, nenhum dado pessoal em claro
// ---------------------------------------------------------------------------

describe("o comprador so em hash", () => {
  it("Meta: e-mail, telefone E.164 (BR), nome, cidade, estado, CEP e pais em SHA-256; fbc/fbp do webhook", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_approved", venda({ callback: "xc.lq2x9k.ab12cd34" })));
    const [compra] = metaDe(f);
    expect(compra).toMatchObject({
      event_name: "Purchase",
      event_id: "purchase_cakto_4852F91",
      action_source: "website",
      // Sem a query (o pre-preenchimento leva nome e e-mail nela).
      event_source_url: "https://pay.cakto.com.br/a8BcHrY_1101387",
    });
    expect(compra.user_data).toEqual({
      em: [sha("ana.souza@provedor.com.br")],
      ph: [sha("5534988887777")],
      fn: [sha("ana")],
      ln: [sha("lima")],
      ct: [sha("uberlândia"), sha("uberlandia")],
      st: [sha("mg")],
      zp: [sha("38400000")],
      country: [sha("br")],
      external_id: [sha("lq2x9k.ab12cd34")],
      fbc: "fb.1.1760799000000.IwAR0abc",
      fbp: "fb.1.1760799000000.1234567890",
    });
  });

  it("TikTok: telefone com '+' antes do hash (outro hash que o do Meta), e-mail e o vid", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_approved", venda({ callback: "xc.lq2x9k.ab12cd34" })));
    const [compra] = tiktokDe(f);
    expect(compra.user).toEqual({
      email: sha("ana.souza@provedor.com.br"),
      phone: sha("+5534988887777"),
      external_id: [sha("lq2x9k.ab12cd34")],
    });
    expect(compra.page).toEqual({ url: "https://pay.cakto.com.br/a8BcHrY_1101387" });
  });

  it("nada do comprador em claro no payload da fila (nem o CPF, nem '@')", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("pix_gerado", pix()));
    await receber(m, f, corpo("purchase_approved", [venda({ id: "e3333333-3333-4333-8333-333333333333", refId: "OUTRA01" }), BUMP({ parent_order: "" })]));
    const tudo = JSON.stringify(f.linhas);
    expect(f.linhas.length).toBeGreaterThan(0);
    for (const dado of DADOS_DO_COMPRADOR) expect(tudo, dado).not.toContain(dado);
    // A 073 recusa payload com "@": o e-mail em claro nunca entra.
    for (const l of f.linhas) expect(JSON.stringify(l.payload)).not.toContain("@");
  });

  it("sem fbc no webhook: monta do fbclid da URL do checkout; fbc torto sai", () => {
    const m = cakto.lerTodos!(
      corpo("purchase_approved", venda({ fbc: "lixo", fbp: null, checkoutUrl: "https://pay.cakto.com.br/a8BcHrY?fbclid=IwAR9xyz_123&ttclid=E.C.P.abc" })),
      AGORA
    );
    if (!m.ok) throw new Error(m.erro);
    const [compra] = comprasDaEntrega(m.eventos.map((ev) => ({ ev, venceu: true })), "gerada", "purchase_approved");
    const meta = montarCompraMeta(compra, { plataforma: "cakto", agoraMs: AGORA.getTime(), moedaPadrao: "BRL" });
    expect(meta.user_data.fbc).toBe(`fb.1.${Date.parse("2026-10-18T14:58:00.123Z")}.IwAR9xyz_123`);
    expect(meta.user_data.fbp).toBeUndefined();
    const tt = montarCompraTiktok(compra, { plataforma: "cakto", agoraMs: AGORA.getTime(), moedaPadrao: "BRL" });
    expect(tt.user.ttclid).toBe("E.C.P.abc");
  });

  it("o gancho da Fase D: IP, user agent, _fbp e ttclid da identidade do visitante", () => {
    const m = cakto.lerTodos!(corpo("purchase_approved", venda({ fbc: null, fbp: null, callback: "xc.lq2x9k.ab12cd34" })), AGORA);
    if (!m.ok) throw new Error(m.erro);
    const [compra] = comprasDaEntrega(m.eventos.map((ev) => ({ ev, venceu: true })), "gerada", "purchase_approved");
    const identidade = { fbclid: "IwARclique", fbp: "fb.1.1760700000000.987", ttclid: "ttclique", ttp: "ttp-1", clientIp: "203.0.113.7", userAgent: "Mozilla/5.0" };
    const ctx = { plataforma: "cakto", agoraMs: AGORA.getTime(), moedaPadrao: "BRL", identidade };
    expect(montarCompraMeta(compra, ctx).user_data).toMatchObject({
      fbp: "fb.1.1760700000000.987",
      fbc: `fb.1.${Date.parse("2026-10-18T14:58:00.123Z")}.IwARclique`,
      client_ip_address: "203.0.113.7",
      client_user_agent: "Mozilla/5.0",
    });
    expect(montarCompraTiktok(compra, ctx).user).toMatchObject({ ttclid: "ttclique", ttp: "ttp-1", ip: "203.0.113.7", user_agent: "Mozilla/5.0" });
  });

  it("telefone brasileiro com e sem 55 (e o DDD 55 do RS), nome e vid", () => {
    expect(telefoneDoComprador("5534988887777", null)).toBe("5534988887777");
    expect(telefoneDoComprador("34988887777", "BR")).toBe("5534988887777");
    expect(telefoneDoComprador("(34) 3222-1100", null)).toBe("553432221100");
    // 55 e DDD em Santa Maria: pelo tamanho, nao pelo "comeca com 55".
    expect(telefoneDoComprador("55999998888", "BR")).toBe("5555999998888");
    expect(telefoneDoComprador("+351 912 345 678", "BR")).toBe("351912345678");
    expect(telefoneDoComprador("912345678", "PT")).toBe("351912345678");
    expect(telefoneDoComprador("123", "BR")).toBeNull();
    expect(partesDoNome("  Ana   Souza Lima ")).toEqual({ primeiro: "Ana", ultimo: "Lima" });
    expect(partesDoNome("Ana")).toEqual({ primeiro: "Ana", ultimo: null });
    expect(vidDoRastreio({ callback: "xc.lq2x9k.ab12cd34", sck: null } as never)).toBe("lq2x9k.ab12cd34");
    expect(vidDoRastreio({ callback: "outro-token", sck: "xc.a1.b2" } as never)).toBe("a1.b2");
    expect(vidDoRastreio({ callback: "xc.<script>", sck: null } as never)).toBeNull();
    expect(idDaCompra("cakto", "4852F91")).toBe("purchase_cakto_4852F91");
  });
});

// ---------------------------------------------------------------------------
// Fase D: a compra acha o visitante que a ponte gravou
// ---------------------------------------------------------------------------

describe("a compra acha o visitante da ponte (Fase D)", () => {
  const VID = "mgx1k2a3.4b5c6d7e";
  const DA_PONTE: IdentidadeGuardada = {
    visitorId: VID,
    fbp: "fb.1.1760700000000.987654321",
    fbc: null,
    fbclid: "IwAR_ponte",
    ttclid: "E.C.P.ttponte",
    ttp: "UqBuLHl7abc",
    clientIp: "203.0.113.7",
    userAgent: "Mozilla/5.0 (iPhone)",
    // A hora do clique (o conjunto da ponte): o fbc montado leva ela, nao a do pedido.
    utmEm: "2026-10-18T14:30:00.000Z",
  };
  const semSinalDaCakto = { fbc: null, fbp: null, callback: null, sck: null, checkoutUrl: "https://pay.cakto.com.br/a8BcHrY_1101387" };

  async function compraCom(dados: Dados) {
    const m = memoria();
    const f = fila([META, TIKTOK], { identidades: { [VID]: DA_PONTE } });
    await receber(m, f, corpo("purchase_approved", venda({ ...semSinalDaCakto, ...dados })));
    return { f, meta: metaDe(f)[0], tiktok: tiktokDe(f)[0] };
  }

  it("pelo callback (xc.<vid>): IP, user agent, _fbp, fbc do fbclid, ttclid e _ttp da identidade; external_id = vid", async () => {
    const { f, meta, tiktok } = await compraCom({ callback: `xc.${VID}` });
    expect(f.procurados).toEqual([`${CHECKOUT.id}|${VID}`]);
    expect(meta.user_data).toMatchObject({
      external_id: [sha(VID)],
      fbp: "fb.1.1760700000000.987654321",
      fbc: `fb.1.${Date.parse("2026-10-18T14:30:00.000Z")}.IwAR_ponte`,
      client_ip_address: "203.0.113.7",
      client_user_agent: "Mozilla/5.0 (iPhone)",
    });
    expect(tiktok.user).toMatchObject({
      external_id: [sha(VID)],
      ttclid: "E.C.P.ttponte",
      ttp: "UqBuLHl7abc",
      ip: "203.0.113.7",
      user_agent: "Mozilla/5.0 (iPhone)",
    });
  });

  it("o fbc e o fbp que a Cakto mandou vencem os da identidade", async () => {
    const { meta } = await compraCom({ callback: `xc.${VID}`, fbc: "fb.1.1760799000000.IwAR0abc", fbp: "fb.1.1760799000000.1234567890" });
    expect(meta.user_data).toMatchObject({ fbc: "fb.1.1760799000000.IwAR0abc", fbp: "fb.1.1760799000000.1234567890", client_ip_address: "203.0.113.7" });
  });

  it("pelo sck, quando o callback e de outro sistema", async () => {
    const { f, meta } = await compraCom({ callback: "token-do-lojista", sck: `xc.${VID}` });
    expect(f.procurados).toEqual([`${CHECKOUT.id}|${VID}`]);
    expect(meta.user_data.client_ip_address).toBe("203.0.113.7");
  });

  it("pela query do checkoutUrl, quando os campos nao vieram; a URL do evento sai sem a query", async () => {
    const { f, meta } = await compraCom({
      checkoutUrl: `https://pay.cakto.com.br/a8BcHrY_1101387?callback=xc.${VID}&utm_source=FB&email=ana.souza%40provedor.com.br`,
    });
    expect(f.procurados).toEqual([`${CHECKOUT.id}|${VID}`]);
    expect(meta.event_source_url).toBe("https://pay.cakto.com.br/a8BcHrY_1101387");
    expect(meta.user_data.external_id).toEqual([sha(VID)]);
    expect(meta.user_data.client_user_agent).toBe("Mozilla/5.0 (iPhone)");
  });

  it("sem vid: nem procura a identidade, e a compra sai so com o que a Cakto mandou", async () => {
    const { f, meta } = await compraCom({ callback: "outro", sck: "utmify-123" });
    expect(f.procurados).toEqual([]);
    expect(meta.user_data.external_id).toBeUndefined();
    expect(meta.user_data.client_ip_address).toBeUndefined();
  });

  it("identidade vencida ou que falhou (null): a compra sai mesmo assim", async () => {
    const m = memoria();
    const f = fila();
    await receber(m, f, corpo("purchase_approved", venda({ ...semSinalDaCakto, callback: "xc.zz9.zz9" })));
    expect(f.procurados).toEqual([`${CHECKOUT.id}|zz9.zz9`]);
    expect(metaDe(f)).toHaveLength(1);
    expect(metaDe(f)[0].user_data.external_id).toEqual([sha("zz9.zz9")]);
  });

  it("valor da identidade com '@' nao entra (o CHECK da fila recusaria a compra inteira)", async () => {
    const m = memoria();
    const f = fila([META, TIKTOK], { identidades: { [VID]: { ...DA_PONTE, userAgent: "Bot (contato@empresa.com)", fbp: "x@y" } } });
    const r = await receber(m, f, corpo("purchase_approved", venda({ ...semSinalDaCakto, callback: `xc.${VID}` })));
    expect(r.status).toBe(200);
    for (const l of f.linhas) expect(JSON.stringify(l.payload)).not.toContain("@");
    expect(metaDe(f)[0].user_data.client_user_agent).toBeUndefined();
    expect(metaDe(f)[0].user_data.client_ip_address).toBe("203.0.113.7");
  });

  it("a Utmify na mesma pagina: as UTMs saem sem o que ela gruda, e o click id dela vira o fbc", async () => {
    const m = cakto.lerTodos!(
      corpo(
        "purchase_approved",
        venda({ ...semSinalDaCakto, utm_source: "FBjLj6728abc", utm_content: "Anuncio X|120200000000000003::IwAR_utmify::" })
      ),
      AGORA
    );
    if (!m.ok) throw new Error(m.erro);
    const r = m.eventos[0].rastreio!;
    expect(r.utm).toMatchObject({ source: "FB", content: "Anuncio X|120200000000000003" });
    expect(r.fbclid).toBe("IwAR_utmify");
    const [compra] = comprasDaEntrega(m.eventos.map((ev) => ({ ev, venceu: true })), "gerada", "purchase_approved");
    const meta = montarCompraMeta(compra, { plataforma: "cakto", agoraMs: AGORA.getTime(), moedaPadrao: "BRL" });
    expect(meta.user_data.fbc).toBe(`fb.1.${Date.parse("2026-10-18T14:58:00.123Z")}.IwAR_utmify`);
  });
});

// ---------------------------------------------------------------------------
// A entrega (TikTok so vale com code 0) e o envio comum com as lojas
// ---------------------------------------------------------------------------

function adminFalso() {
  const updates: { tabela: string; campos: Record<string, unknown>; filtros: Record<string, unknown> }[] = [];
  const admin = {
    from(tabela: string) {
      return {
        update(campos: Record<string, unknown>) {
          const filtros: Record<string, unknown> = {};
          const q = {
            eq(c: string, v: unknown) {
              filtros[c] = v;
              return q;
            },
            then(ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) {
              updates.push({ tabela, campos, filtros });
              return Promise.resolve({ error: null }).then(ok, erro);
            },
          };
          return q;
        },
      };
    },
  };
  return { admin: admin as never, updates };
}

function linhaDaFila(plataforma: "meta" | "tiktok", extra: Record<string, unknown> = {}) {
  const agoraS = Math.floor(Date.now() / 1000);
  const payload =
    plataforma === "tiktok"
      ? { event: "Purchase", event_time: agoraS, event_id: "purchase_cakto_G1", user: {}, page: { url: "https://pay.cakto.com.br/x" } }
      : { event_name: "Purchase", event_time: agoraS, event_id: "purchase_cakto_G1", action_source: "website", user_data: {} };
  return { id: "linha-1", destino_id: plataforma === "tiktok" ? TIKTOK.id : META.id, plataforma, event_id: "purchase_cakto_G1", payload, attempts: 0, ...extra };
}

const respostaJson = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });

describe("entregarEnvio", () => {
  beforeEach(() => {
    rede.respostas = [];
    rede.chamadas = [];
  });

  it("TikTok com HTTP 200 e code != 0 e FALHA (permanente); code 0 e enviado", async () => {
    const { admin, updates } = adminFalso();
    rede.respostas.push(respostaJson({ code: 40002, message: "invalid field", request_id: "r1" }));
    const r = await entregarEnvio(admin, linhaDaFila("tiktok"), TIKTOK);
    expect(r).toMatchObject({ ok: false });
    expect(updates.at(-1)).toMatchObject({
      tabela: "checkout_externo_envios",
      campos: { status: "falhou", attempts: 1 },
      filtros: { id: "linha-1", status: "pendente" },
    });
    expect(rede.chamadas[0].headers["Access-Token"]).toBe(TIKTOK.token);

    rede.respostas.push(respostaJson({ code: 50000, message: "erro deles" }));
    await entregarEnvio(admin, linhaDaFila("tiktok"), TIKTOK);
    expect(updates.at(-1)?.campos).toMatchObject({ status: "pendente", attempts: 1 });

    rede.respostas.push(respostaJson({ code: 0, message: "OK", request_id: "r2" }));
    expect(await entregarEnvio(admin, linhaDaFila("tiktok"), TIKTOK)).toEqual({ ok: true });
    expect(updates.at(-1)?.campos).toMatchObject({ status: "enviado", last_error: "sem ttclid: nao veio de clique em anuncio do TikTok" });
  });

  it("Meta aceito vira enviado; destino desligado, sem token ou compra velha fecham sem chamar a rede", async () => {
    const { admin, updates } = adminFalso();
    rede.respostas.push(respostaJson({ events_received: 1, fbtrace_id: "t1" }));
    expect(await entregarEnvio(admin, linhaDaFila("meta"), META)).toEqual({ ok: true });
    expect(rede.chamadas[0].url).toContain("/123456789012345/events");
    expect(updates.at(-1)?.campos).toMatchObject({ status: "enviado" });

    const antes = rede.chamadas.length;
    await entregarEnvio(admin, linhaDaFila("meta"), { ...META, ativo: false });
    expect(updates.at(-1)?.campos).toMatchObject({ status: "falhou", last_error: "destino desligado" });
    await entregarEnvio(admin, linhaDaFila("meta"), { ...META, token: null });
    expect(updates.at(-1)?.campos).toMatchObject({ status: "falhou" });
    const velha = linhaDaFila("meta");
    (velha.payload as { event_time: number }).event_time -= 8 * 86_400;
    await entregarEnvio(admin, velha, META);
    expect(updates.at(-1)?.campos).toMatchObject({ status: "falhou", last_error: "passou dos 7 dias que o Meta e o TikTok aceitam" });
    expect(rede.chamadas.length).toBe(antes);
  });

  it("o envio comum mantem o que a fila das lojas fazia: despacho pela plataforma e os avisos", async () => {
    rede.respostas.push(respostaJson({ events_received: 1 }));
    const meta = await enviarAoDestino({ plataforma: "meta", conta: "123", token: "tk" }, { user_data: {} });
    expect(meta).toMatchObject({ ok: true, aviso: "sem fbc: nao veio de clique em anuncio do Meta" });
    rede.respostas.push(respostaJson({ events_received: 1 }));
    const comClique = await enviarAoDestino({ plataforma: "meta", conta: "123", token: "tk" }, { user_data: { fbc: "fb.1.1.x" } });
    expect(comClique.aviso).toBeNull();
    rede.respostas.push(respostaJson({ code: 40105, message: "token invalido" }));
    const tt = await enviarAoDestino({ plataforma: "tiktok", conta: "CUSG5HBC77UD11VVRQEG", token: "tk" }, { user: {} });
    expect(tt).toMatchObject({ ok: false, podeTentarDeNovo: false, aviso: null });
    expect(rede.chamadas.map((c) => new URL(c.url).hostname)).toEqual(["graph.facebook.com", "graph.facebook.com", "business-api.tiktok.com"]);
  });
});

// ---------------------------------------------------------------------------
// Limite do plano: checkout com rastreamento conta como uma loja
// ---------------------------------------------------------------------------

type Linha = Record<string, unknown>;

function bancoFalso(tabelas: Record<string, Linha[]>, opcoes: { semTabelaDestinos?: boolean } = {}) {
  const from = (tabela: string) => {
    const filtros: [string, (v: unknown) => boolean][] = [];
    const resolver = () => {
      if (tabela === "checkout_externo_destinos" && opcoes.semTabelaDestinos) {
        return { data: null, error: { code: "PGRST205", message: "Could not find the table 'public.checkout_externo_destinos'" } };
      }
      return { data: (tabelas[tabela] || []).filter((l) => filtros.every(([c, f]) => f(l[c]))), error: null };
    };
    const api = {
      select: () => api,
      eq: (c: string, v: unknown) => {
        filtros.push([c, (x) => x === v]);
        return api;
      },
      in: (c: string, vs: unknown[]) => {
        filtros.push([c, (x) => vs.includes(x)]);
        return api;
      },
      maybeSingle: async () => {
        const r = resolver();
        return { data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error };
      },
      then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(resolver()).then(ok, erro),
    };
    return api;
  };
  return { from } as unknown as SupabaseClient;
}

function conta(plano: string, extra: Partial<Record<string, Linha[]>> = {}) {
  return {
    profiles: [{ id: "alice", plan: "pro", plano }],
    stores: [
      { id: "a1", user_id: "alice" },
      { id: "a2", user_id: "alice" },
    ],
    tracking_configs: [] as Linha[],
    routed_checkout_configs: [] as Linha[],
    routed_checkout_targets: [] as Linha[],
    checkout_externo_destinos: [] as Linha[],
    ...extra,
  };
}

describe("limite do plano conta o checkout com rastreamento", () => {
  it("1 Loja com uma loja rastreando: ligar o checkout passa do limite", async () => {
    const db = bancoFalso(conta("loja1", { tracking_configs: [{ store_id: "a1", enabled: true }] }));
    const r = await conferirLigarRastreamento(db, "alice", { checkoutId: "ck1" });
    expect(r).toMatchObject({ ok: false, status: 403, codigo: "limite_do_plano" });
  });

  it("1 Loja com o checkout rastreando: a loja nova e barrada; o proprio checkout segue passando", async () => {
    const db = bancoFalso(conta("loja1", { checkout_externo_destinos: [{ checkout_id: "ck1", user_id: "alice", ativo: true }] }));
    expect(await conferirLigarRastreamento(db, "alice", "a1")).toMatchObject({ ok: false, status: 403 });
    expect(await conferirLigarRastreamento(db, "alice", { checkoutId: "ck1" })).toEqual({ ok: true });
    const uso = await lerUso(db, "alice");
    expect([...uso.rastreamento]).toEqual([chaveDoCheckout("ck1")]);
  });

  it("destino desligado, de outro usuario ou sem a 073 nao conta; 3 Lojas cabe loja + checkouts", async () => {
    const desligado = bancoFalso(
      conta("loja1", {
        checkout_externo_destinos: [
          { checkout_id: "ck1", user_id: "alice", ativo: false },
          { checkout_id: "ck9", user_id: "bob", ativo: true },
        ],
      })
    );
    expect(await conferirLigarRastreamento(desligado, "alice", "a1")).toEqual({ ok: true });

    const semTabela = bancoFalso(conta("loja1"), { semTabelaDestinos: true });
    expect(await conferirLigarRastreamento(semTabela, "alice", "a1")).toEqual({ ok: true });
    expect((await lerUso(semTabela, "alice")).rastreamento.size).toBe(0);

    const tres = bancoFalso(
      conta("lojas3", {
        tracking_configs: [{ store_id: "a1", enabled: true }],
        checkout_externo_destinos: [
          { checkout_id: "ck1", user_id: "alice", ativo: true },
          // Dois destinos (Meta e TikTok) do mesmo checkout contam uma vez.
          { checkout_id: "ck1", user_id: "alice", ativo: true },
        ],
      })
    );
    expect(await conferirLigarRastreamento(tres, "alice", { checkoutId: "ck2" })).toEqual({ ok: true });
    const cheio = bancoFalso(
      conta("lojas3", {
        tracking_configs: [{ store_id: "a1", enabled: true }],
        checkout_externo_destinos: [
          { checkout_id: "ck1", user_id: "alice", ativo: true },
          { checkout_id: "ck2", user_id: "alice", ativo: true },
        ],
      })
    );
    expect(await conferirLigarRastreamento(cheio, "alice", "a2")).toMatchObject({ ok: false, status: 403 });
  });
});

// ---------------------------------------------------------------------------
// A migration 073 e o codigo: so acrescenta, segredo so pelo service role
// ---------------------------------------------------------------------------

const RAIZ = path.resolve(__dirname, "..");
const SQL = readFileSync(path.join(RAIZ, "supabase/migrations/073_checkout_externo_rastreamento.sql"), "utf8")
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n");

describe("migration 073", () => {
  it("segredo e identidade: RLS ligada e ZERO policy; os dois caminhos de privilegio fechados", () => {
    for (const t of ["checkout_externo_destino_segredos", "checkout_externo_identidades"]) {
      expect(SQL).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security;`));
      expect(SQL).not.toMatch(new RegExp(`create policy[^;]*on public\\.${t}\\b`));
    }
    expect(SQL).toMatch(
      /revoke all on table\s+public\.checkout_externo_destinos, public\.checkout_externo_destino_segredos,\s+public\.checkout_externo_envios, public\.checkout_externo_identidades\s+from public, anon, authenticated;/
    );
  });

  it("o lojista le a fila sem o payload nem a resposta; destinos e fila so por select", () => {
    const grant = SQL.match(/grant select \(([^)]*)\)\s+on table public\.checkout_externo_envios to authenticated;/)?.[1] ?? "";
    expect(grant).toMatch(/status/);
    expect(grant).not.toMatch(/payload|response/);
    expect(SQL).toMatch(/create policy "Dono le checkout_externo_destinos" on public\.checkout_externo_destinos\s+for select to authenticated/);
    expect(SQL).toMatch(/create policy "Dono le checkout_externo_envios" on public\.checkout_externo_envios\s+for select to authenticated/);
    expect(SQL).not.toMatch(/grant (insert|update|delete)[^;]*to authenticated/);
  });

  it("a fila: unique (destino, event_id), sem e-mail no payload, FK composta ate o checkout", () => {
    expect(SQL).toMatch(/constraint checkout_externo_envios_unico unique \(destino_id, event_id\)/);
    expect(SQL).toMatch(/check \(payload::text !~ '@'\)/);
    expect(SQL).toMatch(/foreign key \(destino_id, checkout_id, user_id\)\s+references public\.checkout_externo_destinos \(id, checkout_id, user_id\) on delete cascade/);
    expect(SQL).toMatch(/foreign key \(checkout_id, user_id\)\s+references public\.checkouts_externos \(id, user_id\) on delete cascade/);
  });

  it("o purge: SECURITY DEFINER revogado de public/anon/authenticated, conferido com has_function_privilege", () => {
    expect(SQL).toMatch(/function public\.purge_checkout_externo_rastreio\(\)[\s\S]*security definer\s+set search_path = public, pg_temp/);
    expect(SQL).toMatch(/revoke all on function public\.purge_checkout_externo_rastreio\(\) from public, anon, authenticated;/);
    expect(SQL).toMatch(/grant execute on function public\.purge_checkout_externo_rastreio\(\) to service_role;/);
    expect(SQL).toMatch(/has_function_privilege\(papel, 'public\.purge_checkout_externo_rastreio\(\)', 'execute'\)/);
    expect(SQL).toMatch(/raise exception/);
  });

  it("o purge guarda a COMPRA entregue 30 dias (a trava do boleto que compensa depois do dia 8); aos 8 so tira payload e resposta", () => {
    const corpoDoPurge = SQL.match(/function public\.purge_checkout_externo_rastreio\(\)[\s\S]*?\$\$([\s\S]*?)\$\$;/)?.[1] ?? "";
    expect(corpoDoPurge).toMatch(/begin/);
    const deletes = corpoDoPurge.match(/delete from public\.checkout_externo_envios[^;]*;/g) ?? [];
    expect(deletes.length).toBeGreaterThan(0);
    for (const d of deletes) {
      const dias = Number(d.match(/interval '(\d+) days'/)?.[1]);
      expect(Number.isFinite(dias), d).toBe(true);
      // Antes dos 30 dias so sai o funil da pagina, nunca a compra.
      if (dias < 30) expect(d).toMatch(/event_name <> 'Purchase'/);
    }
    expect(deletes.some((d) => /interval '30 days'/.test(d) && !/status|event_name/.test(d))).toBe(true);
    const poda = corpoDoPurge.match(/update public\.checkout_externo_envios[^;]*;/)?.[0] ?? "";
    expect(poda).toMatch(/payload = '\{\}'::jsonb/);
    expect(poda).toMatch(/response = null/);
    expect(poda).toMatch(/interval '8 days'/);
    expect(poda).not.toMatch(/status <> 'enviado'/);
    // O literal do SQL e o nome que a fila grava na compra (compra.ts).
    expect(definicaoDoEvento("purchase").nomeNoMeta).toBe("Purchase");
  });

  it("Fase D: o visitante e o ip_hash da fila (os tetos do coletor) nao saem pela sessao; o ip_hash e o HMAC curto", async () => {
    const grant = SQL.match(/grant select \(([^)]*)\)\s+on table public\.checkout_externo_envios to authenticated;/)?.[1] ?? "";
    expect(grant).not.toMatch(/visitor_id|ip_hash/);
    expect(SQL).toMatch(/has_column_privilege\(papel, 'public\.checkout_externo_envios', 'ip_hash', 'select'\)/);
    expect(SQL).toMatch(/add column if not exists visitor_id text,\s+add column if not exists ip_hash text;/);
    // O CHECK aceita o que hashDoIp grava (32 hex) -- com {64} a identidade nova nunca entraria.
    const { hashDoIp } = await import("@/lib/tracking/ip-balde");
    const h = hashDoIp("203.0.113.7", "segredo") as string;
    for (const tabela of ["checkout_externo_envios", "checkout_externo_identidades"]) {
      const re = SQL.match(new RegExp(`${tabela}_ip_hash_check\\s+check \\(ip_hash is null or ip_hash ~ '([^']+)'\\)`))?.[1];
      expect(re, tabela).toBeTruthy();
      expect(new RegExp(re as string).test(h), tabela).toBe(true);
    }
  });

  it("compra_quando com padrao 'gerada'; nada encosta nas tracking_* das lojas", () => {
    expect(SQL).toMatch(/add column if not exists compra_quando text not null default 'gerada'/);
    expect(SQL).toMatch(/check \(compra_quando in \('gerada', 'aprovada'\)\)/);
    expect(SQL).not.toMatch(/tracking_(events|destinations|identities|configs|checkouts)|purge_tracking/);
  });
});

function arquivos(dir: string): string[] {
  const saida: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) saida.push(...arquivos(p));
    else if (/\.tsx?$/.test(p)) saida.push(p);
  }
  return saida;
}

describe("codigo: o token do pixel do checkout so pelo service role", () => {
  afterEach(() => vi.restoreAllMocks());

  it("toda leitura de checkout_externo_destino_segredos sai de um cliente admin, nunca de tela", () => {
    const usos: string[] = [];
    for (const f of arquivos(path.join(RAIZ, "src"))) {
      const texto = readFileSync(f, "utf8");
      const re = /(\w+)\s*\.from\("checkout_externo_destino_segredos"\)/g;
      for (let m = re.exec(texto); m; m = re.exec(texto)) {
        usos.push(path.relative(RAIZ, f).replace(/\\/g, "/"));
        expect(m[1], `${f}: ${m[0]}`).toBe("admin");
        expect(texto, f).not.toMatch(/^"use client"/);
      }
    }
    expect(usos.length).toBeGreaterThan(0);
  });
});
