import { createHmac, timingSafeEqual } from "node:crypto";
import { limparValor, parametrosDaUrl, utmDeParametros, type Utm } from "@/lib/tracking/utm";
import { GATILHOS_CAKTO, type SituacaoExterna } from "../tipos";
import { ehObjeto, lerData, lerMoeda, lerPais, lerPedidoId, lerValor, texto, type Obj } from "./comum";
import type {
  Autenticacao,
  CompradorNormalizado,
  EventoNormalizado,
  Leitura,
  LeituraVarios,
  PlataformaCheckout,
  RastreioNormalizado,
  VendaNormalizada,
} from "./tipos";

// ============================================================================
// Cakto: webhook do PRODUTOR (venda propria). Doc: docs.cakto.com.br/conceitos/webhooks.
//
// Corpo: { secret, event, data }. `data` e um OBJETO na V1 e uma LISTA na V2
// (principal, order bump, upsell e downsell da mesma cobranca numa entrega
// so). Headers X-Cakto-Timestamp (s) e X-Cakto-Signature: v1=<hex>, o
// HMAC-SHA256 de "{timestamp}.{corpo cru}" com o secret.
//
// - Dinheiro em dois tipos: baseAmount, amount e fees sao numero; discount e
//   charged_fees sao string ("0.00"). Os dois passam pelo lerValor.
// - Faturamento = baseAmount - discount (o charged_fees e do comprador para a
//   Cakto). Liquido = a linha "producer" de commissions: e a receita.
// - Datas ISO com fuso -03:00 e microssegundos; o vencimento do Pix vem com
//   espaco ("2026-09-16 16:46:00.387619+00:00").
// - `data.checkout` e o id da PAGINA de checkout (vai na URL: /<oferta>_<id>),
//   igual em toda venda dela: NAO agrupa a cobranca. O grupo e o parent_order
//   (o refId do principal) ou o proprio refId.
// - Os dois vocabularios de status: o atual (waiting_payment, paid, refused,
//   refunded, chargedback, canceled, refund_requested) e o da doc de 2024
//   (chargeback, processing, authorized, in_protest).
// - checkout_abandonment (nao tem id: repete a cada visita) e subscription_*
//   respondem 200 sem gravar.
// - Teste: o "Testar webhook" da Cakto manda um exemplo fixo com card, pix,
//   boleto e picpay JUNTOS (a entrega real traz so o meio usado) e John Doe
//   com e-mail @example.com; o nosso leva o id fixo e callback=xcart-teste.
//   Nunca vira pedido, e e reconhecido ANTES de validar datas e valores: o
//   exemplo fixo da Cakto e de 2025 e sairia da janela das datas.
//
// A Cakto NAO reenvia resposta nao-2xx (so timeout e erro de rede): a rota
// segura a resposta da falha nossa ate o timeout dela (reenvio: "timeout").
//
// O comprador (nome, e-mail, telefone, endereco) fica SO em memoria
// (EventoNormalizado.comprador). CPF nem e lido.
// ============================================================================

/** O `callback` do nosso "Enviar evento de teste". */
export const CALLBACK_TESTE = "xcart-teste";

/**
 * O data.id do nosso exemplo. O callback sozinho nao basta: ele vem da URL do
 * checkout (?callback=), e qualquer comprador o poe numa venda de verdade.
 */
export const ID_TESTE = "7e57c0de-0000-4000-8000-00000000c470";

/**
 * A janela do X-Cakto-Timestamp. A doc sugere 5 min, mas nao diz se o
 * "Reenviar" assina de novo; a trava (checkout, pedido, evento) ja barra a
 * mesma entrega duas vezes, entao a janela larga so evita recusar reenvio.
 */
export const TOLERANCIA_PASSADO_S = 30 * 24 * 3600;
export const TOLERANCIA_FUTURO_S = 10 * 60;

/** Teto de itens numa entrega V2 (principal + bumps + upsells). */
export const MAX_ITENS = 20;

/** O vencimento do boleto pode estar semanas a frente. */
const DIAS_VENCIMENTO = 90;

