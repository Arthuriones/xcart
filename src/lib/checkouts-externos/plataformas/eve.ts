import { createHmac, timingSafeEqual } from "node:crypto";
import { limparValor, type Utm } from "@/lib/tracking/utm";
import { GATILHOS_EVE, type SituacaoExterna } from "../tipos";
import { TOLERANCIA_FUTURO_S, TOLERANCIA_PASSADO_S, separarUtmify } from "./cakto";
import { VALOR_MAXIMO, ehObjeto, lerData, lerMoeda, lerPais, lerPedidoId, texto, type Obj } from "./comum";
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
// Eve (PixKit): o checkout Pix PROPRIO do Arthur (PHP + MySQL na HostGator,
// checkouteve.shop). Venda propria, como a Cakto e a Hubla. SO a conta dele
// ve e cadastra (src/lib/checkouts-externos/liberadas.ts).
//
// CONTRATO v1 (o mesmo dos dois lados; o Eve monta em PHP):
//   POST com corpo JSON. Headers X-Eve-Event (= corpo.evento), X-Eve-Timestamp
//   (unix em s) e X-Eve-Signature: v1=<hex minusculo do HMAC-SHA256(secret,
//   "{timestamp}.{corpo CRU}")>. O secret o painel do Eve gera (64 hex) e o
//   lojista cola aqui. Janela do timestamp: a da Cakto.
//   Corpo { versao: 1, evento, enviado_em, teste, loja { id, nome }, pedido {
//   id, numero, origem, status, metodo, moeda, *_centavos, criado_em, pago_em,
//   vence_em, cancelado_em, reembolsado_em, atualizado_em, itens[] },
//   comprador { nome, email, telefone, cidade, estado, cep, pais }, rastreio {
//   utm_*, src, sck, fbclid, gclid, ttclid, fbp, fbc, url } }.
//
// - Cada aviso traz o ESTADO INTEIRO do pedido. O STATUS manda na situacao; o
//   nome do evento so serve para a trava (checkout, pedido, evento) -- a
//   retentativa do Eve remonta o corpo, entao um "pix.gerado" atrasado pode
//   chegar ja pago, e vale o pago. O "pix.gerado" trava por cobranca
//   ("pix.gerado:<unix do vence_em>:<centavos>"): o Pix gerado de novo entra.
// - pedido.id = checkouts.token do Eve: estavel do lead ao reembolso. E a
//   cobranca (grupo); o numero (orders.number) e a referencia do painel.
// - Dinheiro em CENTAVOS INTEIROS. valor = receita = total: o Eve nao sabe a
//   taxa do gateway (taxa e comissoes null).
// - Status "started" (lead sem Pix) e origem "shopify" o Eve nem manda; se
//   chegarem, 200 sem gravar: o pedido da loja Shopify ja entra pelo
//   orders/create, e contaria duas vezes.
// - Teste: corpo.teste === true OU pedido.id === "eve-teste" (cada sinal vale
//   sozinho), reconhecido ANTES das validacoes. Nunca vira pedido.
// - Sem IP nem user agent: no lead externo eles sao do SERVIDOR da pagina,
//   nao do comprador. Sem a ponte (Fase D): callback e vid ficam null.
// - historico: true (opcional) = o Eve mandando os pedidos de antes da
//   conexao (bin/console xcart:historico). Grava igual, mas sem aviso no
//   celular e sem compra ao Meta/TikTok (`semAviso`).
//
// O Eve REENVIA qualquer nao-2xx pela fila de jobs dele (30 s, 1, 2, 4 e 8
// min; com o worker no cron): 503 na hora, como a Hubla.
//
// O comprador fica SO em memoria. CPF/documento o Eve nem manda, e aqui nada
// o leria.
// ============================================================================

/** A versao do contrato que o xcart le. Outra = erro claro (o Eve mudou sem o xcart). */
export const VERSAO = 1;

/** O pedido.id do teste (o do Eve e o do nosso "Enviar evento de teste"). */
export const ID_TESTE = "eve-teste";

