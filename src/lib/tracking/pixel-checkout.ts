// ============================================================================
// O codigo do Custom Pixel, gerado por loja.
//
// POR QUE ISTO EXISTE
//
// O snippet do tema nao entra no checkout da Shopify -- o checkout nao e tema.
// Por isso `begin_checkout` hoje e o CLIQUE no botao e `payment_info` nao
// existe. O Web Pixel entra.
//
// POR QUE NAO E INSTALADO PELA API
//
// Medido: `webPixelCreate` responde "No extension found". A mutation so
// funciona para app que declara uma Web Pixel Extension e faz deploy pelo
// Shopify CLI -- mudanca no app, nao chamada de API. O Custom Pixel colado no
// admin roda no MESMO sandbox e alcanca as mesmas superficies.
//
// O QUE ELE E, E O QUE ELE NAO E
//
// Ele NAO manda nada para o Meta nem para o Google. Ele avisa o NOSSO coletor,
// e o nosso servidor e que envia -- igual ao snippet do tema. O pixel e o
// sensor; o emissor continua sendo o servidor.
//
// LIMITE QUE DECIDE O DESENHO
//
// O sandbox NAO le os cookies da loja: `_xc_gclid` e invisivel daqui. O que o
// evento traz e o `clientId` da Shopify, que o snippet do tema tambem conhece
// (ShopifyAnalytics.lib.user().traits().uniqToken). E por ele que o servidor
// recupera o click id.
//
// Em compensacao, o evento de checkout traz e-mail, telefone e endereco --
// sinais que os nossos eventos de funil nunca tiveram. Isso foi verificado no
// codigo de implementacoes publicas de Web Pixel, nao suposto.
//
// A COMPRA NAO SAI DAQUI
//
// `checkout_completed` existe e seria tentador. Mas a compra ja vem do webhook
// `orders/create`, que e servidor-a-servidor: nao depende de o navegador do
// comprador continuar vivo na pagina de obrigado. Mandar pelos dois caminhos
// faria o primeiro a chegar vencer o indice unico da fila -- e o que chegaria
// primeiro seria justamente o mais fragil.
// ============================================================================

/** Eventos do checkout que o tema nao alcanca. */
const EVENTOS_DO_PIXEL: { shopify: string; nosso: string }[] = [
  { shopify: "checkout_started", nosso: "begin_checkout" },
  { shopify: "payment_info_submitted", nosso: "payment_info" },
];

export interface DadosDoPixel {
  /** O dominio .myshopify.com, para o coletor achar a loja. */
  shopDomain: string;
  /** A LINHA de loja. O mesmo dominio pode estar em mais de uma conta xcart. */
  storeId: string;
  /** Origem do coletor, normalmente https://user.xcart.app. */
  origemDoApp: string;
}

/**
 * Gera o codigo para colar em Configuracoes -> Eventos de cliente.
 *
 * Auto-contido de proposito, sem carregar script externo: e codigo que roda
 * dentro do checkout, e uma dependencia de rede a mais ali e uma forma a mais
 * de o evento nao sair. O custo e que mudanca exige colar de novo.
 */
export function gerarCodigoDoPixel(dados: DadosDoPixel): string {
  const assinaturas = EVENTOS_DO_PIXEL.map(
    ({ shopify, nosso }) => `analytics.subscribe(${JSON.stringify(shopify)}, function (event) {
  enviar(${JSON.stringify(nosso)}, event);
});`
  ).join("\n\n");

  return `// xcart -- eventos do checkout. Gerado automaticamente, nao edite a mao.
//
// Isto NAO manda nada para o Meta nem para o Google: avisa o servidor do xcart,
// e o servidor e que envia. O checkout da Shopify nao e tema, entao e o unico
// lugar de onde estes eventos podem sair.
var COLETOR = ${JSON.stringify(`${dados.origemDoApp.replace(/\/+$/, "")}/api/tracking/collect`)};
var LOJA = ${JSON.stringify(dados.shopDomain)};
var STORE_ID = ${JSON.stringify(dados.storeId)};

function enviar(nome, event) {
  try {
    var ctx = (event && event.context) || {};
    var doc = ctx.document || {};
    var checkout = (event.data && event.data.checkout) || {};
    var endereco = checkout.shippingAddress || checkout.billingAddress || {};

    var corpo = {
      shop: LOJA,
      storeId: STORE_ID,
      evento: nome,
      fonte: "pixel",
      // O id que a Shopify ja gerou para este evento. Usar o dela, e nao um
      // nosso, faz o reenvio do mesmo evento cair no indice unico da fila.
      eventId: nome + "_" + (event.id || Date.now()),
      // A unica chave de identidade que o sandbox conhece. O snippet do tema
      // manda a mesma, e e por ela que o servidor recupera o click id.
      clientId: event.clientId || null,
      visitorId: event.clientId || null,
      checkoutToken: checkout.token || null,
      pageUrl: (doc.location && doc.location.href) || null,
      referrer: doc.referrer || null,
      // PII do checkout. Vai em claro por HTTPS e o servidor hasheia antes de
      // sair daqui -- nenhum valor em claro chega ao Meta nem ao Google.
      email: checkout.email || null,
      telefone: checkout.phone || null,
      primeiroNome: endereco.firstName || null,
      sobrenome: endereco.lastName || null,
      cidade: endereco.city || null,
      estado: endereco.provinceCode || null,
      cep: endereco.zip || null,
      pais: endereco.countryCode || null,
      // Valor NAO vai: este endpoint e publico, e valor forjado estraga o
      // lance automatico. O valor da venda vem do webhook do pedido.
      moeda: checkout.currencyCode || null,
    };

    var texto = JSON.stringify(corpo);

    // text/plain mantem a requisicao "simples" para o CORS, sem preflight.
    if (typeof browser !== "undefined" && browser.sendBeacon) {
      browser.sendBeacon(COLETOR, texto);
      return;
    }
    fetch(COLETOR, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
      body: texto,
      keepalive: true,
    }).catch(function () {});
  } catch (e) {
    // Erro aqui nao pode derrubar o checkout do comprador.
  }
}

${assinaturas}
`;
}

/** Os eventos que este pixel cobre. A tela usa para explicar ao lojista. */
export const EVENTOS_COBERTOS_PELO_PIXEL = EVENTOS_DO_PIXEL.map((e) => e.nosso);
