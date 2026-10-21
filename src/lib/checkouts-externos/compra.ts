import { montarFbc, montarUserData, montarUserTiktok, telefoneE164 } from "@/lib/tracking/normalizar";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import { MOEDAS_TIKTOK, urlSemTtclid, type EventoTiktok } from "@/lib/tracking/tiktok-evento";
import { definicaoDoEvento } from "@/lib/tracking/eventos";
import type { IdentidadeGuardada } from "@/lib/tracking/purchase";
import type { EventoNormalizado, RastreioNormalizado } from "./plataformas/tipos";
import type { CompraQuando, PlataformaRastreio } from "./tipos";
import { PREFIXO_VID, RE_VID, vidDoParametro } from "./plataformas/comum";

// ============================================================================
// A compra do checkout externo (Cakto, Hubla) pelo SERVIDOR: Meta (Conversions
// API) e TikTok (Events API). Decisao do Arthur (19/10/2026): quem manda a
// compra das vendas da Cakto e o xcart; o lojista tira o pixel e o token
// nativos da plataforma (um emissor por pixel). O Google fica com a tag nativa.
//
// Hubla: a cobranca gerada e o invoice.created de Pix/boleto
// (`venda.cobrancaGerada`; o de cartao espera o pagamento), a renovacao, o
// upgrade e a parcela 2+ do Parcelamento Inteligente nao mandam
// (`venda.recorrencia`), e IP, user agent e _ttp vem da sessao do pagamento
// (`rastreio.ip`/`userAgent`/`ttp`) quando a identidade da ponte nao tem.
//
// QUANDO SAI (por checkout, `compra_quando`):
//   "gerada" (padrao): no PRIMEIRO evento de venda da cobranca -- Pix, boleto,
//     PicPay ou Open Finance gerado, ou o cartao aprovado direto.
//   "aprovada": so no purchase_approved.
// Nos dois o event_id e UM por cobranca (`purchase_cakto_<grupo>`), e o
// indice unico (destino, event_id) da fila e a trava: o Pix pago depois do
// gerado, a retentativa da Cakto e o order bump que chega em outra entrega
// caem em "duplicado" e nao saem de novo. Reembolso, chargeback e recusa nao
// mandam nada. So o evento que VENCEU (estado.ts) conta: o Pix gerado que
// chega depois da aprovacao nao e venda nova.
//
// V2 da Cakto (a entrega E a cobranca): principal e order bump somam no mesmo
// Purchase. V1 (uma entrega por item): o primeiro que chega leva a compra; o
// order bump que chega depois nao duplica, e o valor dele fica de fora.
//
// DADO PESSOAL: so em SHA-256 no payload (montarUserData/montarUserTiktok:
// e-mail, telefone, nome, cidade, estado, CEP, pais, external_id). CPF nem e
// lido. fbc/fbp e IP e user agent (da identidade que a ponte gravou, Fase D)
// vao em claro, como na Shopify: e o formato que o Meta e o TikTok pedem.
// Nada com "@" entra (o CHECK da 073 recusaria a linha, e a compra cairia no
// caminho de falha): valor da identidade ou URL com "@" sai.
//
// O VISITANTE (Fase D): a ponte poe `callback=xc.<vid>` no link da Cakto. O
// vid vem do campo `callback`, depois do `sck`, depois da query do
// `checkoutUrl` (cakto.ts) -- e acha a identidade (IP, user agent, _fbp,
// fbclid, ttclid, _ttp).
//
// Puro: sem banco, sem rede. Testado em tests/checkout-externo-rastreio.test.ts.
// ============================================================================

/** O Meta recusa event_time de mais de 7 dias; o TikTok, igual. */
export const JANELA_COMPRA_MS = 7 * 86_400_000;

/** A cobranca gerada: pix_gerado, boleto_gerado, picpay_gerado, openfinance_nubank_gerado. */
const COBRANCA_GERADA = /^[a-z_]+_gerado$/;

/** O checkout de onde a compra veio, quando o webhook nao traz a URL. */
const URL_DO_CHECKOUT: Record<string, string> = { cakto: "https://pay.cakto.com.br/", hubla: "https://pay.hub.la/" };

