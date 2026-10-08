import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  eventoValido,
  definicaoDoEvento,
  idDoCheckoutExpresso,
  origemDoCheckout,
  ATRASO_CHECKOUT_EXPRESSO_MS,
  JANELA_CHECKOUT_EXPRESSO_MS,
  PREFIXO_CHECKOUT_EXPRESSO,
  vaiPeloServidor,
  type ChaveEvento,
  type PlataformaServidor,
} from "@/lib/tracking/eventos";
import { MAX_TTCLID, montarFbc, montarUserData, montarUserTiktok } from "@/lib/tracking/normalizar";
import { montarEventoDeFunilTiktok } from "@/lib/tracking/tiktok-evento";
import { JANELA_PIXEL_CHECKOUT_MS } from "@/lib/tracking/google-tag";

export const runtime = "nodejs";

// ============================================================================
// Coletor dos eventos de funil (ver produto, carrinho, checkout).
//
// A Shopify nao tem webhook para essas tres acoes -- carrinho e checkout
// acontecem no navegador. Entao o snippet do tema avisa aqui, e daqui o NOSSO
// servidor fala com o Meta (CAPI) e com o TikTok (Events API).
//
// O GOOGLE NAO PASSA POR AQUI. O Google Ads sai do navegador, pela tag do
// Google (gtag.js) que o proprio snippet e o Web Pixel carregam -- ver
// /api/tracking/google-config. Este coletor nao enfileira nada para o Google.
//
// ------------------------- ESTE ENDPOINT E PUBLICO -------------------------
//
// Quem dispara e o visitante da loja: nao existe sessao para autenticar. Ou
// seja, qualquer um pode chamar e gerar conversao na conta de anuncios do
// lojista. Tres decisoes limitam o estrago, e nenhuma delas e "conferir a
// origem" -- Origin e Referer sao escolhidos pelo cliente, e checar isso daria
// uma sensacao de seguranca que nao existe:
//
//   1. VALOR NAO VEM DO NAVEGADOR. Nenhum evento daqui leva value/currency.
//      Era o vetor que importava: inflar valor de conversao distorce o lance
//      automatico. O valor da venda vem do webhook, que e a Shopify falando.
//   2. TETO POR VISITANTE. Um cookie novo por rodada ainda passa, mas o custo
//      sobe e o volume fica visivel na tela em vez de silencioso.
//   3. DEDUPE PELO event_id, pelo indice unico que a fila ja tem. Reenvio do
//      snippet e retentativa nossa nao viram duas conversoes.
//
// O mesmo vale para qualquer pixel de navegador -- inclusive o do Google. A
// diferenca e que aqui esta escrito.
// ============================================================================

/**
 * LINHAS de fila por visitante por dia -- nao acoes.
 *
 * Uma acao rende uma linha por destino configurado, entao numa loja com dois
 * pixels Meta sao duas. Um visitante de verdade faz algo como 10 produtos + 3
 * carrinhos + 1 checkout = 14 acoes = 28 linhas, e o teto nao pode encostar
 * nisso. Contar linha em vez de acao e escolha de custo: distinct por event_id
 * seria outra consulta a cada evento.
 *
 * De todo jeito o teto por visitante nao e a defesa principal -- quem troca o
 * cookie escapa dele. O teto da LOJA e o que limita de verdade.
 */
const TETO_POR_VISITANTE = 120;

/**
 * Teto por loja por hora.
 *
 * Era 2000, e isso e pouco para loja que deu certo: 20 mil pageviews por dia
 * com tres eventos por visita passa de 2000/h so na media, antes de qualquer
 * pico. O teto virava um limite de CRESCIMENTO, nao de abuso -- e descartava
 * evento real em silencio.
 *
 * 20 mil/h e folgado para trafego legitimo e continua barrando laco no snippet
 * ou chamada em massa. E quando estoura, agora carimba: ser visivel importa
 * mais que o numero exato, porque nenhum numero serve para toda loja.
 */
const TETO_POR_LOJA_HORA = 20000;

/**
 * Identidades NOVAS por loja por hora.
 *
 * O visitorId vem do cliente: cada id inventado era uma linha nova em
 * `tracking_identities`, sem teto nenhum. Acima disto, so atualiza visitante
 * que ja existe -- quem ja estava na loja segue com o clique, e o abuso para
 * de crescer a tabela.
 */
const TETO_IDENTIDADES_HORA = 20000;

/** Pixel e tema no mesmo checkout: o do tema chegou antes, nesta janela. */
const JANELA_CHECKOUT_DO_TEMA_MS = 10 * 60 * 1000;

/** Itens do carrinho num evento. Carrinho de verdade nao chega perto disto. */
const MAX_ITENS = 20;

/**
 * O formato do `_xc_vid` que o snippet grava: base36 + "." + base36. O pixel le
 * o cookie e manda como `vidDoTema`; fora disto e lixo, e nao vira filtro.
 */
const FORMATO_VID_DO_TEMA = /^[a-z0-9]+\.[a-z0-9]+$/;
const MAX_VID_DO_TEMA = 64;

type ProdutoDoCorpo = {
  variante?: string | null;
  produto?: string | null;
  sku?: string | null;
};

/** Cortado: o valor vai cru para o payload e para o catalogo. */
function lerProduto(p: unknown) {
  const o = (p && typeof p === "object" ? p : {}) as ProdutoDoCorpo;
  const texto = (v: unknown, max: number) =>
    (typeof v === "string" || typeof v === "number" ? String(v) : "").trim().slice(0, max) || null;
  return {
    variantId: texto(o.variante, 64),
    productId: texto(o.produto, 64),
    sku: texto(o.sku, 128),
  };
}

function comCors(resposta: NextResponse, origem: string | null): NextResponse {
  // `*` de proposito, e sem Allow-Credentials: o dominio publico da loja nao
  // esta no nosso banco (guardamos o .myshopify.com), a resposta nao carrega
  // nada do lojista e nenhum cookie e lido. Restringir a origem aqui nao
  // impediria um curl -- o que limita abuso sao os tetos acima.
  resposta.headers.set("Access-Control-Allow-Origin", origem || "*");
  resposta.headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  resposta.headers.set("Access-Control-Allow-Headers", "Content-Type");
  resposta.headers.set("Access-Control-Max-Age", "86400");
  resposta.headers.set("Vary", "Origin");
  return resposta;
}

export async function OPTIONS(request: NextRequest) {
  return comCors(
    new NextResponse(null, { status: 204 }),
    request.headers.get("origin")
  );
}

