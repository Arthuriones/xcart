/* ===========================================================================
 * Captura do click id na vitrine.
 *
 * O problema que isto resolve: o clique no anuncio chega com ?gclid=... na
 * URL, mas o PEDIDO nasce no checkout da Shopify -- outro dominio, onde o
 * tema nao roda e o cookie da loja nao existe. Entre um e outro o clique se
 * perde, e a venda vira "direto".
 *
 * A ponte e o CART ATTRIBUTE. Ele viaja com o carrinho ate o pedido e aparece
 * no webhook orders/create, que e de onde o servidor manda a conversao.
 *
 * Cookie tambem, por 90 dias: cobre quem clica no anuncio hoje e compra
 * depois, sem passar de novo pelo link com gclid.
 *
 * Nao depende de jQuery nem do tema. Roda em qualquer pagina.
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

  achados._xc_vid = visitante();

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

  var anterior = jaGravado();
  var novos = {};
  var mudou = false;
  for (var k in achados) {
    if (!Object.prototype.hasOwnProperty.call(achados, k)) continue;
    novos[k] = achados[k];
    if (anterior[k] !== achados[k]) mudou = true;
  }

  if (!mudou) return;

  // O raiz precisa do prefixo de idioma quando a loja usa Markets com
  // sub-caminho (/ja, /en). Sem isso o POST cai em 404 e o atributo nunca
  // chega ao carrinho.
  function raiz() {
    var t = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return t.charAt(t.length - 1) === "/" ? t : t + "/";
  }

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
})();
