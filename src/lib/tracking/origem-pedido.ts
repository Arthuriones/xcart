import {
  JANELA_ORIGEM_MS,
  caminhoDeEntrada,
  cliquesDeParametros,
  cliquesDosAtributos,
  instanteDoFbc,
  limparValor,
  niveisDoAnuncio,
  parametrosDaUrl,
  plataformaDe,
  plataformaDoClique,
  temUtm,
  utmDeParametros,
  utmDosAtributos,
  type AtributoDoPedido,
  type Cliques,
  type NiveisAnuncio,
  type PlataformaAnuncio,
  type PlataformaOrigem,
  type Utm,
} from "./utm";

// ============================================================================
// De qual campanha, conjunto e anuncio veio o pedido -- gravado NO PEDIDO
// (fin_order_origem, migration 071), na hora em que ele chega.
//
// Puro (sem "server-only"): quem grava e origem-banco.ts, e o vitest trava as
// regras em tests/tracking-origem-pedido.test.ts.
//
// QUATRO FONTES, da mais confiavel para a menos:
//
//   1. jornada   -- customerJourneySummary da Shopify, so no sync (o webhook
//                   nao traz): UTMs inteiras da ultima e da primeira visita.
//   2. landing   -- landing_site do pedido, so no webhook. Cortado em 255: com
//                   o fbclid do Meta na frente (~200 caracteres), a campanha
//                   sobreviveu em 0 de 23 pedidos medidos. Serve para o
//                   Google e para o nosso modelo, que poe as UTMs antes.
//   3. atributo  -- _xc_utm_* que o snippet do tema e a ponte gravam no
//                   carrinho (com a hora do clique), ou utm_* de app de COD.
//   4. identidade -- tracking_identities.utm, achada pela MESMA cascata do
//                   Purchase (visitante do carrinho, checkout -> clientId).
//                   E o que cobre pedido sem atributo e sem jornada.
//
// QUAL VENCE: o ultimo clique.
//   - Toque da SESSAO que virou o pedido (ultima visita da jornada, URL de
//     chegada, atributo de app) vence: e por definicao o ultimo. Entre eles,
//     a fonte mais confiavel.
//   - Sem ele, o toque com hora mais recente (primeira visita, cookie,
//     identidade). Empate de ate 1 h e a mesma visita: fonte mais confiavel.
//   - Toque com hora so vale ate 7 DIAS antes do pedido (JANELA_ORIGEM_MS).
//     O cookie e a identidade duram 90 dias: sem a janela, a compra organica
//     na volta herdaria um anuncio de meses atras.
//
// O vencedor incompleto (o landing cortado tem a plataforma mas nao a
// campanha) e COMPLETADO por outro toque da mesma plataforma e da mesma
// campanha (quando ele sabe a campanha): um so, o mais proximo do pedido.
//
// So click id, sem UTM (cart attribute gclid, cookie _fbc): diz a plataforma,
// sem campanha. O _fbc carrega a hora do clique, e fora da janela nao conta.
// Nada de anuncio mas visita registrada: "Direto". Nada mesmo: sem linha (a
// tela diz "Sem dado").
//
// SEM DADO PESSOAL: so UTMs, ids e o caminho da pagina de entrada.
// ============================================================================

export type FonteOrigem = "jornada" | "landing" | "atributo" | "identidade";

/** Da mais confiavel para a menos. */
export const FONTES_ORIGEM: readonly FonteOrigem[] = ["jornada", "landing", "atributo", "identidade"];

/** Dois toques com menos que isto entre eles sao a mesma visita. */
export const MESMA_VISITA_MS = 60 * 60 * 1000;

export interface Toque {
  fonte: FonteOrigem;
  /** Da sessao que virou o pedido: ultima visita, URL de chegada, atributo de app. */
  sessao: boolean;
  /** Hora do clique ou da visita (ISO). Toque fora da sessao sem hora nao vale. */
  em: string | null;
  utm: Utm;
  cliques: Cliques;
  /** Caminho da pagina de entrada (caminhoDeEntrada). */
  pagina: string | null;
  /** Ja resolvidos: a origem gravada que volta como toque. */
  plataforma?: PlataformaOrigem | null;
  niveis?: NiveisAnuncio;
}

/** Um click id sem UTM nem hora confiavel: so diz a plataforma. */
export interface CliqueSolto {
  fonte: FonteOrigem;
  plataforma: PlataformaAnuncio;
}

export interface VisitaSemAnuncio {
  fonte: FonteOrigem;
  pagina: string | null;
  em: string | null;
}

