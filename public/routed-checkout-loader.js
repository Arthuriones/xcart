(function () {
  // Forca no-referrer mesmo que o tema ja tenha uma meta/tag de referrer com
  // outra politica: a dark store nunca pode saber que o trafego veio da
  // vitrine, entao isso precisa ganhar de qualquer config existente.
  var existingReferrerMeta = document.querySelector('meta[name="referrer"]');
  if (existingReferrerMeta) {
    existingReferrerMeta.setAttribute("content", "no-referrer");
  } else {
    var noReferrerMeta = document.createElement("meta");
    noReferrerMeta.setAttribute("name", "referrer");
    noReferrerMeta.setAttribute("content", "no-referrer");
    document.head.insertBefore(noReferrerMeta, document.head.firstChild);
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
    var response = await fetch(rootPath() + "cart.js", {
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
  function resolveInlineUrl(lines) {
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
    if (pick.target.country) url.searchParams.set("country", pick.target.country);
    if (pick.target.locale) url.searchParams.set("locale", pick.target.locale);
    lastRoutedTarget = pick.target;
    return url.toString();
  }

  async function resolveCheckoutLines(lines) {
    // 1. Tenta resolucao inline (instantaneo, sem API, funciona offline)
    var inlineUrl = resolveInlineUrl(lines);
    if (inlineUrl) return inlineUrl;

    // 2. Fallback para API (cobre SKUs novos ainda nao embutidos no script)
    var response = await fetch(appUrl.replace(/\/$/, "") + "/api/checkout-routes/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: token,
        lines: lines,
        rotationKey: rotationKey,
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
    return resolveCheckoutLines(toRouteLines(cart));
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
  function enviarEvento(reason, detail) {
    try {
      var payload = JSON.stringify({
        token: token,
        reason: reason,
        detail: detail ? String(detail).slice(0, 500) : "",
        pageUrl: window.location.href,
        targetId: (lastRoutedTarget && lastRoutedTarget.id) || null,
        targetDomain: (lastRoutedTarget && lastRoutedTarget.domain) || "",
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
  function report(reason, detail) {
    enviarEvento(reason, detail);
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
      el.textContent = "Erro ao carregar checkout. Tente novamente.";
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 4000);
    } catch (e) {}
  }

  async function routeCartCheckout(skipGuard) {
    if (isRouting && !skipGuard) return;
    isRouting = true;

    try {
      var cart = await getCart();
      if (!cart.items || cart.items.length === 0) {
        window.location.href = rootPath() + "cart";
        return;
      }

      var destino = await resolveCheckout(cart);
      report(
        "routed_ok",
        String(cart.item_count || "") + " itens -> " +
          ((lastRoutedTarget && lastRoutedTarget.domain) || "?")
      );
      window.location.href = destino;
    } catch (error) {
      console.warn("[RoutedCheckout] erro ao rotear checkout", error);
      trackFallback("cart_checkout_error", error);
      // Nao redireciona para checkout da vitrine — mostra erro e deixa cliente tentar de novo.
      showRoutingError();
      isRouting = false;
    } finally {
      if (isRouting) {
        setTimeout(function () { isRouting = false; }, 1500);
      }
    }
  }

  async function routeCheckout(event, targetOverride) {
    var target = targetOverride || event.target;
    if (isRouting || !isCheckoutTarget(target)) return;

    event.preventDefault();
    event.stopPropagation();
    if (event.stopImmediatePropagation) event.stopImmediatePropagation();
    isRouting = true;

    try {
      if (isImmediatePurchaseTarget(target)) {
        var form = findProductForm(target);
        if (form) {
          try { await submitProductForm(form); } catch (e) {}
        }
      }

      await routeCartCheckout(true);
    } catch (error) {
      console.warn("[RoutedCheckout] erro ao rotear checkout", error);
      trackFallback("direct_checkout_error", error);
      showRoutingError();
      isRouting = false;
    } finally {
      if (isRouting) {
        setTimeout(function () { isRouting = false; }, 1500);
      }
    }
  }

  function findProductForm(target) {
    if (!target || !target.closest) return null;
    var form = target.closest("form");
    if (form) return form;
    return document.querySelector('form[action*="/cart/add"]');
  }

  function submitProductForm(form) {
    var formData = new FormData(form);
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

    return fetch(rootPath() + "cart/add.js", {
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
          return fetch(rootPath() + "cart/add.js", {
            method: "POST",
            credentials: "same-origin",
            headers: {
              Accept: "application/json",
              "X-Requested-With": "XMLHttpRequest",
            },
            body: new FormData(form),
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
              report("bypass_form_submit", this.getAttribute("action") || "");
              routeCartCheckout(true);
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
            if (ehCheckoutLocal(url) && !isRouting) {
              report("bypass_location_" + metodo, String(url).slice(0, 200));
              routeCartCheckout(true);
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
    reportarPresenca();
    window.addEventListener("click", handleDocumentClick, true);
    document.addEventListener("click", handleDocumentClick, true);
    document.addEventListener(
      "submit",
      function (event) {
        var submitter = event.submitter;
        var form = event.target;
        if (submitter && isCheckoutTarget(submitter)) {
          routeCheckout(event, submitter);
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
