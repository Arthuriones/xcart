import { MAX_VALOR_UTM, limparValor } from "@/lib/tracking/utm";
import type { CAMPOS_UTM, EstadoPedido } from "./estado";

// ============================================================================
// O postback da Sphere (086): de que anuncio veio a comissao.
//
// O webhook dela nao traz o clique. O postback GET por programa (vaga do
// RedTrack no painel dela) traz o sub1 no `{clickid}` -- nos url_tags do
// Arthur, o id do anuncio do Meta. Ele chega na URL do webhook, com a query
// de SUFIXO_POSTBACK_SPHERE (tipos.ts), e casa com o pedido que o webhook
// gravou. ATRIBUIR ERRADO E PIOR QUE NAO ATRIBUIR, entao:
//
//   1. `{t}` igual ao id do pedido: casa na hora.
//   2. Senao, so DEPOIS de a janela fechar (JANELA_POSTBACK_MS depois da
//      chegada; o cron decide): os pedidos com aviso de pedido criado ou de
//      comissao aprovada a ate JANELA_POSTBACK_MS do postback. Decidir com a
//      janela aberta casava o postback que chegou antes do aviso do proprio
//      pedido com o pedido de outra pessoa.
//   3. Comissao gravada diferente do `{sum}` nao e o pedido.
//   4. Sobrou um: casa. Mais de um: nao casa. Aviso sem pedido gravado ainda
//      (a gravacao estava no meio): espera.
//   5. Recusa (`status=declined`) e InitiateCheckout nem entram.
// Pedido que ja tem origem nao muda (o primeiro que casou fica).
//
// Puro: o banco e src/lib/checkouts-externos/postback-supabase.ts, o teste
// tests/checkout-externo-postback.test.ts.
// ============================================================================

/** Postback e aviso do webhook do mesmo pedido chegam juntos; folga para a retentativa de 10 s dela. */
export const JANELA_POSTBACK_MS = 3 * 60_000;

/** O cron decide o postback ate este prazo; depois, fica pendente (so para conferir o formato). */
export const PRAZO_DECISAO_MS = 24 * 3_600_000;

/** Postback guardado por 30 dias. */
export const RETENCAO_POSTBACK_MS = 30 * 24 * 3_600_000;

/** Os avisos do webhook da Sphere que podem ser o mesmo momento do postback de compra. */
export const EVENTOS_DO_POSTBACK = ["pedido.criado", "comissao.aprovada"] as const;

const RE_ID = /^\d{5,25}$/;
const RE_REF = /^[A-Za-z0-9_-]{1,64}$/;
const RE_RECUSA = /^(declin|reject|refus|cancel|recus)/;

export interface PostbackLido {
  clickid: string | null;
  /** O clickid quando ele e um id de anuncio (so digitos). */
  anuncioId: string | null;
  /** O `{t}`. */
  pedidoRef: string | null;
  soma: number | null;
  moeda: string | null;
  status: string | null;
}

/** GET com clickid ou t = postback; sem eles, alguem abriu a URL no navegador. */
export function ehPostback(q: URLSearchParams): boolean {
  return q.has("clickid") || q.has("t");
}

function texto(q: URLSearchParams, k: string, max: number): string | null {
  const v = limparValor(q.get(k));
  return v ? v.slice(0, max) : null;
}

/**
 * A query do postback, so com o que serve. `ignorado` = nao e compra: o
 * InitiateCheckout so traz o clickid, e a recusa sai na hora da recusa (sem
 * aviso do webhook ao lado para casar).
 */
export function lerPostback(q: URLSearchParams): { ok: true; postback: PostbackLido } | { ok: false; ignorado: string } {
  // So o InitiateCheckout sai: a vaga e "Purchase (COD)"/"Purchase (Cartao)",
  // e um `{type}` que nao seja exatamente "Purchase" ainda e compra.
  const tipo = texto(q, "type", 40);
  if (tipo && /initiat|checkout/i.test(tipo)) return { ok: false, ignorado: "tipo" };
  const status = texto(q, "status", 40)?.toLowerCase() ?? null;
  if (status && RE_RECUSA.test(status)) return { ok: false, ignorado: "status" };
  const clickid = texto(q, "clickid", 200);
  const ref = texto(q, "t", 64);
  const somaTexto = q.get("sum");
  const soma = somaTexto !== null && somaTexto.trim() !== "" ? Number(somaTexto.replace(",", ".")) : NaN;
  const moeda = (q.get("currency") || "").trim().toUpperCase();
  return {
    ok: true,
    postback: {
      clickid,
      anuncioId: clickid && RE_ID.test(clickid) ? clickid : null,
      pedidoRef: ref && RE_REF.test(ref) ? ref : null,
      soma: Number.isFinite(soma) && soma >= 0 && soma <= 100_000 ? Math.round(soma * 100) / 100 : null,
      moeda: /^[A-Z]{3}$/.test(moeda) ? moeda : null,
      status,
    },
  };
}