const POR_EVENTO: Record<string, SituacaoExterna> = {
  pix_gerado: "pendente",
  boleto_gerado: "pendente",
  picpay_gerado: "pendente",
  openfinance_nubank_gerado: "pendente",
  purchase_approved: "pago",
  // O reembolso pedido nao desfaz a venda: segue paga, "em risco".
  refund_requested: "pago",
  purchase_refused: "expirado",
  refund: "revertido",
  chargeback: "revertido",
};

/** O atual e o da doc de 2024. */
const POR_STATUS: Record<string, SituacaoExterna> = {
  waiting_payment: "pendente",
  processing: "pendente",
  authorized: "pendente",
  pending: "pendente",
  paid: "pago",
  approved: "pago",
  refund_requested: "pago",
  in_protest: "pago",
  refused: "expirado",
  canceled: "expirado",
  cancelled: "expirado",
  expired: "expirado",
  refunded: "revertido",
  chargedback: "revertido",
  chargeback: "revertido",
};

const ORDEM: Record<SituacaoExterna, number> = { pendente: 0, aprovado: 1, pago: 2, expirado: 3, revertido: 4 };

/** Nao vira pedido: 200 e nada gravado. */
const IGNORADOS = /^(checkout_abandonment|initiate_checkout|subscription_[a-z_]+)$/;

/** O bloco do meio de pagamento que traz o vencimento. */
const BLOCOS_COM_VENCIMENTO = ["pix", "boleto", "picpay", "openFinanceNubank"];

const TIPOS_OFERTA = new Set(["main", "orderbump", "upsell", "downsell"]);

function redondo(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Id curto do painel (refId) e grupo: letras, numeros, _ e -. */
function lerRef(v: unknown): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return /^[A-Za-z0-9_-]{1,64}$/.test(s) ? s : null;
}

/** Data opcional: ausente = null; presente e torta = erro (undefined). */
function dataOpcional(v: unknown, agora: Date, diasParaFrente?: number): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  return lerData(v, agora, { espaco: true, diasParaFrente }) ?? undefined;
}

/** O due_date do boleto pode vir so com o dia: vale ate o fim dele, em Brasilia. */
function lerVencimento(v: unknown, agora: Date): string | null {
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim())) {
    return lerData(`${v.trim()}T23:59:59-03:00`, agora, { diasParaFrente: DIAS_VENCIMENTO });
  }
  return dataOpcional(v, agora, DIAS_VENCIMENTO) ?? null;
}

function vencimentoDe(d: Obj, agora: Date): string | null {
  for (const b of BLOCOS_COM_VENCIMENTO) {
    const bloco = d[b];
    if (ehObjeto(bloco)) {
      const v = lerVencimento(bloco.expirationDate ?? bloco.expiration_date ?? bloco.dueDate, agora);
      if (v) return v;
    }
  }
  return lerVencimento(d.due_date, agora);
}

/**
 * O nosso exemplo (id fixo E callback), ou o "Testar webhook" da Cakto: os
 * quatro blocos de meio PREENCHIDOS (a venda real traz so o usado; o resto
 * falta ou vem null), ou John Doe com e-mail de exemplo (RFC 2606). So o
 * e-mail nao basta: um comprador pode digitar um.
 */
function ehTeste(d: Obj): boolean {
  if (d.id === ID_TESTE && d.callback === CALLBACK_TESTE) return true;
  if (["card", "pix", "boleto", "picpay"].every((k) => ehObjeto(d[k]))) return true;
  const c = ehObjeto(d.customer) ? d.customer : {};
  return (
    typeof c.email === "string" &&
    /@example\.(com|org|net)$/i.test(c.email.trim()) &&
    typeof c.name === "string" &&
    /^john doe$/i.test(c.name.trim())
  );
}

/** A entrega de teste: so marca "teste recebido", entao nada nela precisa valer. */
function eventoDeTeste(evento: string, d: Obj, agora: Date): EventoNormalizado {
  const agoraIso = agora.toISOString();
  return {
    evento,
    dataEvento: agoraIso,
    pedidoId: lerPedidoId(d.id) ?? "teste",
    pedido: { status: null, metodo: null, produto: null, pais: null, moeda: "", valor: 0, criadoEm: agoraIso },
    receita: { valor: 0, moeda: null, situacao: POR_EVENTO[evento] ?? "pendente", statusOriginal: null },
    conta: null,
    programa: null,
    teste: true,
  };
}