// O vid da ponte ("xc.<vid>" no `callback`): o formato mora em comum.ts, que
// o adaptador da Cakto tambem usa para ler a query do checkoutUrl.
export { PREFIXO_VID, RE_VID, vidDoParametro };

export const RE_FBC = /^fb\.[0-9]\.[0-9]{9,14}\.[A-Za-z0-9_.-]+$/;
export const RE_FBP = /^fb\.[0-9]\.[0-9]{9,14}\.[0-9]+$/;

/** O id do evento: o MESMO para Meta e TikTok, um por cobranca. */
export function idDaCompra(plataforma: string, grupo: string): string {
  return `purchase_${plataforma}_${grupo}`;
}

/**
 * Este evento e venda para o rastreamento? A aprovacao sempre (o cartao
 * aprovado direto, o Pix pago). A cobranca gerada so no modo "gerada" -- e
 * vale tambem quando ela chega ja paga (o payload e montado na hora do envio).
 */
export function ehEventoDeCompra(ev: EventoNormalizado, quando: CompraQuando, eventoDeVenda: string): boolean {
  if (ev.teste || ev.venda?.recorrencia) return false;
  const s = ev.receita.situacao;
  if (ev.evento === eventoDeVenda) return s === "pago";
  const gerada = ev.venda?.cobrancaGerada ?? COBRANCA_GERADA.test(ev.evento);
  return quando === "gerada" && gerada && (s === "pendente" || s === "pago");
}

export interface CompraDaCobranca {
  /** A cobranca (o refId do principal). */
  grupo: string;
  /** Os itens da cobranca nesta entrega, o principal primeiro. */
  itens: EventoNormalizado[];
}

/** As compras da entrega: os eventos de venda que VENCERAM, um grupo por cobranca. */
export function comprasDaEntrega(
  aplicados: readonly { ev: EventoNormalizado; venceu: boolean }[],
  quando: CompraQuando,
  eventoDeVenda: string
): CompraDaCobranca[] {
  const porGrupo = new Map<string, EventoNormalizado[]>();
  for (const a of aplicados) {
    if (!a.venceu || !ehEventoDeCompra(a.ev, quando, eventoDeVenda)) continue;
    const grupo = a.ev.venda?.grupo ?? a.ev.pedidoId;
    const lista = porGrupo.get(grupo) ?? [];
    if (!lista.some((e) => e.pedidoId === a.ev.pedidoId)) lista.push(a.ev);
    porGrupo.set(grupo, lista);
  }
  return [...porGrupo].map(([grupo, itens]) => ({
    grupo,
    itens: [...itens].sort((a, b) => Number(b.venda?.ofertaTipo === "main") - Number(a.venda?.ofertaTipo === "main")),
  }));
}

/** O instante da compra (ms): a geracao ou o pagamento mais antigo da cobranca, nunca no futuro. */
export function quandoDaCompra(compra: CompraDaCobranca, agoraMs: number): number {
  const datas = compra.itens.map((e) => Date.parse(e.dataEvento)).filter(Number.isFinite);
  return Math.min(datas.length ? Math.min(...datas) : agoraMs, agoraMs);
}

/**
 * O vid da ponte, se veio: no `callback` ("xc.<vid>"), depois no `sck`,
 * depois na query do `checkoutUrl` (o `callback`/`sck` com que o comprador
 * abriu o checkout, que cakto.ts ja leu e validou).
 */
export function vidDoRastreio(r: RastreioNormalizado | null | undefined): string | null {
  for (const bruto of [r?.callback, r?.sck]) {
    const v = vidDoParametro(bruto);
    if (v) return v;
  }
  const daUrl = (r?.vidNaUrl || "").trim();
  return RE_VID.test(daUrl) ? daUrl : null;
}

/** O vid da cobranca (do principal, ou do primeiro item que trouxe). */
export function vidDaCompra(compra: CompraDaCobranca): string | null {
  for (const e of compra.itens) {
    const v = vidDoRastreio(e.rastreio);
    if (v) return v;
  }
  return null;
}

/** "Ana Souza Lima" -> Ana e Lima (o sobrenome de familia, o que o perfil costuma ter). */
export function partesDoNome(nome: string | null | undefined): { primeiro: string | null; ultimo: string | null } {
  const p = (nome || "").trim().split(/\s+/).filter(Boolean);
  if (p.length === 0) return { primeiro: null, ultimo: null };
  return { primeiro: p[0], ultimo: p.length > 1 ? p[p.length - 1] : null };
}

