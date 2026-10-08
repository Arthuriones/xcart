(function () {
  // Politica de referrer do DOCUMENTO -- ultimo recurso, nao o caminho normal.
  //
  // Antes isto rodava sempre, no topo do arquivo. Como o script vive no
  // theme.liquid, toda pagina da vitrine passava a mandar no-referrer para
  // TUDO: pixel do Meta, TikTok, analytics da Shopify e apps. Era canhao para
  // matar mosca -- a unica navegacao que precisa de protecao e a que sai para
  // a loja de checkout, e essa da para marcar link a link (irParaCheckout).
  //
  // Sobrevive so para o caso de o link marcado falhar: ai a politica do
  // documento e a unica coisa entre a vitrine e a dark store, e tem que ser
  // aplicada ANTES de navegar.
  function forcarNoReferrerNoDocumento() {
    try {
      var metaExistente = document.querySelector('meta[name="referrer"]');
      if (metaExistente) {
        metaExistente.setAttribute("content", "no-referrer");
      } else {
        var meta = document.createElement("meta");
        meta.setAttribute("name", "referrer");
        meta.setAttribute("content", "no-referrer");
        document.head.insertBefore(meta, document.head.firstChild);
      }
    } catch (e) {}
  }

  // Navega para a loja de checkout sem contar de onde o comprador veio.
  //
  // Anchor com rel="noreferrer" em vez de location.href: a politica vale para
  // ESTE link e mais nada, entao o resto da vitrine continua mandando Referer
  // normalmente. location.href nao aceita rel -- para proteger a navegacao com
  // ele era preciso mexer na politica do documento inteiro.
  //
  // Medido em navegador: com rel="noreferrer" a loja de destino recebe
  // Referer nulo; sem nada, recebe a origem da vitrine (o padrao dos
  // navegadores e strict-origin-when-cross-origin, e a Shopify nao manda
  // header Referrer-Policy nenhum).
  //
  // O link leva uma marca propria. O clique sintetico passa pelos MESMOS
  // ouvintes de captura que barram todo clique de checkout -- e um destino
  // com "checkout" no dominio (checkout.minhaloja.com.br) casa com eles. Sem
  // a marca, o loader barrava o proprio redirect.
  var MARCA_LINK_PROPRIO = "data-xcart-rota";

  function irParaCheckout(url) {
    try {
      var a = document.createElement("a");
      a.href = url;
      a.rel = "noreferrer noopener";
      a.style.display = "none";
      a.setAttribute(MARCA_LINK_PROPRIO, "1");
      (document.body || document.documentElement).appendChild(a);
      a.click();
    } catch (e) {
      forcarNoReferrerNoDocumento();
      window.location.href = url;
    }
  }

  var scriptTag = document.currentScript;
  if (!scriptTag) return;

  var token = scriptTag.dataset.token || "";
  var appUrl = scriptTag.dataset.appUrl || new URL(scriptTag.src).origin;

  if (!token) {
    console.error("[RoutedCheckout] data-token nao encontrado no script.");
    return;
  }

  // Configuracao inline: pode vir embutida no script tag (data-config)
  // ou como asset externo na CDN Shopify (data-config-url).
  // Estrutura atual: { rotation: {strategy}, targets: [{id, domain, weight,
  // skuMap, variantMap, country, locale}] }.
  // Estrutura antiga (um destino so): { domain, skuMap, variantMap, country,
  // locale } -- ainda chega de tema que nao regerou o config, entao
  // normalizeConfig converte para o formato novo com um destino.
  var inlineConfig = null;

  // ==========================================================================
  // Trava de destino, aqui no navegador do comprador.
  //
  // Este arquivo montava `new URL("https://" + target.domain + "/cart/...")`
  // direto, sem validar nada -- enquanto o servidor validava. Os dois lados
  // discordavam, e quem manda quando isso acontece e o lado fraco. Passavam
  // por aqui e nao pelo servidor:
  //
  //   "google.com@evil.com"      -> host vira evil.com (userinfo)
  //   "loja.myshopify.com:8080"  -> porta aceita
  //   "аррӏе.com"                -> vira xn--80ak6aa92e.com (homografo)
  //   "evil.com#@loja.myshopify" -> host evil.com, resto vira fragmento
  //
  // Mesma regra de src/lib/net/url-guard.ts. Se um lado mudar, o outro tem
  // que mudar junto -- tests/url-guard.test.ts cobre a versao do servidor e
  // tests/loader-domain-parity.test.ts compara as duas.
  // ==========================================================================
  function dominioSeguro(entrada) {
    if (typeof entrada !== "string") return null;
    var bruto = entrada.trim();
    if (!bruto) return null;
    if (bruto.indexOf("\\") !== -1) return null;
    if (/[\s\u0000-\u001f\u007f]/.test(bruto)) return null;
    if (bruto.slice(0, 2) === "//") return null;

    var comEsquema = /^([a-z][a-z0-9+.-]*):\/\//i.exec(bruto);
    if (/^([a-z][a-z0-9+.-]*):(?!\/\/)/i.test(bruto)) return null;

    var url;
    try {
      url = new URL(comEsquema ? bruto : "https://" + bruto);
    } catch (e) {
      return null;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    if (url.port) return null;
    if ((url.pathname && url.pathname !== "/") || url.search || url.hash) return null;

    var host = url.hostname.toLowerCase();
    if (!host) return null;
    if (host.charAt(0) === "[") return null;
    if (/^\d+(\.\d+)*$/.test(host)) return null;
    if (host.charAt(host.length - 1) === ".") return null;
    if (/[^\x00-\x7f]/.test(bruto)) return null;

    var rotulos = host.split(".");
    if (rotulos.length < 2) return null;
    for (var i = 0; i < rotulos.length; i += 1) {
      if (rotulos[i].indexOf("xn--") === 0) return null;
      if (!/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(rotulos[i])) return null;
    }
    if (!/^[a-z]{2,63}$/.test(rotulos[rotulos.length - 1])) return null;
    var internos = [".internal", ".local", ".localhost", ".localdomain", ".home.arpa"];
    for (var j = 0; j < internos.length; j += 1) {
      if (host.length >= internos[j].length &&
          host.slice(-internos[j].length) === internos[j]) return null;
    }
    for (var k = 0; k + 3 < rotulos.length; k += 1) {
      if (/^\d{1,3}$/.test(rotulos[k]) && /^\d{1,3}$/.test(rotulos[k + 1]) &&
          /^\d{1,3}$/.test(rotulos[k + 2]) && /^\d{1,3}$/.test(rotulos[k + 3])) return null;
    }
    return host;
  }

  function normalizeConfig(cfg) {
    if (!cfg) return null;
    var targets = [];
    if (Array.isArray(cfg.targets) && cfg.targets.length > 0) {
      targets = cfg.targets
        .map(function (t) {
          if (!t || !t.domain) return null;
          var host = dominioSeguro(t.domain);
          if (!host) {
            console.error("[RoutedCheckout] destino recusado:", t.domain);
            return null;
          }
          // Guarda o host JA normalizado: ninguem mais concatena o valor cru.
          var copia = {};
          for (var chave in t) if (Object.prototype.hasOwnProperty.call(t, chave)) copia[chave] = t[chave];
          copia.domain = host;
          return copia;
        })
        .filter(function (t) { return t; });
    } else if (cfg.domain && dominioSeguro(cfg.domain)) {
      targets = [{
        id: cfg.id || null,
        domain: dominioSeguro(cfg.domain),
        weight: 1,
        skuMap: cfg.skuMap || {},
        variantMap: cfg.variantMap || {},
        country: cfg.country || "",
        locale: cfg.locale || ""
      }];
    }
    if (targets.length === 0) return null;
    return {
      strategy: (cfg.rotation && cfg.rotation.strategy) || "sticky",
      targets: targets
    };
  }

  try {
    var configAttr = scriptTag.dataset.config || scriptTag.getAttribute("data-config");
    if (configAttr) inlineConfig = normalizeConfig(JSON.parse(configAttr));
  } catch (e) {
    console.warn("[RoutedCheckout] data-config invalido, ignorando.", e);
  }

  // Busca config do asset JSON na CDN Shopify (preferencial — sem limite de tamanho)
  var configUrl = scriptTag.dataset.configUrl || scriptTag.getAttribute("data-config-url");
  if (configUrl && !inlineConfig) {
    fetch(configUrl)
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (cfg) { inlineConfig = normalizeConfig(cfg) || inlineConfig; })
      .catch(function () {});
  }

  // Chave do comprador para o rodizio sticky: sorteia uma vez, guarda, e a
  // partir dai ele cai sempre na mesma loja de checkout. Sem isso ele trocaria
  // de dominio de checkout a cada visita -- ruim para quem abandona o carrinho
  // e volta, e ruim para o pixel da loja de checkout.
  var ROTATION_KEY_STORAGE = "xcart_rk";
  var rotationKey = "";
  try {
    rotationKey = window.localStorage.getItem(ROTATION_KEY_STORAGE) || "";
    if (!rotationKey) {
      rotationKey = String(Date.now()) + "-" + Math.random().toString(36).slice(2, 10);
      window.localStorage.setItem(ROTATION_KEY_STORAGE, rotationKey);
    }
  } catch (e) {
    // Navegador com storage bloqueado (anonima, ITP): sem chave o sorteio cai
    // no aleatorio. Perde a aderencia, nao perde o checkout.
    rotationKey = "";
  }

  // Mesmo hash do servidor (FNV-1a 32 bits, ver lib/checkout-routes/rotation.ts).
  // Os dois PRECISAM concordar: se o inline sorteia a loja A e a API sorteia a
  // B, o comprador troca de checkout no meio da compra.
  function hashRotationKey(key) {
    var hash = 0x811c9dc5;
    for (var i = 0; i < key.length; i++) {
      hash ^= key.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash >>> 0;
  }

  var isRouting = false;
  var isAddingToCart = false;
  // Ultimo destino sorteado, para a telemetria dizer QUAL loja de checkout
  // levou (ou perdeu) o carrinho. Com rodizio, "a rota falhou" nao localiza
  // mais o problema.
  var lastRoutedTarget = null;
  var yampiPatchTimer = null;
  var yampiPatchAttempts = 0;
  var initialized = false;

  // ==========================================================================
  // Trava do roteamento: vale do primeiro toque ate a pagina SAIR.
  //
  // Antes o segundo toque no "Finalizar" escapava. `if (isRouting) return`
  // saia SEM preventDefault, o submit nativo do tema seguia e o comprador caia
  // no checkout da VITRINE, que nao cobra. E o segundo toque e o esperado: o
  // loader segura o primeiro antes do tema (stopImmediatePropagation), entao o
  // spinner do tema nao aparece e o botao parece morto enquanto o carrinho e a
  // rota sao lidos. Visto na NORAH (tema Shrine, gaveta "Secure checkout"): no
  // Safari a navegacao para a vitrine ainda abortava o fetch da rota e sobrava
  // um "Load failed" na telemetria; no Chrome nao sobrava nada.
  //
  // Agora: clique de checkout e SEMPRE barrado, e durante a rota so e contado.
  // A trava cai no erro, na volta pelo bfcache (pageshow persisted) e, como
  // valvula, TRAVA_MAXIMA_MS depois do redirect -- se a navegacao nao vingou,
  // o comprador nao pode ficar preso num botao morto. Tocar depois disso roteia
  // de novo; nada mais leva ao checkout da vitrine.
  // ==========================================================================
  var TRAVA_MAXIMA_MS = 10000;
  // Nenhuma tentativa pode ficar pendurada: com a trava valendo ate a pagina
  // sair, um fetch que nunca volta deixaria o botao morto para sempre.
  //
  // PAR com ORCAMENTO_HIDRATACAO_MS de src/lib/checkout-routes/hidratar-por-sku.ts:
  // o /resolve tem que responder antes deste prazo, ou o loader corta uma
  // rota que o servidor ainda terminaria. Travado por
  // tests/resolve-orcamento.test.ts -- subir um sem olhar o outro quebra.
  var PRAZO_REDE_MS = 15000;
  var travaTimer = null;
  var toquesDuranteRota = 0;
  var botaoCarregando = null;

  // Retorno no botao tocado. Imita o tema quando ele tem spinner no botao
  // (Dawn e derivados, como o Shrine: classe "loading" + spinner visivel).
  // Sem spinner, NAO poe "loading": no Dawn ela deixa o texto transparente e
  // nao mostra nada no lugar. Ai fica so o botao meio apagado.
  var SPINNER_DO_TEMA = ".loading-overlay__spinner, .loading__spinner";

  function marcarCarregando(elemento) {
    desmarcarCarregando();
    try {
      if (!elemento || !elemento.closest) return;
      var botao = elemento.closest("button, a, input, [role='button']") || elemento;
      if (!botao.setAttribute || /^(FORM|BODY|HTML)$/i.test(botao.tagName || "")) return;
      var estado = {
        el: botao,
        spinner: null,
        loading: false,
        opacidade: botao.style ? botao.style.opacity : "",
        cursor: botao.style ? botao.style.cursor : ""
      };
      botao.setAttribute("aria-busy", "true");
      var spinner = botao.querySelector ? botao.querySelector(SPINNER_DO_TEMA) : null;
      if (spinner && botao.classList) {
        estado.loading = !botao.classList.contains("loading");
        botao.classList.add("loading");
        if (spinner.classList && spinner.classList.contains("hidden")) {
          spinner.classList.remove("hidden");
          estado.spinner = spinner;
        }
      } else if (botao.style) {
        botao.style.opacity = "0.6";
      }
      if (botao.style) botao.style.cursor = "progress";
      botaoCarregando = estado;
    } catch (e) {}
  }

  function desmarcarCarregando() {
    var estado = botaoCarregando;
    botaoCarregando = null;
    if (!estado) return;
    try {
      var botao = estado.el;
      botao.removeAttribute("aria-busy");
      if (estado.loading) botao.classList.remove("loading");
      if (estado.spinner) estado.spinner.classList.add("hidden");
      if (botao.style) {
        botao.style.opacity = estado.opacidade;
        botao.style.cursor = estado.cursor;
      }
    } catch (e) {}
  }

  function travarRoteamento(elemento) {
    isRouting = true;
    toquesDuranteRota = 0;
    if (travaTimer) {
      clearTimeout(travaTimer);
      travaTimer = null;
    }
    marcarCarregando(elemento);
  }

  function liberarRoteamento() {
    isRouting = false;
    if (travaTimer) {
      clearTimeout(travaTimer);
      travaTimer = null;
    }
    desmarcarCarregando();
  }

  // A navegacao saiu: a trava fica ate a pagina ir embora. O timer e so a
  // valvula para a navegacao que nao vingou.
  function segurarAteSair() {
    if (travaTimer) clearTimeout(travaTimer);
    travaTimer = setTimeout(liberarRoteamento, TRAVA_MAXIMA_MS);
  }

  function barrarEvento(event) {
    if (!event) return;
    if (event.preventDefault) event.preventDefault();
    if (event.stopPropagation) event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
  }

  function ehLinkProprio(el) {
    try {
      return Boolean(el && el.closest && el.closest("a[" + MARCA_LINK_PROPRIO + "]"));
    } catch (e) {
      return false;
    }
  }

  // O detalhe do erro leva quantos toques o comprador deu enquanto esperava:
  // e o numero que diz se o botao parado esta custando venda.
  function detalheDoErro(error) {
    var msg = error ? String(error && error.message ? error.message : error) : "";
    if (toquesDuranteRota > 0) msg += " (+" + toquesDuranteRota + " toques durante a rota)";
    return msg;
  }

  // fetch com prazo. Sem AbortController (navegador muito velho) fica sem
  // prazo, como era antes.
  function buscarComPrazo(url, opcoes) {
    var controle = null;
    try {
      controle = typeof AbortController === "function" ? new AbortController() : null;
    } catch (e) {
      controle = null;
    }
    if (!controle) return fetch(url, opcoes);
    var comSinal = {};
    for (var chave in opcoes) {
      if (Object.prototype.hasOwnProperty.call(opcoes, chave)) comSinal[chave] = opcoes[chave];
    }
    comSinal.signal = controle.signal;
    var estourou = false;
    var timer = setTimeout(function () {
      estourou = true;
      controle.abort();
    }, PRAZO_REDE_MS);
    return fetch(url, comSinal).then(
      function (resposta) {
        clearTimeout(timer);
        return resposta;
      },
      function (erro) {
        clearTimeout(timer);
        throw estourou ? new Error("Prazo esgotado (" + PRAZO_REDE_MS + " ms)") : erro;
      }
    );
  }

  // ==========================================================================
  // Carteiras (Shop Pay, Apple/Google Pay, PayPal, Amazon Pay) e o botao
  // dinamico ("Comprar agora", "Mais opcoes de pagamento").
  //
  // Os de hoje moram em shadow DOM FECHADO dentro de
  // shopify-accelerated-checkout(-cart). No ouvinte do window o alvo ja chega
  // trocado pelo hospedeiro, sem texto e sem name, e isCheckoutTarget nao via
  // nada: o clique seguia e a carteira cobrava NA VITRINE, com o nome da marca.
  // O caminho do clique (composedPath) ainda passa pelo hospedeiro.
  //
  // Mesma lista de public/xcart-click.js (SELETOR_EXPRESSO), mais o que la
  // fica de fora de proposito: para o rastreamento o "Comprar agora" e o "Mais
  // opcoes de pagamento" sao checkout comum; para a rota, tudo isso e checkout
  // da vitrine e tem que ser levado.
  // ==========================================================================
  var SELETOR_EXPRESSO_CARRINHO = [
    "shopify-accelerated-checkout-cart",
    ".additional-checkout-buttons",
    "#dynamic-checkout-cart",
    "[data-shopify='dynamic-checkout-cart']"
  ].join(", ");

  var SELETOR_EXPRESSO = [
    "shop-pay-wallet-button",
    "shopify-apple-pay-button",
    "shopify-google-pay-button",
    "shopify-paypal-button",
    "shopify-amazon-pay-button",
    "shopify-buy-it-now-button",
    "more-payment-options-link",
    "shopify-accelerated-checkout",
    ".shopify-payment-button__button",
    ".shopify-payment-button__more-options",
    ".shopify-payment-button",
    "[data-shopify='payment-button']",
    "[data-xcart-carteira]",
    SELETOR_EXPRESSO_CARRINHO
  ].join(", ");

  function casaSeletor(no, seletor) {
    if (!no || no.nodeType !== 1) return false;
    var f = no.matches || no.msMatchesSelector || no.webkitMatchesSelector;
    try {
      return Boolean(f && f.call(no, seletor));
    } catch (e) {
      return false;
    }
  }

  // O primeiro elemento do caminho do clique que casa com o seletor. Sem
  // composedPath (navegador antigo), fica o `closest` no alvo.
  function noCaminho(event, seletor) {
    var caminho = null;
    try {
      caminho = typeof event.composedPath === "function" ? event.composedPath() : null;
    } catch (e) {
      caminho = null;
    }
    if (caminho && caminho.length) {
      for (var i = 0; i < caminho.length; i++) {
        if (casaSeletor(caminho[i], seletor)) return caminho[i];
      }
      return null;
    }
    try {
      return event.target && event.target.closest ? event.target.closest(seletor) : null;
    } catch (e) {
      return null;
    }
  }

  // No carrinho (pagina ou gaveta) a carteira paga o carrinho inteiro; na
  // pagina de produto, compra a variante do formulario.
  function alvoExpresso(event) {
    var el = noCaminho(event, SELETOR_EXPRESSO);
    if (!el) return null;
    return {
      el: el,
      modo: noCaminho(event, SELETOR_EXPRESSO_CARRINHO) ? "carrinho" : "produto"
    };
  }

  // O que nao da para interceptar some. O PayPal desenha o botao num iframe
  // de outro dominio, e clique dentro de iframe nao chega a esta pagina. Na
  // vitrine carteira nenhuma deve aparecer -- quem cobra e a loja de checkout.
  // As do CARRINHO somem inteiras (ali so ha carteira; o "Finalizar" do tema
  // fica). Na pagina de produto o componente tambem traz o "Comprar agora",
  // entao ele fica, e a capa de cobrirCarteirasDoProduto leva o toque; so
  // some o botao antigo de carteira que e iframe. O :has vai em regra propria:
  // navegador sem :has descarta a regra inteira, e nao pode levar a do
  // carrinho junto.
  function esconderCarteiras() {
    try {
      if (document.getElementById("xcart-rota-carteiras")) return;
      var estilo = document.createElement("style");
      estilo.id = "xcart-rota-carteiras";
      estilo.textContent =
        SELETOR_EXPRESSO_CARRINHO + "{display:none!important}\n" +
        ".shopify-payment-button__button--branded:has(iframe){display:none!important}";
      (document.head || document.documentElement).appendChild(estilo);
    } catch (e) {}
  }

  // ==========================================================================
  // Capa sobre o bloco de pagamento da pagina de produto.
  //
  // O shopify-accelerated-checkout do produto desenha o PayPal num iframe de
  // outro dominio dentro do shadow fechado. Toque dentro do iframe nao chega a
  // esta pagina -- nenhum ouvinte nosso roda, e a vitrine cobrava com o nome
  // da marca. Esconder o componente levaria o "Comprar agora" junto.
  //
  // Entao uma capa transparente cobre o bloco: o toque cai nela, que e DESTA
  // pagina, e o caminho do clique passa pelo involucro marcado, que
  // alvoExpresso leva como compra imediata. "Comprar agora" e carteiras
  // continuam a vista.
  //
  // O involucro vira contexto de empilhamento proprio (isolation): o z-index
  // da capa vale so ali dentro e nao passa por cima de gaveta ou cabecalho
  // fixo que estejam sobre o bloco. Tema que troca o bloco ao mudar de
  // variante perde a capa; vigiarCarteirasDoProduto poe de novo.
  // ==========================================================================
  var MARCA_INVOLUCRO = "data-xcart-carteira";
  var MARCA_CAPA = "data-xcart-capa";

  function cobrirCarteirasDoProduto() {
    try {
      var hosts = document.querySelectorAll("shopify-accelerated-checkout");
      for (var i = 0; i < hosts.length; i++) {
        var host = hosts[i];
        var involucro =
          (host.closest && host.closest(".shopify-payment-button, [data-shopify='payment-button']")) ||
          host.parentNode;
        if (!involucro || involucro.nodeType !== 1 || !involucro.style) continue;
        if (involucro.querySelector("[" + MARCA_CAPA + "]")) continue;

        var posicao = "";
        try {
          posicao = window.getComputedStyle ? window.getComputedStyle(involucro).position : "";
        } catch (e) {
          posicao = "";
        }
        if (!posicao || posicao === "static") involucro.style.position = "relative";
        involucro.style.isolation = "isolate";
        involucro.setAttribute(MARCA_INVOLUCRO, "1");

        var capa = document.createElement("div");
        capa.setAttribute(MARCA_CAPA, "1");
        capa.setAttribute("aria-hidden", "true");
        capa.style.cssText =
          "position:absolute;top:0;right:0;bottom:0;left:0;z-index:2147483647;" +
          "background:transparent;cursor:pointer;-webkit-tap-highlight-color:transparent";
        involucro.appendChild(capa);
      }
    } catch (e) {}
  }

  // O tema troca o bloco de pagamento quando o comprador muda de variante.
  // MutationObserver poe a capa no bloco novo antes do proximo toque; sem
  // ele (navegador muito velho), um intervalo.
  function vigiarCarteirasDoProduto() {
    cobrirCarteirasDoProduto();
    var pendente = false;
    var agendar = function () {
      if (pendente) return;
      pendente = true;
      setTimeout(function () {
        pendente = false;
        cobrirCarteirasDoProduto();
      }, 50);
    };
    try {
      if (typeof MutationObserver === "function") {
        new MutationObserver(agendar).observe(document.body, { childList: true, subtree: true });
        return;
      }
    } catch (e) {}
    setInterval(cobrirCarteirasDoProduto, 1000);
  }

  // Produto esgotado: o tema desliga o "Adicionar" e o "Comprar agora", e
  // botao desligado nem dispara clique. A capa dispararia -- e levaria o
  // carrinho sem o item. Com a compra desligada no tema, o toque na capa nao
  // faz nada, como o botao nativo.
  function compraDesligadaNoTema(involucro) {
    try {
      var host = involucro.querySelector("shopify-accelerated-checkout");
      if (host && host.getAttribute("disabled") !== null) return true;
      var form = involucro.closest("form") || findProductForm(involucro);
      var adicionar = form && form.querySelector("[name='add']");
      return Boolean(
        adicionar &&
          (adicionar.disabled === true ||
            adicionar.getAttribute("disabled") !== null ||
            adicionar.getAttribute("aria-disabled") === "true")
      );
    } catch (e) {
      return false;
    }
  }

  function rootPath() {
    return (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
  }

  function isCheckoutTarget(target) {
    if (!target || !target.closest) return false;
    var checkoutElement = target.closest(
      [
        '[name="checkout"]',
        '[id*="checkout"]',
        '[class*="checkout"]',
        '[data-checkout]',
        '[data-testid*="checkout"]',
        '.btn-checkout',
        '.cart__checkout-button',
        '.js-transparent-checkout',
        '.yampi_purchase_confirmation_btn',
        '.dm-quick-purchase__buy',
        'a',
        'button',
        '[role="button"]',
        'a[href="/checkout"]',
        'a[href*="/checkout"]',
        'button[name="checkout"]',
        'button[type="submit"]',
        'input[name="checkout"]',
        'input[type="submit"]'
      ].join(",")
    );

    if (!checkoutElement) return false;

    var href = checkoutElement.getAttribute && checkoutElement.getAttribute("href");
    var action = checkoutElement.getAttribute && checkoutElement.getAttribute("formaction");
    var text = (checkoutElement.textContent || checkoutElement.value || "").toLowerCase();

    return Boolean(
      checkoutElement.getAttribute("name") === "checkout" ||
        /checkout|finaliz|pagamento|pagar|fechar pedido|comprar agora|comprar ahora|comprar|buy now|ir a pagar|proceder|tramitar|realizar pedido/.test(text) ||
        (href && /checkout|checkouts/.test(href)) ||
        (action && /checkout|checkouts/.test(action)) ||
        checkoutElement.matches(
          ".shopify-payment-button__button, [data-testid*='Checkout-button'], .btn-checkout, .cart__checkout-button, .js-transparent-checkout, .yampi_purchase_confirmation_btn, .dm-quick-purchase__buy"
        )
    );
  }

  function isImmediatePurchaseTarget(target) {
    if (!target || !target.closest) return false;
    var button = target.closest("button, a, input, [role='button']");
    if (!button) return false;
    var closestForm = button.closest("form");
    var formAction = closestForm && closestForm.getAttribute("action");
    var insideCart =
      button.closest("cart-drawer-component, cart-items-component") ||
      (formAction && /\/cart(?!\/add)|\/checkout|\/checkouts/.test(formAction));
    var text = (button.textContent || button.value || "").toLowerCase();
    return Boolean(
      /comprar agora|comprar ahora|comprar|buy now|pagar ahora/.test(text) ||
        button.matches(".shopify-payment-button__button, [data-testid*='Checkout-button'], .dm-quick-purchase__buy") ||
        (button.matches(".js-transparent-checkout") && !insideCart)
    );
  }

  function isAddToCartTarget(target) {
    if (!target || !target.closest) return false;
    var button = target.closest("button, input, [role='button']");
    if (!button || isCheckoutTarget(button)) return false;
    var text = (button.textContent || button.value || "").toLowerCase();
    return Boolean(
      button.getAttribute("name") === "add" ||
        button.matches("[name='add'], .add-to-cart-button, .quick-add__button--add, #AddToCart, .ProductForm__AddToCart") ||
        /adicionar ao carrinho|adicionar|add to cart/.test(text)
    );
  }

  // Formulario cujo action E o checkout desta loja (/checkout, /en/checkout).
  function postaNoCheckoutDaVitrine(form) {
    try {
      var acao = form && form.getAttribute && form.getAttribute("action");
      if (!acao) return false;
      var u = new URL(acao, window.location.href);
      return u.origin === window.location.origin &&
        /^\/([a-z]{2}(-[a-z]{2,4})?\/)?checkouts?(\/|$)/i.test(u.pathname);
    } catch (e) {
      return false;
    }
  }

  function isCheckoutForm(form) {
    if (!form || !form.matches) return false;
    var action = form.getAttribute("action") || "";
    return (
      form.matches('form[action*="/checkout"], form[action*="/checkouts"]') ||
      /\/checkout|\/checkouts/.test(action) ||
      Boolean(
        form.querySelector(
          '[name="checkout"], [data-checkout], a[href*="/checkout"], button[name="checkout"], input[name="checkout"]'
        )
      )
    );
  }

  async function getCart() {
    var response = await buscarComPrazo(rootPath() + "cart.js", {
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error("Nao foi possivel ler o carrinho.");
    return response.json();
  }

  function toRouteLines(cart) {
    return (cart.items || []).map(function (item) {
      var variantId = item.variant_id || item.id;
      return {
        sku: item.sku || "",
        sourceVariantId: variantId ? "gid://shopify/ProductVariant/" + variantId : "",
        quantity: item.quantity || 1,
      };
    });
  }

  // ==========================================================================
  // Cupom do carrinho da vitrine vai junto para a loja de checkout.
  //
  // O comprador aplicava o cupom no carrinho da vitrine (campo do tema, link
  // /discount/CODIGO) e o perdia no redirect: o checkout abria sem desconto.
  // Agora o CODIGO vai no permalink (?discount=, documentado pela Shopify em
  // create-cart-permalinks) -- nunca o valor: quem calcula e a loja de
  // checkout, com o cupom dela. Cupom que nao existe la nao vale (a Shopify
  // nao aplica); o lojista cria o mesmo codigo nas duas lojas.
  //
  // De onde o codigo sai no /cart.js:
  //   - discount_codes: [{ code, applicable }] (carrinho recente). Cupom com
  //     applicable false fica: nao e "o cupom aplicado";
  //   - cart_level_discount_applications e
  //     items[].line_level_discount_allocations[].discount_application com
  //     type "discount_code": o title delas e o proprio codigo.
  //
  // MESMA regra de normalizarCupons em src/lib/shopify/cart-routing.ts,
  // comparada por tests/roteamento-carrinho-levado.test.ts.
  // ==========================================================================
  var MAX_CUPONS = 5;
  var MAX_CUPOM = 64;

  function cupomValido(codigo) {
    return typeof codigo === "string" &&
      codigo.length > 0 &&
      codigo.length <= MAX_CUPOM &&
      codigo.trim() === codigo &&
      codigo.indexOf(",") === -1 &&
      !/[\u0000-\u001f\u007f]/.test(codigo);
  }

  function cuponsDoCarrinho(cart) {
    var saida = [];
    var vistos = {};
    function guardar(bruto) {
      if (saida.length >= MAX_CUPONS) return;
      var codigo = typeof bruto === "string" ? bruto.trim() : bruto;
      if (!cupomValido(codigo)) return;
      // Prefixo na chave: "constructor" e "__proto__" sao cupons possiveis.
      var chave = "c:" + codigo.toLowerCase();
      if (vistos[chave]) return;
      vistos[chave] = true;
      saida.push(codigo);
    }
    function daAplicacao(aplicacao) {
      if (aplicacao && aplicacao.type === "discount_code") guardar(aplicacao.title);
    }
    try {
      var codigos = (cart && cart.discount_codes) || [];
      for (var i = 0; i < codigos.length; i++) {
        if (codigos[i] && codigos[i].applicable !== false) guardar(codigos[i].code);
      }
      var doCarrinho = (cart && cart.cart_level_discount_applications) || [];
      for (var j = 0; j < doCarrinho.length; j++) daAplicacao(doCarrinho[j]);
      var itens = (cart && cart.items) || [];
      for (var k = 0; k < itens.length; k++) {
        var alocacoes = (itens[k] && itens[k].line_level_discount_allocations) || [];
        for (var m = 0; m < alocacoes.length; m++) {
          daAplicacao(alocacoes[m] && alocacoes[m].discount_application);
        }
      }
    } catch (e) {}
    return saida;
  }

  // Moeda em que o comprador viu o carrinho na vitrine (cart.js "currency").
  function moedaDoCarrinho(cart) {
    var moeda = cart && typeof cart.currency === "string" ? cart.currency.toUpperCase() : "";
    return /^[A-Z]{3}$/.test(moeda) ? moeda : "";
  }

  // country que foi no permalink ("" = a Shopify escolhe pelo comprador).
  function paisDoDestino(url) {
    try {
      var pais = new URL(url).searchParams.get("country") || "";
      return /^[A-Z]{2}$/.test(pais) ? pais : "";
    } catch (e) {
      return "";
    }
  }

  function readProductFormLine(target) {
    if (!target || !target.closest) return null;
    var form = target.closest("form") || findProductForm(target);
    if (!form) return null;
    var variantInput =
      form.querySelector('[name="id"]') ||
      form.querySelector('select[name="id"]') ||
      form.querySelector('input[name="variant"]');
    var variantId = variantInput && variantInput.value;
    if (!variantId) return null;
    var quantityInput = form.querySelector('[name="quantity"]');
    var quantity = quantityInput ? Number(quantityInput.value || 1) : 1;
    return {
      sku: "",
      sourceVariantId: "gid://shopify/ProductVariant/" + variantId,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    };
  }

  // Quantas linhas do carrinho ESTE destino consegue resolver, e com que ids.
  // Resolve por variantMap (sourceVariantId) primeiro, depois skuMap.
  function resolveWithTarget(target, lines) {
    var resolvedLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var srcVariant = String(line.sourceVariantId || "");
      var sku = String(line.sku || "").trim().toLowerCase();
      var targetId = null;
      if (srcVariant && target.variantMap) {
        targetId = target.variantMap[srcVariant] || null;
      }
      if (!targetId && sku && target.skuMap) {
        targetId = target.skuMap[sku] || null;
      }
      if (targetId) {
        var numericId = String(targetId);
        if (numericId.indexOf("gid://") !== -1) numericId = numericId.split("/").pop() || numericId;
        resolvedLines.push({ variantId: numericId, quantity: Math.max(1, Number(line.quantity) || 1) });
      }
    }
    return resolvedLines;
  }

  // Sorteia a loja de checkout deste carrinho. Espelha pickTarget do servidor:
  // so disputam os destinos que empatam na MELHOR cobertura do carrinho --
  // rodizio nunca vale um item a menos no checkout -- e entre eles o sorteio e
  // ponderado por weight e ancorado na chave do comprador.
  function pickInlineTarget(lines) {
    if (!inlineConfig || !inlineConfig.targets.length) return null;

    var candidates = [];
    var best = 0;
    for (var i = 0; i < inlineConfig.targets.length; i++) {
      var target = inlineConfig.targets[i];
      var resolved = resolveWithTarget(target, lines);
      if (resolved.length > best) best = resolved.length;
      candidates.push({ target: target, resolved: resolved });
    }
    if (best === 0) return null;

    var pool = candidates.filter(function (c) { return c.resolved.length === best; });
    var weighted = pool.filter(function (c) { return Number(c.target.weight || 0) > 0; });
    if (weighted.length > 0) pool = weighted;
    if (pool.length === 1) return pool[0];

    // Ordem estavel: o mesmo comprador tem que cair sempre no mesmo destino,
    // entao a fila do sorteio nao pode depender da ordem que veio o JSON.
    pool.sort(function (a, b) {
      return String(a.target.id || a.target.domain).localeCompare(
        String(b.target.id || b.target.domain)
      );
    });

    var total = 0;
    for (var j = 0; j < pool.length; j++) total += Math.max(1, Number(pool[j].target.weight) || 1);

    var key = inlineConfig.strategy === "each_checkout" || !rotationKey
      ? String(Math.random())
      : rotationKey;
    var cursor = hashRotationKey(key) % total;

    for (var k = 0; k < pool.length; k++) {
      cursor -= Math.max(1, Number(pool[k].target.weight) || 1);
      if (cursor < 0) return pool[k];
    }
    return pool[pool.length - 1];
  }

  // Resolucao inline: usa o mapa embutido no script tag, sem chamada de API.
  // cupons: codigos ja validados (cuponsDoCarrinho).
  function resolveInlineUrl(lines, cupons) {
    // Destino com teto de pedidos por dia: so o servidor sabe quantos pedidos
    // a loja ja fez, entao o sorteio nao pode ser inline. Cai na API.
    if (inlineConfig) {
      for (var q = 0; q < inlineConfig.targets.length; q++) {
        if (Number(inlineConfig.targets[q].dailyLimit) > 0) return null;
      }
    }
    var pick = pickInlineTarget(lines);
    if (!pick) return null;

    // Cobertura parcial cai para a API: la o destino ainda pode resolver o
    // resto pelo products.json publico. Mandar o comprador para um checkout
    // com item faltando e pior do que gastar uma chamada.
    if (pick.resolved.length < lines.length) return null;

    var cartPath = pick.resolved.map(function (l) { return l.variantId + ":" + l.quantity; }).join(",");
    // pick.target.domain ja veio de dominioSeguro na normalizacao do config,
    // mas revalidar aqui custa nada e fecha o caso de o config ter sido
    // montado por outro caminho.
    var hostOk = dominioSeguro(pick.target.domain);
    if (!hostOk) return null;
    var url = new URL("https://" + hostOk + "/cart/" + cartPath);
    // country vazio = "pais do comprador" no destino: a Shopify geolocaliza.
    if (pick.target.country) url.searchParams.set("country", pick.target.country);
    if (pick.target.locale) url.searchParams.set("locale", pick.target.locale);
    // Mesma montagem de buildCartPermalink no servidor (ordem inclusive).
    if (cupons && cupons.length) url.searchParams.set("discount", cupons.join(","));
    lastRoutedTarget = pick.target;
    return url.toString();
  }

  async function resolveCheckoutLines(lines, cupons) {
    // 1. Tenta resolucao inline (instantaneo, sem API, funciona offline)
    var inlineUrl = resolveInlineUrl(lines, cupons);
    if (inlineUrl) return inlineUrl;

    // 2. Fallback para API (cobre SKUs novos ainda nao embutidos no script)
    var response = await buscarComPrazo(appUrl.replace(/\/$/, "") + "/api/checkout-routes/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token,
        lines: lines,
        rotationKey: rotationKey,
        discountCodes: cupons || [],
      }),
    });

    var data = await response.json().catch(function () {
      return {};
    });

    if (!response.ok || !data.redirectUrl) {
      throw new Error(data.error || "Nao foi possivel rotear o checkout.");
    }

    lastRoutedTarget = { id: data.targetId || null, domain: data.targetDomain || "" };
    return data.redirectUrl;
  }

  async function resolveCheckout(cart) {
    return resolveCheckoutLines(toRouteLines(cart), cuponsDoCarrinho(cart));
  }

  // Envia um evento de telemetria. Best-effort: nunca atrasa nem bloqueia o
  // redirect.
  //
  // O Content-Type PRECISA ser text/plain. Ele e um dos tres valores da lista
  // segura do CORS; qualquer outro (inclusive application/json) obriga o
  // browser a fazer um preflight OPTIONS antes do POST. Um beacon com
  // preflight nao sobrevive a navegacao: o documento e descarregado antes do
  // OPTIONS voltar e o POST nunca sai.
  //
  // Era exatamente o que acontecia aqui. "loader_ready" dispara com a pagina
  // parada e chegava normal (43 registros); "routed_ok" e todos os
  // "bypass_*" disparam no instante do redirect e chegavam ZERO — nao porque
  // nao acontecessem, mas porque o browser descartava. Ficamos cegos
  // justamente no evento que interessa.
  //
  // O servidor le o corpo como texto e faz o parse (ver track-fallback).
  // extra: so no routed_ok -- { moeda, paisCheckout } (ver routeCartCheckout).
  function enviarEvento(reason, detail, extra) {
    try {
      var payload = JSON.stringify({
        token: token,
        reason: reason,
        detail: detail ? String(detail).slice(0, 500) : "",
        pageUrl: window.location.href,
        targetId: (lastRoutedTarget && lastRoutedTarget.id) || null,
        targetDomain: (lastRoutedTarget && lastRoutedTarget.domain) || "",
        moeda: (extra && extra.moeda) || undefined,
        paisCheckout: extra ? extra.paisCheckout || "" : undefined,
      });
      var url = appUrl.replace(/\/$/, "") + "/api/checkout-routes/track-fallback";
      var tipo = "text/plain;charset=UTF-8";
      if (navigator.sendBeacon) {
        if (navigator.sendBeacon(url, new Blob([payload], { type: tipo }))) return;
        // sendBeacon devolve false quando a fila esta cheia: cai pro fetch.
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": tipo },
        body: payload,
        keepalive: true,
        mode: "cors",
      }).catch(function () {});
    } catch (e) {
      // nunca deixa o log de erro gerar outro erro
    }
  }

  function trackFallback(reason, error) {
    enviarEvento(
      reason,
      error ? String(error && error.message ? error.message : error) : ""
    );
  }

  // Sinal de vida e de sucesso. Usa o mesmo endpoint do fallback (a coluna
  // reason distingue), entao nao precisa de tabela nova.
  //
  // Sem isto ficamos cegos: quando o loader nao roteia, nao ha codigo nosso
  // rodando para contar. Comparando "loader_ready" com "routed_ok" da para
  // saber se o problema e o loader nao carregar ou nao interceptar.
  function report(reason, detail, extra) {
    enviarEvento(reason, detail, extra);
  }

  // Uma vez por sessao, so em pagina onde faz sentido comprar.
  function reportarPresenca() {
    try {
      if (sessionStorage.getItem("rc_ready")) return;
      var path = window.location.pathname;
      if (!/\/cart|\/products\//.test(path)) return;
      sessionStorage.setItem("rc_ready", "1");
      report("loader_ready", path);
    } catch (e) {}
  }

  function showRoutingError() {
    try {
      var existing = document.getElementById("routed-checkout-error");
      if (existing) existing.remove();
      var el = document.createElement("div");
      el.id = "routed-checkout-error";
      el.style.cssText = "position:fixed;top:20px;left:50%;transform:translateX(-50%);z-index:99999;background:#ef4444;color:#fff;padding:12px 20px;border-radius:8px;font-size:14px;font-family:sans-serif;box-shadow:0 4px 12px rgba(0,0,0,.25);max-width:90vw;text-align:center";
      // Na lingua da loja: a maioria das vitrines vende em ingles.
      var lingua = (document.documentElement.getAttribute("lang") || "").toLowerCase();
      el.textContent = lingua.indexOf("pt") === 0
        ? "Erro ao carregar o checkout. Tente novamente."
        : lingua.indexOf("es") === 0
          ? "Error al cargar el checkout. Inténtalo de nuevo."
          : "Couldn’t open checkout. Please try again.";
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 4000);
    } catch (e) {}
  }

  // skipGuard: quem chama ja travou (routeCheckout). Os outros (Yampi, redes
  // de seguranca) travam aqui, e com a trava ligada nao fazem nada.
  // carrinhoLido: o carrinho que quem chama acabou de ler e nao mudou depois
  // (poupa uma ida ao cart.js).
  async function routeCartCheckout(skipGuard, carrinhoLido) {
    if (isRouting && !skipGuard) return;
    if (!isRouting) travarRoteamento(null);

    try {
      var cart = carrinhoLido || await getCart();
      if (!cart.items || cart.items.length === 0) {
        segurarAteSair();
        window.location.href = rootPath() + "cart";
        return;
      }

      var destino = await resolveCheckout(cart);
      // Moeda do carrinho na vitrine e o country que foi no permalink. O
      // loader nao sabe em que moeda a loja de checkout vai cobrar (depende
      // dos mercados dela); a tela compara a moeda da vitrine com a do pais
      // do checkout e avisa quando difere. Nada do comprador vai junto.
      report(
        "routed_ok",
        String(cart.item_count || "") + " itens -> " +
          ((lastRoutedTarget && lastRoutedTarget.domain) || "?"),
        { moeda: moedaDoCarrinho(cart), paisCheckout: paisDoDestino(destino) }
      );
      // A trava NAO cai aqui: o comprador ainda esta nesta pagina ate a loja
      // de checkout responder, e um toque nesse meio cancelava a navegacao.
      segurarAteSair();
      irParaCheckout(destino);
    } catch (error) {
      console.warn("[RoutedCheckout] erro ao rotear checkout", error);
      trackFallback("cart_checkout_error", detalheDoErro(error));
      // Nao redireciona para checkout da vitrine — mostra erro e deixa cliente tentar de novo.
      showRoutingError();
      liberarRoteamento();
    }
  }

  // modo: "produto" (compra a variante do formulario e leva o carrinho),
  // "carrinho" (leva o carrinho como esta) ou nada (decide pelo alvo, e so age
  // se o alvo for de checkout).
  async function routeCheckout(event, targetOverride, modo) {
    var target = targetOverride || event.target;
    if (ehLinkProprio(event.target)) return;
    if (!modo && !isCheckoutTarget(target)) return;

    // Primeiro barra, depois olha a trava. Na ordem antiga o toque durante a
    // rota saia sem preventDefault e o tema mandava para a vitrine.
    barrarEvento(event);
    if (isRouting) {
      toquesDuranteRota += 1;
      return;
    }
    travarRoteamento(target);

    try {
      var compraImediata = modo ? modo === "produto" : isImmediatePurchaseTarget(target);
      var carrinhoLido = null;
      if (compraImediata) {
        var form = findProductForm(target);
        if (form) carrinhoLido = await garantirVarianteNoCarrinho(form);
      }

      await routeCartCheckout(true, carrinhoLido);
    } catch (error) {
      console.warn("[RoutedCheckout] erro ao rotear checkout", error);
      trackFallback("direct_checkout_error", detalheDoErro(error));
      showRoutingError();
      liberarRoteamento();
    }
  }

  function findProductForm(target) {
    if (!target || !target.closest) return null;
    var form = target.closest("form");
    if (form) return form;
    return document.querySelector('form[action*="/cart/add"]');
  }

  // ==========================================================================
  // "Comprar agora" e carteira na pagina de produto: a variante do formulario
  // tem que estar no carrinho na quantidade do formulario -- e nada a mais.
  //
  // /cart/add.js SOMA na linha que ja existe. Adicionar a cada tentativa
  // dobrava o item na loja de checkout (quantidade e preco x2) em dois casos
  // comuns: a rota falhava depois do add e o comprador tocava de novo (o add
  // rodava outra vez, e o tema nem sabia do primeiro, porque nao sai
  // cart:update), e o item ja estava no carrinho (adicionou, fechou a gaveta,
  // tocou no Apple Pay). Agora le o carrinho antes e adiciona so o que falta.
  //
  // Devolve o carrinho lido quando nada foi adicionado (ele ainda vale para a
  // rota), ou null quando o add mudou o carrinho e ele tem que ser relido.
  // ==========================================================================
  async function garantirVarianteNoCarrinho(form) {
    var idVariante = campoDoFormulario(form, "id");
    // Sem variante no formulario o add.js falharia de qualquer jeito.
    if (!idVariante) return null;
    var desejada = Number(campoDoFormulario(form, "quantity") || 1);
    if (!(desejada > 0)) desejada = 1;

    var cart = await getCart();
    var noCarrinho = 0;
    (cart.items || []).forEach(function (item) {
      if (String(item.variant_id || item.id) === idVariante) {
        noCarrinho += Number(item.quantity) || 0;
      }
    });

    var falta = desejada - noCarrinho;
    if (falta <= 0) return cart;
    try {
      // So sobrepoe a quantidade quando parte ja esta no carrinho; senao o
      // add sai exatamente como o formulario manda.
      await submitProductForm(form, falta < desejada ? falta : 0);
    } catch (e) {}
    return null;
  }

  // Valor de um campo como o formulario o enviaria. FormData conta tambem o
  // campo de FORA do <form> ligado por form="..." -- no Dawn a quantidade fica
  // assim, e o querySelector dentro do form nao acha.
  function campoDoFormulario(form, nome) {
    try {
      var valor = new FormData(form).get(nome);
      if (valor !== null && valor !== undefined && valor !== "") return String(valor);
    } catch (e) {}
    try {
      var campo = form.querySelector('[name="' + nome + '"]');
      return campo && campo.value ? String(campo.value) : "";
    } catch (e) {
      return "";
    }
  }

  // quantidade: sobrepoe a do formulario (garantirVarianteNoCarrinho manda so
  // a diferenca). Sem ela, vale a do formulario.
  function dadosDoFormulario(form, quantidade) {
    var formData = new FormData(form);
    if (quantidade) formData.set("quantity", String(quantidade));
    return formData;
  }

  function submitProductForm(form, quantidade) {
    var formData = dadosDoFormulario(form, quantidade);
    var sectionIds = Array.prototype.slice
      .call(document.querySelectorAll("cart-items-component"))
      .map(function (element) {
        return element.dataset && element.dataset.sectionId;
      })
      .filter(Boolean);

    if (sectionIds.length) {
      formData.set("sections", sectionIds.join(","));
      formData.set("sections_url", window.location.pathname);
    }

    return buscarComPrazo(rootPath() + "cart/add.js", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        Accept: "application/json, text/html",
        "X-Requested-With": "XMLHttpRequest",
      },
      body: formData,
    }).then(function (response) {
      if (!response.ok) {
        return new Promise(function (resolve) {
          setTimeout(resolve, 350);
        }).then(function () {
          return buscarComPrazo(rootPath() + "cart/add.js", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: dadosDoFormulario(form, quantidade),
          });
        });
      }
      return response;
    }).then(function (response) {
      if (!response.ok) throw new Error("Nao foi possivel adicionar ao carrinho.");
      return response.json();
    });
  }

  function getProductIdFromForm(form) {
    var productInput = form && form.querySelector('[name="product-id"]');
    return productInput && productInput.value ? productInput.value : "";
  }

  function animateAddToCartButton(target) {
    var component = target && target.closest && target.closest("add-to-cart-component");
    if (component && typeof component.animateAddToCart === "function") {
      component.animateAddToCart();
    }
  }

  async function syncThemeCart(item, response, form) {
    var cart = await getCart().catch(function () {
      return null;
    });
    var itemCount = cart && typeof cart.item_count === "number" ? cart.item_count : item.quantity || 1;
    var detail = {
      resource: {},
      sourceId: String(item.id || item.variant_id || ""),
      data: {
        source: "routed-checkout-loader",
        itemCount: itemCount,
        productId: getProductIdFromForm(form),
        sections: response && response.sections ? response.sections : {},
      },
    };

    document.dispatchEvent(
      new CustomEvent("cart:update", {
        bubbles: true,
        detail: detail,
      })
    );
    document.dispatchEvent(
      new CustomEvent("cart:refresh", {
        bubbles: true,
        detail: { item: item, cart: cart, sections: detail.data.sections },
      })
    );
    document.dispatchEvent(
      new CustomEvent("cart:updated", {
        bubbles: true,
        detail: { item: item, cart: cart, sections: detail.data.sections },
      })
    );
  }

  function openCartPreview() {
    setTimeout(function () {
      var selectors = [
        "cart-icon button",
        "[aria-controls*='cart']",
        "[data-cart-drawer-toggle]",
        "button.header-actions__action",
        "button[class*='cart']",
        "button"
      ];
      var buttons = [];

      selectors.forEach(function (selector) {
        buttons = buttons.concat(Array.prototype.slice.call(document.querySelectorAll(selector)));
      });

      var clicked = buttons.some(function (button) {
        var label = (
          button.getAttribute("aria-label") ||
          button.textContent ||
          button.value ||
          button.className ||
          ""
        ).toString().toLowerCase();
        var rect = button.getBoundingClientRect ? button.getBoundingClientRect() : null;
        if (!/cart|carrinho/.test(label)) return false;
        if (rect && (!rect.width || !rect.height)) return false;
        button.click();
        return true;
      });

      if (!clicked) {
        document.dispatchEvent(new CustomEvent("cart:open"));
        document.dispatchEvent(new CustomEvent("theme:cart:open"));
      }
    }, 450);
  }

  async function routeAddToCart(event) {
    if (isAddingToCart) return;
    var target = event.target;
    var form = findProductForm(target);
    if (!form) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    isAddingToCart = true;

    try {
      animateAddToCartButton(target);
      var response = await submitProductForm(form);
      var item = response.items && response.items[0] ? response.items[0] : response;
      document.dispatchEvent(
        new CustomEvent("routed-checkout:cart-added", { detail: { item: item } })
      );
      await syncThemeCart(item, response, form);
      openCartPreview();
    } catch (error) {
      console.warn("[RoutedCheckout] fallback para add-to-cart nativo", error);
      form.submit();
    } finally {
      setTimeout(function () {
        isAddingToCart = false;
      }, 1200);
    }
  }

  function handleDocumentClick(event) {
    if (ehLinkProprio(event.target)) return;
    var expresso = alvoExpresso(event);
    if (expresso) {
      var naCapa = Boolean(
        event.target && event.target.getAttribute && event.target.getAttribute(MARCA_CAPA) !== null
      );
      if (naCapa && compraDesligadaNoTema(expresso.el)) {
        barrarEvento(event);
        return;
      }
      routeCheckout(event, expresso.el, expresso.modo);
      return;
    }
    if (isCheckoutTarget(event.target)) {
      routeCheckout(event);
    }
    // O "adicionar ao carrinho" NAO e interceptado: o proprio tema adiciona o
    // produto da vitrine normalmente (1 item). O roteamento acontece so no
    // checkout. Interceptar o add causava double-add (loader + tema = 2 itens).
  }

  function patchYampiCheckoutFunctions() {
    ["getNewCheckoutURL", "yampiClick", "fakeClick"].forEach(function (name) {
      var current = window[name];
      if (typeof current !== "function" || current.__routedCheckoutWrapped) return;
      window[name] = function (event) {
        if (event && event.preventDefault) event.preventDefault();
        routeCartCheckout();
        return false;
      };
      window[name].__routedCheckoutWrapped = true;
    });

    yampiPatchAttempts += 1;
    if (yampiPatchAttempts > 40 && yampiPatchTimer) {
      clearInterval(yampiPatchTimer);
      yampiPatchTimer = null;
    }
  }

  function bindDirectCheckoutTargets() {
    var selector =
      "[name='checkout'], [data-checkout], a[href*='/checkout'], button[name='checkout'], input[name='checkout'], .btn-checkout, .cart__checkout-button, .js-transparent-checkout, .yampi_purchase_confirmation_btn, .dm-quick-purchase__buy";
    Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (element) {
      if (element.__routedCheckoutBound) return;
      element.__routedCheckoutBound = true;
      element.addEventListener(
        "click",
        function (event) {
          routeCheckout(event, element);
        },
        true
      );
    });
  }

  // ------------------------------------------------------------------------
  // Redes de seguranca para os caminhos que NAO passam por evento de clique.
  //
  // Sem elas o loader falha em silencio: nao roteia e nao registra nada, que e
  // exatamente o padrao que vimos (checkout na vitrine com zero fallback).
  // ------------------------------------------------------------------------
  function instalarRedesDeSeguranca() {
    // (a) form.submit() por JS NAO dispara o evento "submit". Se o tema chama
    //     isso no cart drawer, nosso listener nunca roda.
    try {
      var submitOriginal = HTMLFormElement.prototype.submit;
      if (!submitOriginal.__routedCheckoutPatched) {
        var patched = function () {
          try {
            if (isCheckoutForm(this)) {
              // Com a rota em curso, este submit e o mesmo checkout que ja
              // esta sendo levado: engole. Deixar passar era ir para a vitrine.
              if (!isRouting) {
                report("bypass_form_submit", this.getAttribute("action") || "");
                routeCartCheckout();
              }
              return;
            }
          } catch (e) {}
          return submitOriginal.apply(this, arguments);
        };
        patched.__routedCheckoutPatched = true;
        HTMLFormElement.prototype.submit = patched;
      }
    } catch (e) {}

    // (b) navegacao programatica para o checkout desta loja.
    try {
      var ehCheckoutLocal = function (url) {
        try {
          var u = new URL(String(url), window.location.origin);
          return u.origin === window.location.origin && /^\/checkouts?(\/|$)/.test(u.pathname);
        } catch (e) { return false; }
      };
      ["assign", "replace"].forEach(function (metodo) {
        var original = window.location[metodo];
        if (typeof original !== "function" || original.__routedCheckoutPatched) return;
        var novo = function (url) {
          try {
            if (ehCheckoutLocal(url)) {
              // Mesma regra do submit: com a rota em curso, engole.
              if (!isRouting) {
                report("bypass_location_" + metodo, String(url).slice(0, 200));
                routeCartCheckout();
              }
              return;
            }
          } catch (e) {}
          return original.call(window.location, url);
        };
        novo.__routedCheckoutPatched = true;
        try { window.location[metodo] = novo; } catch (e) {}
      });
    } catch (e) {}
  }

  function init() {
    if (initialized || !document.body) return;
    initialized = true;
    instalarRedesDeSeguranca();
    esconderCarteiras();
    vigiarCarteirasDoProduto();
    reportarPresenca();
    window.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("click", handleDocumentClick, true);
    // Volta pelo bfcache (o "voltar" do checkout): a pagina volta congelada
    // como saiu, com a trava ligada e o botao carregando. Sem isto o comprador
    // voltava para um botao morto ate a valvula estourar.
    window.addEventListener("pageshow", function (event) {
      if (event && event.persisted) {
        liberarRoteamento();
        isAddingToCart = false;
      }
    });
    document.addEventListener(
      "submit",
      function (event) {
        var submitter = event.submitter;
        var form = event.target;
        if (submitter && isCheckoutTarget(submitter)) {
          routeCheckout(event, submitter);
        } else if (postaNoCheckoutDaVitrine(form)) {
          // Formulario que posta DIRETO no checkout da vitrine: qualquer
          // submit dele vai para la, seja qual for o botao. Antes passava sem
          // preventDefault quando o botao nao parecia de checkout.
          routeCheckout(event, submitter || form, "carrinho");
        } else if (isCheckoutForm(form)) {
          routeCheckout(
            event,
            form.querySelector(
              '[name="checkout"], [data-checkout], a[href*="/checkout"], button[name="checkout"], input[name="checkout"]'
            ) || form
          );
        }
      },
      true
    );
    bindDirectCheckoutTargets();
    patchYampiCheckoutFunctions();
    yampiPatchTimer = setInterval(function () {
      bindDirectCheckoutTargets();
      patchYampiCheckoutFunctions();
    }, 500);
  }

  function boot() {
    if (document.body) {
      init();
      return;
    }
    setTimeout(boot, 50);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  }
  boot();
})();
