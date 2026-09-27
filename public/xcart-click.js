/* ===========================================================================
 * Captura do click id e eventos de funil na vitrine.
 *
 * DUAS COISAS ACONTECEM AQUI.
 *
 * 1. CLICK ID ATE O PEDIDO
 *
 * O clique no anuncio chega com ?gclid=... na URL, mas o PEDIDO nasce no
 * checkout da Shopify -- outro dominio, onde o tema nao roda e o cookie da loja
 * nao existe. Entre um e outro o clique se perde, e a venda vira "direto".
 *
 * A ponte e o CART ATTRIBUTE. Ele viaja com o carrinho ate o pedido e aparece
 * no webhook orders/create, que e de onde o servidor manda a conversao.
 *
 * Cookie tambem, por 90 dias: cobre quem clica no anuncio hoje e compra
 * depois, sem passar de novo pelo link com gclid.
 *
 * 2. EVENTOS DE FUNIL (ver produto, carrinho, checkout)
 *
 * A Shopify nao tem webhook para essas tres acoes -- elas acontecem no
 * navegador. Entao aqui a gente AVISA o coletor do xcart, e e o servidor do
 * xcart que fala com o Google. O ping de conversao nunca sai do navegador: o
 * bloqueador de anuncio derruba a requisicao para googleadservices.com, e nao a
 * requisicao para ca.
 *
 * Nenhum valor monetario e enviado daqui. O coletor tambem ignora se vier --
 * valor vindo do navegador e numero que qualquer um pode inflar na conta de
 * anuncios do lojista. O valor da venda vem do webhook, que e a Shopify falando.
 *
 * Nao depende de jQuery nem do tema. ES5 de proposito: tema antigo ainda roda.
 * =========================================================================== */
