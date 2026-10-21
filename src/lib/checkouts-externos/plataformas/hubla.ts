import { timingSafeEqual } from "node:crypto";
import { limparValor, parametrosDaUrl, utmDeParametros, type Utm } from "@/lib/tracking/utm";
import { GATILHOS_HUBLA, type SituacaoExterna } from "../tipos";
import { separarUtmify } from "./cakto";
import { VALOR_MAXIMO, ehObjeto, lerData, lerMoeda, lerPais, lerPedidoId, texto, vidDoParametro, type Obj } from "./comum";
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
// Hubla: webhook do PRODUTOR (venda propria). Doc: hubla.gitbook.io/docs/webhooks.
//
// Corpo: { type, version: "2.0.0", event: { product, products, hasOrderBump,
// invoice, subscriptions, user } }. Headers: x-hubla-token (o token FIXO da
// aba Autenticacao do webhook -- nao e HMAC, nao assina o corpo),
// x-hubla-sandbox ("TRUE" no "Testar configuracao"), x-hubla-idempotency (o
// AVISO, nao a venda) e x-hubla-delivery-mode (standard | compatibility).
//
// - Uma fatura por aviso no modo "Integracao recomendada" (standard): order
//   bump vem dentro, com o total da venda. O "Modo de compatibilidade" manda
//   2 x N avisos numa venda de N produtos: N com a fatura REAL (o total da
//   venda inteira, iguais menos o produto) e N com uma fatura FABRICADA por
//   item (id "<fatura>-offer-<n>", parentInvoiceId preenchido, centavos
//   rateados e quebrados). Os fabricados (pelo sufixo: a fatura real tambem
//   pode ter parentInvoiceId) respondem 200 sem gravar; os reais caem na
//   trava (checkout, pedido, evento) a partir do segundo.
// - Dinheiro em CENTAVOS (amount.totalCents; o campo em reais veio em
//   23/09/2026 e e so a divisao). Faturamento = total - juros do parcelamento
//   (installmentFee: o comprador paga a Hubla, como o charged_fees da Cakto).
//   Liquido = receivers role "seller"; a taxa e o resto depois das comissoes
//   (qualquer outro papel que nao seja "platform").
// - Venda internacional: cobrada numa moeda (invoice.currency), liquidada em
//   outra (receivers[].currency, amount.settlement). Tudo vai na moeda de
//   LIQUIDACAO, que e onde a soma dos receivers fecha: faturamento, taxa e
//   liquido somam no mesmo dinheiro.
// - invoice.status_updated sai em TODA transicao junto com o evento proprio
//   (pagar manda os dois). So vale para o que nao tem evento proprio:
//   chargeback, disputed e canceled, com o status no nome do evento (a trava
//   e por evento: "invoice.status_updated" sozinho barraria a 2a transicao).
//   O reembolso PARCIAL so sai por ele, com status "refunded" -- fica de fora:
//   a doc nao diz quanto voltou, e marcar a venda inteira como reembolsada
//   seria pior.
// - disputed = a disputa aberta: a venda segue paga, SEM o "em risco". A
//   Hubla resolve a disputa a favor do vendedor so pelo status_updated "paid"
//   (o payment_succeeded nao sai de novo), e o reembolso_pedido_em nunca sai
//   (estado.ts: a primeira data de etapa fica) -- a venda ficaria em disputa
//   para sempre. Perdeu a disputa, vem o chargeback.
// - Renovacao, upgrade (invoice.type) e a parcela 2+ do Parcelamento
//   Inteligente entram no lucro, mas NAO vao ao Meta/TikTok (`recorrencia`):
//   nao tem clique de anuncio. Upsell nativo e fatura propria (compra propria).
// - Lead, assinatura, membro, solicitacao de reembolso: 200 sem gravar. O
//   invoice.created de cartao tambem (o pedido nasce no pagamento: a recusa
//   no checkout nao tem evento).
// - ATENCAO, a confirmar na 1a venda real: no exemplo da doc, o
//   payment_succeeded traz so firstPaymentSession { ip, utm } -- sem cookies
//   (fbp, fbclid, ttclid, ttp), params (o vid da ponte) e user agent, que so o
//   invoice.created mostra. Se for assim, o Purchase do cartao sai so com o
//   IP e as UTMs; o conserto e guardar a sessao do created (tabela sem policy)
//   e completar a compra com ela.
// - Teste: x-hubla-sandbox TRUE, o id fixo do nosso exemplo, ou John Doe com
//   e-mail @example.com (o payload ficticio da Hubla). Sai ANTES das
//   validacoes: o ficticio pode ter data de 2024.
//
// A Hubla REENVIA resposta nao-2xx (5 tentativas em ~75 s): 503 na hora.
//
// O comprador (nome, e-mail, telefone, endereco) fica SO em memoria. CPF
// (document) nem e lido. IP e user agent da sessao de pagamento vao para a
// compra pelo servidor (compra.ts), como os da identidade da ponte.
// ============================================================================