/** Um pedido do checkout que o postback pode ser. */
export interface CandidatoPostback {
  pedidoId: string;
  /** false = tem aviso, mas o pedido ainda nao foi gravado. */
  gravado: boolean;
  /** A comissao gravada (pedidos_externos.receita); null sem pedido. */
  receita: number | null;
  /** A chegada (ms) de cada aviso de EVENTOS_DO_POSTBACK desse pedido perto do postback. */
  avisosMs: number[];
}

export type Casamento =
  | { tipo: "casado"; pedidoId: string }
  | { tipo: "ambiguo" }
  | { tipo: "nenhum" }
  /** Aviso cujo pedido ainda nao esta gravado: decide na proxima passada. */
  | { tipo: "esperar" };

/** O pedido do postback pelo `{t}` (na hora, a janela aberta nao importa). */
export function casarPeloId(pedidoRef: string | null, candidatos: CandidatoPostback[]): string | null {
  if (!pedidoRef) return null;
  return candidatos.find((c) => c.gravado && c.pedidoId === pedidoRef)?.pedidoId ?? null;
}

/** O pedido do postback com a janela JA FECHADA (quem chama confere), ou por que nao casou. */
export function casarPostback(
  p: { recebidoMs: number; pedidoRef: string | null; soma: number | null },
  candidatos: CandidatoPostback[]
): Casamento {
  const exato = casarPeloId(p.pedidoRef, candidatos);
  if (exato) return { tipo: "casado", pedidoId: exato };
  const naJanela = candidatos.filter((c) => c.avisosMs.some((ms) => Math.abs(ms - p.recebidoMs) <= JANELA_POSTBACK_MS));
  // Comissao gravada diferente do {sum}: nao e o pedido.
  const compativeis =
    p.soma === null ? naJanela : naJanela.filter((c) => c.receita === null || Math.abs(c.receita - p.soma!) < 0.005);
  if (compativeis.some((c) => !c.gravado)) return { tipo: "esperar" };
  if (compativeis.length === 0) return { tipo: "nenhum" };
  if (compativeis.length === 1) return { tipo: "casado", pedidoId: compativeis[0].pedidoId };
  return { tipo: "ambiguo" };
}

/** O anuncio como a sincronizacao do Meta o conhece (ad_insights_granular). */
export interface AnuncioConhecido {
  plataforma: string | null;
  anuncioNome: string | null;
  conjuntoId: string | null;
  conjuntoNome: string | null;
  campanhaId: string | null;
  campanhaNome: string | null;
}

const ORIGEM_DA_PLATAFORMA: Record<string, string> = { meta: "facebook", google: "google", tiktok: "tiktok" };

/**
 * "nome|id" (o formato que o resto do xcart le, src/lib/tracking/utm.ts),
 * so o id quando o nome nao serve. O nome e cortado antes: o corte do
 * limparValor no fim levaria o id.
 */
function nomeEId(nome: string | null, id: string | null): string | null {
  if (!id) return null;
  const n = limparValor(nome)?.slice(0, MAX_VALOR_UTM - id.length - 1).trim();
  return n ? `${n}|${id}` : id;
}

/** A UTM e os ids que o pedido ganha do anuncio do postback. */
export function origemDoAnuncio(
  anuncioId: string,
  a: AnuncioConhecido | null
): Pick<EstadoPedido, (typeof CAMPOS_UTM)[number]> {
  const conjunto = a?.conjuntoId && RE_ID.test(a.conjuntoId) ? a.conjuntoId : null;
  const campanha = a?.campanhaId && RE_ID.test(a.campanhaId) ? a.campanhaId : null;
  return {
    utm_source: (a?.plataforma && ORIGEM_DA_PLATAFORMA[a.plataforma]) || null,
    utm_medium: nomeEId(a?.conjuntoNome ?? null, conjunto),
    utm_campaign: nomeEId(a?.campanhaNome ?? null, campanha),
    utm_content: nomeEId(a?.anuncioNome ?? null, anuncioId),
    utm_term: null,
    campanha_id: campanha,
    conjunto_id: conjunto,
    anuncio_id: anuncioId,
  };
}