/** A origem do pedido: as colunas de fin_order_origem, sem as chaves. */
export interface OrigemDoPedido {
  fonte: FonteOrigem;
  sessao: boolean;
  /** null = visita sem anuncio ("Direto"). */
  plataforma: PlataformaOrigem | null;
  /** Click id visto em qualquer fonte (dentro da janela, quando da para saber). */
  clique: PlataformaAnuncio | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  utm_term: string | null;
  campanha_id: string | null;
  conjunto_id: string | null;
  anuncio_id: string | null;
  posicionamento: string | null;
  toque_em: string | null;
  pagina_entrada: string | null;
}

export interface LinhaOrigem extends OrigemDoPedido {
  store_id: string;
  user_id: string;
  shopify_order_id: string;
  /** createdAt do pedido. */
  pedido_em: string;
  atualizado_em?: string;
}

/** Os campos de OrigemDoPedido, na ordem: comparar e gravar sempre os mesmos. */
export const CAMPOS_ORIGEM = [
  "fonte",
  "sessao",
  "plataforma",
  "clique",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "campanha_id",
  "conjunto_id",
  "anuncio_id",
  "posicionamento",
  "toque_em",
  "pagina_entrada",
] as const satisfies readonly (keyof OrigemDoPedido)[];

// ---------------------------------------------------------------------------
// Escolha
// ---------------------------------------------------------------------------

function ms(iso: string | null | undefined): number {
  const v = iso ? Date.parse(iso) : Number.NaN;
  return Number.isFinite(v) ? v : Number.NaN;
}

/** Na janela: ate 7 dias antes do pedido (e ate 1 dia depois, para relogio de navegador adiantado). */
export function naJanela(em: string | null | undefined, pedidoMs: number): boolean {
  const t = ms(em);
  return Number.isFinite(t) && t >= pedidoMs - JANELA_ORIGEM_MS && t <= pedidoMs + 864e5;
}

function resolver(t: Toque): { plataforma: PlataformaOrigem | null; niveis: NiveisAnuncio } {
  const plataforma = t.plataforma !== undefined ? t.plataforma : plataformaDe(t.utm, t.cliques);
  return { plataforma, niveis: t.niveis ?? niveisDoAnuncio(t.utm, plataforma) };
}

function temSinal(t: Toque): boolean {
  return temUtm(t.utm) || plataformaDoClique(t.cliques) !== null || Boolean(t.plataforma);
}

function valido(t: Toque, pedidoMs: number): boolean {
  if (!temSinal(t)) return false;
  // Da sessao do pedido: vale mesmo sem hora. Fora dela, so com hora e na janela.
  if (t.sessao) return !t.em || naJanela(t.em, pedidoMs);
  return naJanela(t.em, pedidoMs);
}

function ordemDaFonte(f: FonteOrigem): number {
  return FONTES_ORIGEM.indexOf(f);
}

/** O toque que vale (ver cabecalho), ou null. Os toques chegam em qualquer ordem. */
export function escolherToque(toques: readonly Toque[], pedidoMs: number): Toque | null {
  const validos = ordenar(toques).filter((t) => valido(t, pedidoMs));
  const daSessao = validos.find((t) => t.sessao);
  if (daSessao) return daSessao;
  let melhor: Toque | null = null;
  for (const t of validos) {
    if (!melhor || ms(t.em) > ms(melhor.em) + MESMA_VISITA_MS) melhor = t;
  }
  return melhor;
}

/** Pela fonte; mesma fonte, a ordem de chegada (o novo antes do gravado). */
function ordenar(toques: readonly Toque[]): Toque[] {
  return toques
    .map((t, i) => ({ t, i }))
    .sort((a, b) => ordemDaFonte(a.t.fonte) - ordemDaFonte(b.t.fonte) || a.i - b.i)
    .map((x) => x.t);
}

const NIVEIS = ["campanha", "conjunto", "anuncio", "posicionamento"] as const;
const RAW = ["source", "medium", "campaign", "content", "term"] as const;

/**
 * A origem do pedido a partir dos toques, dos click ids soltos e da visita.
 * null = nada para gravar.
 */
