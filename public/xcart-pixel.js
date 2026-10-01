/* ===========================================================================
 * Eventos do checkout da Shopify.
 *
 * Este arquivo e CARREGADO pelo Custom Pixel, nao colado nele. O que o lojista
 * cola e uma linha so:
 *
 *   document.head.appendChild(document.createElement("script")).src =
 *     "https://user.xcart.app/xcart-pixel.js?shop=" +
 *     (self.ctx = this).init.data.shop.myshopifyDomain;
 *
 * Duas coisas nessa linha importam, e as duas foram aprendidas lendo como o
 * WeTracked faz:
 *
 *   - `self.ctx = this` guarda o contexto do sandbox num global. Sem isso este
 *     arquivo nao alcanca `analytics`, que e o objeto que assina os eventos --
 *     ele nao existe no escopo global, so no `this` do Custom Pixel.
 *
 *   - `init.data.shop.myshopifyDomain` vem da propria Shopify. Por isso o
 *     mesmo trecho serve para TODA loja: nao ha id cravado, e o lojista cola
 *     uma vez e nunca mais. A versao anterior disto era gerada por loja e
 *     exigia recolar a cada mudanca de logica.
 *
 * O QUE ELE NAO FAZ
 *
 * Nao fala com o Meta nem com o Google. Avisa o coletor do xcart, e quem envia
 * e o servidor -- igual ao snippet do tema. O checkout e so o lugar de onde
 * estes eventos podem ser observados.
 *
 * A COMPRA NAO SAI DAQUI
 *
 * `checkout_completed` existe e seria tentador. Mas a compra vem do webhook
 * `orders/create`, que e servidor-a-servidor e nao depende de o navegador
 * continuar vivo na pagina de obrigado. Pelos dois caminhos, o primeiro a
 * chegar venceria o indice unico da fila -- e o que chega primeiro e o mais
 * fragil.
 * =========================================================================== */
(function () {
  "use strict";

  var ctx = self.ctx;
  if (!ctx || !ctx.analytics || !ctx.init) return;

  var LOJA =
    (ctx.init.data && ctx.init.data.shop && ctx.init.data.shop.myshopifyDomain) ||
    null;
  if (!LOJA) return;

  /** De onde este arquivo veio e tambem para onde o evento vai. */
  var COLETOR = (function () {
    try {
      // document.currentScript nao existe de forma confiavel aqui; o src foi
      // montado pelo trecho colado, entao a origem e a deste proprio arquivo.
      var marca = "/xcart-pixel.js";
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src || "";
        if (src.indexOf(marca) !== -1) {
          return new URL(src).origin + "/api/tracking/collect";
        }
      }
    } catch (e) {
      /* cai no retorno abaixo */
    }
    return null;
  })();
  if (!COLETOR) return;

  /** O que o tema nao alcanca. Nome da Shopify -> nome do nosso catalogo. */
  var EVENTOS = [
    ["checkout_started", "begin_checkout"],
    ["payment_info_submitted", "payment_info"],
  ];

  function enviar(nome, event) {
    try {
      var ectx = (event && event.context) || {};
      var doc = ectx.document || {};
      var checkout = (event.data && event.data.checkout) || {};
      var endereco = checkout.shippingAddress || checkout.billingAddress || {};

      // O clientId zerado que a Shopify usa sem consentimento nao e identidade:
      // e o mesmo valor para pessoas diferentes. Sem ele, o checkout vira o
      // visitante -- unico por compra, e nunca compartilhado.
      var clientId = event.clientId || null;
      if (clientId && /^0{8}-0{4}-0{4}-[0-9a-f]0{3}-0{12}$/i.test(clientId)) {
        clientId = null;
      }

      var corpo = {
        shop: LOJA,
        evento: nome,
        fonte: "pixel",
        // UM evento por checkout. O `event.id` da Shopify e novo a cada
        // disparo: recarregar o checkout, ou reenviar o cartao depois de uma
        // recusa, virava InitiateCheckout/AddPaymentInfo novo. O token do
        // checkout repete, e o indice unico da fila responde "duplicado". O
        // servidor faz o mesmo, para valer tambem com este arquivo em cache.
        eventId: nome + "_" + (checkout.token || event.id || Date.now()),
        // A unica chave de identidade que o sandbox conhece: ele nao le os
        // cookies da loja. O snippet do tema publica a associacao deste
        // clientId com os click ids, e o servidor recupera por ela.
        clientId: clientId,
        visitorId: clientId || checkout.token || null,
        checkoutToken: checkout.token || null,
        pageUrl: (doc.location && doc.location.href) || null,
        referrer: doc.referrer || null,
        // PII do checkout. Vai em claro por HTTPS e o servidor hasheia antes de
        // sair dali -- nada em claro chega ao Meta nem ao Google.
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
      if (ctx.browser && ctx.browser.sendBeacon) {
        ctx.browser.sendBeacon(COLETOR, texto);
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

  for (var i = 0; i < EVENTOS.length; i++) {
    (function (par) {
      ctx.analytics.subscribe(par[0], function (event) {
        enviar(par[1], event);
      });
    })(EVENTOS[i]);
  }
})();
