import { definicaoDoEvento, type ChaveEvento } from "@/lib/tracking/eventos";
import type { UserTiktok } from "@/lib/tracking/normalizar";

// ============================================================================
// O evento da Events API do TikTok, como fica na fila.
//
// Puro de proposito, como purchase.ts: o coletor e o webhook so montam, a fila
// so entrega. O envio (com o token) mora em tiktok-api.ts.
//
// A linha da fila guarda UM evento (o item de `data[]`); o corpo inteiro --
// event_source, event_source_id (o Pixel Code) e test_event_code -- e montado
// na hora de mandar, com o destino em maos. Igual ao Meta, que guarda o evento
// e recebe o pixel e o token so no envio.
// ============================================================================

export interface ConteudoTiktok {
  content_id: string;
  quantity?: number;
  /** Preco PAGO por unidade. `value` e o total. */
  price?: number;
}

export interface EventoTiktok {
  /** Nome padrao do TikTok ("AddToCart"), nunca a nossa chave. */
  event: string;
  /** Em SEGUNDOS, UTC. */
  event_time: number;
  /** O MESMO do Meta: a dedupe do TikTok e por pixel + evento + event_id. */
  event_id: string;
  user: UserTiktok;
  /** Obrigatorio para web: sem `page.url` o TikTok recusa o evento. */
  page: { url: string };
  properties?: {
    content_type?: "product" | "product_group";
    contents?: ConteudoTiktok[];
    currency?: string;
    value?: number;
    order_id?: string;
    num_items?: number;
  };
}

/**
 * As moedas que a Events API aceita (lista fechada da documentacao, 06/10/2026).
 *
 * Fora dela o comportamento nao esta documentado -- recusa (40002, que a fila
 * trata como permanente) ou descarte. Perder a COMPRA inteira por causa da
 * moeda e pior que perder o valor, entao fora da lista a compra sai sem
 * value/currency: conta como conversao, so nao entra no ROAS.
 */
export const MOEDAS_TIKTOK: ReadonlySet<string> = new Set([
  "AED", "ARS", "AUD", "BDT", "BHD", "BIF", "BOB", "BRL", "CAD", "CHF", "CLP",
  "CNY", "COP", "CRC", "CZK", "DKK", "DZD", "EGP", "EUR", "GBP", "GTQ", "HKD",
  "HNL", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KES", "KHR", "KRW", "KWD",
  "KZT", "MAD", "MOP", "MXN", "MYR", "NGN", "NIO", "NOK", "NZD", "OMR", "PEN",
  "PHP", "PKR", "PLN", "PYG", "QAR", "RON", "RUB", "SAR", "SEK", "SGD", "THB",
  "TRY", "TWD", "UAH", "USD", "VES", "VND", "ZAR",
]);

/**
 * `product_group` quando o id e do PRODUTO (o item_group_id do catalogo do
 * TikTok); `product` quando e da variante ou do SKU. Errado, o evento nao casa
 * com o catalogo e nenhum erro aparece.
 */
export function tipoDeConteudoTiktok(idTemplate: string | null | undefined): "product" | "product_group" {
  const t = (idTemplate || "").trim();
  return t.includes("{product_id}") && !t.includes("{variant_id}") && !t.includes("{sku}")
    ? "product_group"
    : "product";
}

/**
 * A `page.url` sem o ttclid. O TikTok tambem le o clique dali, e ali ele pode
 * estar CORTADO (a Shopify corta o landing_site em 255, o coletor a URL em
 * 500). Inteiro, ele ja vai em `user.ttclid`.
 */
export function urlSemTtclid(url: string): string {
  try {
    const u = new URL(url);
    if (!u.searchParams.has("ttclid")) return url;
    u.searchParams.delete("ttclid");
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * Um evento de funil (ver produto, carrinho, checkout, pagamento).
 *
 * SEM value e SEM currency: estes vem do coletor, que e publico -- valor dali
 * seria numero que qualquer um infla na conta de anuncios do lojista. So o
 * id do produto vai, como no Meta.
 */
export function montarEventoDeFunilTiktok(entrada: {
  evento: ChaveEvento;
  eventId: string;
  quandoMs: number;
  user: UserTiktok;
  /** URL da pagina (com os parametros: o TikTok le o ttclid dela tambem). */
  url: string;
  /** Ids ja no formato do catalogo do destino (template de id). */
  contentIds: string[];
  idTemplate?: string | null;
}): EventoTiktok {
  const evento: EventoTiktok = {
    event: definicaoDoEvento(entrada.evento).nomeNoTiktok,
    event_time: Math.floor(entrada.quandoMs / 1000),
    event_id: entrada.eventId,
    user: entrada.user,
    page: { url: urlSemTtclid(entrada.url) },
  };
  if (entrada.contentIds.length) {
    evento.properties = {
      content_type: tipoDeConteudoTiktok(entrada.idTemplate),
      contents: entrada.contentIds.map((id) => ({ content_id: id })),
    };
  }
  return evento;
}
