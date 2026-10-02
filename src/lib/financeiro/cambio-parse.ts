// ============================================================================
// Cambio diario: parse das duas fontes, puro (o vitest importa sem servidor).
//
// fx_rates guarda "unidades da moeda por 1 USD". Frankfurter (BCE e outros
// bancos centrais) cobre todas as moedas; a PTAX de fechamento do BCB e a
// referencia oficial do BRL e sobrescreve o BRL do mesmo dia.
// ============================================================================

import { RE_DIA, RE_MOEDA, type FxRateRow } from "./tipos";

/** So o que uma loja ou conta de anuncio do Arthur pode usar; o resto e ruido. */
export const MOEDAS_GUARDADAS: readonly string[] = [
  "BRL", "EUR", "GBP", "CAD", "AUD", "NZD", "CHF", "SEK", "NOK", "DKK",
  "PLN", "CZK", "HUF", "RON", "JPY", "CNY", "HKD", "SGD", "MXN", "CLP",
  "COP", "PEN", "ARS", "UYU", "PYG", "ZAR", "AED", "INR", "TRY", "ILS",
];

const GUARDADAS = new Set(MOEDAS_GUARDADAS);

function taxaValida(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : Number.NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

/**
 * Frankfurter v2: array de { date, base, quote, rate }. Base tem que ser USD
 * (pedimos base=USD; se vier outra, a conta sairia invertida sem ninguem ver).
 * Entrada que nao e array vira [] -- quem chama decide o que fazer sem dado.
 */
export function parseFrankfurterV2(json: unknown): FxRateRow[] {
  if (!Array.isArray(json)) return [];
  const saida: FxRateRow[] = [];
  for (const item of json) {
    if (!ehObjeto(item)) continue;
    const { date, base, quote } = item;
    const rate = taxaValida(item.rate);
    if (base !== "USD") continue;
    if (typeof date !== "string" || !RE_DIA.test(date)) continue;
    if (typeof quote !== "string" || !RE_MOEDA.test(quote) || !GUARDADAS.has(quote)) continue;
    if (rate === null) continue;
    saida.push({ data: date, moeda: quote, por_usd: rate, fonte: "frankfurter" });
  }
  return saida;
}

/**
 * PTAX (Olinda/BCB, CotacaoMoedaPeriodo): { value: [{ cotacaoVenda,
 * dataHoraCotacao: "AAAA-MM-DD hh:mm:ss.sss", tipoBoletim }] }. So o boletim
 * de Fechamento; os intermediarios do dia mudariam o valor conforme a hora do
 * cron. Mais de um registro no dia: o ultimo vence.
 */
export function parsePtax(json: unknown): FxRateRow[] {
  if (!ehObjeto(json) || !Array.isArray(json.value)) return [];
  const porDia = new Map<string, FxRateRow>();
  for (const item of json.value) {
    if (!ehObjeto(item)) continue;
    if (item.tipoBoletim !== "Fechamento") continue;
    if (typeof item.dataHoraCotacao !== "string") continue;
    const data = item.dataHoraCotacao.slice(0, 10);
    if (!RE_DIA.test(data)) continue;
    const venda = taxaValida(item.cotacaoVenda);
    if (venda === null) continue;
    porDia.set(data, { data, moeda: "BRL", por_usd: venda, fonte: "ptax" });
  }
  return [...porDia.values()];
}

/**
 * Junta as fontes: PTAX vence no BRL do mesmo dia, e todo dia presente ganha
 * USD = 1. Sem a linha do USD, converter de/para USD exigiria caso especial em
 * todo leitor.
 */
export function mesclarCambio(frank: FxRateRow[], ptax: FxRateRow[]): FxRateRow[] {
  const porChave = new Map<string, FxRateRow>();
  for (const r of frank) porChave.set(`${r.data}|${r.moeda}`, r);
  for (const r of ptax) porChave.set(`${r.data}|${r.moeda}`, r);

  const dias = new Set<string>();
  for (const r of porChave.values()) dias.add(r.data);
  for (const data of dias) {
    porChave.set(`${data}|USD`, { data, moeda: "USD", por_usd: 1, fonte: "frankfurter" });
  }

  return [...porChave.values()].sort((a, b) =>
    a.data !== b.data ? (a.data < b.data ? -1 : 1) : a.moeda < b.moeda ? -1 : a.moeda > b.moeda ? 1 : 0
  );
}

/** "AAAA-MM-DD" -> "MM-DD-AAAA", o formato que o Olinda/BCB pede. */
export function dataPtax(dia: string): string {
  const [ano, mes, d] = dia.split("-");
  return `${mes}-${d}-${ano}`;
}