/** O status do pedido (o estado inteiro): ele manda na situacao. */
const POR_STATUS: Record<string, SituacaoExterna> = {
  pix_generated: "pendente",
  awaiting_payment: "pendente",
  paid: "pago",
  expired: "expirado",
  cancelled: "expirado",
  // O checkout em erro vira "pedido.cancelado" no Eve: o mesmo destino.
  error: "expirado",
  refunded: "revertido",
};

/** O que o Eve nao devia mandar: 200 sem gravar (um 4xx seria reenviado 5 vezes). */
const STATUS_IGNORADOS = new Set(["started"]);

const EVENTOS = new Set<string>(GATILHOS_EVE);

/** O vencimento do Pix fica a horas da criacao; a folga so evita recusar um prazo longo. */
const DIAS_VENCIMENTO = 7;

function redondo(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Centavos INTEIROS (o contrato) -> reais. Ausente -> undefined. Fracao,
 * negativo, lixo ou acima do teto -> null (recusa: o valor vai para o lucro).
 * String so de digitos passa (o PDO pode devolver o inteiro como texto).
 */
function lerCentavos(v: unknown): number | null | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : typeof v === "string" && /^\d{1,11}$/.test(v.trim()) ? Number(v.trim()) : NaN;
  if (!Number.isSafeInteger(n) || n < 0 || n / 100 > VALOR_MAXIMO) return null;
  return redondo(n / 100);
}

/** Data opcional: ausente = null; presente e torta (ou fora da janela) = erro (undefined). */
function dataOpcional(v: unknown, agora: Date, diasParaFrente?: number): string | null | undefined {
  if (v === null || v === undefined || v === "") return null;
  return lerData(v, agora, { diasParaFrente }) ?? undefined;
}

/** A entrega de teste: so marca "teste recebido", entao nada nela precisa valer. */
function eventoDeTeste(evento: string, pedido: Obj, agora: Date): EventoNormalizado {
  const agoraIso = agora.toISOString();
  const status = typeof pedido.status === "string" ? pedido.status.trim().toLowerCase() : "";
  return {
    evento,
    dataEvento: agoraIso,
    pedidoId: lerPedidoId(pedido.id) ?? ID_TESTE,
    pedido: { status: null, metodo: null, produto: null, pais: null, moeda: "", valor: 0, criadoEm: agoraIso },
    receita: { valor: 0, moeda: null, situacao: POR_STATUS[status] ?? "pendente", statusOriginal: null },
    conta: null,
    programa: null,
    teste: true,
  };
}

/** URL sem query nem fragmento (o contrato ja manda assim; aqui so a garantia). */
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

function lerRastreio(r: Obj): RastreioNormalizado {
  const utm: Utm = {};
  for (const k of ["source", "medium", "campaign", "content", "term"] as const) {
    const v = limparValor(r[`utm_${k}`]);
    if (v) utm[k] = v;
  }
  // A pagina pode ter o script da Utmify: o que ele gruda nas UTMs sai.
  const { utm: finalUtm, clique: daUtmify } = separarUtmify(utm);
  return {
    utm: finalUtm,
    sck: texto(r.sck, 255),
    // Sem a ponte (Fase D): nenhum vid do xcart no checkout do Eve.
    callback: null,
    fbc: texto(r.fbc, 300),
    fbp: texto(r.fbp, 300),
    fbclid: cliqueValido(r.fbclid, 600) ?? daUtmify.fbclid,
    ttclid: cliqueValido(r.ttclid, 1000) ?? daUtmify.ttclid,
    checkoutUrl: semQuery(r.url),
    vidNaUrl: null,
  };
}

/** SO EM MEMORIA (ver o cabecalho). */
function lerComprador(c: Obj): CompradorNormalizado {
  const email = texto(c.email, 200);
  return {
    nome: texto(c.nome, 120),
    email: email ? email.toLowerCase() : null,
    telefone: texto(c.telefone, 30),
    pais: lerPais(c.pais),
    estado: texto(c.estado, 60),
    cidade: texto(c.cidade, 80),
    cep: texto(c.cep, 20),
  };
}

