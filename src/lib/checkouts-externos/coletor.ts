import { ehUuid } from "@/lib/financeiro/tipos";
import { definicaoDoEvento, type ChaveEvento } from "@/lib/tracking/eventos";
import { chaveDoIp } from "@/lib/tracking/ip-balde";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import { MAX_TTCLID, montarFbc, montarUserData, montarUserTiktok } from "@/lib/tracking/normalizar";
import { montarEventoDeFunilTiktok, type EventoTiktok } from "@/lib/tracking/tiktok-evento";
import { CORTE_PAGINA, limparValor, parametrosDaUrl, utmDaPagina, utmDoCorpo, type Utm } from "@/lib/tracking/utm";
import { RE_FBC, RE_FBP, RE_VID, type DestinoDoCheckout, type EnvioGravado, type EnvioNovo, type EnvioParaEntregar } from "./compra";
import { HOST_DO_CHECKOUT, rastreiaCompra, type IdPlataformaCheckout } from "./tipos";

// ============================================================================
// O ramo de CHECKOUT do coletor publico (/api/tracking/collect), Fase D.
//
// A pagina de vendas (VSL, advertorial) que leva a um checkout da Cakto tem a
// ponte (xcart-bridge.js com data-xcart-checkout="<id>"). Ela avisa aqui:
//
//   page_view       ao abrir a pagina          -> PageView no Meta e no TikTok
//   begin_checkout  no clique do botao da Cakto -> InitiateCheckout
//
// e poe `callback=xc.<vid>` no link do botao. Este ramo grava a IDENTIDADE do
// visitante (checkout_externo_identidades: fbp, fbc, fbclid, ttclid, ttp,
// gclid, IP, user agent, UTMs) -- a Cakto nao manda nada disso no webhook, e
// a compra (compra.ts) acha a identidade pelo vid -- e poe os dois eventos na
// fila do checkout (checkout_externo_envios), com o mesmo envio da compra.
//
// O MESMO ACORDO DO COLETOR DAS LOJAS (o endpoint e publico; o id do checkout
// esta no HTML da VSL):
//   1. NENHUM VALOR MONETARIO. PageView e InitiateCheckout saem sem value nem
//      currency: valor vindo do navegador e numero que qualquer um infla.
//   2. Os MESMOS TETOS (TETOS_DO_COLETOR: por visitante no dia, por IP e por
//      checkout na hora, identidades novas por hora) -- travados contra os do
//      coletor das lojas por tests/checkout-externo-coletor.test.ts.
//   3. event_id estavel: um por visitante a cada 30 min, e o indice unico da
//      fila segura a repeticao. O InitiateCheckout ainda tem a janela
//      deslizante: outro do mesmo visitante nos ultimos 30 min, nao sai.
//
// So checkout ATIVO, do modelo venda (a Sphere nao rastreia) e com destino
// ligado (pixel com token): o resto e recusado sem gravar nada. Google: nada
// (fica com a tag nativa da Cakto) -- o gclid so vai para a identidade.
//
// Nada com "@" entra (o CHECK da 073 recusaria a linha): user agent com "@"
// sai, a URL da pagina vai so com origem, caminho e os parametros de anuncio.
// IP e user agent em claro, como nas lojas: e o que o Meta e o TikTok casam.
//
// Sem banco aqui: o RepositorioDoColetor de verdade e o de rastreio.ts.
// ============================================================================

/**
 * Os mesmos numeros do coletor das lojas (src/app/api/tracking/collect/route.ts),
 * com o checkout no lugar da loja. Linhas de fila, nao acoes: uma acao rende
 * uma linha por pixel.
 */
export const TETOS_DO_COLETOR = {
  /** TETO_POR_VISITANTE: linhas por visitante por dia. */
  porVisitanteDia: 120,
  /** TETO_POR_IP_HORA: linhas por IP por checkout por hora, contado ANTES do do checkout. */
  porIpHora: 1500,
  /** TETO_POR_LOJA_HORA: linhas por checkout por hora. */
  porCheckoutHora: 20000,
  /** TETO_IDENTIDADES_HORA: identidades NOVAS por checkout por hora. */
  identidadesHora: 20000,
  /** TETO_IDENTIDADES_POR_IP_HORA: identidades NOVAS por IP por checkout por hora. */
  identidadesPorIpHora: 500,
} as const;

