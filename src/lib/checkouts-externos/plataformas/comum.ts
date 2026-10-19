// ============================================================================
// Leitores comuns dos adaptadores (Sphere, Cakto): valor, data, moeda, pais,
// texto e id. Sairam do sphere.ts sem mudar nada do que a Sphere aceita --
// tests/checkout-externo-sphere.test.ts trava. O que a Cakto precisa a mais
// (data com espaco, janela mais longa para o vencimento) vem por opcao.
//
// VALIDACAO DURA: o valor vai direto para o lucro. Numero fora de faixa,
// moeda que nao e ISO, data fora de [-400 dias, +1 dia] e recusado.
//
// Puro: sem banco, sem rede.
// ============================================================================

/** Teto de valor aceito (pedido e comissao). */
export const VALOR_MAXIMO = 100_000;
/** Datas aceitas em volta de agora. */
export const DIAS_PARA_TRAS = 400;
export const DIAS_PARA_FRENTE = 1;

const DIA_MS = 86_400_000;

export type Obj = Record<string, unknown>;

export function ehObjeto(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function texto(v: unknown, max: number): string | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = String(v).replace(/\s+/g, " ").trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * "89.90", "89,90", 89.9 -> 89.9. Vazio/ausente -> 0. Lixo, negativo ou acima
 * do teto -> null (o chamador recusa).
 */
export function lerValor(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return 0;
  let n: number;
  if (typeof v === "number") {
    n = v;
  } else if (typeof v === "string") {
    let s = v.trim();
    // So virgula: decimal europeu ("89,90"). Ponto e virgula juntos: recusa.
    if (s.includes(",") && !s.includes(".")) s = s.replace(",", ".");
    if (!/^\d{1,9}(\.\d{1,6})?$/.test(s)) return null;
    n = Number(s);
  } else {
    return null;
  }
  if (!Number.isFinite(n) || n < 0 || n > VALOR_MAXIMO) return null;
  return Math.round(n * 100) / 100;
}

export interface OpcoesData {
  /**
   * Aceita espaco no lugar do "T" ("2026-09-16 16:46:00.387619+00:00", o
   * vencimento do Pix da Cakto). A Sphere nao: o que ela mandava antes segue
   * sendo o que ela aceita.
   */
  espaco?: boolean;
  /** Janela para a frente (o vencimento do boleto e dias depois). */
  diasParaFrente?: number;
}

/** ISO 8601 com data e hora, dentro da janela aceita. Devolve em UTC. */
export function lerData(v: unknown, agora: Date, opcoes: OpcoesData = {}): string | null {
  if (typeof v !== "string") return null;
  let s = v.trim();
  const formato = opcoes.espaco ? /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
  if (!formato.test(s)) return null;
  if (opcoes.espaco) s = s.replace(" ", "T");
  const ms = Date.parse(s);
  if (!Number.isFinite(ms)) return null;
  const agoraMs = agora.getTime();
  const frente = opcoes.diasParaFrente ?? DIAS_PARA_FRENTE;
  if (ms < agoraMs - DIAS_PARA_TRAS * DIA_MS || ms > agoraMs + frente * DIA_MS) return null;
  return new Date(ms).toISOString();
}

export function lerPedidoId(v: unknown): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v >= 0 ? String(v) : null;
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^[A-Za-z0-9_.:#-]{1,64}$/.test(s) ? s : null;
}

export function lerMoeda(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = v.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(m) ? m : null;
}

export function lerPais(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const p = v.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(p) ? p : null;
}

// ---------------------------------------------------------------------------
// O visitante da ponte (Fase D)
// ---------------------------------------------------------------------------

/** O prefixo que a ponte (xcart-bridge.js) poe antes do vid: `callback=xc.<vid>`. */
export const PREFIXO_VID = "xc.";
/** O formato do _xcb_vid/_xc_vid: base36 + "." + base36 (o CHECK da 073). */
export const RE_VID = /^[A-Za-z0-9]{1,32}\.[A-Za-z0-9]{1,32}$/;

/** "xc.<vid>" -> o vid; qualquer outra coisa (o callback de outro sistema, lixo) -> null. */
export function vidDoParametro(bruto: unknown): string | null {
  const v = typeof bruto === "string" ? bruto.trim() : "";
  return v.startsWith(PREFIXO_VID) && RE_VID.test(v.slice(PREFIXO_VID.length)) ? v.slice(PREFIXO_VID.length) : null;
}