/**
 * O telefone em E.164 SEM o '+' (so os digitos), com o Brasil como padrao.
 *
 * A Cakto manda com e sem o 55 ("5534999999999" e "34999999999"). No Brasil o
 * numero nacional tem 10 ou 11 digitos (DDD + 8 ou 9) e o internacional 12 ou
 * 13 comecando em 55 -- pelo tamanho, e nao pelo "comeca com 55", porque 55 e
 * DDD no Rio Grande do Sul. Com '+'/'00' ou pais de fora, a regra geral
 * (telefoneE164). O que nao fecha sai null: hash de numero torto nunca casa.
 */
export function telefoneDoComprador(telefone: string | null | undefined, pais: string | null | undefined): string | null {
  const bruto = (telefone || "").trim();
  if (!bruto) return null;
  const p = (pais || "BR").trim().toUpperCase();
  if (p !== "BR" || /^(\+|00)/.test(bruto)) {
    const e = telefoneE164(bruto, p);
    return e ? e.slice(1) : null;
  }
  const d = bruto.replace(/\D/g, "").replace(/^0+/, "");
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) return d;
  return null;
}

export interface ContextoDaCompra {
  /** A plataforma do checkout ("cakto", "hubla"): o prefixo do event_id e a URL padrao. */
  plataforma: string;
  agoraMs: number;
  /** A moeda do checkout: vale quando a venda nao trouxe a dela. */
  moedaPadrao: string;
  /**
   * O que a ponte guardou do visitante (Fase D: IP, user agent, fbclid,
   * ttclid, _fbp, _ttp e a hora do clique). null = so o que a Cakto mandou.
   */
  identidade?: IdentidadeGuardada | null;
}

function redondo(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Texto sem "@" (o CHECK da fila); o resto sai null. */
function semArroba(v: string | null | undefined): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && !s.includes("@") ? s : null;
}

/**
 * A hora do clique para o fbc montado do fbclid da identidade: a do conjunto
 * do clique que a ponte guardou (utm_em), nunca depois da compra. Sem ela, a
 * criacao do pedido (o clique foi antes, nao depois).
 */
function horaDoClique(id: IdentidadeGuardada | null, criadoMs: number): number {
  const em = Date.parse(String(id?.utmEm ?? ""));
  return Number.isFinite(em) && em < criadoMs ? em : criadoMs;
}