/** Um aviso = um pedido, ou nada (`ignorado`). */
export function lerTodosEve(corpo: unknown, agora: Date, headers?: Headers): LeituraVarios {
  if (!ehObjeto(corpo)) return { ok: false, erro: "corpo nao e um objeto JSON" };
  if (corpo.versao !== VERSAO) {
    // Como veio (o "1" em texto aparece com aspas): e o Eve que precisa mudar.
    const veio = corpo.versao === undefined ? "ausente" : (JSON.stringify(corpo.versao) ?? "?").slice(0, 20);
    return { ok: false, erro: `versao ${veio} do contrato; o xcart le a versao ${VERSAO}` };
  }
  const evento = typeof corpo.evento === "string" ? corpo.evento.trim().toLowerCase() : "";
  if (!evento) return { ok: false, erro: "evento ausente" };
  if (!EVENTOS.has(evento)) return { ok: false, erro: `evento desconhecido: ${evento.slice(0, 40)}` };
  // O header nao e assinado: so confere que os dois lados montam igual.
  const doHeader = (headers?.get("x-eve-event") || "").trim().toLowerCase();
  if (doHeader && doHeader !== evento) return { ok: false, erro: "X-Eve-Event diferente do evento do corpo" };

  const p = ehObjeto(corpo.pedido) ? corpo.pedido : null;
  // Antes das validacoes: o teste nao precisa valer. Os dois sinais valem sozinhos.
  if (corpo.teste === true || p?.id === ID_TESTE) return { ok: true, eventos: [eventoDeTeste(evento, p ?? {}, agora)] };
  if (!p) return { ok: false, erro: "pedido ausente" };

  // A loja Shopify ja entra pelo orders/create: aqui contaria a venda duas vezes.
  if (String(p.origem ?? "").trim().toLowerCase() === "shopify") return { ok: true, eventos: [], ignorado: "origem shopify" };

  const status = typeof p.status === "string" ? p.status.trim().toLowerCase().slice(0, 40) || null : null;
  if (status && STATUS_IGNORADOS.has(status)) return { ok: true, eventos: [], ignorado: `status ${status}` };
  const situacao = status ? POR_STATUS[status] : undefined;
  if (!situacao) return { ok: false, erro: `status desconhecido: ${status ?? "ausente"}` };

  const pedidoId = lerPedidoId(p.id);
  if (!pedidoId) return { ok: false, erro: "pedido.id invalido" };

  // Datas. Presente e torta (ou fora da janela) recusa: e o dia do lucro.
  const criado = dataOpcional(p.criado_em, agora);
  if (criado === undefined) return { ok: false, erro: "criado_em invalido ou fora da janela" };
  const pago = dataOpcional(p.pago_em, agora);
  if (pago === undefined) return { ok: false, erro: "pago_em invalido ou fora da janela" };
  const cancelado = dataOpcional(p.cancelado_em, agora);
  if (cancelado === undefined) return { ok: false, erro: "cancelado_em invalido ou fora da janela" };
  const reembolsado = dataOpcional(p.reembolsado_em, agora);
  if (reembolsado === undefined) return { ok: false, erro: "reembolsado_em invalido ou fora da janela" };
  const atualizado = dataOpcional(p.atualizado_em, agora);
  if (atualizado === undefined) return { ok: false, erro: "atualizado_em invalido ou fora da janela" };
  const vence = dataOpcional(p.vence_em, agora, DIAS_VENCIMENTO);
  if (vence === undefined) return { ok: false, erro: "vence_em invalido ou fora da janela" };
  const enviado = dataOpcional(corpo.enviado_em, agora);
  if (enviado === undefined) return { ok: false, erro: "enviado_em invalido ou fora da janela" };

  // A data do evento e a do proprio status; atualizado_em e enviado_em de reserva.
  const daEtapa =
    situacao === "pendente" ? criado : situacao === "pago" ? pago : situacao === "expirado" ? cancelado : reembolsado;
  const dataEvento = daEtapa ?? atualizado ?? enviado ?? agora.toISOString();

  // Dinheiro.
  const total = lerCentavos(p.total_centavos);
  if (total === undefined || total === null) return { ok: false, erro: "pedido.total_centavos ausente ou invalido (centavos inteiros)" };
  for (const campo of ["subtotal_centavos", "desconto_centavos", "frete_centavos"] as const) {
    if (lerCentavos(p[campo]) === null) return { ok: false, erro: `pedido.${campo} invalido (centavos inteiros)` };
  }
  const temMoeda = p.moeda !== undefined && p.moeda !== null && p.moeda !== "";
  const moeda = temMoeda ? lerMoeda(p.moeda) : null;
  if (temMoeda && !moeda) return { ok: false, erro: "pedido.moeda invalida" };

  // A trava do Pix gerado e a COBRANCA (prazo e valor), nao so o nome: o Pix
  // vencido gerado de novo no mesmo checkout (prazo novo) ou com o valor
  // trocado (o lead da pagina reenviado) e aviso novo. So com o nome, caia em
  // "duplicado" e o pedido ficava com o prazo e o valor do 1o Pix. A
  // retentativa do mesmo Pix segue na mesma trava. Cabe nos 40 caracteres.
  const trava =
    evento === "pix.gerado" ? `pix.gerado:${vence ? Math.floor(Date.parse(vence) / 1000) : 0}:${Math.round(total * 100)}` : evento;

  const itens = Array.isArray(p.itens) ? p.itens.filter(ehObjeto) : [];
  const primeiro: Obj = itens[0] ?? {};
  const comprador = lerComprador(ehObjeto(corpo.comprador) ? corpo.comprador : {});
  // orders.number (inteiro; o PDO pode mandar em texto). Sem pedido no Eve ainda: null.
  const numeroBruto = typeof p.numero === "string" ? p.numero.trim() : p.numero;
  const numero =
    (typeof numeroBruto === "number" && Number.isSafeInteger(numeroBruto) && numeroBruto > 0) ||
    (typeof numeroBruto === "string" && /^[1-9]\d{0,11}$/.test(numeroBruto))
      ? String(numeroBruto)
      : null;

  const venda: VendaNormalizada = {
    // O Eve nao sabe a taxa do gateway: o liquido e o total.
    taxa: null,
    comissoes: null,
    referencia: numero,
    // O token do checkout e a cobranca inteira (um pedido por aviso).
    grupo: pedidoId,
    produtoId: lerPedidoId(primeiro.id),
    ofertaTipo: "main",
    venceEm: vence,
    reembolsadoEm: situacao === "revertido" ? (reembolsado ?? dataEvento) : null,
    chargebackEm: null,
    reembolsoPedidoEm: null,
    cobrancaGerada: evento === "pix.gerado",
    recorrencia: false,
  };

  const saida: EventoNormalizado = {
    evento: trava,
    dataEvento,
    pedidoId,
    pedido: {
      status: texto(p.status, 40),
      metodo: texto(p.metodo, 40)?.toLowerCase() ?? "pix",
      produto: texto(primeiro.titulo, 200),
      pais: comprador.pais ?? "BR",
      moeda: moeda ?? "",
      valor: total,
      criadoEm: criado ?? dataEvento,
    },
    receita: { valor: total, moeda, situacao, statusOriginal: status },
    conta: null,
    programa: null,
    teste: false,
    ...(corpo.historico === true ? { semAviso: true } : {}),
    venda,
    rastreio: lerRastreio(ehObjeto(corpo.rastreio) ? corpo.rastreio : {}),
    comprador,
  };
  return { ok: true, eventos: [saida] };
}

