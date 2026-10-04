import {
  montarFbc,
  montarUserData,
  type UserData,
} from "@/lib/tracking/normalizar";
import type { EventoCapi } from "@/lib/tracking/meta-capi";
import {
  montarIdDeProduto,
  montarIdsDeProdutos,
} from "@/lib/tracking/id-produto";

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
  /**
   * O token do checkout que virou este pedido. E o MESMO `checkout.token` que o
   * Web Pixel ve (documentado pela Shopify) -- a ponte para recuperar o clique
   * quando o cart attribute nao chega ao pedido.
   */
  checkout_token?: string | null;
  /** URL da pagina de status, no dominio PUBLICO da loja. */
  order_status_url?: string | null;
  test?: boolean | null;
  source_name?: string | null;
  customer?: {
    id?: number | string | null;
    email?: string | null;
    phone?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    /** Quantos pedidos este cliente ja fez. Decide novo x recorrente. */
    orders_count?: number | null;
  } | null;
  billing_address?: EnderecoShopify | null;
  shipping_address?: EnderecoShopify | null;
  client_details?: { user_agent?: string | null; browser_ip?: string | null } | null;
  note_attributes?: { name?: string | null; value?: string | null }[] | null;
  line_items?: {
    product_id?: number | string | null;
    variant_id?: number | string | null;
    /** Precisa para o template de id que usa {sku}. */
    sku?: string | null;
    quantity?: number | null;
    /** Preco de TABELA, por unidade. O que foi pago sai dos descontos abaixo. */
    price?: string | number | null;
    /** Desconto alocado a esta linha, no total (nao por unidade). */
    discount_allocations?: { amount?: string | number | null }[] | null;
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
    // Do cookie `_gcl_au`, que a tag do Google escreve. Viaja ate o pedido
    // pelo mesmo caminho dos click ids. Ver google-ads.ts.
    auid: atributo(pedido, "_auid") || atributo(pedido, "auid"),
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
  /**
   * gbraid, wbraid e auid FALTAVAM aqui, embora a tabela tenha as colunas e o
   * coletor grave as tres. Clique de iOS chega so com gbraid/wbraid: sem eles
   * no fallback, a compra de quem clicou num anuncio no iPhone saia sem
   * atribuicao nenhuma para o Google.
   */
  gbraid?: string | null;
  wbraid?: string | null;
  auid?: string | null;
  /** O nosso id de visitante e o da Shopify: casam com o external_id do funil. */
  visitorId?: string | null;
  clientId?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
}

/**
 * Click ids que vieram na URL de CHEGADA da sessao que virou o pedido.
 *
 * Ultima reserva, quando nem o cart attribute nem a identidade trouxeram o
 * clique. O `landing_site` do pedido e a URL onde a sessao comecou, e quem
 * chega de anuncio chega com `?gclid=` ou `?fbclid=` nela -- medido: uma das
 * compras reais trazia o fbclid no proprio landing_site e ele era ignorado.
 *
 * A Shopify corta o landing_site em 255 caracteres. Perto do limite, o ultimo
 * parametro pode estar truncado, e um gclid pela metade e pior que nenhum: o
 * Google descarta e ainda parece que foi enviado. Entao, perto do limite, o
 * ultimo parametro e descartado.
 *
 * Exceto o fbclid que PROVA estar inteiro. O fbclid atual termina em
 * `_aem_` + 22 caracteres; cortado, o sufixo nao fecha. E o caso comum, nao o
 * raro: path de produto + fbclid de ~200 caracteres ja encosta no limite --
 * medido na #NM100599, landing de 255 com o fbclid intacto, que a regra antiga
 * jogava fora.
 */
const FBCLID_COMPLETO = /_aem_[A-Za-z0-9_-]{22}$/;

export function cliquesDaLanding(landingSite: string | null | undefined): {
  gclid: string | null;
  gbraid: string | null;
  wbraid: string | null;
  fbclid: string | null;
} {
  const vazio = { gclid: null, gbraid: null, wbraid: null, fbclid: null };
  const bruto = (landingSite || "").trim();
  if (!bruto || !bruto.includes("?")) return vazio;

  let parametros: URLSearchParams;
  try {
    parametros = new URL(bruto, "https://x.invalid").searchParams;
  } catch {
    return vazio;
  }

  if (bruto.length >= 250) {
    const chaves = [...parametros.keys()];
    const ultima = chaves[chaves.length - 1];
    const fbclidInteiro =
      ultima === "fbclid" && FBCLID_COMPLETO.test(parametros.get("fbclid") || "");
    if (ultima && !fbclidInteiro) parametros.delete(ultima);
  }

  const ler = (k: string) => (parametros.get(k) || "").trim() || null;
  return {
    gclid: ler("gclid"),
    gbraid: ler("gbraid"),
    wbraid: ler("wbraid"),
    fbclid: ler("fbclid"),
  };
}