/** O invoice.id do nosso "Enviar evento de teste". */
export const ID_TESTE = "7e57c0de-0000-4000-8000-0000000b1a00";

/** Os eventos de fatura que viram pedido; o resto da Hubla responde 200 sem gravar. */
const POR_EVENTO: Record<string, SituacaoExterna> = {
  "invoice.created": "pendente",
  "invoice.payment_succeeded": "pago",
  "invoice.payment_failed": "expirado",
  "invoice.expired": "expirado",
  "invoice.refunded": "revertido",
};

/** O status que cada evento proprio prova: a data da etapa sai dele em statusAt[]. */
const STATUS_DO_EVENTO: Record<string, string> = {
  "invoice.created": "unpaid",
  "invoice.payment_succeeded": "paid",
  "invoice.payment_failed": "overdue",
  "invoice.expired": "overdue",
  "invoice.refunded": "refunded",
};

const STATUS_UPDATED = "invoice.status_updated";

/** Os status que so o invoice.status_updated traz (os outros ja tem evento proprio). */
const SO_PELO_STATUS = new Set(["chargeback", "disputed", "canceled"]);

const POR_STATUS: Record<string, SituacaoExterna> = {
  unpaid: "pendente",
  paid: "pago",
  disputed: "pago",
  overdue: "expirado",
  canceled: "expirado",
  refunded: "revertido",
  chargeback: "revertido",
};

const ORDEM: Record<SituacaoExterna, number> = { pendente: 0, aprovado: 1, pago: 2, expirado: 3, revertido: 4 };

/** Cobranca que se paga depois (a "gerada" da compra pelo servidor). */
const METODOS_COM_COBRANCA = new Set(["pix", "boleto"]);

/** invoice.type que nao e a primeira compra. */
const TIPOS_RECORRENTES = new Set(["renewal", "upgrade"]);

/** O vencimento do boleto pode estar semanas a frente. */
const DIAS_VENCIMENTO = 90;

function redondo(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Centavos (numero; o modo de compatibilidade manda quebrado, 3618.9999999999995)
 * -> reais. Ausente -> 0. Lixo, negativo ou acima do teto -> null (recusa).
 */
function lerCentavos(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,11}(\.\d{1,10})?$/.test(v.trim()) ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0 || n / 100 > VALOR_MAXIMO) return null;
  return redondo(n / 100);
}

/** "bank_slip" -> "boleto": o nome que venda.ts conhece (vencimento padrao, folga, rotulo). */
function lerMetodo(v: unknown): string | null {
  const m = texto(v, 40)?.toLowerCase() ?? null;
  return m === "bank_slip" ? "boleto" : m;
}