/** O pedido da entrega (o contrato de um so). Use lerTodosEve: ele diz o que foi ignorado. */
export function lerEve(corpo: unknown, agora: Date, headers?: Headers): Leitura {
  const r = lerTodosEve(corpo, agora, headers);
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
 * O HMAC do contrato sobre o corpo CRU, com o timestamp na janela da Cakto.
 * Toda retentativa do Eve assina de novo (timestamp novo). Tempo constante.
 */
export function autenticarEve(raw: string | Uint8Array, headers: Headers, segredo: string | null, agora: Date): Autenticacao {
  if (!segredo) return { ok: false, semSegredo: true, erro: "secret da Eve nao cadastrado" };
  const assinatura = (headers.get("x-eve-signature") || "").trim();
  if (!assinatura) return { ok: false, erro: "X-Eve-Signature ausente" };
  const ts = (headers.get("x-eve-timestamp") || "").trim();
  if (!/^\d{9,11}$/.test(ts)) return { ok: false, erro: "X-Eve-Timestamp ausente ou invalido" };
  const diferenca = agora.getTime() / 1000 - Number(ts);
  if (diferenca > TOLERANCIA_PASSADO_S || diferenca < -TOLERANCIA_FUTURO_S) {
    return { ok: false, erro: "X-Eve-Timestamp fora da janela" };
  }
  const esperado = hmac(segredo, ts, raw);
  // "v1=<hex>"; numa troca de versao viria "v1=...,v2=...": so a v1 conta.
  const recebidas = assinatura
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.startsWith("v1="))
    .map((s) => s.slice(3).trim().toLowerCase());
  if (!recebidas.some((v) => iguais(v, esperado))) return { ok: false, erro: "assinatura nao confere" };
  return { ok: true };
}

