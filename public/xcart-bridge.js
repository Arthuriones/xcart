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
  var UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"];
  var DIAS = 90;
  var PREFIXO = "_xcb_";

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

  // Nada para levar: visita organica, ou o anuncio nao trouxe parametro.
  var temAlgo = false;
  for (var k in guardados) {
    if (Object.prototype.hasOwnProperty.call(guardados, k)) temAlgo = true;
  }
  if (!temAlgo) return;

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
    return u.toString();
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

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", reescreverTudo);
  } else {
    reescreverTudo();
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