/** URL sem query nem fragmento: o pre-preenchimento leva nome e e-mail na query. */
function semQuery(v: unknown): string | null {
  if (typeof v !== "string" || !v.trim()) return null;
  try {
    const u = new URL(v.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return null;
  }
}

function lerRastreio(d: Obj): RastreioNormalizado {
  const utm: Utm = {};
  for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
    const v = limparValor(d[`utm_${k}`]);
    if (v) utm[k] = v;
  }
  // Sem nenhuma UTM nos campos: a query com que o comprador abriu o checkout.
  // So as chaves utm_* (o resto da query pode ter dado do comprador).
  const finalUtm = Object.keys(utm).length > 0 ? utm : utmDeParametros(parametrosDaUrl(typeof d.checkoutUrl === "string" ? d.checkoutUrl : null));
  return {
    utm: finalUtm,
    sck: texto(d.sck, 255),
    callback: texto(d.callback, 255),
    fbc: texto(d.fbc, 300),
    fbp: texto(d.fbp, 300),
    checkoutUrl: semQuery(d.checkoutUrl),
  };
}

/** SO EM MEMORIA (ver o cabecalho). */
function lerComprador(d: Obj): CompradorNormalizado {
  const c = ehObjeto(d.customer) ? d.customer : {};
  const a = ehObjeto(d.address) ? d.address : {};
  const email = texto(c.email, 200);
  return {
    nome: texto(c.name, 120),
    email: email ? email.toLowerCase() : null,
    telefone: texto(c.phone, 30),
    pais: lerPais(a.country),
    estado: texto(a.state, 60),
    cidade: texto(a.city, 80),
    cep: texto(a.zipcode, 20),
  };
}

type Item = { ok: true; evento: EventoNormalizado } | { ok: false; erro: string };