/** Os eventos que a ponte manda para um checkout. */
export const EVENTOS_DO_CHECKOUT = ["page_view", "begin_checkout"] as const satisfies readonly ChaveEvento[];
export type EventoDoCheckout = (typeof EVENTOS_DO_CHECKOUT)[number];

/** Um PageView e um InitiateCheckout por visitante nesta janela. */
export const JANELA_DA_PONTE_MS = 30 * 60 * 1000;

/** A identidade vale 30 dias (o boleto vence em dias; a compra vai ao Meta ate 7 depois). */
export const VALIDADE_IDENTIDADE_MS = 30 * 864e5;

const UMA_HORA_MS = 36e5;
const UM_DIA_MS = 864e5;

/** Charset dos click ids (fbclid, ttclid, gclid): a query pode ter de tudo. */
const RE_CLIQUE = /^[A-Za-z0-9_.-]+$/;
/** O cookie _ttp do pixel do TikTok. */
const RE_TTP = /^[A-Za-z0-9_.+/=-]{1,100}$/;

/** Os parametros da URL da pagina que vao para o event_source_url: os de anuncio, nunca o resto. */
const PARAMETROS_DA_PAGINA = [
  "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id",
  "gad_campaignid", "fbclid", "ttclid", "gclid", "gbraid", "wbraid",
];

export function idDoEventoDaPonte(evento: EventoDoCheckout, vid: string, agoraMs: number): string {
  return `${evento}_${vid}_${Math.floor(agoraMs / JANELA_DA_PONTE_MS)}`;
}

function clique(v: unknown, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= max && RE_CLIQUE.test(s) ? s : null;
}

function cookie(v: unknown, re: RegExp, max: number): string | null {
  const s = typeof v === "string" ? v.trim() : "";
  return s && s.length <= max && re.test(s) ? s : null;
}

