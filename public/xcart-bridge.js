/* ===========================================================================
 * Ponte de click id: advertorial -> loja.
 *
 * O PROBLEMA
 *
 * Com o anuncio indo direto para a loja, o `?gclid=...` chega na URL da loja, o
 * snippet de la le e grava em cookie first-party. Tudo funciona.
 *
 * Com um advertorial no meio, o gclid chega na URL do ADVERTORIAL. O cookie que
 * ele gravaria fica no dominio do advertorial, e o navegador nao deixa a loja
 * ler cookie de outro dominio -- nem deveria. Se o link do CTA nao levar o
 * parametro adiante, o comprador chega na loja sem click id nenhum e a venda
 * vira "direto": a conversao ate sai, mas sem ligacao com o anuncio que pagou
 * por ela.
 *
 * A SOLUCAO
 *
 * Reescrever os links do CTA acrescentando os click ids. Nada muda na loja: o
 * snippet de la ja le da URL, entao para ele e como se o clique tivesse vindo
 * direto do anuncio.
 *
 * COMO USAR
 *
 *   <script src="https://user.xcart.app/xcart-bridge.js"
 *           data-xcart-destinos="linguo.shop"
 *           defer></script>
 *
 * VSL / pagina de oferta com link DIRETO para o checkout (permalink
 * https://loja/cart/VARIANTE:QTD): nenhuma pagina do tema roda no caminho,
 * entao ninguem na loja leria o `?fbclid=`. Nesses links a ponte grava os
 * mesmos valores como ATRIBUTO do carrinho (`attributes[fbclid]=...`, que a
 * Shopify aceita no permalink) -- o Web Pixel do checkout le de
 * `checkout.attributes` e o pedido nasce com eles em note_attributes, os
 * mesmos nomes que o tema grava via /cart/update.js. Vao junto os cookies dos
 * pixels de navegador DESTA pagina (_fbp, _fbc, _ttp): o Meta e o TikTok rodam
 * aqui, e a compra sai com o mesmo id de navegador que eles usaram.
 *
 * RASTREAMENTO DA PROPRIA PAGINA
 *
 *   <script src="https://user.xcart.app/xcart-bridge.js"
 *           data-xcart-destinos="imftvs-gc.myshopify.com,kings-culture.shop"
 *           data-xcart-store="<id da loja no xcart>"
 *           data-xcart-shop="imftvs-gc.myshopify.com"
 *           defer></script>
 *
 * Com `data-xcart-store` e `data-xcart-shop` a ponte tambem avisa o coletor do
 * xcart -- PageView ao abrir e ViewContent do produto dos botoes de compra --
 * e e o NOSSO servidor que fala com o Meta e o TikTok, igual ao snippet do
 * tema. A pagina nao precisa (e nao deve) ter o pixel do Meta no navegador:
 * contaria em dobro. Por isso a ponte gera o _fbp quando falta, como o
 * snippet, e NUNCA inventa _fbc: esse afirma um clique, e o servidor o monta
 * a partir do fbclid real. O visitante ganha um id (_xcb_vid) que vai junto
 * ao checkout como atributo _xc_vid: o PageView daqui, o InitiateCheckout do
 * pixel e a compra do webhook falam da mesma pessoa.
 *
 * `data-xcart-destinos` e OBRIGATORIO e nao aceita curinga. Sem lista, este
 * arquivo nao faz nada. O motivo: reescrever "todo link externo" mandaria o
 * gclid junto para o Instagram, para o WhatsApp e para qualquer outro link da
 * pagina -- entregar identificador de clique pago para terceiro, de graca.
 * Varios dominios separados por virgula.
 *
 * Funciona em hospedagem compartilhada, sem build. Nao depende de framework.
 * =========================================================================== */
