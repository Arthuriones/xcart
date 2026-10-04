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
 * META: PELO SERVIDOR
 *
 * Para o Meta ele nao fala com ninguem de fora: avisa o coletor do xcart, e
 * quem envia e o servidor (CAPI) -- igual ao snippet do tema. A compra do Meta
 * vem do webhook `orders/create`, nunca daqui: `checkout_completed` NAO vai
 * para o coletor.
 *
 * GOOGLE: PELA TAG DO GOOGLE, AQUI MESMO
 *
 * O Google Ads sai do navegador, com a tag do Google (gtag.js), como o
 * WeTracked faz. As contas e os rotulos vem de /api/tracking/google-config:
 *   - checkout_started   -> begin_checkout, transaction_id begin_checkout_ck_<token>
 *   - checkout_completed -> user_data (conversoes otimizadas) + purchase,
 *                           transaction_id = id do pedido, valor e moeda
 * Uma conversao por conta (send_to AW-x/rotulo), para todas as contas da loja.
 * O consentimento vem da Customer Privacy API: concedido -> granted, negado ->
 * denied, sem leitura -> nada e forcado. Evento de teste nao dispara a tag.
 * =========================================================================== */
(function () {
  "use strict";

  var ctx = self.ctx;
  if (!ctx || !ctx.analytics || !ctx.init) return;

  var LOJA =
    (ctx.init.data && ctx.init.data.shop && ctx.init.data.shop.myshopifyDomain) ||
    null;
  if (!LOJA) return;

  /** O src deste arquivo: dele saem o coletor e o id da loja. */
  var SRC = (function () {
    try {
      // document.currentScript nao existe de forma confiavel aqui; o src foi
      // montado pelo trecho colado, entao e o deste proprio arquivo.
      var marca = "/xcart-pixel.js";
      var scripts = document.getElementsByTagName("script");
      for (var i = scripts.length - 1; i >= 0; i--) {
        var src = scripts[i].src || "";
        if (src.indexOf(marca) !== -1) return new URL(src);
      }
    } catch (e) {
      /* cai no retorno abaixo */
    }
    return null;
  })();
  if (!SRC) return;

  /** De onde este arquivo veio e tambem para onde o evento vai. */
  var COLETOR = SRC.origin + "/api/tracking/collect";

  // O id da LINHA da loja no xcart, que o trecho colado carrega.
  //
  // Sem ele o coletor so tem o dominio, e qualquer conta do xcart consegue
  // cadastrar uma linha com o dominio de outra loja. Com o id, o evento so
  // casa com a linha que gerou este trecho. Trecho antigo, sem `store`,
  // continua funcionando enquanto a loja tiver uma linha so.
  var STORE_ID = SRC.searchParams.get("store") || null;

  // Consentimento de marketing: o do inicio, trocado quando o comprador
  // responde ao banner no meio do checkout. Sem leitura, fica sem valor --
  // nunca "concedido" por padrao.
  var privacidade = (ctx.init && ctx.init.customerPrivacy) || null;
  try {
    if (ctx.customerPrivacy && typeof ctx.customerPrivacy.subscribe === "function") {
      ctx.customerPrivacy.subscribe("visitorConsentCollected", function (e) {
        if (e && e.customerPrivacy) privacidade = e.customerPrivacy;
      });
    }
  } catch (e) {
    /* sem assinatura, vale o do inicio */
  }

  function consentimento() {
    if (!privacidade || typeof privacidade.marketingAllowed !== "boolean") return null;
    return privacidade.marketingAllowed ? "concedido" : "negado";
  }

  // =========================================================================
  // GOOGLE ADS PELA TAG DO GOOGLE (gtag.js)
  // =========================================================================

  /** null = ainda buscando; [] = loja sem Google (ou falhou: nao tenta de novo). */
  var contasGoogle = null;
  var esperandoGoogle = [];

  function gtag() {
    self.dataLayer = self.dataLayer || [];
    self.dataLayer.push(arguments);
  }

  /** O estado de consentimento no formato do Google, ou null sem leitura. */
  function consentimentoGoogle() {
    var c = consentimento();
    if (!c) return null;
    var v = c === "concedido" ? "granted" : "denied";
    return { ad_storage: v, ad_user_data: v, ad_personalization: v };
  }

  function aplicarConsentimento() {
    var estado = consentimentoGoogle();
    // Sem leitura nao forca nada: nem granted (o WeTracked forca), nem denied.
    if (estado) gtag("consent", "update", estado);
  }

  function ligarGoogle(lista) {
    var contas = [];
    for (var i = 0; i < (lista || []).length; i++) {
      var c = lista[i];
      // Mesmo filtro do servidor: o valor vai para a URL do gtag e para send_to.
      if (c && /^AW-\d+$/.test(c.conta || "")) {
        contas.push({ conta: c.conta, labels: c.labels || {} });
      }
    }
    contasGoogle = contas;
    if (contas.length) {
      // UM gtag.js para todas as contas: a biblioteca atende varias pelo dataLayer.
      var s = document.createElement("script");
      s.async = true;
      s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(contas[0].conta);
      document.head.appendChild(s);
      gtag("js", new Date());
      aplicarConsentimento();
      for (var j = 0; j < contas.length; j++) {
        gtag("config", contas[j].conta, { allow_enhanced_conversions: true });
      }
    }
    var fila = esperandoGoogle;
    esperandoGoogle = [];
    for (var k = 0; k < fila.length; k++) fila[k]();
  }

  /** Roda `fn` quando a configuracao chegar (ou ja). */
  function comGoogle(fn) {
    if (contasGoogle === null) esperandoGoogle.push(fn);
    else fn();
  }

  if (STORE_ID) {
    try {
      fetch(
        SRC.origin +
          "/api/tracking/google-config?store=" +
          encodeURIComponent(STORE_ID) +
          "&shop=" +
          encodeURIComponent(LOJA),
        { credentials: "omit" }
      )
        .then(function (r) {
          return r.ok ? r.json() : [];
        })
        .then(ligarGoogle, function () {
          ligarGoogle([]);
        });
    } catch (e) {
      ligarGoogle([]);
    }
  } else {
    // Trecho antigo, sem o id da loja: a configuracao exige id E dominio.
    contasGoogle = [];
  }

  /** Uma conversao por conta que tem rotulo para o evento. */
  function converter(evento, params) {
    comGoogle(function () {
      if (!contasGoogle.length) return;
      aplicarConsentimento();
      for (var i = 0; i < contasGoogle.length; i++) {
        var rotulo = contasGoogle[i].labels[evento];
        if (!rotulo) continue;
        var p = { send_to: contasGoogle[i].conta + "/" + rotulo };
        for (var k in params) {
          if (Object.prototype.hasOwnProperty.call(params, k) && params[k] !== undefined) {
            p[k] = params[k];
          }
        }
        gtag("event", evento, p);
      }
    });
  }

  /** DDI por pais, so os do dia a dia: telefone sem "+" de outro pais fica de fora. */
  var DDI = {
    BR: "55", US: "1", CA: "1", PT: "351", GB: "44", IE: "353", AU: "61", NZ: "64",
    MX: "52", AR: "54", CL: "56", CO: "57", PE: "51", UY: "598", PY: "595",
    ES: "34", FR: "33", DE: "49", IT: "39", NL: "31", BE: "32", CH: "41", AT: "43",
    JP: "81", ZA: "27",
  };

  /**
   * Telefone em E.164 (+5511999998888), ou null quando nao da para ter certeza.
   * O Google so casa o formato exato; um numero errado e pior que nenhum.
   */
  function telefoneE164(bruto, pais) {
    var t = String(bruto || "").trim();
    if (!t) return null;
    var digitos = t.replace(/\D/g, "");
    if (t.charAt(0) === "+") {
      return digitos.length >= 8 && digitos.length <= 15 ? "+" + digitos : null;
    }
    if (digitos.indexOf("00") === 0) {
      digitos = digitos.slice(2);
      return digitos.length >= 8 && digitos.length <= 15 ? "+" + digitos : null;
    }
    var ddi = DDI[String(pais || "").toUpperCase()];
    if (!ddi) return null;
    // O 0 de discagem nacional (0xx no Brasil, 07... no Reino Unido) sai.
    var nacional = digitos.replace(/^0+/, "");
    // Ja veio com o DDI, sem o "+" (5511999998888).
    if (nacional.indexOf(ddi) === 0 && nacional.length >= ddi.length + 10) {
      return nacional.length <= 15 ? "+" + nacional : null;
    }
    var total = ddi + nacional;
    return nacional.length >= 6 && total.length <= 15 ? "+" + total : null;
  }

  /** Endereco no formato do user_data do Google. Campo vazio nao entra. */
  function enderecoGoogle(e) {
    if (!e) return null;
    var saida = {};
    var campos = [
      ["first_name", e.firstName],
      ["last_name", e.lastName],
      ["street", e.address1],
      ["city", e.city],
      ["region", e.provinceCode || e.province],
      ["postal_code", e.zip],
      ["country", e.countryCode || e.country],
    ];
    var algum = false;
    for (var i = 0; i < campos.length; i++) {
      if (campos[i][1]) {
        saida[campos[i][0]] = String(campos[i][1]);
        algum = true;
      }
    }
    return algum ? saida : null;
  }

  /** Dados do comprador para as conversoes otimizadas. A tag faz o hash. */
  function dadosDoComprador(checkout) {
    var endereco = checkout.billingAddress || checkout.shippingAddress || null;
    var u = {};
    var algum = false;
    if (checkout.email) {
      u.email = String(checkout.email).trim();
      algum = true;
    }
    var fone = telefoneE164(
      checkout.phone || (endereco && endereco.phone) || null,
      endereco && (endereco.countryCode || endereco.country)
    );
    if (fone) {
      u.phone_number = fone;
      algum = true;
    }
    var end = enderecoGoogle(endereco);
    if (end) {
      u.address = end;
      algum = true;
    }
    return algum ? u : null;
  }

  /** gid://shopify/ProductVariant/123 -> "123". */
  function numeroDoGid(gid) {
    var m = /\/(\d+)$/.exec(String(gid || ""));
    return m ? m[1] : gid ? String(gid) : null;
  }

  /** Itens da compra no formato do Google (id da variante, preco, quantidade). */
  function itensDoCheckout(checkout) {
    var saida = [];
    var linhas = (checkout && checkout.lineItems) || [];
    for (var i = 0; i < linhas.length; i++) {
      var l = linhas[i] || {};
      var v = l.variant || {};
      var id = numeroDoGid(v.id);
      if (!id) continue;
      var preco = Number(v.price && v.price.amount);
      var item = { id: id, quantity: Number(l.quantity) || 1, google_business_vertical: "retail" };
      if (isFinite(preco)) item.price = preco;
      saida.push(item);
    }
    return saida;
  }

  /** "gid://shopify/Order/123" -> "123"; o resto como veio. */
  function idDoPedido(checkout) {
    var o = checkout && checkout.order;
    var id = o && o.id ? String(o.id) : "";
    var m = /\/(\d+)$/.exec(id);
    return m ? m[1] : id || null;
  }

  function googleNoCheckout(nome, event) {
    var checkout = (event && event.data && event.data.checkout) || {};
    // O dono testando (?xcart_teste=1): nada sai para o Google.
    if (deTeste(checkout)) return;
    if (nome === "begin_checkout") {
      if (!checkout.token) return;
      // O mesmo id do coletor: um begin_checkout POR CHECKOUT, e o Google
      // descarta o repetido pelo transaction_id.
      converter("begin_checkout", { transaction_id: "begin_checkout_ck_" + checkout.token });
      return;
    }
    if (nome === "purchase") {
      var pedido = idDoPedido(checkout);
      if (!pedido) return;
      var total = checkout.totalPrice || {};
      var valor = Number(total.amount);
      var dados = dadosDoComprador(checkout);
      comGoogle(function () {
        // Antes da conversao: e o que liga as conversoes otimizadas.
        if (contasGoogle.length && dados) gtag("set", "user_data", dados);
      });
      var params = {
        transaction_id: pedido,
        value: isFinite(valor) ? valor : 0,
        currency: total.currencyCode || checkout.currencyCode || undefined,
      };
      // Os itens e o "cliente novo", como o WeTracked manda: alimentam as
      // conversoes com dados do carrinho e a meta de aquisicao de cliente
      // novo do Google. Sem eles a conversao conta igual.
      var itens = itensDoCheckout(checkout);
      if (itens.length) params.items = itens;
      var cliente = checkout.order && checkout.order.customer;
      if (cliente && typeof cliente.isFirstOrder === "boolean") {
        params.new_customer = cliente.isFirstOrder;
      }
      converter("purchase", params);
    }
  }

  /**
   * O dono testando: o tema grava `_xc_teste` no carrinho (?xcart_teste=1), e
   * os atributos do carrinho chegam ate aqui. O sandbox nao le o cookie.
   */
  function deTeste(checkout) {
    var lista = (checkout && checkout.attributes) || [];
    for (var i = 0; i < lista.length; i++) {
      if (lista[i] && lista[i].key === "_xc_teste") return lista[i].value === "1";
    }
    return false;
  }

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
        storeId: STORE_ID,
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
        // Ausentes, o JSON nem leva o campo. O coletor tambem marca teste pelo
        // gclid TESTE_* que a identidade do tema trouxer.
        teste: deTeste(checkout) || undefined,
        consentimento: consentimento() || undefined,
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
        if (par[1] === "begin_checkout") {
          try {
            googleNoCheckout("begin_checkout", event);
          } catch (e) {
            // Erro na tag nao pode derrubar o checkout nem o evento do Meta.
          }
        }
      });
    })(EVENTOS[i]);
  }

  // A compra do GOOGLE sai daqui, pela tag. A do Meta continua vindo do webhook
  // orders/create: este evento NAO vai para o coletor.
  ctx.analytics.subscribe("checkout_completed", function (event) {
    try {
      googleNoCheckout("purchase", event);
    } catch (e) {
      // Erro na tag nao pode derrubar a pagina de obrigado.
    }
  });
})();