function lerItem(evento: string, d: unknown, agora: Date): Item {
  if (!ehObjeto(d)) return { ok: false, erro: "data nao e um objeto" };
  const pedidoId = lerPedidoId(d.id);
  if (!pedidoId) return { ok: false, erro: "data.id invalido" };

  const statusOriginal = typeof d.status === "string" ? d.status.trim().toLowerCase().slice(0, 40) || null : null;
  // Vale a etapa mais avancada entre o evento e o status (como na Sphere): o
  // payload e montado na hora do envio, e um pix_gerado atrasado ja pode
  // chegar com status "paid".
  const peloEvento = POR_EVENTO[evento];
  const peloStatus = statusOriginal ? POR_STATUS[statusOriginal] : undefined;
  const situacao =
    peloEvento && peloStatus
      ? ORDEM[peloStatus] > ORDEM[peloEvento]
        ? peloStatus
        : peloEvento
      : peloEvento || peloStatus;
  if (!situacao) return { ok: false, erro: `evento desconhecido: ${evento}` };

  // Datas. Presente e torta (ou fora da janela) recusa: e o dia do lucro.
  const criado = dataOpcional(d.createdAt, agora);
  const pago = dataOpcional(d.paidAt, agora);
  const reembolsado = dataOpcional(d.refundedAt, agora);
  const chargeback = dataOpcional(d.chargedbackAt, agora);
  const cancelado = dataOpcional(d.canceledAt, agora);
  if (criado === undefined) return { ok: false, erro: "createdAt invalido ou fora da janela" };
  if (pago === undefined) return { ok: false, erro: "paidAt invalido ou fora da janela" };
  if (reembolsado === undefined) return { ok: false, erro: "refundedAt invalido ou fora da janela" };
  if (chargeback === undefined) return { ok: false, erro: "chargedbackAt invalido ou fora da janela" };
  if (cancelado === undefined) return { ok: false, erro: "canceledAt invalido ou fora da janela" };
  const pedidoReembolso = ehObjeto(d.refundRequest) ? dataOpcional(d.refundRequest.requestedAt, agora) : null;

  const agoraIso = agora.toISOString();
  const ehChargeback = evento === "chargeback" || statusOriginal === "chargedback" || statusOriginal === "chargeback";
  // A data do evento e a da etapa que ele prova. O reembolso PEDIDO usa a do
  // pagamento: ele nunca e mais novo que um reembolso ou chargeback de
  // verdade, entao nunca desfaz um deles (estado.ts compara por data). A
  // recusa quase nunca traz canceledAt: vale a criacao, nunca a chegada --
  // a recusa reenviada depois de um pagamento do mesmo pedido seria mais nova
  // que ele e o desfaria. Assim ela so vence o pendente (mesmo instante, e na
  // ordem expirado fica acima).
  const dataEvento =
    situacao === "pendente"
      ? criado ?? agoraIso
      : situacao === "pago"
        ? pago ?? (evento === "refund_requested" ? criado : null) ?? agoraIso
        : situacao === "expirado"
          ? cancelado ?? criado ?? agoraIso
          : (ehChargeback ? chargeback : reembolsado) ?? reembolsado ?? chargeback ?? agoraIso;

  // Dinheiro.
  const base = lerValor(d.baseAmount);
  const desconto = lerValor(d.discount);
  const cobrado = lerValor(d.amount);
  const taxaComprador = lerValor(d.charged_fees);
  if (base === null) return { ok: false, erro: "baseAmount invalido" };
  if (desconto === null) return { ok: false, erro: "discount invalido" };
  if (cobrado === null) return { ok: false, erro: "amount invalido" };
  if (taxaComprador === null) return { ok: false, erro: "charged_fees invalido" };
  const temBase = d.baseAmount !== undefined && d.baseAmount !== null && d.baseAmount !== "";
  const faturamento = redondo(Math.max(0, temBase ? base - desconto : cobrado - taxaComprador));
  const taxa = d.fees === undefined || d.fees === null ? null : lerValor(d.fees);
  if (taxa === null && d.fees !== undefined && d.fees !== null) return { ok: false, erro: "fees invalido" };

  let liquido: number | null = null;
  if (Array.isArray(d.commissions)) {
    for (const c of d.commissions) {
      if (!ehObjeto(c) || String(c.type || "").toLowerCase() !== "producer") continue;
      const v = lerValor(c.totalAmount ?? c.commissionValue);
      if (v === null) return { ok: false, erro: "commissions.totalAmount invalido" };
      liquido = redondo((liquido ?? 0) + v);
    }
  }
  if (liquido === null) liquido = redondo(Math.max(0, faturamento - (taxa ?? 0)));
  const resto = redondo(faturamento - (taxa ?? 0) - liquido);

  const moeda = lerMoeda(d.currency) ?? (ehObjeto(d.offer) ? lerMoeda(d.offer.currency) : null);
  const produto = ehObjeto(d.product) ? texto(d.product.name, 200) : null;
  const oferta = ehObjeto(d.offer) ? texto(d.offer.name, 200) : null;
  const a = ehObjeto(d.address) ? d.address : {};
  const tipoOferta = typeof d.offer_type === "string" ? d.offer_type.trim().toLowerCase() : "";
  const referencia = lerRef(d.refId);

  const venda: VendaNormalizada = {
    taxa,
    comissoes: resto > 0.01 ? resto : 0,
    referencia,
    // parent_order e o refId do principal ("" quando nao ha).
    grupo: lerRef(d.parent_order) ?? referencia ?? pedidoId,
    ofertaTipo: TIPOS_OFERTA.has(tipoOferta) ? (tipoOferta as VendaNormalizada["ofertaTipo"]) : null,
    venceEm: vencimentoDe(d, agora),
    reembolsadoEm: reembolsado ?? (situacao === "revertido" && !ehChargeback ? dataEvento : null),
    chargebackEm: chargeback ?? (situacao === "revertido" && ehChargeback ? dataEvento : null),
    reembolsoPedidoEm: evento === "refund_requested" || statusOriginal === "refund_requested" ? pedidoReembolso ?? agoraIso : null,
  };

  const saida: EventoNormalizado = {
    evento,
    dataEvento,
    pedidoId,
    pedido: {
      status: texto(d.status, 40),
      metodo: texto(typeof d.paymentMethod === "string" ? d.paymentMethod.toLowerCase() : d.paymentMethod, 40),
      produto: produto ?? oferta,
      pais: lerPais(a.country),
      moeda: moeda ?? "",
      valor: faturamento,
      criadoEm: criado ?? dataEvento,
    },
    receita: { valor: liquido, moeda, situacao, statusOriginal },
    // O afiliado da Cakto e um e-mail: dado pessoal, nao entra.
    conta: null,
    programa: null,
    // O teste sai antes (lerTodosCakto), sem passar pelas validacoes.
    teste: false,
    venda,
    rastreio: lerRastreio(d),
    comprador: lerComprador(d),
  };
  return { ok: true, evento: saida };
}