(function () {
  "use strict";

  // gclid   = clique normal
  // gbraid  = campanha de app em iOS, web-to-app
  // wbraid  = campanha de app em iOS, app-to-web
  // Os dois ultimos existem porque o iOS 14 quebrou o gclid em parte do
  // trafego; o Google manda um OU outro, nunca os tres.
  var CHAVES = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid"];
  var DIAS = 90;
  var PREFIXO = "_xc_";

  function lerCookie(nome) {
    var m = document.cookie.match(
      new RegExp("(?:^|; )" + nome.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  function gravarCookie(nome, valor) {
    var validade = new Date(Date.now() + DIAS * 864e5).toUTCString();
    // Sem `domain`: fica first-party no host da loja, que e o que sobrevive
    // ao ITP. SameSite=Lax deixa o cookie ir na navegacao que vem do anuncio.
    document.cookie =
      nome + "=" + encodeURIComponent(valor) +
      "; expires=" + validade + "; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }

  function daUrl(chave) {
    try {
      return new URLSearchParams(location.search).get(chave);
    } catch (e) {
      return null;
    }
  }

  /** Id proprio do visitante, para casar com a identidade guardada no servidor. */
  function visitante() {
    var atual = lerCookie(PREFIXO + "vid");
    if (atual) return atual;
    var novo =
      Date.now().toString(36) + "." + Math.random().toString(36).slice(2, 10);
    gravarCookie(PREFIXO + "vid", novo);
    return novo;
  }

  // ---- 1. o que este visitante tem de click id ----------------------------
  var achados = {};
  for (var i = 0; i < CHAVES.length; i++) {
    var chave = CHAVES[i];
    var daQuery = daUrl(chave);
    if (daQuery) {
      // Clique novo sempre vence o cookie antigo: e a atribuicao mais recente.
      gravarCookie(PREFIXO + chave, daQuery);
      achados[chave] = daQuery;
    } else {
      var doCookie = lerCookie(PREFIXO + chave);
      if (doCookie) achados[chave] = doCookie;
    }
  }

  // O _fbp/_fbc do pixel do Meta, quando existir, vai junto de graca.
  var fbp = lerCookie("_fbp");
  if (fbp) achados._fbp = fbp;
  var fbc = lerCookie("_fbc");
  if (fbc) achados._fbc = fbc;

  var vid = visitante();
  achados._xc_vid = vid;

  // ---- 2. levar para o carrinho -------------------------------------------
  //
  // `/cart/update.js` com attributes faz o valor viajar ate o pedido. So
  // escrevemos o que mudou: cada chamada e uma requisicao, e o tema re-renderiza
  // o carrinho quando ele muda.
  function jaGravado() {
    try {
      return JSON.parse(sessionStorage.getItem(PREFIXO + "enviado") || "{}");
    } catch (e) {
      return {};
    }
  }

  function marcarGravado(mapa) {
    try {
      sessionStorage.setItem(PREFIXO + "enviado", JSON.stringify(mapa));
    } catch (e) {
      /* navegacao privada: reenviar nao machuca */
    }
  }

  // O raiz precisa do prefixo de idioma quando a loja usa Markets com
  // sub-caminho (/ja, /en). Sem isso o POST cai em 404 e o atributo nunca
  // chega ao carrinho.
  function raiz() {
    var t = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return t.charAt(t.length - 1) === "/" ? t : t + "/";
  }

  function gravarNoCarrinho() {
    var anterior = jaGravado();
    var novos = {};
    var mudou = false;
    for (var k in achados) {
      if (!Object.prototype.hasOwnProperty.call(achados, k)) continue;
      novos[k] = achados[k];
      if (anterior[k] !== achados[k]) mudou = true;
    }
    // Ja esta gravado neste carrinho: pular a requisicao. Isto e um `return` de
    // funcao, nao do arquivo -- antes era do arquivo, e quando o click id nao
    // mudava nada abaixo rodava.
    if (!mudou) return;

    fetch(raiz() + "cart/update.js", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ attributes: novos }),
    })
      .then(function (r) {
        if (r.ok) marcarGravado(novos);
      })
      .catch(function () {
        /* carrinho indisponivel agora; a proxima pagina tenta de novo */
      });
  }

  gravarNoCarrinho();

  // =========================================================================
  // 3. EVENTOS DE FUNIL
  // =========================================================================

  /**
   * Onde mandar.
   *
   * Tirado do `src` desta propria tag, em vez de cravado no codigo: o script e
   * servido pelo xcart, entao ele sabe de onde veio. Se o dominio do app mudar,
   * a tag no tema muda junto e isto acompanha sem reinstalar nada.
   */
  function tagPropria() {
    return (
      document.currentScript ||
      document.querySelector("script[data-xcart-click]")
    );
  }

  function origemDoApp(el) {
    try {
      return new URL(el.src).origin;
    } catch (e) {
      return null;
    }
  }

  var tag = tagPropria();
  var COLETOR = null;
  var origem = tag ? origemDoApp(tag) : null;
  if (origem) COLETOR = origem + "/api/tracking/collect";

  var LOJA = (window.Shopify && window.Shopify.shop) || null;

  /**
   * Qual LINHA de loja do xcart e esta.
   *
   * O mesmo dominio da Shopify pode estar cadastrado por mais de uma conta
   * xcart, cada uma com o seu app. Mandando so o dominio, o coletor tem que
   * adivinhar entre elas -- e errar manda a conversao para a conta de anuncios
   * de outra pessoa. O instalador crava o id aqui na tag para nao haver duvida.
   *
   * Tag antiga nao tem o atributo; ai o coletor cai no dominio, como antes.
   */
  var STORE_ID = (tag && tag.getAttribute("data-xcart-store")) || null;

  // Ultimo envio de cada evento, para nao contar a mesma acao duas vezes.
  //
  // Precisa existir porque a mesma acao chega por dois caminhos: o tema pode
  // adicionar ao carrinho por fetch E o formulario pode disparar submit, e o
  // clique em "finalizar" chega pelo listener de clique E pelo submit do
  // formulario do carrinho.
  var ultimo = {};
  var JANELA_MS = 1500;

  function repetido(evento) {
    var agora = Date.now();
    if (ultimo[evento] && agora - ultimo[evento] < JANELA_MS) return true;
    ultimo[evento] = agora;
    return false;
  }

  function mandar(evento) {
    if (!COLETOR || !LOJA) return;
    if (repetido(evento)) return;

    var corpo = JSON.stringify({
      shop: LOJA,
      storeId: STORE_ID,
      evento: evento,
      // Instante no id: protege contra reenvio da MESMA acao (o nosso retry, o
      // tema disparando duas vezes), sem impedir a acao repetida de verdade --
      // adicionar dois produtos ao carrinho sao dois eventos.
      eventId: evento + "_" + vid + "_" + Date.now(),
      visitorId: vid,
      gclid: achados.gclid || null,
      gbraid: achados.gbraid || null,
      wbraid: achados.wbraid || null,
      // Sinais do Meta. _fbp e _fbc sao cookies que o pixel do navegador grava;
      // sem eles o Meta nao liga o evento do servidor a sessao, e o Event Match
      // Quality cai. O fbclid vai porque em quem chega pelo anuncio e nao tem
      // pixel no tema, e a unica coisa que existe -- o servidor reconstroi o
      // _fbc a partir dele.
      fbp: achados._fbp || null,
      fbc: achados._fbc || null,
      fbclid: achados.fbclid || null,
    });

    // text/plain de proposito: mantem a requisicao "simples" para o CORS, sem
    // o OPTIONS de preflight. Um ida e volta a menos, e sendBeacon so aceita
    // tipo simples de qualquer forma.
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([corpo], { type: "text/plain;charset=UTF-8" });
        // sendBeacon sobrevive a navegacao: o clique em "finalizar compra" sai
        // da pagina, e um fetch comum seria cancelado no meio.
        if (navigator.sendBeacon(COLETOR, blob)) return;
      }
    } catch (e) {
      /* cai no fetch abaixo */
    }

    try {
      fetch(COLETOR, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: corpo,
        // keepalive deixa a requisicao terminar depois de a pagina sair.
        keepalive: true,
        mode: "cors",
      }).catch(function () {});
    } catch (e) {
      /* sem rede: evento perdido, e nao ha o que fazer no navegador */
    }
  }

  // ---- 3.1 ver produto ----------------------------------------------------
  //
  // Uma vez por produto por sessao: recarregar a pagina nao e uma visita nova.
  function verProduto() {
    var meta =
      (window.ShopifyAnalytics &&
        window.ShopifyAnalytics.meta &&
        window.ShopifyAnalytics.meta.product) ||
      null;
    if (!meta && location.pathname.indexOf("/products/") === -1) return;

    var marca = PREFIXO + "vi:" + location.pathname;
    try {
      if (sessionStorage.getItem(marca)) return;
      sessionStorage.setItem(marca, "1");
    } catch (e) {
      /* navegacao privada: manda de novo, o teto do coletor segura */
    }
    mandar("view_item");
  }

  // ---- 3.2 adicionar ao carrinho ------------------------------------------
  //
  // Tres caminhos, porque cada tema usa um. So `/cart/add` conta: o
  // `/cart/update.js` que este arquivo faz la em cima passaria por aqui se o
  // teste fosse por "/cart/".
  function ehAdicionar(url) {
    if (!url) return false;
    var texto = String(url);
    return texto.indexOf("/cart/add") !== -1;
  }

  function observarFetch() {
    if (typeof window.fetch !== "function") return;
    var original = window.fetch;
    window.fetch = function (entrada, init) {
      var url = null;
      try {
        url = typeof entrada === "string" ? entrada : entrada && entrada.url;
      } catch (e) {
        url = null;
      }
      var promessa = original.apply(this, arguments);
      if (ehAdicionar(url)) {
        // So depois de o servidor confirmar: adicionar que falhou (sem estoque,
        // variante invalida) nao e evento.
        promessa
          .then(function (r) {
            if (r && r.ok) mandar("add_to_cart");
          })
          .catch(function () {});
      }
      return promessa;
    };
  }

  function observarXhr() {
    if (!window.XMLHttpRequest || !XMLHttpRequest.prototype) return;
    var abrir = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (metodo, url) {
      if (ehAdicionar(url)) {
        this.addEventListener("load", function () {
          if (this.status >= 200 && this.status < 300) mandar("add_to_cart");
        });
      }
      return abrir.apply(this, arguments);
    };
  }

  // ---- 3.3 iniciar checkout ----------------------------------------------
  //
  // Captura na fase de CAPTURE, antes de o handler do tema (ou o loader de
  // roteamento) navegar para fora. Depois da navegacao nao ha mais pagina para
  // rodar codigo.
  function ehBotaoDeCheckout(alvo) {
    if (!alvo || !alvo.closest) return false;
    if (alvo.closest('[name="checkout"]')) return true;
    if (alvo.closest('button[type="submit"][value="checkout"]')) return true;
    var link = alvo.closest('a[href*="/checkout"]');
    if (link) return true;
    return false;
  }

  function observarCheckout() {
    document.addEventListener(
      "click",
      function (e) {
        if (ehBotaoDeCheckout(e.target)) mandar("begin_checkout");
      },
      true
    );

    // Tema sem AJAX envia o formulario do carrinho; o clique acima ja pegou na
    // maioria, mas submit por Enter no teclado nao passa por clique.
    document.addEventListener(
      "submit",
      function (e) {
        var f = e.target;
        if (!f || !f.getAttribute) return;
        // getAttribute, nao `.action`: formulario com um <input name="action">
        // sombreia a propriedade e devolve o elemento em vez da URL. Foi
        // exatamente esse tipo de armadilha que deu trabalho no `form.id`.
        var acao = f.getAttribute("action") || "";
        if (acao.indexOf("/cart") !== -1 && acao.indexOf("/cart/add") === -1) {
          mandar("begin_checkout");
        }
      },
      true
    );
  }

  if (COLETOR && LOJA) {
    // AGORA, sincronamente, nao no DOMContentLoaded.
    //
    // Trocar o window.fetch depois que o tema carregou nao serve: se ele ja
    // guardou a referencia original numa variavel dele, as chamadas dele passam
    // por fora do nosso wrapper e o add_to_cart nunca dispara. Os listeners de
    // clique e submit sao no document, que ja existe, e pegam elemento
    // renderizado depois de qualquer jeito.
    observarFetch();
    observarXhr();
    observarCheckout();

    // Este espera: le ShopifyAnalytics.meta, que a Shopify preenche mais tarde.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", verProduto);
    } else {
      verProduto();
    }
  }
})();
