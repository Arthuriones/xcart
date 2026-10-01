// ============================================================================
// A URL da requisicao de conversao do Google Ads.
//
// Modulo proprio, sem "server-only", para poder ser TESTADO: o formato desta
// URL e a unica coisa que decide se a conversao e aceita, e o endpoint responde
// 200 mesmo ignorando o conteudo. Dentro de google-ads.ts, atras do
// `server-only`, nenhum teste conseguiria olhar.
// ============================================================================

import { apenasNumeroDaConversao } from "@/lib/tracking/normalizar";

export interface DadosDaConversao {
  /** AW-XXXXXXXXX, como o lojista copia do Google Ads. */
  conversionId: string;
  label: string;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  auid?: string | null;
  pageUrl?: string | null;
  orderId?: string | null;
  value?: number | null;
  currency?: string | null;
}

/** Null quando falta id ou rotulo -- sem os dois nao ha conversao nenhuma. */
export function montarUrlDeConversao(
  conv: DadosDaConversao,
  agora: number = Date.now()
): string | null {
  const numero = apenasNumeroDaConversao(conv.conversionId);
  const label = (conv.label || "").trim();
  if (!numero || !label) return null;

const url = new URL(`https://www.googleadservices.com/pagead/conversion/${numero}/`);

// ------------------------------------------------------------------------
// O conjunto abaixo foi COPIADO de uma requisicao real do gtag, capturada na
// conta do lojista -- nao inventado.
//
// Antes mandavamos `script=0`, que e o caminho do <noscript> (pixel em
// imagem, sem JavaScript). O gtag de verdade nao manda isso: ele manda
// `en=conversion` com `fmt=7&async=1`. Pedir para ser tratado como pixel
// sem script e uma afirmacao diferente da que queremos fazer.
//
// O que NAO foi copiado, e por que: `gcd`/`tag_exp`/`uaa..uapv` descrevem
// consentimento, experimentos e o navegador -- valores que so o navegador
// sabe e que inventados seriam mentira; `em`/`emd`/`ept` sao os campos de
// enhanced conversions, que a gente nao preenche (ver o cabecalho).
// ------------------------------------------------------------------------

url.searchParams.set("random", String(agora));
url.searchParams.set("cv", "11");
url.searchParams.set("fst", String(agora));
url.searchParams.set("fmt", "7");
url.searchParams.set("bg", "ffffff");
url.searchParams.set("guid", "ON");
url.searchParams.set("async", "1");
url.searchParams.set("en", "conversion");
url.searchParams.set("frm", "0");
url.searchParams.set("npa", "0");
url.searchParams.set("hn", "www.googleadservices.com");
url.searchParams.set("label", label);

// Um dos tres, nesta ordem de preferencia. O Google nunca manda mais de um
// para o mesmo clique, e mandar dois faria a requisicao ser descartada.
if (conv.gclid) url.searchParams.set("gclaw", conv.gclid);
else if (conv.gbraid) url.searchParams.set("gbraid", conv.gbraid);
else if (conv.wbraid) url.searchParams.set("wbraid", conv.wbraid);
// `oid` e o transaction id: mesma conversion action + mesmo oid = o Google
// descarta a segunda. E a rede de seguranca contra reentrega de webhook e
// contra o canal nativo mandando a mesma venda.
if (conv.orderId) url.searchParams.set("oid", String(conv.orderId));

// `auid` liga a conversao ao visitante mesmo sem click id. O gtag manda
// sempre; e o que mais aproxima a nossa requisicao da dele.
if (conv.auid) url.searchParams.set("auid", conv.auid);
if (conv.pageUrl) url.searchParams.set("url", conv.pageUrl);
if (typeof conv.value === "number" && Number.isFinite(conv.value)) {
  url.searchParams.set("value", String(conv.value));
}
if (conv.currency) url.searchParams.set("currency_code", conv.currency.toUpperCase());

  return url.toString();
}
