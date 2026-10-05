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
 * xcart que fala com o Meta (CAPI).
 *
 * O GOOGLE ADS SAI DAQUI MESMO, pela tag do Google (gtag.js): ver produto e
 * adicionar ao carrinho viram conversao com send_to AW-x/rotulo, para cada
 * conta de /api/tracking/google-config. O begin_checkout do Google so sai do
 * tema quando o Web Pixel NAO esta cobrindo o checkout (ver 5).
 *
 * O clique nos botoes de checkout EXPRESSO (Shop Pay, Apple Pay...) vira
 * begin_checkout so para o Meta, pelo coletor (ver 3.4).
 *
 * Nenhum valor monetario e enviado daqui. O coletor tambem ignora se vier --
 * valor vindo do navegador e numero que qualquer um pode inflar na conta de
 * anuncios do lojista. O valor da venda vem do webhook, que e a Shopify falando.
 *
 * Nao depende de jQuery nem do tema. ES5 de proposito: tema antigo ainda roda.
 * =========================================================================== */
(function () {
  "use strict";

  // Uma execucao por pagina. O navegador embutido do Instagram e do Facebook
  // pre-carrega a pagina e pode rodar este arquivo duas vezes: seriam dois
  // wrappers no fetch (cada add_to_cart contado em dobro ate a janela segurar)
  // e duas leituras/escritas do carrinho disputando o mesmo atributo.
  if (window.__xcartClick) return;
  window.__xcartClick = true;

  // gclid   = clique normal
  // gbraid  = campanha de app em iOS, web-to-app
  // wbraid  = campanha de app em iOS, app-to-web
  // Os dois ultimos existem porque o iOS 14 quebrou o gclid em parte do
  // trafego; o Google manda um OU outro, nunca os tres.
  var CHAVES = ["gclid", "gbraid", "wbraid", "fbclid", "ttclid"];
  var DO_GOOGLE = ["gclid", "gbraid", "wbraid"];
  var DIAS = 90;
  var PREFIXO = "_xc_";

  function lerCookie(nome) {
    var m = document.cookie.match(
      new RegExp("(?:^|; )" + nome.replace(/([.$?*|{}()[\]\\/+^])/g, "\\$1") + "=([^;]*)")
    );
    return m ? decodeURIComponent(m[1]) : null;
  }

  function gravarCookie(nome, valor, dias) {
    var validade = new Date(Date.now() + (dias || DIAS) * 864e5).toUTCString();
    // Sem `domain`: fica first-party no host da loja, que e o que sobrevive
    // ao ITP. SameSite=Lax deixa o cookie ir na navegacao que vem do anuncio.
    document.cookie =
      nome + "=" + encodeURIComponent(valor) +
      "; expires=" + validade + "; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }

  // Mesmo path e mesmos atributos da gravacao: cookie apagado com path
  // diferente nao e o mesmo cookie, e o velho continuaria la.
  function apagarCookie(nome) {
    document.cookie =
      nome + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax" +
      (location.protocol === "https:" ? "; Secure" : "");
  }

  function daUrl(chave) {
    try {
      return new URLSearchParams(location.search).get(chave);
    } catch (e) {
      return null;
    }
  }

  // O que vai para o carrinho e para os eventos.
  var achados = {};
  // Chaves que um clique novo tornou velhas: vao VAZIAS ao carrinho, porque o
  // `/cart/update.js` mescla -- quem nao e mandado continua la, e o pedido
  // sairia com o gclid de um clique e o gbraid de outro.
  var limpar = {};
  // Valores inventados NESTA carga porque o cookie faltava. O carrinho pode ter
  // o valor do dia do clique (ver 2a); enquanto ele nao for lido, estes sao
  // provisorios.
  var gerados = {};

  /** Id proprio do visitante, para casar com a identidade guardada no servidor. */
  function visitante() {
    var atual = lerCookie(PREFIXO + "vid");
    if (atual) return atual;
    var novo =
      Date.now().toString(36) + "." + Math.random().toString(36).slice(2, 10);
    gravarCookie(PREFIXO + "vid", novo);
    gerados._xc_vid = true;
    return novo;
  }

  // ---- 1. o que este visitante tem de click id ----------------------------
  var frescos = {};
  for (var i = 0; i < CHAVES.length; i++) {
    var daQuery = daUrl(CHAVES[i]);
    if (daQuery) frescos[CHAVES[i]] = daQuery;
  }

  // Um clique novo no Google SUBSTITUI o conjunto anterior, nao soma a ele. O
  // Google manda um so dos tres por clique; se o gbraid de hoje convivesse com
  // o gclid da semana passada, o servidor escolheria o gclid e creditaria o
  // anuncio antigo pela venda do novo.
  var googleNaUrl = !!(frescos.gclid || frescos.gbraid || frescos.wbraid);

  for (var j = 0; j < CHAVES.length; j++) {
    var chave = CHAVES[j];
    if (frescos[chave]) {
      // Clique novo sempre vence o cookie antigo: e a atribuicao mais recente.
      gravarCookie(PREFIXO + chave, frescos[chave]);
      achados[chave] = frescos[chave];
    } else if (googleNaUrl && DO_GOOGLE.indexOf(chave) !== -1) {
      apagarCookie(PREFIXO + chave);
      limpar[chave] = true;
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
    gerados._fbp = true;
  }
  achados._fbp = fbp;

  // _fbc representa um CLIQUE real em anuncio: inventar um sem fbclid na URL
  // seria afirmar uma origem que nao aconteceu. Entao so existe quando ha
  // fbclid -- e quando ha, ele e montado UMA VEZ e guardado.
  //
  // POR QUE GUARDAR, E NAO RECONSTRUIR A CADA EVENTO
  //
  // O formato e `fb.1.<instante do clique>.<fbclid>`, e o Meta trata o valor
  // inteiro como UM identificador. Reconstruir no servidor com a hora de agora
  // dava um valor diferente em cada evento: medido, um visitante com 11 eventos
  // mandou 11 _fbc distintos -- o mesmo clique parecendo 11 cliques, e o funil
  // deixando de se ligar a compra.
  //
  // O carimbo certo e o instante em que o clique foi OBSERVADO, que so o
  // navegador conhece. Guardado no nosso cookie, todos os eventos daquele
  // visitante levam a mesma string -- inclusive o pedido, porque `achados` vira
  // cart attribute.
  function fbclidDoFbc(valor) {
    var p = String(valor || "").split(".");
    return p.length > 3 ? p.slice(3).join(".") : null;
  }

  // O cookie do PROPRIO Meta vence, quando existe e descreve o clique atual: se
  // o pixel do navegador estiver instalado, o valor dele e a verdade e nao ha o
  // que montar.
  var fbcDoMeta = lerCookie("_fbc");
  var fbc = lerCookie("_fbc") || lerCookie(PREFIXO + "fbc");
  var fbcMontado = false;

  // Clique NOVO refaz: o fbclid da URL e uma atribuicao mais recente que a
  // guardada, e manter a antiga creditaria o anuncio errado. Vale tambem contra
  // o cookie do Meta -- que aqui costuma ser fossil do pixel que foi desligado,
  // vivo por 90 dias e preso ao clique de antes.
  if (achados.fbclid && fbclidDoFbc(fbc) !== achados.fbclid) {
    var fbcNosso = lerCookie(PREFIXO + "fbc");
    if (fbclidDoFbc(fbcNosso) === achados.fbclid) {
      // Ja montamos para ESTE clique numa pagina anterior: reusar mantem o
      // carimbo do instante do clique, que e o que faz os eventos casarem.
      fbc = fbcNosso;
    } else if (frescos.fbclid || !fbcDoMeta) {
      fbc = "fb.1." + Date.now() + "." + achados.fbclid;
      gravarCookie(PREFIXO + "fbc", fbc);
      fbcMontado = true;
    }
  }

  if (fbc) achados._fbc = fbc;
  // Montado com um fbclid que veio do cookie, e nao da URL, o carimbo e o de
  // agora -- o carrinho pode guardar o do clique de verdade (ver 2a).
  if (fbcMontado && !frescos.fbclid) gerados._fbc = true;

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

  function temCliqueDoGoogle() {
    return !!(achados.gclid || achados.gbraid || achados.wbraid);
  }

  // So quando NAO ha nenhum dos tres. Com um gbraid de clique novo na mao, o
  // _gcl_aw ainda guarda o gclid do clique anterior; usa-lo misturaria os dois
  // cliques no mesmo pedido. Roda depois da leitura do carrinho (2a), que e
  // fonte melhor: foi o que nos mesmos vimos chegar na URL.
  function completarComGclAw() {
    if (temCliqueDoGoogle()) return;
    var gclAw = lerCookie("_gcl_aw");
    if (!gclAw) return;
    // Terceiro pedaco; o gclid pode conter ponto, entao junta o resto.
    var partesAw = String(gclAw).split(".");
    if (partesAw.length > 2) {
      var doGoogle = partesAw.slice(2).join(".");
      if (doGoogle) achados.gclid = doGoogle;
    }
  }

  // ---- 1d. teste do dono e consentimento ---------------------------------
  //
  // ?xcart_teste=1 marca ESTE navegador como teste (?xcart_teste=0 desmarca).
  // Vale 1 dia, nao 90: o link nao tem segredo, e um link vazado nao pode
  // calar por meses as compras reais de quem o abriu.
  // O evento continua indo ao coletor -- e la que o dono confere o teste --,
  // mas marcado: ao Meta so vai com codigo de teste, e a tag do Google nem
  // dispara. Vai tambem ao carrinho, para o checkout e a compra saberem.
  var pedidoTeste = daUrl("xcart_teste");
  if (pedidoTeste === "1") gravarCookie(PREFIXO + "teste", "1", 1);
  else if (pedidoTeste === "0") apagarCookie(PREFIXO + "teste");
  var TESTE =
    pedidoTeste === "1" || (pedidoTeste !== "0" && lerCookie(PREFIXO + "teste") === "1");
  if (TESTE) achados._xc_teste = "1";
  // Fora de teste o atributo sai do carrinho, se estiver la: o carrinho do dono
  // que voltou a ser de verdade nao pode marcar a compra como teste.
  else limpar._xc_teste = true;

  // Consentimento de marketing, da Customer Privacy API da Shopify. Lido na
  // hora de mandar, porque o banner pode ser respondido no meio da visita. Sem
  // a API, fica sem valor -- nunca "concedido" por padrao.
  function consentimento() {
    try {
      var cp = window.Shopify && window.Shopify.customerPrivacy;
      if (!cp || typeof cp.marketingAllowed !== "function") return null;
      return cp.marketingAllowed() ? "concedido" : "negado";
    } catch (e) {
      return null;
    }
  }

  // A API so existe quando algum script da loja a pede. Loja sem banner nunca
  // teria valor; pedir aqui e um script pequeno da propria Shopify, uma vez.
  try {
    if (
      window.Shopify &&
      !window.Shopify.customerPrivacy &&
      typeof window.Shopify.loadFeatures === "function"
    ) {
      window.Shopify.loadFeatures(
        [{ name: "consent-tracking-api", version: "0.1" }],
        function () {}
      );
    }
  } catch (e) {
    /* sem a API, o evento sai sem consentimento, como antes */
  }

  var vid = visitante();
  achados._xc_vid = vid;

  // ---- 2. levar para o carrinho -------------------------------------------
  //
  // `/cart/update.js` com attributes faz o valor viajar ate o pedido. So
  // escrevemos o que mudou: cada chamada e uma requisicao, e o tema re-renderiza
  // o carrinho quando ele muda.
  //
  // A marca do que ja foi gravado diz TAMBEM em qual carrinho. Sem o token, a
  // marca sobrevivia ao carrinho: quem comprava, voltava da pagina de obrigado
  // e comprava de novo na mesma aba ganhava um carrinho novo, a marca dizia "ja
  // gravado" e o segundo pedido saia sem gclid, sem _fbc e sem _xc_vid -- venda
  // paga pelo anuncio contada como "direto".
  function jaGravado() {
    try {
      var m = JSON.parse(sessionStorage.getItem(PREFIXO + "enviado") || "null");
      // Formato antigo (o mapa solto, sem token) vale como nada gravado: custa
      // uma escrita, e adivinhar o carrinho dele poderia custar o clique.
      if (m && typeof m === "object" && m.mapa && typeof m.mapa === "object") {
        return { token: m.token || null, mapa: m.mapa };
      }
    } catch (e) {
      /* storage ilegivel: trata como nada gravado */
    }
    return { token: null, mapa: {} };
  }

  function marcarGravado(token, mapa) {
    try {
      sessionStorage.setItem(
        PREFIXO + "enviado",
        JSON.stringify({ token: token, mapa: mapa })
      );
    } catch (e) {
      /* navegacao privada: reenviar nao machuca */
    }
  }

  // O token da Shopify pode vir como `abc123?key=...`. A chave muda sem o
  // carrinho mudar; so o que vem antes do `?` identifica o carrinho.
  function tokenDe(carrinho) {
    var t = carrinho && carrinho.token;
    return t ? String(t).split("?")[0] : null;
  }

  // O raiz precisa do prefixo de idioma quando a loja usa Markets com
  // sub-caminho (/ja, /en). Sem isso o POST cai em 404 e o atributo nunca
  // chega ao carrinho.
  function raiz() {
    var t = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return t.charAt(t.length - 1) === "/" ? t : t + "/";
  }

  /**
   * Escreve `achados` no carrinho, se ele ainda nao tiver.
   *
   * `carrinho` e o JSON de `/cart.js`, ou null quando nao deu para ler. Com o
   * carrinho em maos a comparacao e com os atributos de verdade -- o que pega
   * carrinho novo, carrinho limpo e atributo apagado por outro script. Sem ele,
   * sobra a marca da sessao.
   */
  function gravarNoCarrinho(carrinho) {
    // A compra nasce no servidor da Shopify, sem navegador: o consentimento do
    // visitante so chega ate ela por aqui.
    var consent = consentimento();
    if (consent) achados._xc_consent = consent;
    var anterior = jaGravado();
    var token = tokenDe(carrinho);
    var atributos =
      carrinho && carrinho.attributes && typeof carrinho.attributes === "object"
        ? carrinho.attributes
        : null;
    var novos = {};
    // Carrinho outro que o da marca: o que foi gravado la nao vale aqui.
    var mudou = !!(token && token !== anterior.token);

    for (var k in achados) {
      if (!Object.prototype.hasOwnProperty.call(achados, k)) continue;
      // Inventado agora sem ter conseguido ler o carrinho: la pode estar o
      // valor do dia do clique, e escrever este por cima e exatamente a perda
      // que a leitura existe para evitar. Fica para a proxima pagina.
      if (!carrinho && gerados[k]) continue;
      novos[k] = achados[k];
      if (atributos ? atributos[k] !== achados[k] : anterior.mapa[k] !== achados[k]) {
        mudou = true;
      }
    }
    for (var z in limpar) {
      if (!Object.prototype.hasOwnProperty.call(limpar, z)) continue;
      // Vazio e como a Shopify apaga um atributo.
      novos[z] = "";
      if (atributos ? !!atributos[z] : anterior.mapa[z] !== "") mudou = true;
    }

    // Ja esta gravado neste carrinho: pular a requisicao. Isto e um `return` de
    // funcao, nao do arquivo -- antes era do arquivo, e quando o click id nao
    // mudava nada abaixo rodava.
    if (!mudou) return;

    try {
      fetch(raiz() + "cart/update.js", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ attributes: novos }),
      })
        .then(function (r) {
          return r && r.ok ? r.json() : null;
        })
        .then(function (atualizado) {
          // O token vem da RESPOSTA: quando nao havia carrinho, e o update que
          // cria um, e o token lido antes nao existia.
          if (atualizado) marcarGravado(tokenDe(atualizado) || token, novos);
        })
        .catch(function () {
          /* carrinho indisponivel agora; a proxima pagina tenta de novo */
        });
    } catch (e) {
      /* navegador sem fetch: o resto do snippet (eventos) segue de pe */
    }
  }

  // ---- 2a. o carrinho guarda o que o ITP apagou ---------------------------
  //
  // O Safari apaga cookie gravado por JavaScript em 7 dias (24h quando a
  // pessoa chega por link decorado, que e o caso de todo anuncio). Todos os
  // nossos sao assim. No oitavo dia a pessoa volta, o snippet nao acha nada,
  // gera _xc_vid e _fbp NOVOS -- e escrevia esses por cima dos atributos do
  // carrinho, que ainda guardavam os do dia do clique. O carrinho e cookie do
  // servidor da Shopify e sobrevive; o clique morria por nossa propria mao, e
  // a venda ia sem atribuicao.
  //
  // Entao, antes de escrever, LEMOS o carrinho. O que falta no cookie e esta
  // la, volta para o cookie e para `achados`. Valor da URL continua vencendo:
  // e clique mais novo que qualquer coisa guardada.
  //
  // Teto de espera, porque o primeiro evento espera por isto: carrinho lento
  // nao pode segurar o funil. Estourou, segue com o que tem.
  var LIMITE_CARRINHO_MS = 1500;

  // Os itens do ultimo carrinho visto, em ids: e o que o checkout expresso do
  // carrinho compra (3.4). Atualizado a cada leitura e a cada resposta de
  // mudanca do carrinho -- nunca com uma requisicao so para isto.
  var MAX_ITENS = 20;
  var itensDoCarrinho = null;

  function guardarItens(carrinho) {
    var lista = carrinho && carrinho.items;
    if (!lista || typeof lista.length !== "number") return;
    var fora = [];
    for (var i = 0; i < lista.length && fora.length < MAX_ITENS; i++) {
      var it = lista[i];
      if (!it) continue;
      // Em /cart.js o `id` do item e o da variante.
      var v = it.variant_id || it.id;
      fora.push({
        variante: v ? String(v) : null,
        produto: it.product_id ? String(it.product_id) : null,
        sku: it.sku ? String(it.sku) : null,
      });
    }
    itensDoCarrinho = fora;
  }

  /** Le `/cart.js`. Chama `pronto` UMA vez: com o carrinho, ou null. */
  function lerCarrinho(pronto) {
    var feito = false;
    var controle = null;
    try {
      controle = typeof AbortController === "function" ? new AbortController() : null;
    } catch (e) {
      controle = null;
    }
    var alarme = setTimeout(function () {
      if (controle) {
        try {
          controle.abort();
        } catch (e) {
          /* abortar e so economia */
        }
      }
      fim(null);
    }, LIMITE_CARRINHO_MS);

    function fim(carrinho) {
      if (feito) return;
      feito = true;
      clearTimeout(alarme);
      var lido = carrinho && typeof carrinho === "object" ? carrinho : null;
      if (lido) guardarItens(lido);
      pronto(lido);
    }

    try {
      var opcoes = {
        credentials: "same-origin",
        headers: { Accept: "application/json" },
      };
      if (controle) opcoes.signal = controle.signal;
      fetch(raiz() + "cart.js", opcoes)
        .then(function (r) {
          return r && r.ok ? r.json() : null;
        })
        .then(fim)
        .catch(function () {
          fim(null);
        });
    } catch (e) {
      fim(null);
    }
  }

  // Onde cada atributo mora como cookie. A ordem importa: o _fbc e conferido
  // contra o fbclid, que precisa ter sido restaurado antes.
  var RESTAURAVEIS = CHAVES.concat(["_fbc", "_fbp", "_xc_vid"]);

  function cookieDoAtributo(k) {
    if (k === "_fbp") return "_fbp";
    if (k === "_fbc") return PREFIXO + "fbc";
    if (k === "_xc_vid") return PREFIXO + "vid";
    return PREFIXO + k;
  }

  function restaurarDoCarrinho(atributos) {
    // Calculado ANTES do laco: o conjunto do Google volta inteiro ou nao volta.
    // Ja havendo um (da URL ou de cookie vivo), juntar outro do carrinho
    // misturaria dois cliques.
    var googleVivo = temCliqueDoGoogle();

    for (var i = 0; i < RESTAURAVEIS.length; i++) {
      var k = RESTAURAVEIS[i];
      var guardado = atributos[k];
      if (typeof guardado !== "string" || !guardado || guardado.length > 500) continue;
      // Cookie vivo ou valor da URL: vence o carrinho.
      if (achados[k] && !gerados[k]) continue;
      if (DO_GOOGLE.indexOf(k) !== -1 && (googleVivo || googleNaUrl)) continue;
      // _fbc de outro clique que nao o atual nao serve.
      if (k === "_fbc" && achados.fbclid && fbclidDoFbc(guardado) !== achados.fbclid) {
        continue;
      }
      achados[k] = guardado;
      delete gerados[k];
      gravarCookie(cookieDoAtributo(k), guardado);
    }
    vid = achados._xc_vid;

    // O _auid nao e cookie nosso: vem do _gcl_au do Google. Se a tag dele ainda
    // nao recriou o cookie, devolvemos o mesmo valor no formato dele
    // (`1.1.<a>.<b>`), para o remarketing e a conversao falarem do mesmo
    // visitante.
    var auid = atributos._auid;
    if (!achados._auid && typeof auid === "string" && /^\d+\.\d+$/.test(auid)) {
      achados._auid = auid;
      if (!lerCookie("_gcl_au")) gravarCookie("_gcl_au", "1.1." + auid);
    }
  }

  // Quem precisa de `achados` completo espera aqui: o primeiro evento, a
  // identidade e a escrita no carrinho. Nunca para sempre -- a leitura tem
  // teto, e a saida da pagina solta a fila (ver `pagehide` no fim).
  var reidratado = false;
  var naFila = [];

  function quandoPronto(fn) {
    if (reidratado) {
      fn();
      return;
    }
    naFila.push(fn);
  }

  function concluirReidratacao(carrinho, saindo) {
    if (reidratado) return;
    if (carrinho && carrinho.attributes && typeof carrinho.attributes === "object") {
      restaurarDoCarrinho(carrinho.attributes);
    }
    completarComGclAw();
    reidratado = true;
    // Saindo da pagina nao se escreve: o update seria cancelado no meio, e
    // sem o carrinho lido arriscaria gravar o provisorio.
    if (!saindo) gravarNoCarrinho(carrinho);
    var fila = naFila;
    naFila = [];
    for (var i = 0; i < fila.length; i++) {
      try {
        fila[i]();
      } catch (e) {
        /* um evento com problema nao segura os outros */
      }
    }
  }

  // ---- 2b. carrinho criado depois da carga --------------------------------
  //
  // Quem chega sem carrinho tem o atributo escrito num carrinho que pode nem
  // existir ainda; o primeiro "adicionar" e que cria o de verdade, com outro
  // token e sem os nossos atributos. Depois de cada adicionar confirmado,
  // conferimos o carrinho e escrevemos se faltar.
  var conferindo = false;

  function conferirCarrinho() {
    quandoPronto(function () {
      // O tema faz duas chamadas a /cart/add por clique as vezes; a leitura em
      // voo ja enxerga o carrinho criado pela primeira.
      if (conferindo) return;
      conferindo = true;
      lerCarrinho(function (carrinho) {
        conferindo = false;
        if (carrinho) gravarNoCarrinho(carrinho);
      });
    });
  }

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
   *
   * `form`, quando vem, e o formulario do botao clicado (checkout expresso,
   * 3.4) e vence tudo: e a variante dele que a Shopify compra.
   */
  function produtoAtual(form) {
    var variante = null;
    var produto = null;
    var sku = null;

    var doForm = form && form.querySelector ? form.querySelector('[name="id"]') : null;
    if (doForm && doForm.value) variante = doForm.value;

    if (!variante) {
      try {
        variante = new URLSearchParams(location.search).get("variant");
      } catch (e) {
        variante = null;
      }
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
      // O SKU da variante que de fato esta selecionada -- nao o da primeira.
      //
      // Vai junto porque o id que a plataforma espera nao e sempre o da
      // variante: catalogo exportado por planilha costuma usar SKU, e sem este
      // campo o servidor nao teria como montar esse formato.
      if (meta.variants && meta.variants.length) {
        var conhecida = false;
        for (var k = 0; k < meta.variants.length; k++) {
          if (String(meta.variants[k].id) === String(variante)) {
            sku = meta.variants[k].sku || null;
            conhecida = true;
            break;
          }
        }
        if (!sku && !variante) sku = meta.variants[0].sku || null;
        // Formulario de OUTRO produto na pagina (compra rapida, produto em
        // destaque): o produto da pagina nao e o dele.
        if (doForm && variante && !conhecida) produto = null;
      }
    }

    return {
      variante: variante ? String(variante) : null,
      produto: produto,
      sku: sku ? String(sku) : null,
    };
  }

  /**
   * Eventos que carregam identificacao de produto.
   *
   * `begin_checkout` fica de fora de proposito: o carrinho pode ter varios
   * itens, e mandar so o ultimo produto visto descreveria uma compra que nao e
   * aquela. Melhor sem do que errado. O do checkout expresso (3.4) e a excecao:
   * ali se sabe o que o botao compra, e os itens vao em `produtos`.
   */
  var COM_PRODUTO = { view_item: 1, add_to_cart: 1 };

  function mandar(evento) {
    if (!COLETOR || !LOJA) return;
    if (repetido(evento)) return;

    // O que descreve a ACAO e lido agora; o que descreve o VISITANTE, depois
    // da leitura do carrinho (2a). O primeiro evento da pagina sairia, senao,
    // com o _xc_vid recem-inventado e sem o gclid que o carrinho guardava.
    var instante = Date.now();
    var produto = COM_PRODUTO[evento] ? produtoAtual() : null;
    var pagina = location.href.slice(0, 500);
    quandoPronto(function () {
      // Instante no id: protege contra reenvio da MESMA acao (o nosso retry, o
      // tema disparando duas vezes), sem impedir a acao repetida de verdade --
      // adicionar dois produtos ao carrinho sao dois eventos. O mesmo id vira
      // o transaction_id da conversao no Google.
      var id = evento + "_" + vid + "_" + instante;
      entregar(corpoDoEvento(evento, id, produto, pagina));
      converterNoGoogle(evento, id);
    });
  }

  function corpoDoEvento(evento, id, produto, pagina, extra) {
    return JSON.stringify({
      shop: LOJA,
      storeId: STORE_ID,
      evento: evento,
      eventId: id,
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
      produto: produto,
      // So no checkout expresso (3.4): os itens que o botao compra e a marca de
      // origem. Nos outros eventos ficam undefined e o JSON nem leva os campos.
      produtos: (extra && extra.produtos) || undefined,
      origem: (extra && extra.origem) || undefined,
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
      pageUrl: pagina,
      // Ver 1d. Ausentes, o JSON nem leva o campo.
      teste: TESTE || undefined,
      consentimento: consentimento() || undefined,
    });
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
    // Espera o carrinho pelo mesmo motivo do evento: associar o clientId a um
    // _xc_vid recem-inventado, e sem o gclid restaurado, ensinaria ao servidor
    // a identidade errada para o checkout inteiro.
    quandoPronto(function () {
      entregar(identidadeDe(clientId));
    });
  }

  function identidadeDe(clientId) {
    return JSON.stringify({
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
    });
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

  // Tirar item, trocar quantidade, limpar -- e o nosso /cart/update.js. A
  // resposta da Shopify a esses ja e o carrinho inteiro.
  function ehMudancaDoCarrinho(url) {
    return /\/cart\/(change|update|clear)\b/.test(String(url || ""));
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
            if (r && r.ok) adicionou();
          })
          .catch(function () {});
      } else if (ehMudancaDoCarrinho(url)) {
        // Le de uma COPIA, para o tema receber o corpo intacto. Este `then` e
        // registrado antes do do tema, entao a copia sai antes de ele ler.
        promessa
          .then(function (r) {
            if (!r || !r.ok || typeof r.clone !== "function" || !r.headers) return;
            var tipo = String(r.headers.get("content-type") || "");
            if (tipo.indexOf("json") === -1) return;
            return r.clone().json().then(guardarItens);
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
          if (this.status >= 200 && this.status < 300) adicionou();
        });
      }
      return abrir.apply(this, arguments);
    };
  }

  // O adicionar confirmado e o evento E o momento em que o carrinho de verdade
  // passa a existir (ver 2b).
  function adicionou() {
    mandar("add_to_cart");
    conferirCarrinho();
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
        // Expresso primeiro, e um OU outro: o mesmo clique nao vira dois.
        if (noCaminho(e, SELETOR_EXPRESSO)) checkoutExpresso(e);
        else if (ehBotaoDeCheckout(e.target)) mandar("begin_checkout");
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

  // ---- 3.4 checkout expresso ---------------------------------------------
  //
  // Shop Pay, Apple Pay, Google Pay e Amazon Pay no botao expresso PULAM a
  // pagina do checkout: o Shop Pay roda em shop.app, a carteira abre a janela
  // do sistema, e o Web Pixel nao roda em nenhum dos dois. Medido na Softnook
  // (04-05/10/2026): de 8 compras, as 5 pagas por carteira expressa chegaram
  // sem InitiateCheckout. A compra vem do webhook; o IC so pode sair daqui.
  //
  // Os botoes moram em shadow DOM FECHADO. A Shopify manda escutar o elemento
  // de fora de cada carteira: o clique e `composed` e atravessa a fronteira.
  // O PayPal costuma ficar num iframe de outro dominio, de onde o clique nao
  // sai -- mas ele volta ao checkout da Shopify, onde o pixel cobre.
  //
  // SO O META, pelo coletor. Nada de gtag aqui: no Google o begin_checkout sai
  // do navegador e so deduplica por transaction_id, que o clique e o
  // checkout_started nao compartilham -- o expresso que cai no checkout normal
  // contaria dois.
  var SELETOR_EXPRESSO = [
    "shop-pay-wallet-button",
    "shopify-apple-pay-button",
    "shopify-google-pay-button",
    "shopify-paypal-button",
    "shopify-amazon-pay-button",
    // Reserva: o hospedeiro, quando os de cima ficam dentro do shadow fechado.
    "shopify-accelerated-checkout",
    "shopify-accelerated-checkout-cart",
    // O botao dinamico antigo, de antes do componente.
    ".shopify-payment-button__button"
  ].join(", ");

  /** O mesmo de BALDE_CHECKOUT_EXPRESSO_MS em src/lib/tracking/eventos.ts. */
  var BALDE_EXPRESSO_MS = 30 * 60 * 1000;
  var baldeExpresso = null;

  function casa(no, seletor) {
    if (!no || no.nodeType !== 1) return false;
    var f = no.matches || no.msMatchesSelector || no.webkitMatchesSelector;
    try {
      return !!(f && f.call(no, seletor));
    } catch (e) {
      return false;
    }
  }

  /**
   * O primeiro elemento do caminho do clique que casa com o seletor.
   *
   * composedPath, e nao so `closest` no alvo: com shadow ABERTO o alvo e o
   * botao la de dentro, e `closest` para na fronteira -- nao chega ao
   * hospedeiro nem ao formulario do produto. Sem composedPath (navegador
   * antigo), fica o `closest`.
   */
  function noCaminho(e, seletor) {
    var caminho = null;
    try {
      caminho = typeof e.composedPath === "function" ? e.composedPath() : null;
    } catch (x) {
      caminho = null;
    }
    if (caminho && caminho.length) {
      for (var i = 0; i < caminho.length; i++) {
        if (casa(caminho[i], seletor)) return caminho[i];
      }
      return null;
    }
    var alvo = e.target;
    try {
      return alvo && alvo.closest ? alvo.closest(seletor) : null;
    } catch (x) {
      return null;
    }
  }

  /**
   * O que o botao compra, em ids (valor fica de fora, como em todo evento).
   *
   * Na pagina de produto o expresso compra SO a variante do formulario e pula
   * o carrinho. No carrinho (pagina ou gaveta) paga o carrinho inteiro: os
   * itens da ultima leitura ou resposta do carrinho (2a). Sem isso, o produto
   * da pagina.
   */
  function itensDoExpresso(e) {
    if (!noCaminho(e, "shopify-accelerated-checkout-cart, .additional-checkout-buttons")) {
      var form = noCaminho(e, 'form[action*="/cart/add"]');
      if (form || noCaminho(e, "shopify-accelerated-checkout, .shopify-payment-button")) {
        return [produtoAtual(form)];
      }
    }
    if (itensDoCarrinho && itensDoCarrinho.length) return itensDoCarrinho.slice(0);
    var atual = produtoAtual();
    return atual.variante || atual.produto ? [atual] : null;
  }

  function checkoutExpresso(e) {
    if (!COLETOR || !LOJA) return;
    var balde = Math.floor(Date.now() / BALDE_EXPRESSO_MS);
    // Abrir a carteira, fechar e abrir de novo e a mesma tentativa: um evento
    // por balde. Entre paginas, o coletor junta pelo id, igual no balde.
    if (baldeExpresso === balde) return;
    baldeExpresso = balde;
    // Lidos AGORA: o caminho do clique so existe durante o evento, e o Shop Pay
    // pode sair da pagina logo em seguida.
    var itens = itensDoExpresso(e);
    var pagina = location.href.slice(0, 500);
    quandoPronto(function () {
      // `vid` so depois da leitura do carrinho, pelo mesmo motivo de `mandar`.
      var id = "begin_checkout_xp_" + vid + "_" + balde;
      entregar(
        corpoDoEvento("begin_checkout", id, null, pagina, {
          origem: "expresso",
          produtos: itens,
        })
      );
      // Sem converterNoGoogle, de proposito: ver o comeco desta secao.
    });
  }

  // =========================================================================
  // 4. REMARKETING DO GOOGLE
  //
  // Isto NAO da para fazer do servidor, e e o motivo de existir aqui.
  //
  // Quem monta o publico de remarketing e o Google, a partir de um cookie que
  // ele so consegue gravar quando o NAVEGADOR fala com ele diretamente.
  //
  // Aqui so o hit de remarketing (page_view com send_to = a conta, sem
  // rotulo): nao e conversao. As conversoes ficam na secao 5, com rotulo e
  // transaction_id -- e o servidor nao manda mais nada ao Google, entao nao ha
  // segundo caminho para contar em dobro.
  // =========================================================================

  /** A fila da tag do Google. A mesma do tema, se ele ja tiver uma. */
  function gtag() {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(arguments);
  }

  var gtagCarregado = false;
  /** Contas que ja receberam `config`, para nao configurar duas vezes. */
  var configuradas = {};

  /**
   * Carrega o gtag.js UMA vez. Se o tema ja carrega (app do Google, tag
   * colada), reaproveita: a biblioteca atende qualquer conta pelo dataLayer.
   */
  function carregarGtag(conta) {
    if (gtagCarregado) return;
    gtagCarregado = true;
    var jaTem = false;
    try {
      jaTem = !!document.querySelector('script[src*="googletagmanager.com/gtag/js"]');
    } catch (e) {
      jaTem = false;
    }
    if (jaTem) return;
    var s = document.createElement("script");
    s.async = true;
    s.src = "https://www.googletagmanager.com/gtag/js?id=" + encodeURIComponent(conta);
    document.head.appendChild(s);
    gtag("js", new Date());
  }
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

  /**
   * O formato do id de produto, vindo da tag.
   *
   * Tem que casar BYTE A BYTE com o id do Merchant Center, senao o Google nao
   * liga o visitante ao produto e o anuncio dinamico nao serve aquele item --
   * sem erro nenhum, so campanha que nao entrega. Medido: o feed da Shopify usa
   * `shopify_<PAIS>_<idDoProduto>_<idDaVariante>` e nos mandavamos o id da
   * variante cru.
   *
   * Vazio = `{variant_id}`, que e o que esta tag fazia antes.
   */
  var ID_TEMPLATE =
    (tag && tag.getAttribute("data-xcart-id-template")) || "{variant_id}";

  /**
   * Aplica o template. Devolve null se faltar algum dado que ele pede.
   *
   * Null de proposito: `shopify_US__67606346727697`, com o id do produto
   * faltando, nao casa com nada e ainda PARECE um id valido. Produto sem id sai
   * do hit; produto com id errado mente para o Google.
   *
   * Espelha `montarIdDeProduto` em src/lib/tracking/id-produto.ts -- os dois
   * tem que concordar, senao o remarketing e a conversao falam de itens
   * diferentes.
   */
  function montarIdDeProduto(dados) {
    if (!dados) return null;
    var faltou = false;
    var saida = String(ID_TEMPLATE).replace(
      /\{(variant_id|product_id|sku)\}/g,
      function (inteiro, marcador) {
        var v =
          marcador === "variant_id"
            ? dados.variante
            : marcador === "product_id"
              ? dados.produto
              : dados.sku;
        v = v === null || v === undefined ? "" : String(v).trim();
        if (!v) {
          faltou = true;
          return "";
        }
        return v;
      }
    );
    return faltou ? null : saida;
  }

  function dadosDoProduto() {
    var meta = window.ShopifyAnalytics && window.ShopifyAnalytics.meta;
    var prod = meta && meta.product;
    if (!prod) return null;

    var atual = produtoAtual();
    var id = montarIdDeProduto(atual);
    if (!id) return null;

    // O preco da variante SELECIONADA, nao o da primeira: em produto com kit e
    // avulso, o valor do publico sairia errado.
    var v = null;
    if (prod.variants) {
      for (var i = 0; i < prod.variants.length; i++) {
        if (String(prod.variants[i].id) === String(atual.variante)) {
          v = prod.variants[i];
          break;
        }
      }
      if (!v) v = prod.variants[0] || null;
    }

    return {
      id: id,
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

  /** Contas que ja mandaram o hit de remarketing nesta pagina. */
  var remarketingFeito = {};

  /**
   * O hit de remarketing para cada conta que ainda nao mandou.
   *
   * Chamado duas vezes: com as contas gravadas no tema na instalacao
   * (data-xcart-remarketing) e com as que vem de /api/tracking/google-config.
   * A segunda e o que faz uma conta cadastrada DEPOIS da instalacao ganhar
   * remarketing sem reinstalar o snippet.
   */
  function remarketingPara(lista) {
    // O dono testando (?xcart_teste=1) nao entra na lista de ninguem.
    if (TESTE) return;
    var contas = [];
    for (var n = 0; n < lista.length; n++) {
      if (!remarketingFeito[lista[n]]) {
        remarketingFeito[lista[n]] = true;
        contas.push(lista[n]);
      }
    }
    if (contas.length === 0) return;

    // UM carregamento de gtag.js, nao um por conta: o arquivo e o mesmo e a
    // biblioteca atende varias contas pelo dataLayer. Carregar de novo so
    // duplicaria o download.
    carregarGtag(contas[0]);

    var pagina = tipoDaPagina();
    var prod = dadosDoProduto();

    // Consentimento antes do config, como nas conversoes: negado no banner,
    // a tag nao grava cookie de anuncio.
    aplicarConsentimentoGoogle();

    for (var i = 0; i < contas.length; i++) {
      if (!configuradas[contas[i]]) {
        // Sem page_view automatico: ele sairia sem ecomm_* e contaria a
        // visita duas vezes. O hit com o produto sai logo abaixo.
        gtag("config", contas[i], { send_page_view: false });
        configuradas[contas[i]] = true;
      }

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

  function ligarRemarketing() {
    remarketingPara(contasDeRemarketing());
  }

  /** Espera o DOM (o produto vem do ShopifyAnalytics.meta) e faz o hit. */
  function remarketingQuandoPronto(lista) {
    var fazer = function () {
      remarketingPara(lista);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fazer);
    else fazer();
  }

  if (document.readyState === "loading") {
    // Espera o ShopifyAnalytics.meta, que a Shopify preenche depois deste
    // script; sem ele o produto sai sem id e o publico fica generico.
    document.addEventListener("DOMContentLoaded", ligarRemarketing);
  } else {
    ligarRemarketing();
  }

  // =========================================================================
  // 5. CONVERSOES DO GOOGLE ADS, PELA TAG DO GOOGLE
  //
  // O Google sai do navegador, nao do servidor. As contas e os rotulos vem de
  // /api/tracking/google-config (id da loja E dominio, como o coletor). Cada
  // conta com rotulo para o evento recebe a conversao, com send_to
  // AW-x/rotulo e transaction_id = o id do evento (o mesmo do coletor).
  //
  // - view_item e add_to_cart: daqui.
  // - begin_checkout: daqui SO quando o Web Pixel nao cobre o checkout (header
  //   x-xcart-pixel-checkout: 0). Cobrindo, sai do pixel: o clique no botao e
  //   o checkout_started descrevem a mesma acao com ids diferentes, e o Google
  //   contaria duas.
  // - purchase: nunca daqui. Sai do pixel, na pagina de obrigado.
  // - teste (?xcart_teste=1): nada sai para o Google.
  // =========================================================================

  /** null = ainda buscando; [] = loja sem Google (ou a busca falhou). */
  var contasGoogle = null;
  var esperandoGoogle = [];
  var pixelCobreCheckout = true;

  /** O consentimento no formato do Google; sem leitura, nada e forcado. */
  function aplicarConsentimentoGoogle() {
    var c = consentimento();
    if (!c) return;
    var v = c === "concedido" ? "granted" : "denied";
    gtag("consent", "update", { ad_storage: v, ad_user_data: v, ad_personalization: v });
  }

  function receberContasGoogle(lista) {
    var contas = [];
    for (var i = 0; i < (lista || []).length; i++) {
      var c = lista[i];
      if (c && /^AW-\d+$/.test(c.conta || "")) contas.push({ conta: c.conta, labels: c.labels || {} });
    }
    contasGoogle = contas;
    if (contas.length) {
      carregarGtag(contas[0].conta);
      aplicarConsentimentoGoogle();
      for (var j = 0; j < contas.length; j++) {
        if (configuradas[contas[j].conta]) continue;
        configuradas[contas[j].conta] = true;
        // Sem page_view aqui: o hit de remarketing, com o produto, sai logo
        // abaixo pela secao 4.
        gtag("config", contas[j].conta, { send_page_view: false });
      }
      // Remarketing tambem para conta cadastrada depois da instalacao do
      // snippet, que nao esta em data-xcart-remarketing.
      var aws = [];
      for (var r = 0; r < contas.length; r++) aws.push(contas[r].conta);
      if (!TESTE) remarketingQuandoPronto(aws);
    }
    var fila = esperandoGoogle;
    esperandoGoogle = [];
    for (var k = 0; k < fila.length; k++) {
      try {
        fila[k]();
      } catch (e) {
        /* uma conversao com problema nao segura as outras */
      }
    }
  }

  function ligarGoogle() {
    if (!origem || !LOJA || !STORE_ID) {
      contasGoogle = [];
      return;
    }
    try {
      fetch(
        origem +
          "/api/tracking/google-config?store=" +
          encodeURIComponent(STORE_ID) +
          "&shop=" +
          encodeURIComponent(LOJA),
        { credentials: "omit", mode: "cors" }
      )
        .then(function (r) {
          if (!r || !r.ok) return [];
          try {
            pixelCobreCheckout = r.headers.get("x-xcart-pixel-checkout") !== "0";
          } catch (e) {
            pixelCobreCheckout = true;
          }
          return r.json();
        })
        .then(receberContasGoogle, function () {
          receberContasGoogle([]);
        });
    } catch (e) {
      receberContasGoogle([]);
    }
  }

  /** Dispara a conversao do evento em cada conta que tem rotulo para ele. */
  function converterNoGoogle(evento, id) {
    if (TESTE) return;
    if (evento !== "view_item" && evento !== "add_to_cart" && evento !== "begin_checkout") return;
    var disparar = function () {
      if (!contasGoogle || !contasGoogle.length) return;
      if (evento === "begin_checkout" && pixelCobreCheckout) return;
      aplicarConsentimentoGoogle();
      for (var i = 0; i < contasGoogle.length; i++) {
        var rotulo = contasGoogle[i].labels[evento];
        if (!rotulo) continue;
        gtag("event", evento, {
          send_to: contasGoogle[i].conta + "/" + rotulo,
          transaction_id: id,
        });
      }
    };
    if (contasGoogle === null) esperandoGoogle.push(disparar);
    else disparar();
  }

  // AGORA, sincronamente, nao no DOMContentLoaded.
  //
  // Trocar o window.fetch depois que o tema carregou nao serve: se ele ja
  // guardou a referencia original numa variavel dele, as chamadas dele passam
  // por fora do nosso wrapper e o add_to_cart nunca dispara. Os listeners de
  // clique e submit sao no document, que ja existe, e pegam elemento
  // renderizado depois de qualquer jeito.
  //
  // Fetch e XHR ficam fora do `if` abaixo: alem do evento, sao eles que avisam
  // que o carrinho nasceu (2b), e o click id precisa chegar ao pedido mesmo sem
  // coletor. `mandar` ja se recusa sozinho quando falta coletor ou loja.
  observarFetch();
  observarXhr();

  // Le o carrinho (2a) e so entao solta a fila. A leitura passa pelo nosso
  // wrapper do fetch, o que e inofensivo: cart.js nao e /cart/add.
  lerCarrinho(function (carrinho) {
    concluirReidratacao(carrinho, false);
  });

  // Clique em "finalizar" pode sair da pagina antes de a leitura voltar. Sem
  // isto, o begin_checkout ficaria na fila e morreria com a pagina; aqui ele sai
  // por sendBeacon, que sobrevive a navegacao, com o que houver em maos.
  if (window.addEventListener) {
    window.addEventListener("pagehide", function () {
      concluirReidratacao(null, true);
    });
  }

  if (COLETOR && LOJA) {
    ligarGoogle();
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