/** Chave de objeto sem caixa ("SCK" no exemplo da doc, "sck" na URL). */
function campo(o: Obj, nome: string): unknown {
  const k = Object.keys(o).find((x) => x.toLowerCase() === nome);
  return k === undefined ? undefined : o[k];
}

/** A data da transicao para `status` (a ultima, se repetiu) em statusAt[]. */
function quandoDoStatus(inv: Obj, status: string | null, agora: Date): string | null {
  if (!status || !Array.isArray(inv.statusAt)) return null;
  let melhor: string | null = null;
  for (const s of inv.statusAt) {
    if (!ehObjeto(s) || String(s.status || "").toLowerCase() !== status) continue;
    const d = lerData(s.when, agora);
    if (d && (!melhor || Date.parse(d) > Date.parse(melhor))) melhor = d;
  }
  return melhor;
}

/** Data opcional: ausente = null; presente e torta = erro (undefined). */
function dataOpcional(v: unknown, agora: Date): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  return lerData(v, agora) ?? undefined;
}

/** O nosso exemplo, o sandbox da Hubla, ou o comprador ficticio (John Doe @example). */
function ehTeste(inv: Obj, ev: Obj, headers: Headers | undefined): boolean {
  if (String(headers?.get("x-hubla-sandbox") || "").trim().toLowerCase() === "true") return true;
  if (inv.id === ID_TESTE) return true;
  const p = ehObjeto(inv.payer) ? inv.payer : ehObjeto(ev.user) ? ev.user : {};
  return (
    typeof p.email === "string" &&
    /@example\.(com|org|net)$/i.test(p.email.trim()) &&
    typeof p.firstName === "string" &&
    /^john$/i.test(p.firstName.trim()) &&
    typeof p.lastName === "string" &&
    /^doe$/i.test(p.lastName.trim())
  );
}