/** O user agent do header: sem controle, ate 500, e sem "@" (sai inteiro, nunca cortado no meio do "@"). */
export function userAgentLimpo(v: string | null | undefined): string | null {
  const s = (v || "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return s && s.length <= 500 && !s.includes("@") ? s : null;
}

/** O IP so se for um IP (o teto conta pela mesma chave). */
export function ipLimpo(v: string | null | undefined): string | null {
  const s = (v || "").trim();
  return s && s.length <= 64 && chaveDoIp(s) ? s : null;
}

/**
 * A URL da pagina para o event_source_url / page.url: origem, caminho e so os
 * parametros de anuncio (inteiros: o corpo vem cortado em 500), sem "@". A
 * query de uma VSL pode trazer e-mail e nome (link de campanha de e-mail).
 */
export function urlDaPagina(bruto: unknown): string | null {
  if (typeof bruto !== "string" || !bruto.trim()) return null;
  let u: URL;
  try {
    u = new URL(bruto.trim().slice(0, CORTE_PAGINA));
  } catch {
    return null;
  }
  if ((u.protocol !== "https:" && u.protocol !== "http:") || u.username || u.password) return null;
  const base = `${u.origin}${u.pathname}`;
  if (base.includes("@")) return `${u.origin}/`;
  const saida = new URL(base);
  const p = parametrosDaUrl(bruto.trim().slice(0, CORTE_PAGINA), CORTE_PAGINA);
  for (const k of PARAMETROS_DA_PAGINA) {
    const v = k.startsWith("utm_") ? limparValor(p.get(k)) : clique(p.get(k), 1000);
    if (v) saida.searchParams.set(k, v);
  }
  const texto = saida.toString();
  return texto.includes("@") ? base : texto;
}

// ---------------------------------------------------------------------------
// O banco (contrato): o de verdade em rastreio.ts, um em memoria nos testes
// ---------------------------------------------------------------------------

export interface CheckoutDoColetor {
  id: string;
  user_id: string;
  plataforma: string;
  ativo: boolean;
}

/** O que a identidade guarda (as colunas da 073). */
export interface CamposDaIdentidade {
  fbp: string | null;
  fbc: string | null;
  fbclid: string | null;
  ttclid: string | null;
  ttp: string | null;
  gclid: string | null;
  client_ip_address: string | null;
  client_user_agent: string | null;
  /** So quando vieram: o evento seguinte numa pagina sem UTM nao apaga a campanha do clique. */
  utm?: Utm;
  utm_em?: string;
  updated_at: string;
  expires_at: string;
}

export interface RepositorioDoColetor {
  /** O checkout pelo id (service role). null = nao existe. Erro LANCA. */
  checkout(id: string): Promise<CheckoutDoColetor | null>;
  /** Os destinos ATIVOS, com o token. Sem a 073: []. Erro LANCA. */
  destinos(checkoutId: string): Promise<DestinoDoCheckout[]>;
  /** Atualiza a identidade que ja existe. true = existia. Erro LANCA. */
  atualizarIdentidade(checkoutId: string, visitorId: string, campos: CamposDaIdentidade): Promise<boolean>;
  /** Identidades criadas desde `desde`: do checkout e (com ipHash) do IP. null = nao deu para contar. */
  identidadesNovas(checkoutId: string, desde: string, ipHash: string | null): Promise<{ doCheckout: number | null; doIp: number | null }>;
  /** Grava a identidade nova (upsert pela chave: duas abas ao mesmo tempo). Erro LANCA. */
  inserirIdentidade(linha: CamposDaIdentidade & { checkout_id: string; user_id: string; visitor_id: string; ip_hash: string | null }): Promise<void>;
  /**
   * Linhas da fila deste checkout desde `desde`: do visitante, do IP, ou (sem
   * os dois) as da ponte (visitor_id preenchido). null = nao deu para contar
   * (o teto fica cego, nao fechado).
   */
  contarEnvios(f: { checkoutId: string; desde: string; visitorId?: string; ipHash?: string }): Promise<number | null>;
  /** Ha InitiateCheckout deste visitante na fila desde `desde`? Falha = false. */
  inicioDesde(checkoutId: string, visitorId: string, desde: string): Promise<boolean>;
  /** Grava as linhas; devolve as que entraram (a duplicada fica de fora). Erro LANCA. */
  enfileirar(linhas: EnvioNovo[]): Promise<EnvioGravado[]>;
  /** Manda o que entrou; o que falhar fica pendente para o cron. Nunca lanca. */
  entregar(lista: EnvioParaEntregar[]): Promise<{ id: string; ok: boolean }[]>;
}

/** O que o navegador manda (o mesmo corpo da ponte das lojas, com `checkoutId` no lugar de `shop`). */
export interface CorpoDaPonte {
  checkoutId?: unknown;
  evento?: unknown;
  visitorId?: unknown;
  fbp?: unknown;
  fbc?: unknown;
  fbclid?: unknown;
  ttclid?: unknown;
  ttp?: unknown;
  gclid?: unknown;
  pageUrl?: unknown;
  utm?: unknown;
}

export interface ContextoDoColetor {
  agoraMs: number;
  /** O IP de quem chamou (x-forwarded-for) e o hash dele (ip-balde.ts). */
  ip: string | null;
  ipHash: string | null;
  userAgent: string | null;
  /** O pais pela borda (x-vercel-ip-country / cf-ipcountry). */
  pais: string | null;
}

export type ResultadoDoColetor = { ok: true; detalhe: Record<string, unknown> } | { ok: false; motivo: string };

const recusa = (motivo: string): ResultadoDoColetor => ({ ok: false, motivo });
const aceito = (detalhe: Record<string, unknown>): ResultadoDoColetor => ({ ok: true, detalhe });

function ehEventoDoCheckout(v: string): v is EventoDoCheckout {
  return (EVENTOS_DO_CHECKOUT as readonly string[]).includes(v);
}

export async function coletarDoCheckout(
  repo: RepositorioDoColetor,
  corpo: CorpoDaPonte,
  ctx: ContextoDoColetor
): Promise<ResultadoDoColetor> {
  const checkoutId = typeof corpo.checkoutId === "string" ? corpo.checkoutId.trim().toLowerCase() : "";
  if (!ehUuid(checkoutId)) return recusa("checkoutId invalido");
  const evento = typeof corpo.evento === "string" ? corpo.evento.trim() : "";
  // A compra vem do webhook da Cakto; o resto do funil das lojas nao existe aqui.
  if (!ehEventoDoCheckout(evento)) return recusa("evento nao vale para checkout");
  const vid = typeof corpo.visitorId === "string" ? corpo.visitorId.trim() : "";
  if (!RE_VID.test(vid)) return recusa("visitorId invalido");

  const checkout = await repo.checkout(checkoutId);
  // So a plataforma com a ponte (HOST_DO_CHECKOUT): o Eve rastreia a compra, mas nao tem a Fase D.
  if (!checkout || !rastreiaCompra(checkout.plataforma) || !HOST_DO_CHECKOUT[checkout.plataforma as IdPlataformaCheckout]) {
    return recusa("checkout desconhecido");
  }
  if (!checkout.ativo) return recusa("checkout pausado");
  const destinos = (await repo.destinos(checkout.id)).filter((d) => d.ativo && d.conta && d.token);
  if (destinos.length === 0) return recusa("rastreamento do checkout desligado");

  const agora = ctx.agoraMs;
  const agoraIso = new Date(agora).toISOString();
  const umaHoraAtras = new Date(agora - UMA_HORA_MS).toISOString();

  // ---- os sinais, validados (nada com "@") ---------------------------------
  const fbp = cookie(corpo.fbp, RE_FBP, 100);
  const fbc = cookie(corpo.fbc, RE_FBC, 300);
  const fbclid = clique(corpo.fbclid, 600);
  const ttclid = clique(corpo.ttclid, MAX_TTCLID);
  const ttp = cookie(corpo.ttp, RE_TTP, 100);
  const gclid = clique(corpo.gclid, 300);
  const ip = ipLimpo(ctx.ip);
  const ua = userAgentLimpo(ctx.userAgent);
  const pagina = urlDaPagina(corpo.pageUrl);
  const utm =
    utmDoCorpo(corpo.utm, agora) ??
    utmDaPagina(typeof corpo.pageUrl === "string" ? corpo.pageUrl.slice(0, CORTE_PAGINA) : null, agora);

  // ---- a identidade: antes dos tetos, como nas lojas -----------------------
  // E o que a compra consulta: um teto de FILA estourado nao pode apagar o
  // clique de quem vai comprar. Identidade nova tem o teto proprio.
  const campos: CamposDaIdentidade = {
    fbp,
    fbc,
    fbclid,
    ttclid,
    ttp,
    gclid,
    client_ip_address: ip,
    client_user_agent: ua,
    ...(utm ? { utm: utm.utm, utm_em: utm.em } : {}),
    updated_at: agoraIso,
    expires_at: new Date(agora + VALIDADE_IDENTIDADE_MS).toISOString(),
  };
  try {
    const existia = await repo.atualizarIdentidade(checkout.id, vid, campos);
    if (!existia) {
      const novas = await repo.identidadesNovas(checkout.id, umaHoraAtras, ctx.ipHash);
      const ipCheio = novas.doIp !== null && novas.doIp >= TETOS_DO_COLETOR.identidadesPorIpHora;
      const checkoutCheio = novas.doCheckout !== null && novas.doCheckout >= TETOS_DO_COLETOR.identidadesHora;
      if (!ipCheio && !checkoutCheio) {
        await repo.inserirIdentidade({ checkout_id: checkout.id, user_id: checkout.user_id, visitor_id: vid, ip_hash: ctx.ipHash, ...campos });
      }
    }
  } catch (e) {
    // Melhor esforco: sem a identidade a compra sai mais pobre, mas sai.
    console.error("[tracking/collect] falha ao gravar a identidade do checkout", e instanceof Error ? e.message : e);
  }

  // ---- tetos (os do coletor das lojas) ------------------------------------
  const [doVisitante, doIp, doCheckout] = await Promise.all([
    repo.contarEnvios({ checkoutId: checkout.id, desde: new Date(agora - UM_DIA_MS).toISOString(), visitorId: vid }),
    ctx.ipHash ? repo.contarEnvios({ checkoutId: checkout.id, desde: umaHoraAtras, ipHash: ctx.ipHash }) : Promise.resolve(null),
    repo.contarEnvios({ checkoutId: checkout.id, desde: umaHoraAtras }),
  ]);
  if ((doVisitante ?? 0) >= TETOS_DO_COLETOR.porVisitanteDia) return aceito({ ignorado: "teto do visitante" });
  // Antes do teto do checkout: o que para aqui nao gasta o balde dele.
  if ((doIp ?? 0) >= TETOS_DO_COLETOR.porIpHora) return aceito({ ignorado: "teto do ip" });
  if ((doCheckout ?? 0) >= TETOS_DO_COLETOR.porCheckoutHora) return aceito({ ignorado: "teto do checkout" });

  // Um InitiateCheckout por visitante em 30 min (janela deslizante; o balde do
  // event_id sozinho deixaria 12:29 e 12:31 sairem como dois).
  if (
    evento === "begin_checkout" &&
    (await repo.inicioDesde(checkout.id, vid, new Date(agora - JANELA_DA_PONTE_MS).toISOString()))
  ) {
    return aceito({ ignorado: "checkout ja iniciado nos ultimos 30 min" });
  }

  // ---- os eventos ---------------------------------------------------------
  const definicao = definicaoDoEvento(evento);
  const eventId = idDoEventoDaPonte(evento, vid, agora);
  // A hora do clique para o fbc montado do fbclid: a do conjunto do clique.
  const cliqueMs = utm ? Math.min(Date.parse(utm.em), agora) : agora;
  const fbcFinal = fbc || montarFbc(fbclid, Number.isFinite(cliqueMs) ? cliqueMs : agora);
  const externalIds = [vid];
  const meta: EventoCapi = {
    event_name: definicao.nomeNoMeta,
    // Em segundos: o Meta recusa milissegundos.
    event_time: Math.floor(agora / 1000),
    event_id: eventId,
    action_source: "website",
    ...(pagina ? { event_source_url: pagina } : {}),
    user_data: montarUserData({ pais: ctx.pais, externalIds }, { fbp, fbc: fbcFinal, clientIp: ip, userAgent: ua }),
  };
  const tiktok: EventoTiktok = montarEventoDeFunilTiktok({
    evento,
    eventId,
    quandoMs: agora,
    user: montarUserTiktok({ externalIds }, { ttclid, ttp, clientIp: ip, userAgent: ua }),
    // page.url e obrigatorio no TikTok: sem a da pagina, o checkout.
    url: pagina || `https://${HOST_DO_CHECKOUT[checkout.plataforma as IdPlataformaCheckout] ?? "pay.cakto.com.br"}/`,
    contentIds: [],
  });

  const linhas: EnvioNovo[] = [];
  for (const d of destinos) {
    const payload = d.plataforma === "tiktok" ? tiktok : meta;
    // A ultima trava antes do CHECK da 073 (que recusaria o insert inteiro).
    if (JSON.stringify(payload).includes("@")) {
      console.error("[tracking/collect] evento do checkout com '@' no payload: nao entra", checkout.id, evento);
      continue;
    }
    linhas.push({
      checkout_id: checkout.id,
      user_id: checkout.user_id,
      destino_id: d.id,
      plataforma: d.plataforma,
      event_name: definicao.nomeNoMeta,
      event_id: eventId,
      grupo: null,
      payload,
      visitor_id: vid,
      ip_hash: ctx.ipHash,
    });
  }

  const gravadas = await repo.enfileirar(linhas);
  const porId = new Map(destinos.map((d) => [d.id, d]));
  const resultados = await repo.entregar(
    gravadas.flatMap((envio) => {
      const destino = porId.get(envio.destino_id);
      return destino ? [{ envio, destino }] : [];
    })
  );
  // Por rede (um pixel por rede no checkout): a resposta e publica, o id do
  // destino nao vai nela.
  const ok = new Map(resultados.map((r) => [r.id, r.ok]));
  const saida: Record<string, string> = {};
  for (const l of linhas) saida[l.plataforma] = "duplicado";
  for (const g of gravadas) saida[g.plataforma] = ok.get(g.id) ? "enviado" : "na fila";
  return aceito({ destinos: saida });
}