/** Os headers que o Eve mandaria: o "Enviar evento de teste" passa pelo autenticar. */
export function assinarEve(raw: string, segredo: string, agora: Date): Record<string, string> {
  const ts = String(Math.floor(agora.getTime() / 1000));
  let evento = "";
  try {
    const j: unknown = JSON.parse(raw);
    evento = ehObjeto(j) && typeof j.evento === "string" ? j.evento : "";
  } catch {
    evento = "";
  }
  return {
    ...(evento ? { "X-Eve-Event": evento } : {}),
    "X-Eve-Timestamp": ts,
    "X-Eve-Signature": `v1=${hmac(segredo, ts, raw)}`,
  };
}

/** O corpo do "Enviar evento de teste": um Pix pago, marcado pelos dois sinais. */
export function exemploEve(agora: Date): unknown {
  const iso = `${agora.toISOString().slice(0, 19)}Z`;
  return {
    versao: VERSAO,
    evento: "pedido.pago",
    enviado_em: iso,
    teste: true,
    loja: { id: "xcart-teste", nome: "Teste do xcart" },
    pedido: {
      id: ID_TESTE,
      numero: null,
      origem: "external",
      status: "paid",
      metodo: "pix",
      moeda: "BRL",
      subtotal_centavos: 9700,
      desconto_centavos: 0,
      frete_centavos: 0,
      total_centavos: 9700,
      criado_em: iso,
      pago_em: iso,
      vence_em: null,
      cancelado_em: null,
      reembolsado_em: null,
      atualizado_em: iso,
      itens: [{ id: "xcart-teste", titulo: "Venda de teste do xcart", variante: null, quantidade: 1, preco_centavos: 9700, total_centavos: 9700 }],
    },
    comprador: { nome: "Teste do xcart", email: "teste@example.com", telefone: null, cidade: null, estado: null, cep: null, pais: "BR" },
    rastreio: { url: "https://checkouteve.shop/" },
  };
}

export const eve: PlataformaCheckout = {
  id: "eve",
  nome: "Eve",
  modelo: "venda",
  autenticacao: "hmac_header",
  reenvio: "status",
  // A fila de jobs do Eve: 5 tentativas em ~15 min, e so com o worker no cron.
  reenvioNaTela: {
    automatico: "tenta de novo sozinha pela fila (5 vezes em cerca de 15 minutos, se o worker estiver no cron)",
    // Nada de "entra na proxima mudanca": pedido pago nao tem proxima mudanca,
    // e o Eve nao tem reenvio por pedido no painel. So a fila traz de volta.
    manual:
      "use Enviar teste no painel dela para conferir a conexão; o evento que falhou só volta pela fila de jobs dela, com o worker no cron. Sem a fila, o pedido pago não volta",
  },
  gatilhos: GATILHOS_EVE,
  eventoDeVenda: "pedido.pago",
  ler: lerEve,
  lerTodos: lerTodosEve,
  autenticar: autenticarEve,
  assinar: assinarEve,
  exemplo: exemploEve,
};