export function lerTodosCakto(corpo: unknown, agora: Date): LeituraVarios {
  if (!ehObjeto(corpo)) return { ok: false, erro: "corpo nao e um objeto JSON" };
  const evento = typeof corpo.event === "string" ? corpo.event.trim().toLowerCase() : "";
  if (!evento || evento.length > 40) return { ok: false, erro: "event ausente" };
  // Antes de ler data: o abandono nem tem id.
  if (IGNORADOS.test(evento)) return { ok: true, eventos: [], ignorado: evento };

  const lista = Array.isArray(corpo.data) ? corpo.data : [corpo.data];
  if (lista.length === 0) return { ok: false, erro: "data vazio" };
  if (lista.length > MAX_ITENS) return { ok: false, erro: `data com mais de ${MAX_ITENS} pedidos` };

  // Uma entrega de teste e teste inteira, e sai antes das validacoes: o
  // exemplo fixo da Cakto tem data de 2025, que sai da janela de 400 dias.
  const teste = lista.find((d): d is Obj => ehObjeto(d) && ehTeste(d));
  if (teste) return { ok: true, eventos: [eventoDeTeste(evento, teste, agora)] };

  const eventos: EventoNormalizado[] = [];
  const vistos = new Set<string>();
  for (const item of lista) {
    const r = lerItem(evento, item, agora);
    if (!r.ok) return lista.length > 1 ? { ok: false, erro: `${r.erro} (um dos ${lista.length} pedidos)` } : r;
    if (vistos.has(r.evento.pedidoId)) continue;
    vistos.add(r.evento.pedidoId);
    eventos.push(r.evento);
  }

  // V2: a entrega E a cobranca. O grupo de todos e o do principal.
  const principal = eventos.find((e) => e.venda?.ofertaTipo === "main");
  if (principal && eventos.length > 1) {
    const grupo = principal.venda!.grupo;
    for (const e of eventos) e.venda!.grupo = grupo;
  }
  return { ok: true, eventos };
}

/** O primeiro pedido da entrega (o contrato de um so). Use lerTodosCakto. */
export function lerCakto(corpo: unknown, agora: Date): Leitura {
  const r = lerTodosCakto(corpo, agora);
  if (!r.ok) return r;
  if (r.eventos.length === 0) return { ok: false, erro: `evento ignorado: ${r.ignorado ?? "vazio"}` };
  return { ok: true, evento: r.eventos[0] };
}

// ---------------------------------------------------------------------------
// Autenticacao
// ---------------------------------------------------------------------------

function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a, "utf8");
  const y = Buffer.from(b, "utf8");
  return x.length === y.length && timingSafeEqual(x, y);
}

function hmac(segredo: string, timestamp: string, raw: string | Uint8Array): string {
  return createHmac("sha256", segredo).update(`${timestamp}.`).update(raw).digest("hex");
}

/**
 * A origem da entrega. Com X-Cakto-Signature: o HMAC tem que bater (e o
 * timestamp estar na janela), e o `secret` do corpo, se veio, tambem. Sem a
 * assinatura (entrega de antes de 04/09/2026): vale o `secret` do corpo.
 * Tudo em tempo constante.
 */
