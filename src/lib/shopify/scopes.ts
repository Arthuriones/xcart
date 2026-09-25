// Fonte unica dos escopos do app na Shopify.
//
// Antes esta lista existia duplicada: uma no fluxo de OAuth
// (src/app/api/shopify/auth/route.ts) e outra, escrita a mao, no tutorial de
// conexao (stores/page.tsx). As duas ja tinham divergido — o tutorial mandava o
// usuario configurar `write_themes`, que o OAuth nunca pedia. O resultado era o
// app pedir um conjunto de permissoes diferente do que a loja tinha
// configurado, gerando prompt de reinstalacao ou "access denied" depois.
//
// `write_themes` fica na lista porque o app escreve assets de tema em
// src/app/api/checkout-routes/[id]/update-theme/route.ts.
//
// O segundo bloco abaixo veio de bater a cabeca em producao: montando uma loja
// de checkout do zero, cada um destes devolveu ACCESS_DENIED e virou trabalho
// manual no admin da Shopify. Estao aqui para loja nova ja nascer completa.
//
// ATENCAO: alguns sao escopos protegidos e a Shopify pede aprovacao do lojista
// ("This action requires merchant approval for write_shipping scope"). Colar a
// lista no app customizado nao basta sozinho — o dono da loja precisa aprovar
// no painel. Sem isso o app segue funcionando, so que sem essas capacidades.
export const SHOPIFY_SCOPES = [
  "write_legal_policies",
  "write_online_store_navigation",
  "read_products",
  "write_products",
  "read_publications",
  "write_publications",
  "read_content",
  "write_content",
  "read_themes",
  "write_themes",
  "read_metaobjects",
  "write_metaobjects",
  "read_metaobject_definitions",
  "write_metaobject_definitions",

  // Zonas de envio. Sem isto nao da para incluir o pais de destino, e o cliente
  // e redirecionado para um checkout que trava em "informe o endereco para ver
  // os metodos de envio".
  "read_shipping",
  "write_shipping",

  // Descontos automaticos (ex.: escada 5/10/15% por quantidade no carrinho).
  "read_discounts",
  "write_discounts",

  // Estoque por localizacao. Sem read_locations nao ha como informar quantidade
  // ao criar produto, e variante rastreada com 0 unidades bloqueia a compra.
  "read_locations",
  "write_inventory",

  // Mercados: e o Market que decide quais paises aparecem no seletor do
  // checkout, mesmo com a zona de envio correta.
  "read_markets",
  "write_markets",

  // Diagnostico de publicacao (publishedOnCurrentPublication). Colecao ou
  // produto fora do canal Online Store some da vitrine sem nenhum aviso.
  "read_product_listings",

  // Vendas. A tela de Vendas soma os pedidos pagos de cada loja de checkout
  // direto na Shopify -- o xcart nao guarda pedido.
  //
  // ATENCAO: read_orders da acesso aos ULTIMOS 60 DIAS. Historico completo
  // exige read_all_orders, que e escopo protegido e depende de aprovacao da
  // Shopify caso a caso. Por isso o periodo maximo da tela e 60 dias.
  //
  // Loja conectada antes deste escopo entrar continua funcionando para todo o
  // resto, mas devolve ACCESS_DENIED em pedido ate ser reconectada. A tela de
  // Vendas mostra quais lojas estao nesse estado.
  "read_orders",

  // Rastreamento server-side.
  //
  // `read_orders` acima tambem e pre-requisito daqui: sem ele a Shopify recusa
  // ate a INSCRICAO no webhook orders/create, que e a unica fonte de conversao
  // que nao depende do navegador do comprador.
  //
  // `write_pixels` + `read_customer_events` sao o Custom Web Pixel. Script de
  // tema nao roda no checkout da Shopify -- e outro dominio, fora do tema --
  // entao sem pixel nao existe evento de checkout nenhum.
  "write_pixels",
  "read_customer_events",
] as const;

// String pronta para colar no painel da Shopify e para a URL de authorize.
export const SHOPIFY_SCOPES_STRING = SHOPIFY_SCOPES.join(",");
