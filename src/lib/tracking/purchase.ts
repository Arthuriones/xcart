import {
  emailParaGoogle,
  montarFbc,
  montarUserData,
  nomeParaGoogle,
  sha256,
  telefoneE164,
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
    gbraid: atributo(pedido, "gbraid"),
    wbraid: atributo(pedido, "wbraid"),
    ttclid: atributo(pedido, "ttclid"),
    visitorId: atributo(pedido, "_xc_vid") || atributo(pedido, "visitor_id"),
  };
}

/**
 * O que o coletor guardou para este visitante.
 *
 * Um tipo so para os dois destinos: cada um le os campos que usa. Tipos
 * separados obrigavam o chamador a fatiar o objeto antes de passar, e um
 * campo novo teria que ser adicionado em dois lugares.
 */
export interface IdentidadeGuardada {
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  gclid?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

/** O que o endpoint do Google Ads precisa. Formato proprio, nao o do CAPI. */
export interface ConversaoGoogleDoPedido {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  orderId: string;
  value: number;
  currency: string;
}

/**
 * Recorte do pedido para o Google Ads.
 *
 * Fica separado do evento do Meta de proposito: o payload do Meta e enviado
 * CRU para a API deles, entao pendurar campo de outro destino nele iria junto
 * na requisicao. Cada destino guarda na fila exatamente o que vai usar.
 */
export function montarConversaoGoogle(
  pedido: PedidoShopify,
  contexto: { identidade?: IdentidadeGuardada | null } = {}
): ConversaoGoogleDoPedido {
  const sinais = sinaisDoPedido(pedido);
  const valor = Number(pedido.total_price ?? 0);
  return {
    gclid: sinais.gclid || contexto.identidade?.gclid || null,
    gbraid: sinais.gbraid,
    wbraid: sinais.wbraid,
    // O numero do pedido vira `oid`: mesma conversion action com o mesmo oid
    // o Google descarta, que e a protecao contra reentrega de webhook.
    orderId: String(pedido.id ?? ""),
    value: Number.isFinite(valor) ? valor : 0,
    currency: (pedido.currency || "").toUpperCase(),
  };
}

/**
 * Um identificador do enhanced conversions.
 *
 * O campo do Google e um oneof: preencher hashedEmail E addressInfo no MESMO
 * objeto limpa um dos dois. Por isso cada sinal vira um item da lista, nunca
 * um campo a mais no item anterior.
 *
 * Mora aqui, e nao em google-ads-api.ts, porque este arquivo e puro -- o de
 * API e server-only e arrastaria o bundler para dentro dos testes.
 */
export type IdentificadorGoogle =
  | { hashedEmail: string; userIdentifierSource: "FIRST_PARTY" }
  | { hashedPhoneNumber: string; userIdentifierSource: "FIRST_PARTY" }
  | {
      addressInfo: {
        hashedFirstName: string;
        hashedLastName: string;
        countryCode: string;
        postalCode: string;
        city?: string;
        state?: string;
      };
      userIdentifierSource: "FIRST_PARTY";
    };

/**
 * Pedido -> identificadores hasheados do enhanced conversions.
 *
 * Nao reaproveita o user_data do Meta de proposito, apesar da semelhanca. Sao
 * tres divergencias, e cada uma quebra o match em silencio:
 *
 *   - telefone: o Meta quer digitos sem `+`, o Google exige E.164 com `+`;
 *   - nome: o Meta tira acento antes de hashear, o Google mantem;
 *   - cidade e estado: no Meta vao hasheados, no Google vao em claro.
 *
 * Nada disso da erro. O hash sai valido e simplesmente nao casa com ninguem.
 */
export function montarIdentificadoresGoogle(
  pedido: PedidoShopify
): IdentificadorGoogle[] {
  const endereco = pedido.billing_address || pedido.shipping_address || null;
  const pais = endereco?.country_code || null;
  const ids: IdentificadorGoogle[] = [];

  const email = emailParaGoogle(pedido.customer?.email || pedido.email);
  if (email) {
    ids.push({ hashedEmail: sha256(email), userIdentifierSource: "FIRST_PARTY" });
  }

  const telefone = telefoneE164(
    pedido.customer?.phone || pedido.phone || endereco?.phone,
    pais
  );
  if (telefone) {
    ids.push({
      hashedPhoneNumber: sha256(telefone),
      userIdentifierSource: "FIRST_PARTY",
    });
  }

  const primeiro = nomeParaGoogle(
    pedido.customer?.first_name || endereco?.first_name
  );
  const ultimo = nomeParaGoogle(pedido.customer?.last_name || endereco?.last_name);
  const codigoPais = (pais || "").trim().toUpperCase();
  const cep = (endereco?.zip || "").trim();

  // O endereco so conta completo: o Google exige nome, sobrenome, pais e CEP
  // juntos e descarta o identificador inteiro se faltar um. Montar pela metade
  // gastaria uma das 5 vagas para nada.
  if (primeiro && ultimo && /^[A-Z]{2}$/.test(codigoPais) && cep) {
    const cidade = (endereco?.city || "").trim().toLowerCase();
    const estado = (endereco?.province_code || endereco?.province || "")
      .trim()
      .toLowerCase();
    ids.push({
      addressInfo: {
        hashedFirstName: sha256(primeiro),
        hashedLastName: sha256(ultimo),
        countryCode: codigoPais,
        postalCode: cep,
        ...(cidade ? { city: cidade } : {}),
        ...(estado ? { state: estado } : {}),
      },
      userIdentifierSource: "FIRST_PARTY",
    });
  }

  return ids;
}

export interface ContextoPurchase {
  /** Sinais vindos de tracking_identities, quando o cart attribute nao veio. */
  identidade?: IdentidadeGuardada | null;
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