/** O que os dois formatos dividem, ja resolvido. */
function baseDaCompra(compra: CompraDaCobranca, ctx: ContextoDaCompra) {
  const principal = compra.itens[0];
  const r = principal.rastreio ?? compra.itens.find((e) => e.rastreio)?.rastreio ?? null;
  const c = principal.comprador ?? compra.itens.find((e) => e.comprador)?.comprador ?? null;
  const id = ctx.identidade ?? null;
  const moeda = (principal.pedido.moeda || ctx.moedaPadrao || "").toUpperCase();
  const pais = c?.pais ?? (moeda === "BRL" ? "BR" : null);
  const telefone = telefoneDoComprador(c?.telefone, c?.pais);
  const nome = partesDoNome(c?.nome);

  // contents: um por produto, com o preco pago por unidade.
  const porProduto = new Map<string, { quantidade: number; pago: number }>();
  for (const e of compra.itens) {
    const pid = e.venda?.produtoId ?? e.pedidoId;
    const atual = porProduto.get(pid) ?? { quantidade: 0, pago: 0 };
    porProduto.set(pid, { quantidade: atual.quantidade + 1, pago: atual.pago + e.pedido.valor });
  }
  const contents = [...porProduto].map(([pid, x]) => ({ id: pid, quantidade: x.quantidade, preco: redondo(x.pago / x.quantidade) }));

  const criadoMs = Date.parse(principal.pedido.criadoEm);
  const quandoCriado = Number.isFinite(criadoMs) ? criadoMs : ctx.agoraMs;
  const fbcDoWebhook = r?.fbc && RE_FBC.test(r.fbc) ? r.fbc : null;
  const fbpDoWebhook = r?.fbp && RE_FBP.test(r.fbp) ? r.fbp : null;
  // Da identidade (o coletor ja validou; aqui so a trava do "@").
  const fbcDaIdentidade = semArroba(id?.fbc);
  const fbclidDaIdentidade = semArroba(id?.fbclid);
  const url = semArroba(r?.checkoutUrl) || URL_DO_CHECKOUT[ctx.plataforma] || "https://pay.cakto.com.br/";

  return {
    eventId: idDaCompra(ctx.plataforma, compra.grupo),
    quandoS: Math.floor(quandoDaCompra(compra, ctx.agoraMs) / 1000),
    valor: redondo(compra.itens.reduce((s, e) => s + e.pedido.valor, 0)),
    moeda,
    contents,
    numItens: compra.itens.length,
    orderId: compra.grupo,
    url,
    dados: {
      email: c?.email ?? null,
      // Com o '+': os dois normalizadores tomam como internacional e nao colam DDI de novo.
      telefone: telefone ? `+${telefone}` : null,
      primeiroNome: nome.primeiro,
      sobrenome: nome.ultimo,
      cidade: c?.cidade ?? null,
      estado: c?.estado ?? null,
      cep: c?.cep ?? null,
      pais,
      externalIds: [vidDaCompra(compra) ?? id?.visitorId ?? null],
    },
    fbc:
      fbcDoWebhook ||
      fbcDaIdentidade ||
      (fbclidDaIdentidade
        ? montarFbc(fbclidDaIdentidade, horaDoClique(id, quandoCriado))
        : montarFbc(semArroba(r?.fbclid), quandoCriado)),
    fbp: fbpDoWebhook || semArroba(id?.fbp),
    ttclid: semArroba(id?.ttclid) || semArroba(r?.ttclid),
    ttp: semArroba(id?.ttp) || semArroba(r?.ttp),
    // A sessao do pagamento (Hubla) vence: e quem pagou, na hora da compra.
    ip: semArroba(r?.ip) || semArroba(id?.clientIp),
    ua: semArroba(r?.userAgent) || semArroba(id?.userAgent),
  };
}

/** A compra no formato do Conversions API do Meta. */
export function montarCompraMeta(compra: CompraDaCobranca, ctx: ContextoDaCompra): EventoCapi {
  const b = baseDaCompra(compra, ctx);
  return {
    event_name: definicaoDoEvento("purchase").nomeNoMeta,
    // Em segundos: o Meta recusa milissegundos.
    event_time: b.quandoS,
    event_id: b.eventId,
    event_source_url: b.url,
    action_source: "website",
    user_data: montarUserData(b.dados, { fbp: b.fbp, fbc: b.fbc, clientIp: b.ip, userAgent: b.ua }),
    custom_data: {
      currency: b.moeda || undefined,
      value: b.valor,
      content_type: "product",
      content_ids: b.contents.map((x) => x.id),
      contents: b.contents.map((x) => ({ id: x.id, quantity: x.quantidade, ...(x.preco > 0 ? { item_price: x.preco } : {}) })),
      num_items: b.numItens,
      order_id: b.orderId,
    },
  };
}

/**
 * A compra no formato da Events API do TikTok: `Purchase` (nao o
 * `CompletePayment` da Cakto), o MESMO event_id do Meta, telefone em E.164
 * com '+' antes do hash. Moeda fora da lista do TikTok sai sem valor (conta a
 * conversao, so nao entra no ROAS) -- a regra de MOEDAS_TIKTOK.
 */
export function montarCompraTiktok(compra: CompraDaCobranca, ctx: ContextoDaCompra): EventoTiktok {
  const b = baseDaCompra(compra, ctx);
  const comValor = MOEDAS_TIKTOK.has(b.moeda);
  return {
    event: definicaoDoEvento("purchase").nomeNoTiktok,
    event_time: b.quandoS,
    event_id: b.eventId,
    user: montarUserTiktok(b.dados, { ttclid: b.ttclid, ttp: b.ttp, clientIp: b.ip, userAgent: b.ua }),
    page: { url: urlSemTtclid(b.url) },
    properties: {
      ...(comValor ? { currency: b.moeda, value: b.valor } : {}),
      content_type: "product",
      contents: b.contents.map((x) => ({ content_id: x.id, quantity: x.quantidade, ...(x.preco > 0 ? { price: x.preco } : {}) })),
      num_items: b.numItens,
      order_id: b.orderId,
    },
  };
}