export async function POST(request: NextRequest) {
  const origem = request.headers.get("origin");
  // Sempre 204 para o navegador, mesmo em erro: o snippet nao tem o que fazer
  // com a falha, e um 4xx no console da loja do cliente e ruido que ele leria
  // como problema da loja. O diagnostico fica na tela de rastreamento.
  const ok = (detalhe: Record<string, unknown>) =>
    comCors(NextResponse.json({ ok: true, ...detalhe }, { status: 200 }), origem);
  const recusado = (motivo: string) =>
    comCors(NextResponse.json({ ok: false, motivo }, { status: 200 }), origem);

  let corpo: {
    shop?: string;
    /** Linha de loja do xcart, cravada na tag pelo instalador. */
    storeId?: string;
    evento?: string;
    eventId?: string;
    visitorId?: string;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
    /** Do cookie `_gcl_au`, escrito pela tag do Google. So vai para a identidade. */
    auid?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    fbclid?: string | null;
    /** Clique do TikTok (?ttclid=) e o cookie `_ttp` do pixel dele. */
    ttclid?: string | null;
    ttp?: string | null;
    /** De onde a sessao veio, para diagnosticar trafego sem click id. */
    referrer?: string | null;
    /** A URL da pagina, mandada explicita pelo snippet. Ver abaixo. */
    pageUrl?: string | null;
    /** Produto em tela, nos eventos que tem um. Ver `custom_data` abaixo. */
    produto?: ProdutoDoCorpo | null;
    /**
     * O que esta sendo comprado, quando e mais de um item: o checkout expresso
     * do carrinho paga o carrinho inteiro. So vale no expresso, e ai vence
     * `produto`; nos outros eventos e ignorada.
     */
    produtos?: unknown;
    /** De onde veio o begin_checkout do tema. Ver `origemDoCheckout`. */
    origem?: string | null;
    /** 'pixel' quando vem do Web Pixel do checkout; ausente = snippet do tema. */
    fonte?: string | null;
    /** Identificador de visitante da Shopify. A unica chave que o pixel tem. */
    clientId?: string | null;
    /**
     * O cookie `_xc_vid` do tema, lido pelo pixel por `browser.cookie`. So do
     * pixel, e so serve para cancelar o expresso pendente: e a ponte que sobra
     * quando a Shopify zera o clientId (sem consentimento).
     */
    vidDoTema?: unknown;
    checkoutToken?: string | null;
    /** PII do checkout. So o Web Pixel ve -- o tema nao entra la. */
    email?: string | null;
    telefone?: string | null;
    primeiroNome?: string | null;
    sobrenome?: string | null;
    cidade?: string | null;
    estado?: string | null;
    cep?: string | null;
    pais?: string | null;
    /** Visitante marcado pelo link ?xcart_teste=1. Ver teste.ts. */
    teste?: boolean | null;
    /** 'concedido' | 'negado', da Customer Privacy API da Shopify. */
    consentimento?: string | null;
  };
  // Teto de tamanho ANTES do parse. O endpoint e publico, o payload vira
  // linha de banco, e linha 'falhou' fica 30 dias: um POST de MBs repetido
  // enche o disco do Supabase, e disco cheio poe o Postgres em somente
  // leitura -- o que para o webhook, o coletor e o roteamento juntos. O maior
  // evento legitimo (checkout com endereco) fica abaixo de 2 KB.
  const textoDoCorpo = await request.text();
  if (textoDoCorpo.length > 16 * 1024) return recusado("corpo grande demais");
  try {
    corpo = JSON.parse(textoDoCorpo);
  } catch {
    return recusado("corpo invalido");
  }

  const loja = (corpo.shop || "").trim().toLowerCase();
  const evento = (corpo.evento || "").trim();
  const visitorId = (corpo.visitorId || "").trim().slice(0, 64);
  let eventId = (corpo.eventId || "").trim().slice(0, 200);

  if (!loja || !eventId || !visitorId) {
    return recusado("shop, eventId e visitorId sao obrigatorios");
  }
  // "identidade" nao e evento de conversao: e o tema avisando "este visitante e
  // este clientId da Shopify". Nao entra na fila e nao vira conversao nenhuma.
  //
  // Existe porque o `uniqToken` so aparece depois que o trekkie da Shopify
  // carrega, e o nosso `view_item` dispara ANTES disso. Medido em producao: 949
  // visitantes distintos em 7 dias e 6 identidades gravadas. Sem a identidade, o
  // evento do Web Pixel -- que roda em sandbox e nao le cookie da loja -- chega
  // ao checkout sem gclid e sem _fbp.
  const ehIdentidade = evento === "identidade";

  if (!ehIdentidade && !eventoValido(evento)) {
    return recusado("evento desconhecido");
  }
  const definicao = ehIdentidade ? null : definicaoDoEvento(evento as ChaveEvento);
  if (definicao && definicao.origem === "webhook") {
    // `purchase` vem do webhook. Aceitar aqui deixaria qualquer um declarar
    // uma venda -- e com o oid do navegador, ainda por cima. Os demais
    // ('navegador' e 'pixel') sao acoes de funil: a exposicao e a mesma que
    // qualquer pixel de navegador tem, e os tetos abaixo e que limitam.
    return recusado("este evento nao vem do navegador");
  }

  const admin = createAdminClient();

  // ------------------------------------------------------------------------
  // Qual LINHA de loja e esta?
  //
  // `stores` tem mais de uma linha ativa para o mesmo shop_domain -- ha 4 casos
  // assim em producao hoje. Acontece em reinstalacao, e o webhook ate documenta
  // que o mesmo dominio pode estar cadastrado por usuarios diferentes, cada um
  // com o seu app.
  //
  // `maybeSingle()` aqui ERRA quando vem mais de uma: o PostgREST recusa, e o
  // coletor respondia "loja desconhecida" -- rastreamento morto em silencio
  // justamente nas lojas reinstaladas.
  //
  // O webhook desempata pela assinatura HMAC. Aqui nao ha assinatura: o evento
  // vem do navegador do visitante.
  //
  // POR QUE O DOMINIO SOZINHO NAO BASTA
  //
  // Qualquer conta do xcart consegue gravar uma linha em `stores` com o dominio
  // de OUTRA loja -- o app grava `stores` pelo cliente do usuario, e o
  // `created_at` vai junto. O desempate antigo ("a mais recente com
  // rastreamento ligado") entregava a escolha a quem escrevesse a data mais
  // nova: os eventos do Web Pixel da loja da vitima iam para a linha do
  // intruso, com e-mail e telefone do checkout, e a ponte checkout -> clientId
  // tambem -- o que desligava a recuperacao de clique da compra.
  //
  // Por isso: com o id da linha (tag do tema e pixel novos), casa por id E
  // dominio, e o intruso nao tem como ser essa linha. Sem o id, so aceita
  // quando ha UMA linha ligada para o dominio; com mais de uma, recusa em vez
  // de adivinhar. Medido antes desta mudanca: as lojas com rastreamento ligado
  // tem uma linha cada, e os 4 dominios duplicados tem rastreamento desligado.
  // ------------------------------------------------------------------------
  const idDaTag = (corpo.storeId || "").trim();
  const consulta = admin
    .from("stores")
    .select("id")
    .is("uninstalled_at", null);

  // Com o id da tag nao ha o que desempatar: e exatamente a linha que instalou o
  // snippet. O dominio segue exigido junto -- o id sozinho deixaria alguem
  // apontar evento para a loja de outro sabendo so o uuid.
  const { data: candidatas } = idDaTag
    ? await consulta.eq("id", idDaTag).eq("shop_domain", loja)
    : await consulta.eq("shop_domain", loja);

  if (!candidatas?.length) return recusado("loja desconhecida");

  const ids = candidatas.map((c) => c.id);
  // So o interruptor da loja e o estado do Web Pixel: as credenciais agora
  // moram em tracking_destinations, uma linha por conta.
  const { data: cfgs } = await admin
    .from("tracking_configs")
    .select("store_id, enabled, web_pixel_visto_em, web_pixel_com_id_em, teto_atingido_em")
    .in("store_id", ids);

  const porStore = new Map((cfgs || []).map((c) => [c.store_id, c]));
  // Com o id ha uma candidata so. Sem ele, so serve se exatamente UMA linha do
  // dominio estiver ligada. Nenhuma ligada cai no "rastreamento desligado"
  // abaixo; mais de uma e ambiguo -- e ambiguidade aqui e exatamente o que um
  // intruso fabrica, entao a resposta e recusar.
  const ligadas = candidatas.filter((c) => porStore.get(c.id)?.enabled);
  if (!idDaTag && ligadas.length > 1) {
    return recusado("loja ambigua: reinstale a tag e o pixel com o id da loja");
  }
  const escolhida = ligadas[0] || candidatas[0];

  const registro = escolhida;
  const cfg = porStore.get(registro.id);

  if (!cfg?.enabled) return recusado("rastreamento desligado");

  const doPixel = (corpo.fonte || "").trim() === "pixel";

  const { ehClientIdSentinela, identidadePorCliente } = await import(
    "@/lib/tracking/identidade-do-pedido"
  );

  // O clientId zerado que a Shopify usa sem consentimento NAO e identidade:
  // e o mesmo valor para pessoas diferentes. Tratado como real, virava um
  // external_id compartilhado e uma linha de identidade que creditava o clique
  // de um visitante a outro.
  const clientIdBruto = (corpo.clientId || "").trim().slice(0, 100) || null;
  const clientId = ehClientIdSentinela(clientIdBruto) ? null : clientIdBruto;

  // O visitante do tema que o pixel leu do cookie. Sem consentimento a Shopify
  // zera o clientId, o pixel vira o checkout (visitorId = token) e nao ha
  // identidade para achar quem clicou: sem isto, o expresso pendente do mesmo
  // comprador ficava de pe e saia pelo cron, depois do IC do pixel. So do pixel
  // -- o tema ja manda o proprio como visitorId -- e so no formato do snippet.
  const vidDoTema =
    doPixel &&
    typeof corpo.vidDoTema === "string" &&
    corpo.vidDoTema.length <= MAX_VID_DO_TEMA &&
    FORMATO_VID_DO_TEMA.test(corpo.vidDoTema)
      ? corpo.vidDoTema
      : null;

  const checkoutToken = (corpo.checkoutToken || "").trim().slice(0, 120) || null;

  // Um begin_checkout e um payment_info POR CHECKOUT.
  //
  // O pixel montava o eventId com o `event.id` da Shopify, que e novo a cada
  // disparo: recarregar o checkout disparava checkout_started de novo, e cada
  // cartao recusado e reenviado disparava payment_info de novo. O indice unico
  // nao segurava, o Meta nao deduplicava e o Google contava outra conversao.
  // Recusa de cartao e alta em dropshipping. Feito aqui, e nao so no pixel,
  // para valer tambem para a versao do pixel que esteja em cache.
  if (doPixel && checkoutToken) {
    eventId = `${evento}_ck_${checkoutToken}`.slice(0, 200);
  }

  // Clique num botao de checkout EXPRESSO (Shop Pay, Apple Pay, Google Pay...),
  // que pula a pagina do checkout -- ver `idDoCheckoutExpresso`. So do tema e so
  // no begin_checkout. O id e refeito aqui, com o nosso relogio, pelo mesmo
  // motivo do pixel acima: a marca vem do navegador, e com o id do cliente cada
  // POST com id novo seria um InitiateCheckout a mais furando a supressao abaixo.
  //
  // O PIXEL VENCE: o expresso so e reserva. Ele fica pendente na fila por
  // ATRASO_CHECKOUT_EXPRESSO_MS, e o begin_checkout do pixel do mesmo
  // comprador o cancela -- ver `cancelarExpressoPendente`.
  const expresso =
    !doPixel && evento === "begin_checkout" && origemDoCheckout(corpo.origem) === "expresso";
  if (expresso) eventId = idDoCheckoutExpresso(visitorId, Date.now());

  // A ponte checkout -> clientId, gravada ANTES de qualquer saida antecipada.
  //
  // E o que o webhook usa para achar o clique quando o pedido chega sem cart
  // attribute ("Comprar agora", checkout expresso). Depois daqui ha retorno
  // por "nenhum destino quer o evento" e pelos tetos -- se a gravacao ficasse
  // depois deles, loja sem rotulo de begin_checkout nunca teria a ponte.
  if (doPixel && checkoutToken && clientId) {
    const { error } = await admin.from("tracking_checkouts").upsert(
      {
        store_id: registro.id,
        checkout_token: checkoutToken,
        shopify_client_id: clientId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,checkout_token" }
    );
    if (error) console.error("[tracking/collect] falha ao gravar a ponte do checkout", error.message);
  }

  const clique = {
    gclid: (corpo.gclid || "").trim().slice(0, 200) || null,
    gbraid: (corpo.gbraid || "").trim().slice(0, 200) || null,
    wbraid: (corpo.wbraid || "").trim().slice(0, 200) || null,
    auid: (corpo.auid || "").trim().slice(0, 100) || null,
  };
  let fbp = (corpo.fbp || "").trim().slice(0, 100) || null;
  let fbc = (corpo.fbc || "").trim().slice(0, 300) || null;
  const fbclid = (corpo.fbclid || "").trim().slice(0, 300) || null;
  const ttclidBruto = typeof corpo.ttclid === "string" ? corpo.ttclid.trim() : "";
  let ttclid = ttclidBruto && ttclidBruto.length <= MAX_TTCLID ? ttclidBruto : null;
  let ttp = (typeof corpo.ttp === "string" ? corpo.ttp : "").trim().slice(0, 100) || null;

  /**
   * Grava a associacao visitante -> click ids.
   *
   * Uma linha por visitante (`onConflict store_id,visitor_id`): reenviar o
   * mesmo visitorId so atualiza. Mas o visitorId vem do cliente, e cada id
   * inventado e uma linha nova -- por isso o teto de identidades NOVAS por
   * hora (TETO_IDENTIDADES_HORA). Estourado, so atualiza quem ja existe.
   */
  async function publicarIdentidade(semTtp = false): Promise<void> {
    const campos = {
      shopify_client_id: clientId,
      gclid: clique.gclid,
      gbraid: clique.gbraid,
      wbraid: clique.wbraid,
      auid: clique.auid,
      fbp,
      fbc,
      fbclid,
      ttclid,
      // So quando existe: a coluna nasceu na 059. Sem o valor, a escrita nem
      // cita a coluna.
      ...(ttp && !semTtp ? { ttp } : {}),
      updated_at: new Date().toISOString(),
    };

    // Visitante que ja existe (quase todo evento) so atualiza: nao paga a
    // contagem do teto.
    const { data: existente, error: erroUpdate } = await admin
      .from("tracking_identities")
      .update(campos)
      .eq("store_id", registro.id)
      .eq("visitor_id", visitorId)
      .select("id");
    // Sem a coluna `ttp` (059 ainda nao aplicada) o PostgREST recusa a escrita
    // INTEIRA. De novo sem ela, ja aqui: o clique do Meta e do Google nao pode
    // cair por causa do cookie do TikTok, nem pagar contagem e upsert com erro.
    if (erroUpdate && "ttp" in campos) return publicarIdentidade(true);
    if (!erroUpdate && existente && existente.length > 0) return;

    // Linha NOVA: conta as que nasceram na ultima hora. Indice
    // (store_id, created_at) na migration 056.
    const { count, error: erroConta } = await admin
      .from("tracking_identities")
      .select("id", { count: "exact", head: true })
      .eq("store_id", registro.id)
      .gte("created_at", new Date(Date.now() - 36e5).toISOString());

    // Falha na contagem nao derruba a identidade: melhor uma linha a mais que
    // um clique perdido.
    if (!erroConta && (count ?? 0) >= TETO_IDENTIDADES_HORA) return;

    const { error: erroUpsert } = await admin.from("tracking_identities").upsert(
      { store_id: registro.id, visitor_id: visitorId, ...campos },
      { onConflict: "store_id,visitor_id" }
    );
    // Segunda rede do mesmo caso, se o update passou e o upsert nao.
    if (erroUpsert && "ttp" in campos) return publicarIdentidade(true);
  }

  // O aviso de identidade termina aqui: sem fila, sem destino, sem conversao.
  // Nao passa pelos tetos de `tracking_events` abaixo -- este caminho nao cria
  // linha la. O teto dele e o de identidades novas, em publicarIdentidade.
  if (ehIdentidade) {
    if (!clientId) return recusado("identidade sem clientId");
    await publicarIdentidade();
    return ok({ identidade: "gravada" });
  }

  // Evento do TEMA com clientId publica a associacao aqui, antes da supressao
  // do checkout, do "nenhum destino" e dos tetos. Antes ficava depois deles, e
  // ai a identidade que o checkout e a compra iam consultar simplesmente nao
  // existia quando um desses retornos acontecia.
  //
  // O PIXEL tambem publica quando o evento dele TRAZ clique (atributo do
  // carrinho ou a URL do checkout): anuncio direto para o permalink nao passa
  // por tema nenhum, e sem esta linha a compra desse comprador nao acha o
  // clique por lugar nenhum (identidade-do-pedido.ts, passo 2, resolve o
  // clientId do checkout por aqui). Sem clique o pixel segue so consultando.
  const trouxeClique = Boolean(
    fbclid || fbc || ttclid || clique.gclid || clique.gbraid || clique.wbraid
  );
  if (clientId && (!doPixel || trouxeClique)) {
    await publicarIdentidade();
  }

  // O pixel se ANUNCIA, carimbando a hora. Nao ha passo manual de "marcar como
  // instalado", e nao da para detectar pela API: `read_pixels` nao esta nos
  // nossos escopos, e pedir mais escopo so para isso obrigaria toda loja a
  // reautorizar.
  //
  // E um CARIMBO, nao um booleano, porque booleano nunca desligaria: pixel
  // removido da Shopify deixaria o begin_checkout do tema suprimido para
  // sempre, e o evento sumiria em silencio.
  //
  // Nao carimba a cada evento: seria uma escrita por pageview de checkout sem
  // mudar a decisao. Uma vez por hora basta para a janela de 7 dias.
  const vistoEm = cfg.web_pixel_visto_em
    ? new Date(cfg.web_pixel_visto_em).getTime()
    : 0;
  // E carimba SEPARADO se o trecho colado e o novo, com o id da loja. Sem
  // isso a tela nao tinha como saber que o pixel instalado era o antigo -- e
  // escondia o codigo justamente nas lojas que precisavam trocar.
  const comIdEm = cfg.web_pixel_com_id_em
    ? new Date(cfg.web_pixel_com_id_em).getTime()
    : 0;
  const carimbarVisto = doPixel && Date.now() - vistoEm > 36e5;
  const carimbarComId = doPixel && Boolean(idDaTag) && Date.now() - comIdEm > 36e5;
  if (carimbarVisto || carimbarComId) {
    const agora = new Date().toISOString();
    await admin
      .from("tracking_configs")
      .update({
        ...(carimbarVisto ? { web_pixel_visto_em: agora } : {}),
        ...(carimbarComId ? { web_pixel_com_id_em: agora } : {}),
        updated_at: agora,
      })
      .eq("store_id", registro.id);
    if (carimbarVisto) cfg.web_pixel_visto_em = agora;
  }

  // Com o Web Pixel cobrindo o checkout, o clique no botao (tema) e o
  // `checkout_started` (pixel) descrevem a MESMA acao, e nao tem como
  // compartilhar event_id -- um nasce do clique, o outro do checkout de verdade.
  //
  // A janela (JANELA_PIXEL_CHECKOUT_MS, 7 dias, a mesma do Google) e o que faz
  // isto se curar: se o pixel parar de mandar, o tema volta a cobrir sozinho.
  // Era um dia, e loja com menos de um checkout por dia contava dois.
  //
  // O EXPRESSO nao entra: o Shop Pay roda em shop.app e a carteira na janela do
  // sistema, e o pixel nao roda em nenhum dos dois -- o clique e o unico
  // InitiateCheckout que existe. Quando o clique cai no checkout normal (Shop
  // Pay como convidado, ou o "Comprar agora" que o tema nao separa da carteira
  // no shadow fechado), o pixel manda o dele e cancela o expresso pendente.
  const pixelCobrindo = Date.now() - vistoEm < JANELA_PIXEL_CHECKOUT_MS;
  if (!doPixel && evento === "begin_checkout" && pixelCobrindo && !expresso) {
    return ok({ ignorado: "checkout coberto pelo Web Pixel" });
  }

  // Os destinos sao LINHAS: a loja pode ter dois pixels Meta. Todo destino
  // ativo que aceita este evento recebe uma copia. So Meta e TikTok: o Google
  // vai pelo navegador, e `destinoAceita` recusa destino Google.
  const { destinosDaLoja, destinoAceita } = await import("@/lib/tracking/destinos");
  const todos = await destinosDaLoja(admin, registro.id, { comToken: true });
  const querem = todos.filter((d) => vaiPeloServidor(d.plataforma) && destinoAceita(d));

  // Nenhum destino quer este evento. Silencio, nao erro: o snippet dispara
  // todos os que sabe e e aqui que se decide o que interessa.
  if (querem.length === 0) return ok({ ignorado: "evento nao configurado" });

  const temMeta = querem.some((d) => d.plataforma === "meta");
  const temTiktok = querem.some((d) => d.plataforma === "tiktok");

  // ---- tetos ---------------------------------------------------------------
  const umDiaAtras = new Date(Date.now() - 864e5).toISOString();
  const umaHoraAtras = new Date(Date.now() - 36e5).toISOString();

  const [{ count: doVisitante }, { count: daLoja }] = await Promise.all([
    admin
      .from("tracking_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", registro.id)
      .eq("visitor_id", visitorId)
      .gte("created_at", umDiaAtras),
    admin
      .from("tracking_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", registro.id)
      .not("visitor_id", "is", null)
      .gte("created_at", umaHoraAtras),
  ]);

  if ((doVisitante ?? 0) >= TETO_POR_VISITANTE) {
    return ok({ ignorado: "teto do visitante" });
  }
  if ((daLoja ?? 0) >= TETO_POR_LOJA_HORA) {
    // Carimba, para a tela poder avisar. Descartar em silencio faria uma loja
    // parar de medir metade do funil sem ninguem notar -- e o primeiro sintoma
    // seria o Meta deixando de otimizar, semanas depois.
    //
    // No maximo uma vez por hora: estourando o teto, sao milhares de eventos
    // caindo aqui, e uma escrita em cada um transformaria o teto num problema
    // maior que o que ele evita.
    const tetoEm = cfg.teto_atingido_em
      ? new Date(cfg.teto_atingido_em).getTime()
      : 0;
    if (Date.now() - tetoEm > 36e5) {
      const agora = new Date().toISOString();
      await admin
        .from("tracking_configs")
        .update({ teto_atingido_em: agora, updated_at: agora })
        .eq("store_id", registro.id);
    }
    return ok({ ignorado: "teto da loja" });
  }

  // ---- expresso: janela deslizante ----------------------------------------
  //
  // Um InitiateCheckout por tentativa de compra. Qualquer begin_checkout do
  // mesmo comprador nos ultimos 30 min barra o expresso: o clique comum do tema
  // (visitor_id = o do tema), o do pixel (visitor_id = clientId da Shopify) e
  // outro expresso. O balde do id sozinho nao bastava: 12:29:50 e 12:30:05 sao
  // baldes diferentes, e o comprador que foi ao checkout normal e voltou para o
  // Shop Pay contava dois.
  //
  // Uma consulta por chave, com `.eq`: os dois valores vem do navegador, e
  // monta-los num filtro `or`/`in` do PostgREST seria deixar o cliente escrever
  // filtro.
  //
  // O clientId do comprador. Quando o clique chega sem ele (o trekkie ainda nao
  // carregou nesta pagina), vem da identidade que o tema publicou para este
  // visitante: a linha do pixel tem visitor_id = clientId, e sem esta chave o
  // begin_checkout do checkout normal de minutos antes nao era achado.
  let clienteDoExpresso = clientId;
  if (expresso && !clienteDoExpresso) {
    const { data: ident, error } = await admin
      .from("tracking_identities")
      .select("shopify_client_id")
      .eq("store_id", registro.id)
      .eq("visitor_id", visitorId)
      .maybeSingle();
    // Melhor esforco: sem a identidade a janela olha so o visitante do tema.
    if (error) console.error("[tracking/collect] falha ao ler a identidade do expresso", error.message);
    const resolvido = (ident?.shopify_client_id || "").trim() || null;
    clienteDoExpresso = resolvido && !ehClientIdSentinela(resolvido) ? resolvido : null;
  }

  /**
   * Um begin_checkout deste comprador nos ultimos 30 min, ou null. `soComum`
   * deixa os expressos de fora: e a reconferencia depois de gravar, e la outro
   * expresso concorrente nao pode fechar este (os dois se fechariam).
   */
  async function checkoutDoComprador(soComum: boolean): Promise<{ checkout_token: string | null } | null> {
    const desde = new Date(Date.now() - JANELA_CHECKOUT_EXPRESSO_MS).toISOString();
    const chaves = [
      ...new Set([visitorId, clienteDoExpresso].filter((v): v is string => Boolean(v))),
    ];
    const achados = await Promise.all(
      chaves.map((chave) => {
        let q = admin
          .from("tracking_events")
          .select("checkout_token")
          .eq("store_id", registro.id)
          .eq("visitor_id", chave)
          .eq("event_name", "begin_checkout")
          .gte("created_at", desde);
        if (soComum) q = q.not("event_id", "like", `${PREFIXO_CHECKOUT_EXPRESSO}%`);
        return q.limit(1);
      })
    );
    for (const a of achados) {
      if (a.error) console.error("[tracking/collect] falha ao conferir a janela do expresso", a.error.message);
      const l = (a.data || [])[0] as { checkout_token: string | null } | undefined;
      if (l) return l;
    }
    return null;
  }

  if (expresso && (await checkoutDoComprador(false))) {
    return ok({ ignorado: "checkout ja iniciado nos ultimos 30 min" });
  }

  // ---- identidade ----------------------------------------------------------
  //
  // O Web Pixel roda em sandbox e NAO le os cookies da loja: o evento do
  // checkout chega sabendo que aconteceu e sem saber de qual anuncio veio. A
  // ponte e o identificador de visitante da Shopify, que o snippet do tema
  // tambem conhece.
  //
  // Entao: o tema GRAVA "este clientId tem estes click ids", e o pixel CONSULTA.
  // O visitante do TEMA por tras deste clientId. Vira o external_id do evento
  // do checkout, para casar com o funil e com a compra.
  let visitanteDoTema: string | null = null;

  if (doPixel && clientId) {
    // Vem do checkout: recupera o que o tema guardou para este visitante.
    //
    // Varias linhas, nao maybeSingle(): a unicidade da tabela e por
    // visitor_id. No Safari o ITP gera um visitor_id novo e o clientId fica
    // com duas linhas -- e com duas, maybeSingle() devolvia ERRO e o evento
    // saia sem gclid e sem fbc. Ver consolidarIdentidades.
    let id = null;
    try {
      id = await identidadePorCliente(admin, registro.id, clientId);
    } catch (e) {
      // Melhor esforco: sem a identidade o evento sai mais pobre, mas sai.
      console.error("[tracking/collect] falha ao ler identidade do checkout", e);
    }
    if (id) {
      // O clique do Google vem inteiro de uma fonte: o que o evento trouxe, ou
      // o que a identidade tem. Misturar criaria um clique que nao existiu.
      if (!clique.gclid && !clique.gbraid && !clique.wbraid) {
        clique.gclid = id.gclid ?? null;
        clique.gbraid = id.gbraid ?? null;
        clique.wbraid = id.wbraid ?? null;
      }
      clique.auid = clique.auid || id.auid || null;
      fbp = fbp || id.fbp || null;
      fbc = fbc || id.fbc || null;
      ttclid = ttclid || id.ttclid || null;
      ttp = ttp || id.ttp || null;
      visitanteDoTema = id.visitorId || null;
    }
  }

  // O outro lado da supressao acima. Quando o carimbo do pixel venceu, o tema
  // manda o begin_checkout do clique; o pixel chega logo depois com o do
  // checkout_started, e o carimbo so se renova AGORA. Mesmo visitante, mesma
  // acao: o do tema ja contou.
  //
  // O EXPRESSO fica de fora: contra ele e o pixel que vence (abaixo). O IC do
  // pixel traz e-mail, telefone e endereco quando o checkout ja tem; descartar
  // ele pelo clique trocaria o evento rico pelo pobre.
  if (doPixel && evento === "begin_checkout" && visitanteDoTema) {
    const { count: doTema } = await admin
      .from("tracking_events")
      .select("id", { count: "exact", head: true })
      .eq("store_id", registro.id)
      .eq("visitor_id", visitanteDoTema)
      .eq("event_name", "begin_checkout")
      .not("event_id", "like", `${PREFIXO_CHECKOUT_EXPRESSO}%`)
      .gte("created_at", new Date(Date.now() - JANELA_CHECKOUT_DO_TEMA_MS).toISOString());
    if ((doTema ?? 0) > 0) {
      return ok({ ignorado: "checkout ja contado pelo tema" });
    }
  }

  /**
   * Como a linha do expresso fecha sem enviar: 'enviado' sem sent_at, o mesmo
   * "fechado sem sair" do teste (a tela mostra "Nao enviado", e o painel nao
   * conta -- migration 058). Nao 'falhou': isso acenderia erro e alerta para o
   * lojista sem nada a consertar.
   */
  const fechamentoDoExpresso = (quem: "pixel" | "tema", motivo: string) => ({
    status: "enviado",
    sent_at: null,
    last_error: `cancelado: o begin_checkout do ${quem} ${motivo}`,
    response: { enviado: false, substituido_por: quem },
  });

  /**
   * Fecha o expresso PENDENTE do mesmo comprador.
   *
   * Pelos visitantes do tema (o visitor_id da linha: o resolvido pelo clientId
   * e o do cookie `_xc_vid` que o pixel leu) e pelo clientId que a linha
   * guarda (migration 057). Uma atualizacao por chave, com `.eq`, pelo mesmo
   * motivo da janela deslizante: os valores vem do navegador.
   */
  async function cancelarExpressoPendente(visitantes: (string | null)[], cliente: string | null) {
    const desde = new Date(Date.now() - JANELA_CHECKOUT_EXPRESSO_MS).toISOString();
    const quem = doPixel ? "pixel" : "tema";
    const cancelar = (coluna: "visitor_id" | "shopify_client_id", valor: string) =>
      admin
        .from("tracking_events")
        .update(fechamentoDoExpresso(quem, "veio primeiro"))
        .eq("store_id", registro.id)
        .eq("event_name", "begin_checkout")
        .eq("status", "pendente")
        .like("event_id", `${PREFIXO_CHECKOUT_EXPRESSO}%`)
        .gte("created_at", desde)
        .eq(coluna, valor);
    const porVisitante = [...new Set(visitantes.filter((v): v is string => Boolean(v)))];
    const feitos = await Promise.all([
      ...porVisitante.map((v) => cancelar("visitor_id", v)),
      cliente ? cancelar("shopify_client_id", cliente) : null,
    ]);
    // Melhor esforco: sem o cancelamento sai um IC a mais, nao some nenhum.
    for (const f of feitos) {
      if (f?.error) console.error("[tracking/collect] falha ao cancelar o expresso", f.error.message);
    }
  }

  // O pixel vence o expresso. O begin_checkout que de fato vai para a fila --
  // o do pixel, ou o clique comum do tema quando o pixel nao cobre -- cancela o
  // expresso PENDENTE do mesmo comprador: o "Comprar agora" que o tema tomou
  // por carteira no shadow fechado, ou o Shop Pay que caiu no checkout normal.
  // O expresso que ja saiu (passou do atraso) fica: nao ha como desmandar.
  //
  // ESCREVE PRIMEIRO, CONFERE DEPOIS, nos dois lados. Este cancela DEPOIS de
  // gravar a propria linha (e so se ela for nova: checkout reaproveitado
  // termina `duplicado`, nao sai nada, e nao pode derrubar a reserva). O
  // expresso grava e so depois reconfere se ha begin_checkout comum do mesmo
  // comprador. Com os dois gravando antes de olhar, em qualquer ordem pelo menos
  // um enxerga o outro -- conferir antes deixava os dois POSTs sobrepostos
  // passarem um pelo outro, e saiam 2 IC.
  const cancelaExpresso = evento === "begin_checkout" && !expresso;
  let cancelamento: Promise<void> | null = null;
  /** Uma vez por POST, na primeira linha nova que este evento gravar. */
  const cancelarDepoisDeGravar = () =>
    cancelaExpresso
      ? (cancelamento ??= cancelarExpressoPendente(
          doPixel ? [visitanteDoTema, vidDoTema] : [visitorId],
          clientId
        ))
      : Promise.resolve();

  // ---- teste e consentimento ---------------------------------------------
  //
  // Depois da identidade: no checkout o gclid vem dela, e um gclid TESTE_* que
  // o dono usou no tema tem que marcar o checkout tambem. Ver teste.ts.
  const { ehTeste, lerConsentimento, enviaAoDestino, payloadComMarcas, registrarSemEnviar } =
    await import("@/lib/tracking/teste");
  const marcas = {
    teste: ehTeste(corpo.teste, [clique.gclid, clique.gbraid, clique.wbraid, fbclid, fbc, ttclid]),
    consentimento: lerConsentimento(corpo.consentimento),
  };

  // ---- fila ---------------------------------------------------------------
  const { enfileirar, entregar } = await import("@/lib/tracking/fila");

  const destinos: {
    destination: PlataformaServidor;
    destinationId: string;
    payload: unknown;
    /** Ja carregado aqui: evita `entregar` reler destino, token e config. */
    destino: (typeof querem)[number];
  }[] = [];

  // O que serve aos DOIS (Meta e TikTok): de onde veio a requisicao, a pagina
  // e o produto. Uma vez, nao por destino.
  //
  // Num evento de funil nao existe cliente identificado -- nao ha e-mail nem
  // telefone para mandar. O que da para oferecer e o que o pixel do navegador
  // ofereceria: cookie, IP e user agent.
  const ip =
    (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
    request.headers.get("x-real-ip") ||
    null;
  const userAgent = request.headers.get("user-agent");

  // A URL da pagina vem do CORPO, nao do header Referer.
  //
  // O beacon vai para outro dominio, e a politica padrao do navegador
  // (strict-origin-when-cross-origin) manda so a ORIGEM em requisicao
  // cross-origin -- medido: pagina de produto chegava como
  // "https://loja.shop/", sem caminho. `event_source_url` igual em todo evento
  // piora o casamento no Meta e inutiliza regra por URL.
  //
  // O header fica como reserva, para snippet antigo que ainda nao manda o
  // campo. Nos dois casos so http(s): o valor vem do cliente, e o Meta recusa
  // o evento inteiro se nao for URL.
  let origemDaPagina: string | undefined;
  const doCorpo = (corpo.pageUrl || "").trim();
  const doHeader = request.headers.get("referer") || "";
  const candidata = /^https?:\/\//i.test(doCorpo) ? doCorpo : doHeader;
  if (/^https?:\/\//i.test(candidata)) origemDaPagina = candidata.slice(0, 500);

  // O id do produto sai do TEMPLATE do destino.
  //
  // Antes mandavamos variante e produto juntos, torcendo para um dos dois
  // casar com o catalogo. Nao casava: o feed que a Shopify manda para o
  // Merchant Center identifica o item como
  // `shopify_<PAIS>_<idDoProduto>_<idDaVariante>`, que nao e nem um nem
  // outro -- e a falha e silenciosa, o evento e aceito e o anuncio dinamico
  // so nao serve aquele item.
  //
  // Por destino, e nao por loja: o catalogo do Meta e o feed do Google sao
  // dois catalogos, montados por caminhos diferentes na mesma loja.
  const { montarIdsDeProdutos } = await import("@/lib/tracking/id-produto");
  // A lista so no expresso: e o unico evento que paga um carrinho inteiro de
  // uma vez. Nos outros, um POST qualquer anexaria 20 content_ids a um
  // ViewContent e sujaria o publico dinamico.
  const itens =
    expresso && Array.isArray(corpo.produtos) && corpo.produtos.length
      ? corpo.produtos.slice(0, MAX_ITENS).map(lerProduto)
      : [lerProduto(corpo.produto)];

  // Os dois ids estaveis desta pessoa. O do nosso cookie costura o funil com a
  // compra; o da Shopify e o unico que o checkout conhece, e sem ele o evento
  // do pixel seria uma pessoa diferente das outras do mesmo funil.
  const externalIds = [visitanteDoTema || visitorId, clientId];

  if (temMeta) {
    // O pais, pela geolocalizacao do IP na borda.
    //
    // E o ULTIMO parametro de casamento que da para obter de visitante
    // anonimo: numa pagina de produto nao ha e-mail, telefone nem endereco, e
    // sem isto o evento de funil chega com IP, user agent, _fbp e external_id
    // e mais nada. O Meta pontua pela quantidade de sinais que conferem.
    //
    // Nao e dado novo que estejamos coletando: o Meta ja recebe o IP e
    // geolocaliza por conta propria. Mandar o pais resolvido so poupa ele de
    // adivinhar, e e um campo que ele pontua.
    //
    // Nunca sobrepoe o endereco de verdade: o evento do Web Pixel traz o pais
    // do checkout, que e o que o comprador digitou. Geolocalizacao de IP erra
    // com VPN; endereco preenchido, nao.
    const paisDaBorda =
      request.headers.get("x-vercel-ip-country") ||
      // Em Docker atras de Cloudflare. Fora desses dois nao vem nada, e o
      // evento sai sem o campo -- que e o comportamento de antes.
      request.headers.get("cf-ipcountry") ||
      null;

    const userData = montarUserData(
      {
        // PII, quando existe.
        //
        // No evento de funil do TEMA nao existe: nao ha cliente identificado.
        // No evento do WEB PIXEL existe, porque o checkout da Shopify ja tem
        // e-mail, telefone e endereco -- e e por isso que o pixel melhora o
        // casamento, nao so a cobertura. Tudo hasheado aqui dentro; nada em
        // claro sai daqui.
        email: corpo.email,
        telefone: corpo.telefone,
        primeiroNome: corpo.primeiroNome,
        sobrenome: corpo.sobrenome,
        cidade: corpo.cidade,
        estado: corpo.estado,
        cep: corpo.cep,
        // O do checkout primeiro; a borda e so quando nao ha endereco.
        pais: corpo.pais || paisDaBorda,
        externalIds,
      },
      {
        fbp,
        // Sem o cookie _fbc, reconstruir a partir do fbclid e o que mantem a
        // ligacao com o anuncio -- e o caso de quem chega pelo anuncio numa loja
        // que nao tem pixel no tema.
        fbc: fbc || montarFbc(fbclid, Date.now()),
        clientIp: ip,
        userAgent,
      }
    );

    for (const d of querem.filter((x) => x.plataforma === "meta")) {
      const conteudo = montarIdsDeProdutos(d.idTemplate, itens);

      destinos.push({
        destination: "meta",
        destinationId: d.id,
        destino: d,
        payload: {
          // O nome do Meta, nao a nossa chave: "AddToCart", nao "add_to_cart".
          // Nome fora da lista dele vira evento personalizado, que chega e nao
          // serve para otimizar campanha.
          event_name: definicao!.nomeNoMeta,
          // Em segundos. Em milissegundos o Meta recusa o evento.
          event_time: Math.floor(Date.now() / 1000),
          event_id: eventId,
          action_source: "website",
          user_data: userData,
          ...(origemDaPagina ? { event_source_url: origemDaPagina } : {}),
          ...(conteudo.length
            ? {
                custom_data: {
                  // `content_ids` e exigencia do Meta para publico dinamico e
                  // anuncio de catalogo; sem ele, ViewContent e AddToCart
                  // chegam sem dizer de QUAL produto.
                  //
                  // `product`, nunca `product_group`: a documentacao dele e
                  // explicita de que AddToCart e Purchase sao sempre sobre o
                  // item concreto, porque e um item concreto que a pessoa
                  // compra.
                  content_type: "product",
                  content_ids: conteudo,
                  // Sem value/currency, igual ao Google. Id de produto o
                  // visitante nao tem por que forjar; valor ele teria.
                },
              }
            : {}),
        },
      });
    }
  }

  if (temTiktok) {
    // O mesmo evento, no formato da Events API: o MESMO event_id (a dedupe do
    // TikTok e por pixel + evento + event_id), o ttclid inteiro, o _ttp, e
    // nada de valor -- a regra do item 1 do cabecalho vale igual.
    const user = montarUserTiktok(
      { email: corpo.email, telefone: corpo.telefone, pais: corpo.pais, externalIds },
      { ttclid, ttp, clientIp: ip, userAgent }
    );
    // `page.url` e obrigatorio em evento web. Sem a URL da pagina (snippet
    // muito antigo, sem Referer), a raiz da loja.
    const url = origemDaPagina || `https://${loja}/`;
    for (const d of querem.filter((x) => x.plataforma === "tiktok")) {
      destinos.push({
        destination: "tiktok",
        destinationId: d.id,
        destino: d,
        payload: montarEventoDeFunilTiktok({
          evento: evento as ChaveEvento,
          eventId,
          quandoMs: Date.now(),
          user,
          url,
          contentIds: montarIdsDeProdutos(d.idTemplate, itens),
          idTemplate: d.idTemplate,
        }),
      });
    }
  }

  try {
    const saida: Record<string, string> = {};
    /** Destinos em que a linha do expresso nasceu agora (nao duplicada). */
    const expressoGravado: string[] = [];

    // EM PARALELO, nao em fila.
    //
    // Cada destino e uma chamada de rede para outra empresa, e elas nao
    // dependem umas das outras: linhas de fila distintas, contas distintas.
    //
    // Uma falhar continua nao impedindo as outras: cada `entregar` trata o
    // proprio erro e grava o desfecho na linha dela.
    await Promise.all(
      destinos.map(async (alvo) => {
        // Chave por DESTINO em todos os desfechos: com dois pixels Meta uma
        // chave "meta" sozinha faria o segundo sobrescrever o primeiro.
        const chave = `${alvo.destination}:${alvo.destinationId.slice(0, 8)}`;

        // Evento de teste fica na fila para o dono conferir, mas so sai para o
        // Meta ou o TikTok com codigo de teste. Ver teste.ts.
        const envia = enviaAoDestino(alvo.destino, marcas.teste);
        const payload = payloadComMarcas(alvo.destination, alvo.payload as object, marcas, envia);
        // Ficam na LINHA, nao no payload: o payload do Meta vai cru para a
        // API deles, e campo desconhecido ali pode derrubar o evento inteiro.
        const referrer = (corpo.referrer || "").trim().slice(0, 500) || null;

        if (!envia) {
          const { duplicado } = await registrarSemEnviar(admin, {
            storeId: registro.id,
            destination: alvo.destination,
            destinationId: alvo.destinationId,
            eventName: evento,
            eventId,
            orderId: eventId,
            visitorId,
            referrer,
            checkoutToken,
            payload,
          });
          saida[chave] = duplicado ? "duplicado" : "teste: nao enviado";
          if (!duplicado) await cancelarDepoisDeGravar();
          return;
        }

        const { id, duplicado } = await enfileirar(admin, {
          storeId: registro.id,
          destination: alvo.destination,
          destinationId: alvo.destinationId,
          evento: { event_name: evento, event_id: eventId },
          orderId: eventId,
          visitorId,
          referrer,
          // Liga o evento de checkout ao pedido sem depender de cart attribute,
          // que se perde quando a sessao comeca no proprio checkout.
          checkoutToken,
          payload,
          // O expresso espera o pixel: o cron so manda depois do atraso, e o
          // begin_checkout do pixel cancela antes disso. O event_time do
          // payload continua o do clique.
          // O clientId vai na linha (migration 057) para o pixel achar o
          // comprador por ele -- o do corpo ou o resolvido pela identidade.
          ...(expresso
            ? {
                proximaTentativaEm: new Date(Date.now() + ATRASO_CHECKOUT_EXPRESSO_MS),
                shopifyClientId: clienteDoExpresso,
              }
            : {}),
        });

        if (duplicado) {
          saida[chave] = "duplicado";
          return;
        }
        if (expresso) {
          expressoGravado.push(chave);
          saida[chave] = "aguardando o pixel";
          return;
        }
        // Gravou: agora sim cancela a reserva do mesmo comprador.
        await cancelarDepoisDeGravar();
        if (!id) {
          saida[chave] = "na fila";
          return;
        }

        // Melhor esforco: se falhar, a linha segue pendente e o cron tenta.
        const r = await entregar(
          admin,
          {
            id,
            store_id: registro.id,
            destination: alvo.destination,
            destination_id: alvo.destinationId,
            event_name: evento,
            payload,
            attempts: 0,
          },
          // O destino e o interruptor ja foram lidos la em cima. Sem isto, cada
          // destino custava mais tres idas ao banco por pageview.
          { destino: alvo.destino, lojaLigada: true }
        );
        saida[chave] = r.ok ? "enviado" : "na fila";
      })
    );

    // O outro lado do "escreve primeiro, confere depois": o expresso ja esta
    // gravado, e so AGORA olha se ha begin_checkout comum do mesmo comprador --
    // o do pixel (ou o clique comum) que gravou entre a janela la de cima e o
    // INSERT daqui, e cujo cancelamento rodou antes desta linha existir. Achou,
    // fecha a propria linha. So os comuns: outro expresso concorrente fecharia
    // este, e este a ele, e nao sairia nenhum.
    //
    // Pelo event_id, que e um por comprador e balde: fecha as linhas de todos
    // os destinos de uma vez. So 'pendente': nada que ja tenha saido.
    if (expressoGravado.length) {
      const outro = await checkoutDoComprador(true);
      if (outro) {
        const quem = outro.checkout_token ? "pixel" : "tema";
        const { error } = await admin
          .from("tracking_events")
          .update(fechamentoDoExpresso(quem, "chegou junto"))
          .eq("store_id", registro.id)
          .eq("event_id", eventId)
          .eq("status", "pendente");
        if (error) {
          console.error("[tracking/collect] falha ao fechar o expresso", error.message);
        } else {
          for (const chave of expressoGravado) saida[chave] = "cancelado: checkout ja iniciado";
        }
      }
    }

    return ok({ destinos: saida });
  } catch (e) {
    console.error("[tracking/collect] falha ao enfileirar", e);
    return recusado("falha interna");
  }
}
