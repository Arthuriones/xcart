import {
  montarFbc,
  montarUserData,
  type UserData,
} from "@/lib/tracking/normalizar";
import type { EventoCapi } from "@/lib/tracking/meta-capi";

// ============================================================================
// Pedido da Shopify -> evento Purchase do CAPI.
//
// Funcao pura de proposito: o webhook so entrega o payload e grava o
// resultado. Assim da para testar contra um pedido de verdade sem rede.
// ============================================================================

/** Recorte do payload de orders/create que interessa aqui. */
export interface PedidoShopify {
  id?: number | string;
  order_number?: number;
  email?: string | null;
  phone?: string | null;
  currency?: string | null;
  total_price?: string | number | null;
  created_at?: string | null;
  browser_ip?: string | null;
  landing_site?: string | null;
  customer?: {
    id?: number | string | null;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
  } | null;
  billing_address?: EnderecoShopify | null;
  shipping_address?: EnderecoShopify | null;
  client_details?: { user_agent?: string | null; browser_ip?: string | null } | null;
  note_attributes?: { name?: string | null; value?: string | null }[] | null;
  line_items?: {
    product_id?: number | string | null;
    variant_id?: number | string | null;
    quantity?: number | null;
    price?: string | number | null;
  }[] | null;
}

interface EnderecoShopify {
  first_name?: string | null;
  last_name?: string | null;
  city?: string | null;
  province?: string | null;
  province_code?: string | null;
  zip?: string | null;
  country_code?: string | null;
  phone?: string | null;
}

/**
 * Chave de deduplicacao do pedido.
 *
 * O evento do navegador (Web Pixel, fase 3) precisa mandar EXATAMENTE isto. Se
 * os dois lados divergirem, o Meta conta a mesma venda duas vezes -- ou
 * descarta as duas. Por isso a regra mora aqui, em um lugar so.
 */
export function idDoEvento(pedidoId: number | string | undefined | null): string {
  return `purchase_${String(pedidoId ?? "").trim() || "desconhecido"}`;
}

function atributo(pedido: PedidoShopify, nome: string): string | null {
  const achado = (pedido.note_attributes || []).find(
    (a) => (a?.name || "").trim().toLowerCase() === nome.toLowerCase()
  );
  const valor = (achado?.value || "").trim();
  return valor || null;
}

/**
 * Sinais de clique que o snippet do tema guardou nos cart attributes.
 *
 * Cart attribute e o que faz o clique sobreviver ate o pedido: cookie morre no
 * ITP em 7 dias e nem chega ao checkout da Shopify, que roda em outro dominio.
 */
export function sinaisDoPedido(pedido: PedidoShopify) {
  return {
    fbp: atributo(pedido, "_fbp") || atributo(pedido, "fbp"),
    fbc: atributo(pedido, "_fbc") || atributo(pedido, "fbc"),
    fbclid: atributo(pedido, "fbclid"),
    gclid: atributo(pedido, "gclid"),
    wbraid: atributo(pedido, "wbraid"),
    ttclid: atributo(pedido, "ttclid"),
    visitorId: atributo(pedido, "_xc_vid") || atributo(pedido, "visitor_id"),
  };
}

export interface ContextoPurchase {
  /** Sinais vindos de tracking_identities, quando o cart attribute nao veio. */
  identidade?: {
    fbp?: string | null;
    fbc?: string | null;
    fbclid?: string | null;
    clientIp?: string | null;
    userAgent?: string | null;
  } | null;
  /** Origem da loja, para o event_source_url. */
  dominioLoja?: string | null;
}

export interface PurchaseMontado {
  evento: EventoCapi;
  /** Quantos sinais de match foram para o user_data -- e o que vira EMQ. */
  userData: UserData;
}

/**
 * Monta o Purchase.
 *
 * Tira identificacao de tudo que o pedido oferece -- cliente, cobranca,
 * entrega -- porque o Meta pontua pela QUANTIDADE de sinais que conferem.
 * Mandar so fbp/fbc e o que trava o Event Match Quality em 4.
 */
export function montarPurchase(
  pedido: PedidoShopify,
  contexto: ContextoPurchase = {}
): PurchaseMontado {
  const endereco = pedido.billing_address || pedido.shipping_address || null;
  const sinais = sinaisDoPedido(pedido);
  const identidade = contexto.identidade || {};

  const pais = endereco?.country_code || null;

  // O telefone pode estar em tres lugares e faltar em dois deles.
  const telefone =
    pedido.customer?.phone || pedido.phone || endereco?.phone || null;

  // O fbc de verdade e o cookie. Sem ele, reconstruimos a partir do fbclid --
  // senao a venda perde a ligacao com o anuncio que a gerou.
  const quandoMs = pedido.created_at
    ? new Date(pedido.created_at).getTime()
    : Date.now();
  const fbc =
    sinais.fbc ||
    identidade.fbc ||
    montarFbc(sinais.fbclid || identidade.fbclid, quandoMs);

  const userData = montarUserData(
    {
      email: pedido.customer?.email || pedido.email,
      telefone,
      primeiroNome: pedido.customer?.first_name || endereco?.first_name,
      sobrenome: pedido.customer?.last_name || endereco?.last_name,
      cidade: endereco?.city,
      estado: endereco?.province_code || endereco?.province,
      cep: endereco?.zip,
      pais,
      externalId: pedido.customer?.id ? String(pedido.customer.id) : null,
    },
    {
      fbp: sinais.fbp || identidade.fbp,
      fbc,
      clientIp:
        pedido.client_details?.browser_ip ||
        pedido.browser_ip ||
        identidade.clientIp,
      userAgent: pedido.client_details?.user_agent || identidade.userAgent,
    }
  );

  const itens = pedido.line_items || [];
  const valor = Number(pedido.total_price ?? 0);

  const evento: EventoCapi = {
    event_name: "Purchase",
    // Em segundos, nao milissegundos: o Meta recusa o evento se vier em ms.
    event_time: Math.floor(quandoMs / 1000),
    event_id: idDoEvento(pedido.id),
    action_source: "website",
    user_data: userData,
    custom_data: {
      currency: (pedido.currency || "").toUpperCase() || undefined,
      value: Number.isFinite(valor) ? valor : 0,
      content_type: "product",
      content_ids: itens
        .map((i) => (i.variant_id ?? i.product_id) ?? null)
        .filter((id): id is string | number => id !== null)
        .map(String),
      num_items: itens.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
      order_id: String(pedido.id ?? ""),
    },
  };

  if (contexto.dominioLoja) {
    // O caminho de chegada ajuda o Meta a casar com a sessao do navegador.
    const caminho = (pedido.landing_site || "/").startsWith("/")
      ? pedido.landing_site || "/"
      : "/";
    evento.event_source_url = `https://${contexto.dominioLoja}${caminho}`;
  }

  return { evento, userData };
}