export function montarCompra(plataforma: PlataformaRastreio, compra: CompraDaCobranca, ctx: ContextoDaCompra): EventoCapi | EventoTiktok {
  return plataforma === "tiktok" ? montarCompraTiktok(compra, ctx) : montarCompraMeta(compra, ctx);
}

// ---------------------------------------------------------------------------
// A fila (contrato): quem grava e rastreio.ts; aqui so o que entra nela
// ---------------------------------------------------------------------------

export interface DestinoDoCheckout {
  id: string;
  plataforma: PlataformaRastreio;
  /** Id do pixel no Meta, Pixel Code no TikTok. */
  conta: string;
  /** So no servidor: nunca vai para a tela. */
  token: string | null;
  testEventCode: string | null;
  ativo: boolean;
}

export interface EnvioNovo {
  checkout_id: string;
  user_id: string;
  destino_id: string;
  plataforma: PlataformaRastreio;
  event_name: string;
  event_id: string;
  grupo: string | null;
  payload: EventoCapi | EventoTiktok;
  /** So o que vem da ponte (Fase D): as chaves dos tetos do coletor. A compra nao leva. */
  visitor_id?: string | null;
  ip_hash?: string | null;
}

export interface EnvioGravado extends EnvioNovo {
  id: string;
  attempts: number;
}

/** A linha que entrou na fila e o destino ja lido (com o token), para o after(). */
export interface EnvioParaEntregar {
  envio: EnvioGravado;
  destino: DestinoDoCheckout;
}

export interface RastreioCheckout {
  /** Os destinos ATIVOS do checkout, com o token. Sem a 073: []. Erro de banco LANCA. */
  destinos(checkoutId: string): Promise<DestinoDoCheckout[]>;
  /** A identidade do visitante pelo vid (Fase D). Falha = null (so enriquece). */
  identidade?(checkoutId: string, visitorId: string): Promise<IdentidadeGuardada | null>;
  /** Grava as linhas; devolve as que entraram (a duplicada fica de fora). Erro LANCA. */
  enfileirar(linhas: EnvioNovo[]): Promise<EnvioGravado[]>;
}

/**
 * As compras da entrega na fila: uma linha por cobranca e destino. Compra
 * com mais de 7 dias (Reenviar antigo no painel da Cakto) nao entra: o Meta e
 * o TikTok recusariam. Devolve o que entrou, para entregar depois da resposta.
 */
export async function enfileirarCompras(
  rastreio: RastreioCheckout,
  checkout: { id: string; user_id: string; plataforma: string; moeda_receita: string },
  compras: readonly CompraDaCobranca[],
  agoraMs: number
): Promise<EnvioParaEntregar[]> {
  if (compras.length === 0) return [];
  const destinos = (await rastreio.destinos(checkout.id)).filter((d) => d.ativo && d.conta && d.token);
  if (destinos.length === 0) return [];

  const linhas: EnvioNovo[] = [];
  for (const compra of compras) {
    if (agoraMs - quandoDaCompra(compra, agoraMs) > JANELA_COMPRA_MS) continue;
    const vid = vidDaCompra(compra);
    const identidade =
      vid && rastreio.identidade ? await rastreio.identidade(checkout.id, vid).catch(() => null) : null;
    const ctx: ContextoDaCompra = { plataforma: checkout.plataforma, agoraMs, moedaPadrao: checkout.moeda_receita, identidade };
    for (const d of destinos) {
      linhas.push({
        checkout_id: checkout.id,
        user_id: checkout.user_id,
        destino_id: d.id,
        plataforma: d.plataforma,
        event_name: definicaoDoEvento("purchase").nomeNoMeta,
        event_id: idDaCompra(checkout.plataforma, compra.grupo),
        grupo: compra.grupo,
        payload: montarCompra(d.plataforma, compra, ctx),
      });
    }
  }
  if (linhas.length === 0) return [];

  const gravadas = await rastreio.enfileirar(linhas);
  const porId = new Map(destinos.map((d) => [d.id, d]));
  return gravadas.flatMap((envio) => {
    const destino = porId.get(envio.destino_id);
    return destino ? [{ envio, destino }] : [];
  });
}