(function () {
  "use strict";

  // Os mesmos que o snippet da loja entende. gbraid/wbraid substituem o gclid
  // no trafego de iOS; sem eles, essa parte da campanha chega sem atribuicao.
  var CLICK_IDS = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid"];
  // Cookies que os pixels de navegador gravam neste dominio. So lidos, nunca
  // inventados (o _fbp e a excecao, gerado so no modo de rastreamento): _fbc
  // afirma um clique, e _ttp e do pixel do TikTok.
  var COOKIES_DO_PIXEL = ["_fbp", "_fbc", "_ttp"];
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var DIAS = 90;
  var PREFIXO = "_xcb_";
  // Mesmo evento de novo na mesma aba dentro disto e recarga, nao nova visita.
  var JANELA_MS = 30 * 60 * 1000;

  function tagPropria() {
    return (
      document.currentScript || document.querySelector("script[data-xcart-destinos]")
    );
  }

  var tag = tagPropria();

  /**
   * Para quais hosts vale reescrever.
   *
   * Lista explicita, sem curinga. Host fora dela nao recebe nada.
   */
  function destinos() {
    var bruto = (tag && tag.getAttribute("data-xcart-destinos")) || "";
    var saida = [];
    var partes = bruto.split(",");
    for (var i = 0; i < partes.length; i++) {
      var d = partes[i].trim().toLowerCase().replace(/^www\./, "");
      if (d) saida.push(d);
    }
    return saida;
  }

  var DESTINOS = destinos();
  if (DESTINOS.length === 0) return;

  // ---- 0. rastreamento da pagina (opcional) --------------------------------
  //
  // A loja: `data-xcart-shop` (o dominio permanente) e, de preferencia, o id
  // da linha em `data-xcart-store` -- com o id o coletor nao tem o que
  // desempatar. Sem `data-xcart-shop`, serve o .myshopify.com da lista de
  // destinos: a tag antiga, so com a lista, passa a rastrear sem ser recolada.
  // Sem dominio nenhum, nao rastreia -- o coletor nao aceita evento sem loja.
  var STORE_ID = ((tag && tag.getAttribute("data-xcart-store")) || "").trim();
  var SHOP = ((tag && tag.getAttribute("data-xcart-shop")) || "").trim().toLowerCase();
  if (!SHOP) {
    for (var s = 0; s < DESTINOS.length; s++) {
      if (/\.myshopify\.com$/.test(DESTINOS[s])) {
        SHOP = DESTINOS[s];
        break;
      }
    }
  }
  var COLETOR = null;
  if (SHOP && tag && tag.src) {
    try {
      COLETOR = new URL(tag.src).origin + "/api/tracking/collect";
    } catch (e) {
      COLETOR = null;
    }
  }

  function lerCookie(nome) {
    var m = document.cookie.match(
      new RegExp("(?:^|; )" + nome.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  function gravarCookie(nome, valor) {
    var validade = new Date(Date.now() + DIAS * 864e5).toUTCString();
    document.cookie =
      nome + "=" + encodeURIComponent(valor) +
      "; expires=" + validade + "; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }

  // O visitante, no MESMO formato do _xc_vid do tema (base36 + "." + base36):
  // o pixel do checkout e o coletor so aceitam esse formato.
  function visitante() {
    var atual = lerCookie(PREFIXO + "vid");
    if (atual && /^[a-z0-9]+\.[a-z0-9]+$/.test(atual)) return atual;
    var novo = Date.now().toString(36) + "." + Math.random().toString(36).slice(2, 10);
    gravarCookie(PREFIXO + "vid", novo);
    return novo;
  }

  var vid = COLETOR ? visitante() : null;

  // _fbp e um dos sinais mais fortes do Meta, e sem pixel no navegador ninguem
  // grava. No modo de rastreamento a ponte gera quando falta, no formato do
  // proprio Meta, uma vez por visitante (90 dias): um _fbp novo a cada evento
  // descreveria uma pessoa diferente a cada vez. _fbc NUNCA: ver cabecalho.
  if (COLETOR && !lerCookie("_fbp")) {
    gravarCookie(
      "_fbp",
      "fb.1." + Date.now() + "." + Math.floor(1000000000 + Math.random() * 8999999999)
    );
  }

  // ---- 1. o que este visitante trouxe do anuncio --------------------------
  //
  // Cookie no dominio do advertorial, porque o visitante pode navegar entre
  // paginas dele antes de clicar no CTA -- e a partir da segunda pagina o
  // parametro ja nao esta mais na URL.
  var guardados = {};

  function coletar(chaves) {
    var q;
    try {
      q = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    for (var i = 0; i < chaves.length; i++) {
      var k = chaves[i];
      var daUrl = q.get(k);
      if (daUrl) {
        // Clique novo vence o cookie antigo: e a atribuicao mais recente.
        gravarCookie(PREFIXO + k, daUrl);
        guardados[k] = daUrl;
      } else {
        var doCookie = lerCookie(PREFIXO + k);
        if (doCookie) guardados[k] = doCookie;
      }
    }
  }

  coletar(CLICK_IDS);
  coletar(UTM);

  // Nada para levar: visita organica, ou o anuncio nao trouxe parametro. No
  // modo de rastreamento segue mesmo assim: o Meta e o TikTok atribuem por
  // visualizacao e entre aparelhos, e o organico nao infla campanha.
  var temAlgo = false;
  for (var k in guardados) {
    if (Object.prototype.hasOwnProperty.call(guardados, k)) temAlgo = true;
  }
  if (!temAlgo && !COLETOR) return;

  // ---- 2. reescrever o link ------------------------------------------------
  function ehDestino(href) {
    var u;
    try {
      u = new URL(href, location.href);
    } catch (e) {
      return false;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return false;
    var host = u.hostname.toLowerCase().replace(/^www\./, "");
    for (var i = 0; i < DESTINOS.length; i++) {
      var d = DESTINOS[i];
      // Casa o dominio e os subdominios dele, nao "naolinguo.shop".
      if (host === d || host.slice(-(d.length + 1)) === "." + d) return true;
    }
    return false;
  }

  /** Acrescenta o que falta, preservando o que o link ja trazia. */
  function comParametros(href) {
    var u;
    try {
      u = new URL(href, location.href);
    } catch (e) {
      return href;
    }

    for (var i = 0; i < CLICK_IDS.length; i++) {
      var c = CLICK_IDS[i];
      // Click id nosso SEMPRE vence: e o do clique que esta acontecendo agora.
      if (guardados[c]) u.searchParams.set(c, guardados[c]);
    }
    for (var j = 0; j < UTM.length; j++) {
      var m = UTM[j];
      // utm so quando o link nao define: quem escreveu a pagina pode ter
      // marcado aquele botao de proposito, e sobrescrever apagaria a intencao.
      if (guardados[m] && !u.searchParams.has(m)) {
        u.searchParams.set(m, guardados[m]);
      }
    }
    if (ehPermalink(u)) {
      for (var a = 0; a < CLICK_IDS.length; a++) {
        var id = CLICK_IDS[a];
        if (guardados[id]) u.searchParams.set("attributes[" + id + "]", guardados[id]);
      }
      for (var b = 0; b < COOKIES_DO_PIXEL.length; b++) {
        var nome = COOKIES_DO_PIXEL[b];
        var valor = lerCookie(nome);
        if (valor && valor.length <= 500) u.searchParams.set("attributes[" + nome + "]", valor);
      }
      // O visitante daqui, para o checkout e o pedido falarem da mesma pessoa
      // que o PageView e o ViewContent.
      if (vid) u.searchParams.set("attributes[_xc_vid]", vid);
    }
    return u.toString();
  }

  /**
   * Link direto para o checkout: /cart/VARIANTE:QTD, /cart/add... Tudo que
   * esta em /cart/ALGO pula o tema. A pagina /cart do tema fica de fora.
   */
  function ehPermalink(u) {
    return u.pathname.indexOf("/cart/") === 0 && u.pathname.length > "/cart/".length;
  }

  /** A URL de destino com os parametros, para redirecionamento feito em JS. */
  window.xcartUrl = function (href) {
    return ehDestino(href) ? comParametros(href) : href;
  };

  function reescreverTudo() {
    var links = document.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      var a = links[i];
      var href = a.getAttribute("href");
      if (!href || !ehDestino(href)) continue;
      var novo = comParametros(href);
      if (novo !== href) a.setAttribute("href", novo);
    }
  }

  // ---- 3. avisar o coletor: PageView e ViewContent -------------------------
  //
  // O mesmo corpo do snippet do tema (fonte "ponte"). Valor nao vai, nunca: o
  // coletor e publico. O produto do ViewContent e a variante do primeiro
  // botao de compra da pagina -- uma VSL vende uma oferta.
  function repetido(evento) {
    try {
      var chave = PREFIXO + "ev_" + evento;
      var antes = Number(sessionStorage.getItem(chave) || 0);
      if (antes && Date.now() - antes < JANELA_MS) return true;
      sessionStorage.setItem(chave, String(Date.now()));
    } catch (e) {
      /* sem storage (anonima, ITP): manda, e o servidor segura repeticao */
    }
    return false;
  }

  function varianteDaPagina() {
    var links = document.getElementsByTagName("a");
    for (var i = 0; i < links.length; i++) {
      var href = links[i].getAttribute("href");
      if (!href || !ehDestino(href)) continue;
      var m = href.match(/\/cart\/(\d+):/);
      if (m) return m[1];
    }
    return null;
  }

  function corpoDoEvento(evento, produto) {
    var instante = Date.now();
    return JSON.stringify({
      shop: SHOP,
      storeId: STORE_ID || undefined,
      evento: evento,
      // Instante no id: reenvio da mesma acao nao vira segundo evento.
      eventId: evento + "_" + vid + "_" + instante,
      visitorId: vid,
      gclid: guardados.gclid || null,
      gbraid: guardados.gbraid || null,
      wbraid: guardados.wbraid || null,
      fbp: lerCookie("_fbp") || null,
      fbc: lerCookie("_fbc") || null,
      fbclid: guardados.fbclid || null,
      ttclid: guardados.ttclid || null,
      ttp: lerCookie("_ttp") || null,
      referrer: document.referrer || null,
      produto: produto,
      // Explicita: o Referer cross-origin so leva a origem, sem caminho.
      pageUrl: location.href.slice(0, 500),
      fonte: "ponte",
    });
  }

  // text/plain mantem a requisicao "simples" para o CORS, sem preflight.
  function entregar(texto) {
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([texto], { type: "text/plain;charset=UTF-8" });
        if (navigator.sendBeacon(COLETOR, blob)) return;
      }
    } catch (e) {
      /* cai no fetch */
    }
    try {
      fetch(COLETOR, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=UTF-8" },
        body: texto,
        keepalive: true,
      });
    } catch (e) {
      /* sem rede: o evento se perde, a pagina nao */
    }
  }

  function rastrear() {
    if (!COLETOR) return;
    if (!repetido("page_view")) entregar(corpoDoEvento("page_view", null));
    var variante = varianteDaPagina();
    if (variante && !repetido("view_item")) {
      entregar(corpoDoEvento("view_item", { variante: variante }));
    }
  }

  function aoCarregar() {
    reescreverTudo();
    rastrear();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", aoCarregar);
  } else {
    aoCarregar();
  }

  // Botao que aparece depois (timer de oferta, conteudo carregado por JS,
  // popup de saida). Sem isto, justamente o CTA principal de muito advertorial
  // ficaria de fora.
  if (window.MutationObserver) {
    new MutationObserver(reescreverTudo).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
  }

  // Ultima rede de seguranca, na fase de captura: pega link cujo href foi
  // definido por JS no proprio clique, antes de a navegacao acontecer.
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href || !ehDestino(href)) return;
      var novo = comParametros(href);
      if (novo !== href) a.setAttribute("href", novo);
    },
    true
  );
})();