export function autenticarCakto(raw: string | Uint8Array, headers: Headers, segredo: string | null, agora: Date): Autenticacao {
  if (!segredo) return { ok: false, semSegredo: true, erro: "secret da Cakto nao cadastrado" };
  let secretDoCorpo: unknown;
  try {
    const j: unknown = JSON.parse(typeof raw === "string" ? raw : Buffer.from(raw).toString("utf8"));
    secretDoCorpo = ehObjeto(j) ? j.secret : undefined;
  } catch {
    secretDoCorpo = undefined;
  }
  const assinatura = headers.get("x-cakto-signature");
  if (assinatura) {
    const ts = (headers.get("x-cakto-timestamp") || "").trim();
    if (!/^\d{9,11}$/.test(ts)) return { ok: false, erro: "X-Cakto-Timestamp ausente ou invalido" };
    const diferenca = agora.getTime() / 1000 - Number(ts);
    if (diferenca > TOLERANCIA_PASSADO_S || diferenca < -TOLERANCIA_FUTURO_S) {
      return { ok: false, erro: "X-Cakto-Timestamp fora da janela" };
    }
    const esperado = hmac(segredo, ts, raw);
    // "v1=<hex>"; numa troca de versao vem "v1=...,v2=...": so a v1 conta.
    const recebidas = assinatura
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.startsWith("v1="))
      .map((s) => s.slice(3).trim().toLowerCase());
    if (!recebidas.some((v) => iguais(v, esperado))) return { ok: false, erro: "assinatura nao confere" };
    if (secretDoCorpo !== undefined && secretDoCorpo !== null && !iguais(String(secretDoCorpo), segredo)) {
      return { ok: false, erro: "secret do corpo nao confere" };
    }
    return { ok: true };
  }
  if (typeof secretDoCorpo !== "string" || !iguais(secretDoCorpo, segredo)) {
    return { ok: false, erro: "secret do corpo nao confere" };
  }
  return { ok: true };
}

/** Os headers que a Cakto mandaria: o "Enviar evento de teste" passa pelo autenticar. */
export function assinarCakto(raw: string, segredo: string, agora: Date): Record<string, string> {
  const ts = String(Math.floor(agora.getTime() / 1000));
  return { "X-Cakto-Timestamp": ts, "X-Cakto-Signature": `v1=${hmac(segredo, ts, raw)}` };
}

/** O corpo do "Enviar evento de teste": uma compra aprovada com o callback de teste. */
export function exemploCakto(agora: Date, segredo?: string | null): unknown {
  const iso = agora.toISOString();
  return {
    secret: segredo ?? "",
    event: "purchase_approved",
    data: {
      id: ID_TESTE,
      refId: "XCTESTE",
      status: "paid",
      offer_type: "main",
      checkout: null,
      parent_order: "",
      affiliate: "",
      callback: CALLBACK_TESTE,
      checkoutUrl: `https://pay.cakto.com.br/xcart-teste?callback=${CALLBACK_TESTE}`,
      baseAmount: 97,
      amount: 97,
      currency: "BRL",
      fees: 6.78,
      discount: "0.00",
      charged_fees: "0.00",
      installments: 1,
      paymentMethod: "pix",
      paymentMethodName: "Pix",
      customer: { name: "Teste do xcart", email: "teste@example.com", phone: null },
      product: { id: "xcart-teste", short_id: "xcart", name: "Venda de teste do xcart", type: "unique" },
      offer: { id: "xcart-teste", name: "Teste", price: 97, currency: "BRL" },
      commissions: [{ user: "produtor@example.com", type: "producer", percentage: 100, totalAmount: 90.22 }],
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      createdAt: iso,
      paidAt: iso,
    },
  };
}

export const cakto: PlataformaCheckout = {
  id: "cakto",
  nome: "Cakto",
  modelo: "venda",
  autenticacao: "hmac_header",
  reenvio: "timeout",
  gatilhos: GATILHOS_CAKTO,
  eventoDeVenda: "purchase_approved",
  ler: lerCakto,
  lerTodos: lerTodosCakto,
  autenticar: autenticarCakto,
  assinar: assinarCakto,
  exemplo: exemploCakto,
};