/** A entrega de teste: so marca "teste recebido", entao nada nela precisa valer. */
function eventoDeTeste(evento: string, inv: Obj, agora: Date): EventoNormalizado {
  const agoraIso = agora.toISOString();
  return {
    // O status do sandbox vem no nome: o CHECK de ultimo_evento e de 40.
    evento: evento.slice(0, 40),
    dataEvento: agoraIso,
    pedidoId: lerPedidoId(inv.id) ?? "teste",
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

/** Click id inteiro e so com o charset deles. Grande demais sai, nunca cortado. */
function cliqueValido(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= max && /^[A-Za-z0-9_.-]+$/.test(s) ? s : null;
}

/** IPv4 ou IPv6 (so o formato: quem usa e o Meta e o TikTok). */
function lerIp(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  if (!s || s.length > 45) return null;
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(s) || (/^[0-9A-Fa-f:.]+$/.test(s) && s.includes(":")) ? s : null;
}

function lerRastreio(inv: Obj): RastreioNormalizado {
  // A sessao do pagamento; a da primeira compra so quando ela falta (renovacao).
  const s = ehObjeto(inv.paymentSession) ? inv.paymentSession : ehObjeto(inv.firstPaymentSession) ? inv.firstPaymentSession : {};
  const cookies = ehObjeto(s.cookies) ? s.cookies : {};
  const params = ehObjeto(s.params) ? s.params : {};
  const query = parametrosDaUrl(typeof s.url === "string" ? s.url : null);

  const utm: Utm = {};
  const u = ehObjeto(s.utm) ? s.utm : {};
  for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
    const v = limparValor(u[k]);
    if (v) utm[k] = v;
  }
  // Sem nenhuma UTM no bloco: a query com que o comprador abriu o checkout
  // (so as chaves utm_*: o resto da query pode ter dado do comprador).
  const { utm: finalUtm, clique: daUtmify } = separarUtmify(Object.keys(utm).length > 0 ? utm : utmDeParametros(query));
  const callback = texto(campo(params, "callback"), 255) ?? texto(query.get("callback"), 255);
  const sck = texto(campo(params, "sck"), 255) ?? texto(query.get("sck"), 255);
  return {
    utm: finalUtm,
    sck,
    callback,
    fbc: texto(cookies.fbc, 300),
    fbp: texto(cookies.fbp, 300),
    fbclid: cliqueValido(cookies.fbclid, 600) ?? cliqueValido(query.get("fbclid"), 600) ?? daUtmify.fbclid,
    ttclid: cliqueValido(cookies.ttclid, 1000) ?? cliqueValido(query.get("ttclid"), 1000) ?? daUtmify.ttclid,
    checkoutUrl: semQuery(s.url),
    // O vid da ponte que ficou na URL: so ele sai da query.
    vidNaUrl: vidDoParametro(query.get("callback")) ?? vidDoParametro(query.get("sck")),
    ip: lerIp(s.ip),
    userAgent: texto(s.userAgent, 500),
    ttp: cliqueValido(cookies.ttp, 200),
  };
}

/** SO EM MEMORIA (ver o cabecalho). */
function lerComprador(inv: Obj, ev: Obj): CompradorNormalizado {
  const p = ehObjeto(inv.payer) ? inv.payer : ehObjeto(ev.user) ? ev.user : {};
  const a = ehObjeto(inv.billingAddress) ? inv.billingAddress : {};
  const email = texto(p.email, 200);
  const nome = [texto(p.firstName, 60), texto(p.lastName, 60)].filter(Boolean).join(" ");
  return {
    nome: nome || null,
    email: email ? email.toLowerCase() : null,
    telefone: texto(p.phone, 30),
    pais: lerPais(a.countryCode),
    estado: texto(a.state, 60),
    cidade: texto(a.city, 80),
    cep: texto(a.postalCode, 20),
  };
}

/**
 * O dinheiro da fatura, ja na moeda de liquidacao. Erro = o campo que veio
 * torto (a venda e recusada: o valor vai para o lucro).
 */
function lerDinheiro(inv: Obj): { ok: true; faturamento: number; taxa: number | null; comissoes: number; liquido: number; moeda: string | null } | { ok: false; erro: string } {
  const a = ehObjeto(inv.amount) ? inv.amount : null;
  if (!a) return { ok: false, erro: "invoice.amount ausente" };
  const total = lerCentavos(a.totalCents);
  const juros = lerCentavos(a.installmentFeeCents);
  if (total === null) return { ok: false, erro: "amount.totalCents invalido" };
  if (juros === null) return { ok: false, erro: "amount.installmentFeeCents invalido" };
  // Venda internacional: o total na moeda de liquidacao. Os juros vem na de
  // cobranca, entao saem pela mesma proporcao.
  const st = ehObjeto(a.settlement) ? a.settlement : null;
  let bruto = total;
  let moeda = lerMoeda(inv.currency);
  if (st) {
    const totalSt = lerCentavos(st.totalCents);
    const moedaSt = lerMoeda(st.currency);
    if (totalSt === null || !moedaSt) return { ok: false, erro: "amount.settlement invalido" };
    bruto = totalSt;
    moeda = moedaSt;
  }
  const fator = total > 0 ? bruto / total : 1;
  const faturamento = redondo(Math.max(0, bruto - juros * fator));

  let liquido: number | null = null;
  let comissoes = 0;
  if (Array.isArray(inv.receivers)) {
    for (const r of inv.receivers) {
      if (!ehObjeto(r)) continue;
      const v = lerCentavos(r.totalCents);
      if (v === null) return { ok: false, erro: "receivers.totalCents invalido" };
      const moedaR = lerMoeda(r.currency);
      if (moedaR && moeda && moedaR !== moeda) return { ok: false, erro: `receivers em ${moedaR}, venda em ${moeda}` };
      const papel = String(r.role || "").toLowerCase();
      if (papel === "seller") liquido = redondo((liquido ?? 0) + v);
      else if (papel !== "platform") comissoes = redondo(comissoes + v);
    }
  }
  // Sem a linha do vendedor (nao devia acontecer): a doc nao da a taxa, so o total.
  if (liquido === null) return { ok: true, faturamento, taxa: null, comissoes, liquido: redondo(Math.max(0, faturamento - comissoes)), moeda };
  const taxa = redondo(Math.max(0, faturamento - liquido - comissoes));
  return { ok: true, faturamento, taxa, comissoes, liquido, moeda };
}

/** O nome do evento para a trava: o status_updated leva o status (a trava e por evento). */
function nomeDoEvento(tipo: string, status: string | null): string {
  return tipo === STATUS_UPDATED ? `${STATUS_UPDATED}:${status}` : tipo;
}

/** Um aviso = uma fatura, ou nada (`ignorado`). */
export function lerTodosHubla(corpo: unknown, agora: Date, headers?: Headers): LeituraVarios {
  if (!ehObjeto(corpo)) return { ok: false, erro: "corpo nao e um objeto JSON" };
  const tipo = typeof corpo.type === "string" ? corpo.type.trim().toLowerCase() : "";
  if (!tipo || tipo.length > 60) return { ok: false, erro: "type ausente" };
  // Lead, assinatura, membro, solicitacao de reembolso, evento novo da Hubla:
  // 200 sem gravar (um 4xx seria reenviado 5 vezes, e erro por dias seguidos
  // faz a Hubla desligar a regra).
  if (tipo !== STATUS_UPDATED && !POR_EVENTO[tipo]) return { ok: true, eventos: [], ignorado: tipo };

  const ev = ehObjeto(corpo.event) ? corpo.event : null;
  const inv = ev && ehObjeto(ev.invoice) ? ev.invoice : null;
  if (!ev || !inv) return { ok: false, erro: "event.invoice ausente" };

  const status = typeof inv.status === "string" ? inv.status.trim().toLowerCase().slice(0, 40) || null : null;
  const evento = nomeDoEvento(tipo, status);

  // Antes de tudo: o payload ficticio pode ter data de 2024, e o sandbox
  // tambem manda o status_updated.
  if (ehTeste(inv, ev, headers)) return { ok: true, eventos: [eventoDeTeste(evento, inv, agora)] };

  if (tipo === STATUS_UPDATED && (!status || !SO_PELO_STATUS.has(status))) {
    return { ok: true, eventos: [], ignorado: `${tipo}:${status ?? "?"}` };
  }

  // Modo de compatibilidade: a fatura fabricada por item nao existe na Hubla,
  // e a doc garante o sufixo "-offer-N" nela. O parentInvoiceId NAO serve: a
  // fatura real tambem o traz (o invoice.expired da doc, a recuperacao do
  // Parcelamento Inteligente), e descartar uma real sumiria com a venda.
  if (typeof inv.id === "string" && /-offer-\d+$/.test(inv.id)) {
    return { ok: true, eventos: [], ignorado: "aviso de produto (modo de compatibilidade)" };
  }

  const pedidoId = lerPedidoId(inv.id);
  if (!pedidoId) return { ok: false, erro: "invoice.id invalido" };

  // Vale a etapa mais avancada entre o evento e o status: o payload e montado
  // na hora do envio, e o invoice.created atrasado ja pode chegar pago.
  const peloEvento = tipo === STATUS_UPDATED ? undefined : POR_EVENTO[tipo];
  const peloStatus = status ? POR_STATUS[status] : undefined;
  const statusVence = Boolean(peloStatus && (!peloEvento || ORDEM[peloStatus] > ORDEM[peloEvento]));
  const situacao = statusVence ? peloStatus : peloEvento;
  if (!situacao) return { ok: false, erro: `status desconhecido: ${status ?? "?"}` };
  // A etapa que este aviso prova: a do status quando ele vence, senao a do evento.
  const etapa = statusVence ? status : STATUS_DO_EVENTO[tipo];

  // Datas. Presente e torta (ou fora da janela) recusa: e o dia do lucro.
  const criadaEm = dataOpcional(inv.createdAt, agora);
  if (criadaEm === undefined) return { ok: false, erro: "createdAt invalido ou fora da janela" };
  // O saleDate so vale sem o createdAt (a doc nao diz se a renovacao leva a data da venda original).
  const vendidaEm = criadaEm ? null : dataOpcional(inv.saleDate, agora);
  if (vendidaEm === undefined) return { ok: false, erro: "saleDate invalido ou fora da janela" };
  const criado = criadaEm ?? vendidaEm;
  const modificado = dataOpcional(inv.modifiedAt, agora);
  if (modificado === undefined) return { ok: false, erro: "modifiedAt invalido ou fora da janela" };
  const agoraIso = agora.toISOString();
  // A data do evento e a da transicao em statusAt[]. Pendente fica na criacao
  // (nunca depois de um pagamento do mesmo pedido).
  const quando = situacao === "pendente" ? criado : quandoDoStatus(inv, etapa, agora);
  const dataEvento = quando ?? modificado ?? criado ?? agoraIso;

  const dinheiro = lerDinheiro(inv);
  if (!dinheiro.ok) return dinheiro;

  const metodo = lerMetodo(inv.paymentMethod);
  // O cartao ainda aberto nao vira pedido: a Hubla cria a fatura antes de
  // cobrar, e a recusa no checkout nao tem evento -- o pendente ficaria 48 h
  // em A receber e iria a "Vencida", e avisaria "Cobranca gerada" no celular
  // em toda venda no cartao. O pedido nasce no payment_succeeded.
  if (tipo === "invoice.created" && situacao === "pendente" && metodo && !METODOS_COM_COBRANCA.has(metodo)) {
    return { ok: true, eventos: [], ignorado: `invoice.created:${metodo}` };
  }
  const ehChargeback = status === "chargeback";
  const tipoFatura = texto(inv.type, 40)?.toLowerCase() ?? null;
  const parcela = ehObjeto(inv.smartInstallment) ? Number(inv.smartInstallment.installment) : NaN;
  const produto = ehObjeto(ev.product) ? ev.product : {};
  const produtoId = lerPedidoId(produto.id);

  // O vencimento so quando cai depois da criacao: o Pix do exemplo da doc tem
  // dueDate ANTES da criacao, e vencido na hora sumiria do "a receber".
  const vence = lerData(inv.dueDate, agora, { diasParaFrente: DIAS_VENCIMENTO });
  const venceEm =
    situacao === "pendente" && vence && criado && Date.parse(vence) > Date.parse(criado) && metodo && METODOS_COM_COBRANCA.has(metodo)
      ? vence
      : null;

  const venda: VendaNormalizada = {
    taxa: dinheiro.taxa,
    comissoes: dinheiro.comissoes,
    referencia: null,
    // Uma fatura por aviso: a fatura E a cobranca (o order bump vem dentro).
    grupo: pedidoId,
    produtoId,
    ofertaTipo: "main",
    venceEm,
    reembolsadoEm: situacao === "revertido" && !ehChargeback ? dataEvento : null,
    chargebackEm: situacao === "revertido" && ehChargeback ? dataEvento : null,
    // A disputa aberta segue paga, sem "em risco" (ver o cabecalho).
    reembolsoPedidoEm: null,
    cobrancaGerada: tipo === "invoice.created" && Boolean(metodo && METODOS_COM_COBRANCA.has(metodo)),
    recorrencia: (tipoFatura !== null && TIPOS_RECORRENTES.has(tipoFatura)) || (Number.isFinite(parcela) && parcela > 1),
  };

  const a = ehObjeto(inv.billingAddress) ? inv.billingAddress : {};
  const saida: EventoNormalizado = {
    evento,
    dataEvento,
    pedidoId,
    pedido: {
      status: texto(inv.status, 40),
      metodo,
      produto: texto(produto.name, 200),
      pais: lerPais(a.countryCode),
      moeda: dinheiro.moeda ?? "",
      valor: dinheiro.faturamento,
      criadoEm: criado ?? dataEvento,
    },
    receita: { valor: dinheiro.liquido, moeda: dinheiro.moeda, situacao, statusOriginal: status },
    conta: null,
    programa: null,
    teste: false,
    venda,
    rastreio: lerRastreio(inv),
    comprador: lerComprador(inv, ev),
  };
  return { ok: true, eventos: [saida] };
}

/** A fatura da entrega (o contrato de um so). Use lerTodosHubla: ele diz o que foi ignorado. */
export function lerHubla(corpo: unknown, agora: Date, headers?: Headers): Leitura {
  const r = lerTodosHubla(corpo, agora, headers);
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

/** O x-hubla-token tem que ser o token colado no xcart. Tempo constante. */
export function autenticarHubla(_raw: string | Uint8Array, headers: Headers, segredo: string | null): Autenticacao {
  if (!segredo) return { ok: false, semSegredo: true, erro: "token da Hubla nao cadastrado" };
  const recebido = (headers.get("x-hubla-token") || "").trim();
  if (!recebido) return { ok: false, erro: "x-hubla-token ausente" };
  if (!iguais(recebido, segredo.trim())) return { ok: false, erro: "x-hubla-token nao confere" };
  return { ok: true };
}

/** Os headers que a Hubla mandaria no "Testar configuracao". */
export function assinarHubla(_raw: string, segredo: string): Record<string, string> {
  return { "x-hubla-token": segredo, "x-hubla-sandbox": "TRUE", "x-hubla-delivery-mode": "standard" };
}

/** O corpo do "Enviar evento de teste": um pagamento aprovado com o id fixo. */
export function exemploHubla(agora: Date): unknown {
  const iso = agora.toISOString();
  return {
    type: "invoice.payment_succeeded",
    version: "2.0.0",
    event: {
      product: { id: "xcart-teste", name: "Venda de teste do xcart" },
      products: [
        {
          id: "xcart-teste",
          name: "Venda de teste do xcart",
          offers: [{ id: "xcart-teste", name: "Teste", amountCents: 9700, isOrderBump: false }],
        },
      ],
      hasOrderBump: false,
      invoice: {
        id: ID_TESTE,
        parentInvoiceId: null,
        payer: { firstName: "Teste", lastName: "do xcart", email: "teste@example.com", phone: null },
        installments: 1,
        paymentMethod: "pix",
        currency: "BRL",
        type: "sell",
        status: "paid",
        statusAt: [
          { status: "unpaid", when: iso },
          { status: "paid", when: iso },
        ],
        amount: { subtotalCents: 9700, discountCents: 0, prorataCents: 0, installmentFeeCents: 0, totalCents: 9700 },
        receivers: [
          { id: "platform-identity", role: "platform", paysForFees: false, totalCents: 678, currency: "BRL" },
          { id: "xcart-teste", role: "seller", paysForFees: true, totalCents: 9022, currency: "BRL" },
        ],
        paymentSession: { url: "https://pay.hub.la/xcart-teste", utm: {} },
        saleDate: iso,
        createdAt: iso,
        modifiedAt: iso,
        version: 1,
      },
      subscriptions: [],
    },
  };
}

export const hubla: PlataformaCheckout = {
  id: "hubla",
  nome: "Hubla",
  modelo: "venda",
  autenticacao: "token_no_header",
  reenvio: "status",
  gatilhos: GATILHOS_HUBLA,
  eventoDeVenda: "invoice.payment_succeeded",
  ler: lerHubla,
  lerTodos: lerTodosHubla,
  autenticar: autenticarHubla,
  assinar: assinarHubla,
  exemplo: exemploHubla,
};