export interface ContextoPurchase {
  /** Sinais vindos de tracking_identities, quando o cart attribute nao veio. */
  identidade?: IdentidadeGuardada | null;
  /** Origem da loja, para o event_source_url. */
  dominioLoja?: string | null;
  /**
   * Formato do id de produto do DESTINO. Ausente = `{variant_id}`.
   *
   * Por destino e nao por loja: o catalogo do Meta e o feed do Google sao dois
   * catalogos distintos, montados por caminhos distintos na mesma loja.
   */
  idTemplate?: string | null;
}

export interface PurchaseMontado {
  evento: EventoCapi;
  /** Quantos sinais de match foram para o user_data -- e o que vira EMQ. */
  userData: UserData;
}

/**
 * A origem PUBLICA da loja, tirada da URL de status do pedido.
 *
 * O `shop_domain` cadastrado e o .myshopify.com. A `order_status_url` vem no
 * dominio que o comprador usou -- o mesmo onde o funil aconteceu.
 */
function origemPublica(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" ? u.origin : null;
  } catch {
    return null;
  }
}

type LinhaDoPedido = NonNullable<PedidoShopify["line_items"]>[number];

/**
 * `contents` do Purchase: uma entrada por id, com o preco PAGO por unidade.
 *
 * A versao anterior errava duas vezes, as duas medidas na #NM100599:
 * - uma entrada por LINHA do pedido. A oferta "compre 2 leve 4" da Shopify poe
 *   as unidades gratis numa linha propria do mesmo produto, e o Meta recebia o
 *   mesmo id duas vezes.
 * - `item_price` era o preco de TABELA. As duas unidades gratis iam a 39.39 e a
 *   soma de contents dava o dobro do `value`.
 *
 * Agora agrupa por id e divide o que foi pago (preco x quantidade, menos os
 * descontos alocados a linha) pela quantidade. Pago zero -- brinde -- sai sem
 * item_price, como ja saia o item sem preco.
 */