export function calcularOrigem(e: {
  pedidoEm: string | null | undefined;
  toques: readonly Toque[];
  cliques?: readonly CliqueSolto[];
  visita?: VisitaSemAnuncio | null;
  /** Agora, para pedido sem data (nao deveria acontecer). */
  agoraMs?: number;
}): OrigemDoPedido | null {
  const pedidoMsBruto = ms(e.pedidoEm);
  const pedidoMs = Number.isFinite(pedidoMsBruto) ? pedidoMsBruto : (e.agoraMs ?? Date.now());
  const validos = ordenar(e.toques).filter((t) => valido(t, pedidoMs));
  const escolhido = escolherToque(validos, pedidoMs);

  const clique =
    plataformaDoClique(escolhido?.cliques) ??
    validos.map((t) => plataformaDoClique(t.cliques)).find(Boolean) ??
    [...(e.cliques ?? [])].sort((a, b) => ordemDaFonte(a.fonte) - ordemDaFonte(b.fonte))[0]?.plataforma ??
    null;

  if (escolhido) {
    const base = resolver(escolhido);
    const niveis: NiveisAnuncio = { ...base.niveis };
    const utm: Utm = { ...escolhido.utm };

    // Completar o vencedor incompleto com UM toque da mesma plataforma (e da
    // mesma campanha, quando o vencedor sabe a campanha): o da sessao, ou o
    // mais proximo do pedido.
    const falta = NIVEIS.some((k) => !niveis[k]);
    if (falta && base.plataforma && base.plataforma !== "outra") {
      const par = validos
        .filter((t) => t !== escolhido)
        .map((t) => ({ t, r: resolver(t) }))
        .filter(
          ({ r }) =>
            r.plataforma === base.plataforma &&
            (!niveis.campanha || r.niveis.campanha === niveis.campanha) &&
            NIVEIS.some((k) => !niveis[k] && r.niveis[k])
        )
        .sort((a, b) => Number(b.t.sessao) - Number(a.t.sessao) || (ms(b.t.em) || 0) - (ms(a.t.em) || 0))[0];
      if (par) {
        for (const k of NIVEIS) if (!niveis[k]) niveis[k] = par.r.niveis[k];
        for (const k of RAW) if (!utm[k]) utm[k] = par.t.utm[k] ?? null;
      }
    }

    return {
      fonte: escolhido.fonte,
      sessao: escolhido.sessao,
      plataforma: base.plataforma ?? clique,
      clique,
      utm_source: utm.source ?? null,
      utm_medium: utm.medium ?? null,
      utm_campaign: utm.campaign ?? null,
      utm_content: utm.content ?? null,
      utm_term: utm.term ?? null,
      campanha_id: niveis.campanha,
      conjunto_id: niveis.conjunto,
      anuncio_id: niveis.anuncio,
      posicionamento: niveis.posicionamento,
      toque_em: escolhido.em,
      pagina_entrada: escolhido.pagina ?? e.visita?.pagina ?? null,
    };
  }

  const fonteDoClique = clique
    ? [...(e.cliques ?? [])].sort((a, b) => ordemDaFonte(a.fonte) - ordemDaFonte(b.fonte))[0]?.fonte
    : null;
  if (clique || e.visita) {
    return {
      fonte: fonteDoClique ?? e.visita?.fonte ?? "atributo",
      sessao: !clique,
      plataforma: clique,
      clique,
      utm_source: null,
      utm_medium: null,
      utm_campaign: null,
      utm_content: null,
      utm_term: null,
      campanha_id: null,
      conjunto_id: null,
      anuncio_id: null,
      posicionamento: null,
      toque_em: clique ? null : (e.visita?.em ?? null),
      pagina_entrada: e.visita?.pagina ?? null,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// A origem gravada volta como toque: o webhook grava, o sync completa
// ---------------------------------------------------------------------------

/** A origem gravada como toque. So clique ou visita sem anuncio: null (entram por `cliques` e `visita`). */
export function toqueDaGravada(o: OrigemDoPedido): Toque | null {
  const utm: Utm = {
    source: o.utm_source,
    medium: o.utm_medium,
    campaign: o.utm_campaign,
    content: o.utm_content,
    term: o.utm_term,
  };
  const temNivel = Boolean(o.campanha_id || o.conjunto_id || o.anuncio_id);
  if (!temUtm(utm) && !temNivel) return null;
  return {
    fonte: o.fonte,
    sessao: o.sessao,
    em: o.toque_em,
    utm,
    cliques: {},
    pagina: o.pagina_entrada,
    plataforma: o.plataforma,
    niveis: {
      campanha: o.campanha_id,
      conjunto: o.conjunto_id,
      anuncio: o.anuncio_id,
      posicionamento: o.posicionamento,
    },
  };
}

/**
 * A origem nova contra a gravada, pela mesma regra: a do webhook (URL de
 * chegada, identidade) e a do sync (jornada) se completam em vez de uma
 * apagar a outra.
 */
export function mesclarOrigens(
  nova: OrigemDoPedido,
  gravada: OrigemDoPedido | null | undefined,
  pedidoEm: string | null | undefined
): OrigemDoPedido {
  if (!gravada) return nova;
  const as = [nova, gravada];
  const toques = as.map(toqueDaGravada).filter((t): t is Toque => t !== null);
  const cliques = as
    .filter((o) => o.clique)
    .map((o) => ({ fonte: o.fonte, plataforma: o.clique as PlataformaAnuncio }));
  const direta = as.find((o) => !o.plataforma && !o.clique) ?? null;
  return (
    calcularOrigem({
      pedidoEm,
      toques,
      cliques,
      visita: direta ? { fonte: direta.fonte, pagina: direta.pagina_entrada, em: direta.toque_em } : null,
    }) ?? nova
  );
}

export function mesmaOrigem(a: OrigemDoPedido | null | undefined, b: OrigemDoPedido | null | undefined): boolean {
  if (!a || !b) return a === b;
  return CAMPOS_ORIGEM.every((k) => {
    const x = a[k] ?? null;
    const y = b[k] ?? null;
    if (k === "toque_em" && x && y) return ms(x as string) === ms(y as string);
    return x === y;
  });
}

// ---------------------------------------------------------------------------
// Toques de cada lugar
// ---------------------------------------------------------------------------

/** Click id solto, com o _fbc fora da janela descartado (ele diz quando foi o clique). */
function cliqueSolto(fonte: FonteOrigem, c: Cliques, pedidoMs: number): CliqueSolto | null {
  const quando = instanteDoFbc(c.fbc);
  const fbcVelho = quando !== null && !naJanela(new Date(quando).toISOString(), pedidoMs);
  const fbclidDoFbc = c.fbc ? String(c.fbc).split(".").slice(3).join(".") : null;
  const limpo: Cliques = {
    ...c,
    fbc: fbcVelho ? null : c.fbc,
    // O mesmo clique do _fbc velho: tambem velho.
    fbclid: fbcVelho && c.fbclid === fbclidDoFbc ? null : c.fbclid,
  };
  const plataforma = plataformaDoClique(limpo);
  return plataforma ? { fonte, plataforma } : null;
}

function toquesDosAtributos(lista: readonly AtributoDoPedido[] | null | undefined, pagina: string | null): Toque[] {
  const { nosso, externo } = utmDosAtributos(lista);
  const toques: Toque[] = [];
  // De app (Releasit): da sessao do pedido.
  if (externo) toques.push({ fonte: "atributo", sessao: true, em: null, utm: externo, cliques: {}, pagina });
  // Do snippet/ponte: o clique tem hora, e vale a janela.
  if (nosso) toques.push({ fonte: "atributo", sessao: false, em: nosso.em, utm: nosso.utm, cliques: {}, pagina: null });
  return toques;
}

/** O recorte do pedido do webhook (orders/create) que a origem le. */
export interface PedidoDoWebhook {
  id?: number | string | null;
  created_at?: string | null;
  landing_site?: string | null;
  note_attributes?: { name?: string | null; value?: string | null }[] | null;
}

/** O que a identidade recuperada sabe do clique (ver identidade-do-pedido.ts). */
export interface IdentidadeDaOrigem {
  utm?: Utm | null;
  utmEm?: string | null;
  fbclid?: string | null;
  fbc?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  ttclid?: string | null;
}

/**
 * A origem no webhook orders/create: URL de chegada, atributos e a identidade
 * que a cascata do Purchase achou. null = nada para gravar.
 */
export function origemDoWebhook(
  pedido: PedidoDoWebhook,
  identidade: IdentidadeDaOrigem | null | undefined,
  agoraMs = Date.now()
): OrigemDoPedido | null {
  const pedidoMs = Number.isFinite(ms(pedido.created_at)) ? ms(pedido.created_at) : agoraMs;
  const toques: Toque[] = [];
  const cliques: CliqueSolto[] = [];
  let visita: VisitaSemAnuncio | null = null;

  const landing = (pedido.landing_site || "").trim();
  if (landing) {
    const p = parametrosDaUrl(landing, true);
    const pagina = caminhoDeEntrada(landing);
    toques.push({
      fonte: "landing",
      sessao: true,
      em: null,
      utm: utmDeParametros(p),
      cliques: cliquesDeParametros(p),
      pagina,
    });
    visita = { fonte: "landing", pagina, em: null };
  }

  const atributos = (pedido.note_attributes || []).map((a) => ({ name: a?.name, value: a?.value }));
  toques.push(...toquesDosAtributos(atributos, visita?.pagina ?? null));
  const doCarrinho = cliqueSolto("atributo", cliquesDosAtributos(atributos), pedidoMs);
  if (doCarrinho) cliques.push(doCarrinho);

  if (identidade) {
    if (identidade.utm && temUtm(identidade.utm) && identidade.utmEm) {
      toques.push({
        fonte: "identidade",
        sessao: false,
        em: identidade.utmEm,
        utm: limparUtm(identidade.utm),
        cliques: {},
        pagina: null,
      });
    }
    const daIdentidade = cliqueSolto(
      "identidade",
      {
        fbclid: identidade.fbclid,
        fbc: identidade.fbc,
        gclid: identidade.gclid,
        gbraid: identidade.gbraid,
        wbraid: identidade.wbraid,
        ttclid: identidade.ttclid,
      },
      pedidoMs
    );
    if (daIdentidade) cliques.push(daIdentidade);
  }

  return calcularOrigem({ pedidoEm: pedido.created_at, toques, cliques, visita, agoraMs });
}

/** Utm vinda do banco (jsonb): so as chaves conhecidas, limpas de novo. */
export function limparUtm(u: Utm | Record<string, unknown> | null | undefined): Utm {
  const o = (u && typeof u === "object" ? u : {}) as Record<string, unknown>;
  const saida: Utm = {};
  for (const k of ["source", "medium", "campaign", "content", "term", "id", "gad"] as const) {
    const v = limparValor(o[k]);
    if (v) saida[k] = v;
  }
  return saida;
}

/** Uma visita da jornada da Shopify (CustomerVisit). */
export interface VisitaShopify {
  occurredAt?: string | null;
  landingPage?: string | null;
  utmParameters?: {
    source?: string | null;
    medium?: string | null;
    campaign?: string | null;
    content?: string | null;
    term?: string | null;
  } | null;
}

/** customerJourneySummary do pedido. Sem `ready`, a Shopify ainda nao montou. */
export interface JornadaShopify {
  ready?: boolean | null;
  firstVisit?: VisitaShopify | null;
  lastVisit?: VisitaShopify | null;
}

function toqueDaVisita(v: VisitaShopify, sessao: boolean): Toque {
  // utmParameters vem inteiro; a URL completa o utm_id e o gad_campaignid,
  // que nao estao nele, e os click ids.
  const p = parametrosDaUrl(v.landingPage);
  const daUrl = utmDeParametros(p);
  const u = v.utmParameters || {};
  const utm: Utm = {
    source: limparValor(u.source) ?? daUrl.source ?? null,
    medium: limparValor(u.medium) ?? daUrl.medium ?? null,
    campaign: limparValor(u.campaign) ?? daUrl.campaign ?? null,
    content: limparValor(u.content) ?? daUrl.content ?? null,
    term: limparValor(u.term) ?? daUrl.term ?? null,
    id: daUrl.id ?? null,
    gad: daUrl.gad ?? null,
  };
  return {
    fonte: "jornada",
    sessao,
    em: limparValor(v.occurredAt),
    utm,
    cliques: cliquesDeParametros(p),
    pagina: caminhoDeEntrada(v.landingPage),
  };
}

/**
 * A origem no sync de pedidos: a jornada da Shopify (so pronta, `ready`) e os
 * atributos do pedido. A identidade nao entra: e do webhook, e a gravacao
 * mescla as duas (mesclarOrigens).
 */
export function origemDoSync(
  no: {
    createdAt?: string | null;
    customAttributes?: readonly AtributoDoPedido[] | null;
    customerJourneySummary?: JornadaShopify | null;
  },
  agoraMs = Date.now()
): OrigemDoPedido | null {
  const pedidoMs = Number.isFinite(ms(no.createdAt)) ? ms(no.createdAt) : agoraMs;
  const toques: Toque[] = [];
  const cliques: CliqueSolto[] = [];
  let visita: VisitaSemAnuncio | null = null;

  const j = no.customerJourneySummary;
  if (j?.ready) {
    // A ultima visita e a sessao que virou o pedido. Sem ela, a primeira e um
    // toque com hora, que vale a janela.
    if (j.lastVisit) toques.push(toqueDaVisita(j.lastVisit, true));
    if (j.firstVisit) toques.push(toqueDaVisita(j.firstVisit, false));
    const v = j.lastVisit ?? j.firstVisit;
    if (v) visita = { fonte: "jornada", pagina: caminhoDeEntrada(v.landingPage), em: limparValor(v.occurredAt) };
  }

  toques.push(...toquesDosAtributos(no.customAttributes, visita?.pagina ?? null));
  const doCarrinho = cliqueSolto("atributo", cliquesDosAtributos(no.customAttributes), pedidoMs);
  if (doCarrinho) cliques.push(doCarrinho);

  return calcularOrigem({ pedidoEm: no.createdAt, toques, cliques, visita, agoraMs });
}
