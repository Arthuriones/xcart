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
 * aqui, e a compra sai com o mesmo id de navegador que eles usaram. E as UTMs
 * do anuncio (_xc_utm_*, _xc_utm_gad, _xc_utm_clique e a hora do clique em
 * _xc_utm_em): sao a campanha, o conjunto e o anuncio do pedido. No link para
 * as paginas da loja vai a hora do clique (xcart_clique_em), para o snippet de
 * la nao tomar o click id repassado por um clique de agora.
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
 * xcart -- PageView ao abrir, ViewContent do produto dos botoes de compra e
 * InitiateCheckout no clique do link direto para o checkout (3c) --
 * e e o NOSSO servidor que fala com o Meta e o TikTok, igual ao snippet do
 * tema. A pagina nao precisa (e nao deve) ter o pixel do Meta no navegador:
 * contaria em dobro. Por isso a ponte gera o _fbp quando falta, como o
 * snippet, e NUNCA inventa _fbc: esse afirma um clique, e o servidor o monta
 * a partir do fbclid real. O visitante ganha um id (_xcb_vid) que vai junto
 * ao checkout como atributo _xc_vid: o PageView daqui, o InitiateCheckout do
 * pixel e a compra do webhook falam da mesma pessoa.
 *
 * PAGINA DE VENDAS DE UM CHECKOUT EXTERNO (Cakto)
 *
 *   <script src="https://user.xcart.app/xcart-bridge.js"
 *           data-xcart-destinos="pay.cakto.com.br"
 *           data-xcart-checkout="<id do checkout no xcart>"
 *           defer></script>
 *
 * O botao aponta para o link da oferta na Cakto, sem nada a mais. A ponte poe
 * nele `callback=xc.<vid>` (so se o link ainda nao tiver um callback: a Cakto
 * devolve esse campo no webhook e o xcart acha o visitante por ele), as UTMs e
 * os click ids (o gclid e da tag do Google que fica na Cakto). E avisa o
 * coletor -- para o CHECKOUT, nao para loja -- do PageView ao abrir e do
 * InitiateCheckout no clique do botao para a Cakto (uma vez em 30 min, sem
 * valor). A compra vem do webhook da Cakto, com o mesmo visitante: IP, user
 * agent, _fbp e o clique do anuncio saem daqui. `data-xcart-param-vid="sck"`
 * leva o visitante no `sck` em vez do `callback`. Com `data-xcart-checkout`
 * a pagina rastreia para o checkout mesmo que tenha `data-xcart-store`.
 *
 * VITRINE DE UMA ROTA (vitrine -> loja de checkout)
 *
 * A mesma tag do rastreamento da pagina, colada no tema da VITRINE, com
 * `data-xcart-shop` = a loja de checkout. O carrinho acontece na vitrine, onde
 * a loja de checkout nao tem snippet nem pixel: sem isto o Meta da loja de
 * checkout via InitiateCheckout e Purchase sem nenhum ViewContent ou
 * AddToCart antes (medido em 25/10 na Stepz Club: 105 carrinhos roteados e 0
 * AddToCart). Com o loader de roteamento na pagina, a ponte manda tambem:
 *
 *   - view_item na pagina de produto (uma vez por produto em 30 min na aba);
 *   - add_to_cart quando o /cart/add da vitrine da certo -- fetch, XHR ou o
 *     submit nativo do formulario, com a janela de 8 s do snippet do tema;
 *   - begin_checkout no clique do link que o loader cria para levar o
 *     carrinho a loja de checkout, so quando o destino e ESTA loja (3c). O
 *     pixel do checkout, quando roda, o cancela pelo visitante ou pelo IP (o
 *     clientId dele e de outra loja).
 *
 * O produto e o da LOJA DE CHECKOUT: a variante da vitrine nao existe no
 * catalogo dela. A ponte le o mesmo xcart-config.json que o loader usa para
 * rotear (o destino desta loja: variant_map, depois sku_map) e manda a
 * variante do checkout; o SKU so quando o sku_map confirma o mesmo par.
 * Variante sem par vai SEM produto -- nunca com o id da vitrine, que sujaria o
 * catalogo com ids que nao casam. O id do produto do checkout nao esta no
 * mapa: template `{product_id}` sai sem content_ids. Valor nunca vai. Com
 * rodizio, conta para a loja de `data-xcart-shop`, nao para a sorteada.
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
  // Os mesmos que o snippet da loja guarda (1e): no permalink vao como
  // attributes[_xc_utm_*] com a hora do clique (_xc_utm_em).
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "utm_id"];
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
  // A pagina de vendas de um checkout externo (Cakto): o id dele no xcart. Com
  // ele a ponte rastreia para o checkout e poe o visitante no link do botao.
  var CHECKOUT_ID = ((tag && tag.getAttribute("data-xcart-checkout")) || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(CHECKOUT_ID)) CHECKOUT_ID = "";
  // O parametro do link que leva o visitante: o `callback`, que a Cakto
  // devolve no webhook; `sck` so a pedido (a Utmify reescreve o sck).
  var PARAM_VID =
    ((tag && tag.getAttribute("data-xcart-param-vid")) || "").trim().toLowerCase() === "sck" ? "sck" : "callback";
  var COLETOR = null;
  if ((SHOP || CHECKOUT_ID) && tag && tag.src) {
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

  function apagarCookie(nome) {
    document.cookie =
      nome + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }

  /**
   * As UTMs, como CONJUNTO e com a hora do clique (o mesmo acordo do snippet
   * da loja, secao 1e): clique novo substitui o conjunto inteiro, e o guardado
   * so vale 7 dias. Clique novo e UTM, gad_campaignid ou so o click id (Google
   * so com auto-tagging, TikTok sem o modelo), que entra como `clique`. Sem
   * isto o link do CTA levaria a UTM de um clique de 2 meses atras -- ou a de
   * um clique do Meta depois de um clique novo no Google.
   */
  var EXTRAS_UTM = ["gad_campaignid", "clique"];
  var CONJUNTO_UTM = UTM.concat(EXTRAS_UTM);
  var utmEm = null;
  // A hora do ultimo clique, de qualquer idade (o cookie dura 90 dias, como os
  // click ids): vai com o click id repassado as paginas da loja.
  var cliqueEm = null;

  function cliqueDaUrl(q) {
    if (q.get("gclid") || q.get("gbraid") || q.get("wbraid")) return "google";
    if (q.get("fbclid")) return "meta";
    if (q.get("ttclid")) return "tiktok";
    return null;
  }

  function coletarUtm() {
    var q;
    try {
      q = new URLSearchParams(location.search);
    } catch (e) {
      return;
    }
    var nova = {};
    var naUrl = false;
    for (var i = 0; i < UTM.length; i++) {
      if (q.get(UTM[i])) {
        nova[UTM[i]] = q.get(UTM[i]);
        naUrl = true;
      }
    }
    var gad = q.get("gad_campaignid");
    if (gad && /^\d{5,25}$/.test(gad)) {
      nova.gad_campaignid = gad;
      naUrl = true;
    }
    var clique = cliqueDaUrl(q);
    if (clique) {
      nova.clique = clique;
      naUrl = true;
    }
    // O click id da URL que ja estava no cookie e o MESMO clique (recarga,
    // voltar, aba reaberta): a hora fica a de quando ele chegou. Por isso
    // roda antes de coletar(CLICK_IDS), que regrava os cookies.
    var mesmoClique = clique !== null;
    for (var c = 0; c < CLICK_IDS.length; c++) {
      var id = q.get(CLICK_IDS[c]);
      if (id && lerCookie(PREFIXO + CLICK_IDS[c]) !== id) mesmoClique = false;
    }
    // Mesmo clique SEM conjunto guardado valido (cookie do click id de antes
    // deste conjunto existir): vale a URL, como clique novo.
    var emGuardado = lerCookie(PREFIXO + "utm_em");
    var temGuardado = !!emGuardado && /^\d+$/.test(emGuardado) && Date.now() - Number(emGuardado) <= 7 * 864e5;
    if (naUrl && (!mesmoClique || !temGuardado)) {
      for (var j = 0; j < CONJUNTO_UTM.length; j++) {
        var chave = CONJUNTO_UTM[j];
        if (nova[chave]) {
          gravarCookie(PREFIXO + chave, nova[chave]);
          guardados[chave] = nova[chave];
        } else {
          apagarCookie(PREFIXO + chave);
        }
      }
      utmEm = cliqueEm = String(Date.now());
      gravarCookie(PREFIXO + "utm_em", utmEm);
      return;
    }
    var em = lerCookie(PREFIXO + "utm_em");
    if (!em || !/^\d+$/.test(em)) return;
    cliqueEm = em;
    if (Date.now() - Number(em) > 7 * 864e5) return;
    utmEm = em;
    for (var k = 0; k < CONJUNTO_UTM.length; k++) {
      var doCookie = lerCookie(PREFIXO + CONJUNTO_UTM[k]);
      if (doCookie) guardados[CONJUNTO_UTM[k]] = doCookie;
    }
  }

  /** O conjunto para o coletor (a identidade), no formato do snippet da loja. */
  function utmDoEvento() {
    if (!utmEm) return undefined;
    var saida = { em: Number(utmEm) };
    var algo = false;
    for (var i = 0; i < CONJUNTO_UTM.length; i++) {
      var v = guardados[CONJUNTO_UTM[i]];
      // Com "@" e e-mail: nao vai.
      if (v && v.indexOf("@") === -1) {
        saida[CONJUNTO_UTM[i]] = v.slice(0, 200);
        algo = true;
      }
    }
    return algo ? saida : undefined;
  }

  coletarUtm();
  coletar(CLICK_IDS);

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

    var levouClique = false;
    for (var i = 0; i < CLICK_IDS.length; i++) {
      var c = CLICK_IDS[i];
      // Click id nosso SEMPRE vence: e o do clique que esta acontecendo agora.
      if (guardados[c]) {
        u.searchParams.set(c, guardados[c]);
        levouClique = true;
      }
    }
    var paraLink = UTM.concat(["gad_campaignid"]);
    for (var j = 0; j < paraLink.length; j++) {
      var m = paraLink[j];
      // utm so quando o link nao define: quem escreveu a pagina pode ter
      // marcado aquele botao de proposito, e sobrescrever apagaria a intencao.
      if (guardados[m] && !u.searchParams.has(m)) {
        u.searchParams.set(m, guardados[m]);
        levouClique = true;
      }
    }
    // O visitante, para o webhook do checkout achar quem clicou. So se o link
    // nao trouxer um: quem montou a pagina pode usar o campo para outra coisa.
    if (CHECKOUT_ID && vid && !u.searchParams.has(PARAM_VID)) u.searchParams.set(PARAM_VID, "xc." + vid);
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
      // A campanha, o conjunto e o anuncio vao ao PEDIDO pelo mesmo caminho:
      // nenhuma pagina da loja roda antes do checkout. Com a hora do clique,
      // que o servidor confere contra a janela de 7 dias.
      var conjunto = utmDoEvento();
      if (conjunto) {
        for (var t = 0; t < CONJUNTO_UTM.length; t++) {
          var k = CONJUNTO_UTM[t];
          // Os nomes que o snippet da loja grava no carrinho.
          var nomeUtm = k === "gad_campaignid" ? "utm_gad" : k === "clique" ? "utm_clique" : k;
          if (conjunto[k]) u.searchParams.set("attributes[_xc_" + nomeUtm + "]", conjunto[k]);
        }
        u.searchParams.set("attributes[_xc_utm_em]", utmEm);
      }
    } else if (levouClique && cliqueEm && !CHECKOUT_ID) {
      // A hora do clique que a ponte viu: o snippet da loja nao toma um click
      // id de semanas atras por um clique de agora.
      u.searchParams.set("xcart_clique_em", cliqueEm);
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
    if (CHECKOUT_ID) {
      // Pagina de um checkout externo: o checkout no lugar da loja, e sem
      // produto (a oferta e da Cakto). O resto e o mesmo acordo.
      return JSON.stringify({
        checkoutId: CHECKOUT_ID,
        evento: evento,
        eventId: evento + "_" + vid + "_" + instante,
        visitorId: vid,
        gclid: guardados.gclid || null,
        fbp: lerCookie("_fbp") || null,
        fbc: lerCookie("_fbc") || null,
        fbclid: guardados.fbclid || null,
        ttclid: guardados.ttclid || null,
        ttp: lerCookie("_ttp") || null,
        referrer: document.referrer || null,
        pageUrl: location.href.slice(0, 500),
        utm: utmDoEvento(),
        fonte: "ponte",
      });
    }
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
      // O conjunto do clique (UTMs e a hora): vai para a identidade, a origem
      // do pedido que chega sem atributo.
      utm: utmDoEvento(),
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

  // ---- 3b. vitrine de rota: produto e carrinho para a loja de checkout -----
  //
  // Ver o cabecalho. So com o loader de roteamento na pagina, numa loja que
  // NAO e a do rastreamento: na propria loja quem conta e o snippet do tema, e
  // sem rota o carrinho daqui nao vira carrinho na loja de checkout.
  var LOADER = COLETOR && SHOP && !CHECKOUT_ID
    ? document.querySelector('script[src*="/routed-checkout-loader.js"]')
    : null;
  var LOJA_DA_PAGINA = String((window.Shopify && window.Shopify.shop) || "").toLowerCase();
  var NA_VITRINE = !!LOADER && !!LOJA_DA_PAGINA && LOJA_DA_PAGINA !== SHOP;

  /**
   * O destino desta loja no mapa da rota (o formato do loader, novo ou o
   * antigo de um destino so). Pelo dominio permanente, e depois pelos
   * dominios da lista: o destino guarda o dominio de checkout quando a rota
   * tem um. Nenhum casou = sem mapa: o evento vai sem produto.
   */
  function destinoDoMapa(cfg) {
    var lista = cfg && cfg.targets && cfg.targets.length ? cfg.targets : cfg && cfg.domain ? [cfg] : [];
    var hosts = [];
    for (var i = 0; i < lista.length; i++) {
      hosts.push(
        String((lista[i] && lista[i].domain) || "")
          .trim()
          .toLowerCase()
          .replace(/^https?:\/\//, "")
          .replace(/^www\./, "")
      );
    }
    for (var j = 0; j < lista.length; j++) if (hosts[j] === SHOP) return lista[j];
    for (var k = 0; k < lista.length; k++) if (hosts[k] && DESTINOS.indexOf(hosts[k]) !== -1) return lista[k];
    return null;
  }

  // null = ainda nao lido; false = sem mapa.
  var mapa = null;
  var esperandoMapa = [];

  function esvaziarFila(destino) {
    var fila = esperandoMapa;
    esperandoMapa = [];
    for (var i = 0; i < fila.length; i++) fila[i](destino);
  }

  function soltarMapa(destino) {
    if (mapa !== null) return;
    mapa = destino || false;
    esvaziarFila(mapa);
  }

  /**
   * O mesmo xcart-config.json do loader. O loader acabou de buscar a mesma
   * URL, entao isto sai do cache do navegador. Um mapa que nao chega nao
   * segura o evento: 4 s, ou a pagina saindo, e ele vai sem produto.
   */
  function lerMapa() {
    var embutido = LOADER.getAttribute("data-config");
    if (embutido) {
      try {
        soltarMapa(destinoDoMapa(JSON.parse(embutido)));
      } catch (e) {
        soltarMapa(false);
      }
      return;
    }
    var url = LOADER.getAttribute("data-config-url");
    if (!url) return soltarMapa(false);
    setTimeout(function () {
      soltarMapa(false);
    }, 4000);
    try {
      fetch(url, { cache: "force-cache" })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(
          function (cfg) {
            soltarMapa(destinoDoMapa(cfg));
          },
          function () {
            soltarMapa(false);
          }
        );
    } catch (e) {
      soltarMapa(false);
    }
  }

  var lendoMapa = false;

  function comMapa(fn) {
    if (mapa !== null) return fn(mapa);
    esperandoMapa.push(fn);
    if (!lendoMapa) {
      lendoMapa = true;
      lerMapa();
    }
  }

  function idNumerico(v) {
    var s = String(v === null || v === undefined ? "" : v);
    if (s.indexOf("gid://") !== -1) s = s.split("/").pop() || "";
    return /^\d+$/.test(s) ? s : null;
  }

  /** A variante da vitrine vira a do checkout pelo par da rota; sem par, null. */
  function produtoNoCheckout(destino, item) {
    if (!destino || !item) return null;
    var vm = destino.variantMap || {};
    var sm = destino.skuMap || {};
    var sku = item.sku ? String(item.sku).trim() : "";
    var peloSku = sku ? idNumerico(sm[sku.toLowerCase()]) : null;
    var variante =
      idNumerico(vm["gid://shopify/ProductVariant/" + item.variante]) || idNumerico(vm[item.variante]) || peloSku;
    if (!variante) return null;
    // O par por SKU garante o mesmo SKU nas duas lojas; o do variant_map nao
    // (o par antigo fica quando o SKU da vitrine muda).
    return peloSku === variante ? { variante: variante, sku: sku } : { variante: variante };
  }

  function itemValido(variante, sku) {
    var v = idNumerico(variante);
    return v ? { variante: v, sku: sku ? String(sku) : null } : null;
  }

  /**
   * A variante em tela. A ordem do snippet do tema (produtoAtual): o
   * formulario, o ?variant=, o primeiro formulario de compra e a primeira
   * variante do ShopifyAnalytics; o SKU sai do ShopifyAnalytics.
   */
  function produtoDaPagina(form) {
    var variante = null;
    var campo = form && form.querySelector ? form.querySelector('[name="id"]') : null;
    if (campo && campo.value) variante = campo.value;
    if (!variante) {
      try {
        variante = new URLSearchParams(location.search).get("variant");
      } catch (e) {
        variante = null;
      }
    }
    if (!variante) {
      var f = document.querySelector('form[action*="/cart/add"]');
      var c = f && f.querySelector('[name="id"]');
      if (c && c.value) variante = c.value;
    }
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta ? window.ShopifyAnalytics.meta.product : null;
    var variantes = (meta && meta.variants) || [];
    if (!variante && variantes[0]) variante = variantes[0].id;
    var sku = null;
    for (var i = 0; i < variantes.length; i++) {
      if (String(variantes[i].id) === String(variante)) {
        sku = variantes[i].sku || null;
        break;
      }
    }
    return itemValido(variante, sku);
  }

  /** O item que o /cart/add devolveu: acerta tambem a compra rapida da colecao. */
  function itemDoAdd(dados) {
    var item = dados && dados.items && dados.items.length ? dados.items[0] : dados;
    if (!item || typeof item !== "object") return null;
    return itemValido(item.variant_id || item.id, item.sku);
  }

  function mandarDaVitrine(evento, item) {
    comMapa(function (destino) {
      entregar(corpoDoEvento(evento, produtoNoCheckout(destino, item)));
    });
  }

  function verProdutoNaVitrine() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta ? window.ShopifyAnalytics.meta.product : null;
    if (!meta && location.pathname.indexOf("/products/") === -1) return;
    if (repetido("view_item:" + location.pathname)) return;
    mandarDaVitrine("view_item", produtoDaPagina(null));
  }

  // A janela do snippet do tema (JANELA_MS de xcart-click.js): o tema que faz
  // duas chamadas ao /cart/add por clique (brinde do "leve 4 pague 3", 3 a 4 s
  // depois) conta um carrinho, nao dois.
  var JANELA_CARRINHO_MS = 8000;
  var ultimoCarrinho = 0;

  function adicionou(item) {
    var agora = Date.now();
    if (agora - ultimoCarrinho < JANELA_CARRINHO_MS) return;
    ultimoCarrinho = agora;
    mandarDaVitrine("add_to_cart", item || produtoDaPagina(null));
  }

  // So `/cart/add` conta, como no snippet: change/update/clear nao sao carrinho novo.
  function ehAdicionar(url) {
    return !!url && String(url).indexOf("/cart/add") !== -1;
  }

  // Os tres caminhos do snippet do tema. O wrapper do fetch e do XHR vale para
  // o tema e para o "Comprar agora" do loader (que adiciona antes de rotear).
  // So depois de o servidor confirmar: adicionar que falhou nao e evento.
  function observarCarrinhoDaVitrine() {
    if (window.__xcartPonteCarrinho) return;
    window.__xcartPonteCarrinho = true;

    if (typeof window.fetch === "function") {
      var original = window.fetch;
      window.fetch = function (entrada) {
        var url = null;
        try {
          url = typeof entrada === "string" ? entrada : entrada && (entrada.url || entrada.href);
        } catch (e) {
          url = null;
        }
        var promessa = original.apply(this, arguments);
        if (ehAdicionar(url)) {
          // Le de uma COPIA, antes do tema: este `then` foi registrado primeiro.
          promessa
            .then(function (r) {
              if (!r || !r.ok) return;
              var copia = null;
              try {
                var tipo = String((r.headers && r.headers.get("content-type")) || "");
                if (tipo.indexOf("json") !== -1 && typeof r.clone === "function") copia = r.clone();
              } catch (e) {
                copia = null;
              }
              if (!copia) return adicionou(null);
              return copia.json().then(itemDoAdd, function () {
                return null;
              }).then(adicionou);
            })
            .catch(function () {});
        }
        return promessa;
      };
    }

    if (window.XMLHttpRequest && XMLHttpRequest.prototype) {
      var abrir = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (metodo, url) {
        if (ehAdicionar(url)) {
          this.addEventListener("load", function () {
            if (this.status < 200 || this.status >= 300) return;
            var item = null;
            try {
              item = itemDoAdd(this.responseType === "json" ? this.response : JSON.parse(this.responseText));
            } catch (e) {
              item = null;
            }
            adicionou(item);
          });
        }
        return abrir.apply(this, arguments);
      };
    }

    // Tema sem AJAX: o formulario vai ao /cart/add pelo navegador. Conferido
    // DEPOIS de todos os ouvintes: o tema que segura o submit (preventDefault)
    // adiciona por fetch/XHR, e esse ja conta acima. sendBeacon sobrevive a
    // navegacao.
    document.addEventListener("submit", function (e) {
      var f = e.target;
      if (!f || !f.getAttribute || !ehAdicionar(f.getAttribute("action"))) return;
      setTimeout(function () {
        if (!e.defaultPrevented) adicionou(produtoDaPagina(f));
      }, 0);
    });

    // Evento esperando o mapa quando a pagina sai: vai sem produto.
    if (window.addEventListener) {
      window.addEventListener("pagehide", function () {
        esvaziarFila(false);
      });
    }
  }

  // AGORA, nao no DOMContentLoaded: o tema chama o fetch na hora do clique.
  if (NA_VITRINE) {
    observarCarrinhoDaVitrine();
    // Pagina de produto: o mapa ja vem para o view_item e para o carrinho.
    var naPaginaDeProduto =
      (window.ShopifyAnalytics && window.ShopifyAnalytics.meta && window.ShopifyAnalytics.meta.product) ||
      location.pathname.indexOf("/products/") !== -1;
    if (naPaginaDeProduto) comMapa(function () {});
  }

  function rastrear() {
    if (!COLETOR) return;
    if (!repetido("page_view")) entregar(corpoDoEvento("page_view", null));
    // Pagina de checkout externo: nao ha produto da Shopify para o ViewContent.
    if (CHECKOUT_ID) return;
    // Vitrine de rota: o produto e o da pagina, no catalogo do checkout (3b).
    if (NA_VITRINE) return verProdutoNaVitrine();
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

  // O clique no botao que leva ao checkout externo: o InitiateCheckout. Uma vez
  // em 30 min por aba (o coletor tambem segura). Sem valor, como todo evento
  // daqui. sendBeacon sobrevive a navegacao que vem logo depois.
  function inicioDoCheckout() {
    if (!CHECKOUT_ID || !COLETOR) return;
    if (!repetido("begin_checkout")) entregar(corpoDoEvento("begin_checkout", null));
  }

  // ---- 3c. o checkout da LOJA rastreada: abriu checkout = InitiateCheckout --
  //
  // Sem nada preenchido, no clique que leva ao checkout dela. Dois caminhos:
  //
  //   - o link que o loader de roteamento cria e clica para levar o carrinho da
  //     vitrine a loja de checkout (marca data-xcart-rota);
  //   - o link direto para o checkout numa VSL/advertorial, /cart/VARIANTE:QTD.
  //
  // So quando o link vai para ESTA loja (data-xcart-shop ou um dominio da
  // lista): com rodizio o sorteio pode mandar a outra loja de checkout, e o IC
  // dela nao e daqui. Na propria loja quem conta e o snippet do tema.
  //
  // Com o Web Pixel cobrindo a loja o coletor guarda o clique como RESERVA: o
  // checkout_started do pixel (o IC rico) a cancela, pelo visitante ou pelo IP,
  // e ela so sai quando o pixel nao roda (consentimento negado, Shop Pay em
  // shop.app). Sem pixel, sai na hora. Uma vez em 30 min por aba, sem valor e
  // sem gtag; sendBeacon, porque a navegacao vem logo depois. Isto so manda o
  // evento: nao poe nada no link.
  function checkoutDaLoja(a, href) {
    if (!COLETOR || !SHOP || CHECKOUT_ID) return;
    if (LOJA_DA_PAGINA === SHOP) return;
    var u;
    try {
      u = new URL(href, location.href);
    } catch (e) {
      return;
    }
    if (u.protocol !== "http:" && u.protocol !== "https:") return;
    var host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (host !== SHOP && !ehDestino(u.href)) return;
    var daRota = !!a.getAttribute && a.getAttribute("data-xcart-rota") !== null;
    if (!daRota && !/^\/cart\/\d+:\d+/.test(u.pathname)) return;
    // A janela e por loja: a vitrine com duas lojas do rodizio rastreadas leva
    // uma tag de cada, no mesmo sessionStorage, e o IC de uma nao tranca o da
    // outra quando o proximo sorteio cai nela.
    if (!repetido("begin_checkout:" + SHOP)) entregar(corpoDoEvento("begin_checkout", null));
  }

  // Ultima rede de seguranca, na fase de captura: pega link cujo href foi
  // definido por JS no proprio clique, antes de a navegacao acontecer.
  document.addEventListener(
    "click",
    function (e) {
      var a = e.target && e.target.closest ? e.target.closest("a[href]") : null;
      if (!a) return;
      var href = a.getAttribute("href");
      if (!href) return;
      // Pelo href como o loader (ou a pagina) o montou, antes da reescrita.
      checkoutDaLoja(a, href);
      if (!ehDestino(href)) return;
      var novo = comParametros(href);
      if (novo !== href) a.setAttribute("href", novo);
      inicioDoCheckout();
    },
    true
  );
})();