function conteudoDoPedido(
  idTemplate: string | null,
  itens: LinhaDoPedido[]
): { id: string; quantity: number; item_price?: number }[] {
  const porId = new Map<string, { quantidade: number; pago: number; temPreco: boolean }>();
  for (const i of itens) {
    const id = montarIdDeProduto(idTemplate, {
      variantId: i.variant_id,
      productId: i.product_id,
      sku: i.sku,
    });
    // Item sem id sai da lista. `contents: [{id: ""}]` e id invalido para o
    // Meta e pode derrubar o evento inteiro.
    if (!id) continue;
    const quantidade = Number(i.quantity) || 1;
    const preco = Number(i.price ?? 0);
    const temPreco = Number.isFinite(preco) && preco > 0;
    const desconto = (i.discount_allocations || []).reduce((soma, d) => {
      const v = Number(d?.amount ?? 0);
      return soma + (Number.isFinite(v) ? v : 0);
    }, 0);
    const pago = temPreco ? Math.max(0, preco * quantidade - desconto) : 0;
    const atual = porId.get(id) ?? { quantidade: 0, pago: 0, temPreco: false };
    porId.set(id, {
      quantidade: atual.quantidade + quantidade,
      pago: atual.pago + pago,
      temPreco: atual.temPreco || temPreco,
    });
  }
  return [...porId].map(([id, c]) => {
    const unitario = Math.round((c.pago / c.quantidade) * 100) / 100;
    return {
      id,
      quantity: c.quantidade,
      ...(c.temPreco && unitario > 0 ? { item_price: unitario } : {}),
    };
  });
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
  // O formato do id de produto e do DESTINO: o catalogo do Meta e o feed do
  // Google sao dois catalogos, e podem ter sido montados de formas diferentes
  // na mesma loja. Ausente = `{variant_id}`, o comportamento de antes.
  const idTemplate = contexto.idTemplate ?? null;
  const endereco = pedido.billing_address || pedido.shipping_address || null;
  const sinais = sinaisDoPedido(pedido);
  const identidade = contexto.identidade || {};

  const pais = endereco?.country_code || null;

  // O telefone pode estar em quatro lugares e faltar em tres deles. A entrega
  // vai por ultimo, mas vai: com cobranca presente, `endereco` e a cobranca, e
  // o telefone que so o endereco de entrega trazia se perdia.
  //
  // O numero anda com o PAIS do lugar de onde veio. Sem "+", o normalizador
  // cola o DDI do pais recebido: o telefone espanhol da entrega com o pais da
  // cobranca francesa virava um celular frances valido -- de outra pessoa.
  const fonteDoTelefone = [
    { numero: pedido.customer?.phone, pais },
    { numero: pedido.phone, pais },
    { numero: pedido.billing_address?.phone, pais: pedido.billing_address?.country_code || pais },
    { numero: pedido.shipping_address?.phone, pais: pedido.shipping_address?.country_code || pais },
  ].find((t) => t.numero);

  // O fbc de verdade e o cookie. Sem ele, reconstruimos a partir do fbclid --
  // senao a venda perde a ligacao com o anuncio que a gerou.
  const quandoMs = pedido.created_at
    ? new Date(pedido.created_at).getTime()
    : Date.now();
  const fbc =
    sinais.fbc ||
    identidade.fbc ||
    montarFbc(
      sinais.fbclid || identidade.fbclid || cliquesDaLanding(pedido.landing_site).fbclid,
      quandoMs
    );

  const userData = montarUserData(
    {
      email: pedido.customer?.email || pedido.email,
      telefone: fonteDoTelefone?.numero ?? null,
      paisDoTelefone: fonteDoTelefone?.pais ?? null,
      primeiroNome: pedido.customer?.first_name || endereco?.first_name,
      sobrenome: pedido.customer?.last_name || endereco?.last_name,
      cidade: endereco?.city,
      estado: endereco?.province_code || endereco?.province,
      cep: endereco?.zip,
      pais,
      // Os DOIS: o customer id liga pedidos do mesmo comprador ao longo do
      // tempo; o id de visitante e o unico que o carrinho e o checkout tambem
      // conhecem, e e ele que costura o funil inteiro na mesma pessoa.
      //
      // O visitante tambem pode vir da identidade recuperada pelo checkout, e o
      // clientId da Shopify junto: os eventos do funil mandam [visitorId,
      // clientId], e sem eles aqui a compra nao casava com o proprio funil.
      externalIds: [
        pedido.customer?.id ? String(pedido.customer.id) : null,
        sinais.visitorId || identidade.visitorId,
        identidade.clientId,
      ],
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
  const itensParaId = itens.map((i) => ({
    variantId: i.variant_id,
    productId: i.product_id,
    sku: i.sku,
  }));
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
      content_ids: montarIdsDeProdutos(idTemplate, itensParaId),
      // `contents` alem de `content_ids`: ele carrega quantidade e preco por
      // item, que e o formato que o Meta pede para anuncio de catalogo. Com
      // apenas os ids, uma compra de 3 unidades e indistinguivel de 1, e o
      // catalogo nao sabe por quanto cada item saiu.
      contents: conteudoDoPedido(idTemplate, itens),
      num_items: itens.reduce((s, i) => s + (Number(i.quantity) || 0), 0),
      order_id: String(pedido.id ?? ""),
    },
  };

  // Cliente novo ou recorrente.
  //
  // E o que alimenta a otimizacao de AQUISICAO DE CLIENTE NOVO do Meta.
  //
  // DENTRO de custom_data, com o enum dele. A primeira versao disto punha o
  // campo no topo do evento com "new_customer"/"existing_customer" -- valores
  // que o Meta nao aceita. So nao quebrou porque a Shopify nao manda mais
  // `orders_count` no pedido e o bloco nunca rodava. Se viesse, o Meta podia
  // responder erro 100, que a fila trata como permanente: toda compra de toda
  // loja iria para 'falhou'.
  //
  // `orders_count` ja inclui este pedido, entao 1 e a primeira compra. Ausente
  // fica ausente de proposito -- chutar "novo" inflaria a conquista.
  const quantos = pedido.customer?.orders_count;
  if (typeof quantos === "number" && Number.isFinite(quantos) && quantos > 0) {
    evento.custom_data = {
      ...evento.custom_data,
      customer_segmentation:
        quantos <= 1 ? "new_customer_to_business" : "existing_customer_to_business",
    };
  }

  const origem =
    origemPublica(pedido.order_status_url) ||
    (contexto.dominioLoja ? `https://${contexto.dominioLoja}` : null);
  if (origem) {
    // O caminho de chegada ajuda o Meta a casar com a sessao do navegador.
    //
    // No dominio PUBLICO, nao no .myshopify.com: o funil inteiro sai no
    // dominio publico, e o Purchase em outro dominio quebra regra de dominio
    // verificado e conversao personalizada por URL.
    const caminho = (pedido.landing_site || "/").startsWith("/")
      ? pedido.landing_site || "/"
      : "/";
    evento.event_source_url = `${origem}${caminho}`;
  }

  return { evento, userData };
}
