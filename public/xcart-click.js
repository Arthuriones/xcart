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

  // ---- 1b. _fbp e _fbc ----------------------------------------------------
  //
  // _fbp e o id de navegador do Meta e um dos sinais mais fortes que ele tem.
  // Normalmente quem grava e o pixel do navegador -- que aqui esta DESLIGADO de
  // proposito, para a mesma acao nao contar duas vezes. Sem ninguem gravando,
  // todo evento nosso ia sem ele.
  //
  // Entao geramos quando falta. O formato e o do proprio Meta:
  // fb.1.<timestamp em ms>.<numero aleatorio>. Uma vez gerado, fica no cookie
  // por 90 dias e todos os eventos daquele visitante levam o MESMO valor --
  // que e o ponto: um _fbp novo a cada evento descreveria uma pessoa diferente
  // a cada vez e pioraria o casamento em vez de melhorar.
  //
  // Se o pixel do tema voltar a existir, ele le e reusa este cookie; o formato e
  // o mesmo e nao ha conflito.
  var fbp = lerCookie("_fbp");
  if (!fbp) {
    fbp =
      "fb.1." + Date.now() + "." +
      Math.floor(1000000000 + Math.random() * 8999999999);
    gravarCookie("_fbp", fbp);
  }
  achados._fbp = fbp;

  // _fbc e diferente: ele representa um CLIQUE real em anuncio, e inventar um
  // sem fbclid na URL seria afirmar uma origem que nao aconteceu. So lemos o
  // cookie; quando ele nao existe, o servidor reconstroi a partir do fbclid --
  // e se nao houver fbclid, o evento vai sem, que e o correto.
  var fbc = lerCookie("_fbc");
  if (fbc) achados._fbc = fbc;

  // ---- 1c. os cookies que o proprio Google escreve ------------------------
  //
  // A tag de remarketing grava dois, e os dois valem muito:
  //
  // _gcl_au = "1.1.<a>.<b>.-.-..." -> `<a>.<b>` e o `auid`, identificador
  //   first-party do Google. E o equivalente exato do _fbp do Meta, e a
  //   requisicao real do gtag manda ele em TODA conversao. Sem ele, o Google
  //   perde a ligacao com o visitante quando o gclid nao esta presente.
  //
  // _gcl_aw = "GCL.<timestamp>.<gclid>" -> o gclid guardado pelo PROPRIO
  //   Google. Serve de segunda fonte: se a pessoa chegou numa pagina onde o
  //   nosso snippet nao rodou, ou o nosso cookie foi limpo, este ainda tem.
  function pedaco(valor, indice) {
    if (!valor) return null;
    var partes = String(valor).split(".");
    return partes.length > indice ? partes[indice] : null;
  }

  var gclAu = lerCookie("_gcl_au");
  if (gclAu) {
    var a = pedaco(gclAu, 2);
    var b = pedaco(gclAu, 3);
    if (a && b) achados._auid = a + "." + b;
  }

  var gclAw = lerCookie("_gcl_aw");
  if (gclAw && !achados.gclid) {
    // Terceiro pedaco; o gclid pode conter ponto, entao junta o resto.
    var partesAw = String(gclAw).split(".");
    if (partesAw.length > 2) {
      var doGoogle = partesAw.slice(2).join(".");
      if (doGoogle) achados.gclid = doGoogle;
    }
  }

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
   * O identificador de visitante da propria Shopify.
   *
   * E a PONTE para o checkout. O Web Pixel roda em sandbox e nao le os cookies
   * da loja -- ele nao enxerga o nosso `_xc_vid` nem o `_xc_gclid`. O que ele
   * conhece e este valor, que chega la como `event.clientId`.
   *
   * Mandando daqui, o servidor guarda "este clientId tem estes click ids", e o
   * evento que vier do checkout recupera a atribuicao por ele. Sem isso,
   * `begin_checkout` vindo do pixel chegaria sem gclid -- pior que o de hoje.
   */
  function clienteDaShopify() {
    try {
      var lib = window.ShopifyAnalytics && window.ShopifyAnalytics.lib;
      var traits = lib && lib.user ? lib.user().traits() : null;
      return (traits && traits.uniqToken) || null;
    } catch (e) {
      return null;
    }
  }

  /**
   * De onde este visitante chegou.
   *
   * Guardado na PRIMEIRA pagina da sessao e reusado depois. Sem isso, a partir
   * do segundo clique o referrer vira a propria loja e a origem some -- que e
   * exatamente o buraco que fez "o Google mandou trafego" e "era busca
   * organica do google.com" ficarem indistinguiveis daqui.
   *
   * sessionStorage, nao cookie: interessa a sessao, nao os 90 dias.
   */
  function origemDaSessao() {
    var chave = PREFIXO + "ref";
    try {
      var guardado = sessionStorage.getItem(chave);
      if (guardado !== null) return guardado;
    } catch (e) {
      /* navegacao privada: cai no referrer atual, que na 1a pagina esta certo */
    }
    var atual = document.referrer || "";
    // Navegacao interna nao e origem.
    try {
      if (atual && new URL(atual).hostname === location.hostname) atual = "";
    } catch (e) {
      /* referrer estranho: guarda como veio */
    }
    try {
      sessionStorage.setItem(chave, atual);
    } catch (e) {
      /* sem storage: so nao persiste */
    }
    return atual;
  }

  var ORIGEM = origemDaSessao();

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

  /**
   * Janela anti-duplicata, por tipo de evento.
   *
   * Era 1500ms e nao bastava. Medido em producao: o tema faz DUAS chamadas a
   * `/cart/add` por clique (mecanica de "leve 4 pague 3" acrescenta o item
   * brinde numa segunda requisicao), com 3 a 4 segundos entre elas -- e as duas
   * viravam conversao. Quatro visitantes, oito carrinhos no Google Ads.
   *
   * 8s cobre isso com folga. Nao suprime acao legitima repetida, porque o mapa e
   * POR EVENTO: ver produto e adicionar ao carrinho em sequencia continuam
   * passando. O que ele junta e o mesmo evento repetido em segundos, que para
   * contagem de conversao e sempre a mesma acao do comprador.
   *
   * Entre contar a mais e contar a menos, aqui o certo e contar a menos: numero
   * inflado estraga o lance automatico, que passa a mirar um passo que acontece
   * o dobro do que parece.
   */
  var JANELA_MS = 8000;

  function repetido(evento) {
    var agora = Date.now();
    if (ultimo[evento] && agora - ultimo[evento] < JANELA_MS) return true;
    ultimo[evento] = agora;
    return false;
  }

  /**
   * Qual produto e variante esta em tela.
   *
   * A ordem importa. `?variant=` e a escolha explicita do comprador; o input
   * `id` do formulario acompanha o seletor de variante e e o que sera de fato
   * adicionado; `ShopifyAnalytics.meta` so conhece a primeira variante, entao
   * fica por ultimo -- usar ela antes mandaria "P preto" quando a pessoa
   * escolheu "GG branco".
   *
   * getAttribute, nao `.id`: formulario com <input name="id"> sombreia a
   * propriedade e devolve o elemento. Ja mordeu neste repo.
   */
  function produtoAtual() {
    var variante = null;
    var produto = null;

    try {
      variante = new URLSearchParams(location.search).get("variant");
    } catch (e) {
      variante = null;
    }

    if (!variante) {
      var form = document.querySelector('form[action*="/cart/add"]');
      var campo = form && form.querySelector('[name="id"]');
      if (campo && campo.value) variante = campo.value;
    }

    var meta =
      window.ShopifyAnalytics && window.ShopifyAnalytics.meta
        ? window.ShopifyAnalytics.meta.product
        : null;
    if (meta) {
      produto = meta.id ? String(meta.id) : null;
      if (!variante && meta.variants && meta.variants[0]) {
        variante = String(meta.variants[0].id);
      }
    }

    return { variante: variante ? String(variante) : null, produto: produto };
  }

  /**
   * Eventos que carregam identificacao de produto.
   *
   * `begin_checkout` fica de fora de proposito: o carrinho pode ter varios
   * itens, e mandar so o ultimo produto visto descreveria uma compra que nao e
   * aquela. Melhor sem do que errado.
   */
  var COM_PRODUTO = { view_item: 1, add_to_cart: 1 };

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
      auid: achados._auid || null,
      // Sinais do Meta. _fbp e _fbc sao cookies que o pixel do navegador grava;
      // sem eles o Meta nao liga o evento do servidor a sessao, e o Event Match
      // Quality cai. O fbclid vai porque em quem chega pelo anuncio e nao tem
      // pixel no tema, e a unica coisa que existe -- o servidor reconstroi o
      // _fbc a partir dele.
      fbp: achados._fbp || null,
      fbc: achados._fbc || null,
      fbclid: achados.fbclid || null,
      referrer: ORIGEM || null,
      // Quando este evento ja leva o clientId, o aviso separado nao e preciso:
      // o coletor grava a associacao a partir dele.
      clientId: (function () {
        var cid = clienteDaShopify();
        if (cid) identidadeNoAr = true;
        return cid;
      })(),
      // Sem isto o Meta recebe AddToCart e ViewContent sem saber de QUAL
      // produto -- e `content_ids` e exigencia dele para publico dinamico e
      // para anuncio de catalogo. Nao e dado que o visitante possa inflar:
      // valor continua de fora.
      produto: COM_PRODUTO[evento] ? produtoAtual() : null,
      // A URL da pagina, EXPLICITA.
      //
      // O servidor nao pode deduzir do header Referer: o beacon vai para outro
      // dominio, e a politica padrao do navegador
      // (strict-origin-when-cross-origin) manda so a ORIGEM em requisicao
      // cross-origin. Medido: a pagina de produto chegava como
      // "https://loja.shop/", sem caminho nenhum.
      //
      // Isso custava duas coisas. No Meta, `event_source_url` identico em todo
      // evento piora o casamento e inutiliza regra por URL. E no diagnostico,
      // fazia parecer que todo mundo entrava pela home -- eu cheguei a concluir
      // isso e estava errado.
      pageUrl: location.href.slice(0, 500),
    });

    entregar(corpo);
  }

  /**
   * O transporte. text/plain de proposito: mantem a requisicao "simples" para
   * o CORS, sem o OPTIONS de preflight -- um ida e volta a menos, e sendBeacon
   * so aceita tipo simples de qualquer forma.
   */
  function entregar(corpo) {
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

  // ---- 2.1 a identidade, quando o trekkie finalmente chegar ----------------
  //
  // PROBLEMA MEDIDO EM PRODUCAO
  //
  // `ShopifyAnalytics.lib` e o trekkie, que a Shopify carrega de forma assincrona
  // -- depois do nosso script. O `view_item` dispara no DOMContentLoaded, e
  // nessa hora `lib.user` quase nunca existe ainda: em 7 dias, 949 visitantes
  // distintos na fila e 6 identidades gravadas.
  //
  // O QUE ISSO CUSTAVA
  //
  // O Web Pixel do checkout roda em sandbox e NAO le os cookies da loja: o
  // `clientId` da Shopify e a unica ponte que ele tem. Sem a associacao
  // publicada, todo `begin_checkout` e `payment_info` do checkout chegava sem
  // gclid e sem _fbp -- sem atribuicao no Google e com casamento fraco no Meta.
  //
  // Nao da para so esperar antes de mandar o evento: o visitante pode sair da
  // pagina antes. Entao o evento sai na hora e a identidade vai atras.
  //
  // Nao e um evento de conversao: o coletor grava a associacao e responde, sem
  // tocar na fila. Ler o cookie nao substitui isto -- a Shopify aposentou
  // `_shopify_y` e `_shopify_s` em 1 de janeiro de 2026, e eles nao existem
  // mais na loja.
  var identidadeNoAr = false;

  function publicarIdentidade(clientId) {
    if (identidadeNoAr || !clientId || !COLETOR || !LOJA) return;
    identidadeNoAr = true;
    entregar(
      JSON.stringify({
        shop: LOJA,
        storeId: STORE_ID,
        evento: "identidade",
        eventId: "identidade_" + vid,
        visitorId: vid,
        clientId: clientId,
        gclid: achados.gclid || null,
        gbraid: achados.gbraid || null,
        wbraid: achados.wbraid || null,
        auid: achados._auid || null,
        fbp: achados._fbp || null,
        fbc: achados._fbc || null,
        fbclid: achados.fbclid || null,
      })
    );
  }

  /** Tenta ate o trekkie aparecer. Desiste em 15s: quem nao carregou, nao vem. */
  function esperarClienteDaShopify() {
    var tentativas = 0;
    var alarme = setInterval(function () {
      tentativas++;
      var cid = clienteDaShopify();
      if (cid) {
        clearInterval(alarme);
        publicarIdentidade(cid);
      } else if (tentativas >= 60) {
        clearInterval(alarme);
      }
    }, 250);
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

  // =========================================================================
  // 4. REMARKETING DO GOOGLE
  //
  // Isto NAO da para fazer do servidor, e e o motivo de existir aqui.
  //
  // Quem monta o publico de remarketing e o Google, a partir de um cookie que
  // ele so consegue gravar quando o NAVEGADOR fala com ele diretamente. O nosso
  // ping de conversao sai do servidor com um gclid -- nao ha navegador nenhum
  // do outro lado para entrar em lista. Conversao server-side e remarketing sao
  // coisas diferentes, e uma nao substitui a outra.
  //
  // O QUE NAO PODE ACONTECER AQUI: disparar conversao.
  //
  // `gtag('config', 'AW-x')` sozinho manda um hit de remarketing e nada mais.
  // Conversao so sai com `gtag('event','conversion',{send_to:'AW-x/rotulo'})`.
  // Se alguem acrescentar isso, a venda passa a contar duas vezes -- uma pelo
  // navegador e outra pelo nosso servidor -- e o Google nao deduplica, porque os
  // dois caminhos nao compartilham identificador de transacao.
  // =========================================================================
  var REMARKETING = (tag && tag.getAttribute("data-xcart-remarketing")) || null;

  function tipoDaPagina() {
    // A propria Shopify classifica a pagina; so caio na URL quando ela nao
    // preencheu, porque o caminho muda em loja com Markets por sub-caminho.
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
    var doShopify = meta && meta.page && meta.page.pageType;
    if (doShopify) {
      if (doShopify === "product") return "product";
      if (doShopify === "collection") return "category";
      if (doShopify === "cart") return "cart";
      if (doShopify === "home" || doShopify === "index") return "home";
      return "other";
    }
    var p = location.pathname;
    if (p.indexOf("/products/") !== -1) return "product";
    if (p.indexOf("/collections/") !== -1) return "category";
    if (p.indexOf("/cart") !== -1) return "cart";
    if (p === "/" || /^\/[a-z]{2}(-[a-z]{2})?\/?$/i.test(p)) return "home";
    return "other";
  }

  function dadosDoProduto() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
    var prod = meta && meta.product;
    if (!prod) return null;
    var v = (prod.variants && prod.variants[0]) || null;
    return {
      id: String(v && v.id ? v.id : prod.id || ""),
      // `price` vem em centavos no ShopifyAnalytics.
      valor: v && typeof v.price === "number" ? v.price / 100 : null,
    };
  }

  /**
   * As contas do atributo. Uma ou varias, separadas por virgula.
   *
   * Varias porque cada conta de anuncio monta a SUA lista: publico criado na
   * conta A nao serve na conta B. Com cinco contas anunciando a mesma loja,
   * configurar so a primeira deixa quatro sem publico nenhum -- e o lojista nao
   * tem como notar, porque a lista simplesmente nunca enche.
   */
  function contasDeRemarketing() {
    if (!REMARKETING) return [];
    var fora = [];
    var partes = String(REMARKETING).split(",");
    for (var i = 0; i < partes.length; i++) {
      var c = partes[i].trim();
      // Vai para a URL do gtag e para `send_to`. Caractere estranho aqui so
      // pode ser erro de configuracao, e deixar passar quebraria a tag inteira.
      if (c && /^[A-Za-z0-9_-]+$/.test(c) && fora.indexOf(c) === -1) fora.push(c);
    }
    return fora;
  }

  function ligarRemarketing() {
    var contas = contasDeRemarketing();
    if (contas.length === 0) return;

    window.dataLayer = window.dataLayer || [];
    function gtag() {
      window.dataLayer.push(arguments);
    }

    // UM carregamento de gtag.js, nao um por conta: o arquivo e o mesmo e a
    // biblioteca atende varias contas pelo dataLayer. Carregar de novo so
    // duplicaria o download.
    var s = document.createElement("script");
    s.async = true;
    s.src =
      "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(contas[0]);
    document.head.appendChild(s);

    gtag("js", new Date());

    var pagina = tipoDaPagina();
    var prod = dadosDoProduto();

    for (var i = 0; i < contas.length; i++) {
      gtag("config", contas[i]);

      var params = { send_to: contas[i], ecomm_pagetype: pagina };
      if (prod && prod.id) {
        params.ecomm_prodid = prod.id;
        if (prod.valor !== null) params.ecomm_totalvalue = prod.valor;
      }
      // `page_view` com send_to e o hit de remarketing. NAO e conversao -- o
      // Google so conta conversao no evento com nome `conversion` e um rotulo.
      gtag("event", "page_view", params);
    }
  }

  if (document.readyState === "loading") {
    // Espera o ShopifyAnalytics.meta, que a Shopify preenche depois deste
    // script; sem ele o produto sai sem id e o publico fica generico.
    document.addEventListener("DOMContentLoaded", ligarRemarketing);
  } else {
    ligarRemarketing();
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
    esperarClienteDaShopify();

    // Este espera: le ShopifyAnalytics.meta, que a Shopify preenche mais tarde.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", verProduto);
    } else {
      verProduto();
    }
  }
})();
