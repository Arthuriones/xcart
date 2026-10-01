import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  eventoValido,
  definicaoDoEvento,
  type ChaveEvento,
} from "@/lib/tracking/eventos";
import { montarFbc, montarUserData } from "@/lib/tracking/normalizar";

export const runtime = "nodejs";

// ============================================================================
// Coletor dos eventos de funil (ver produto, carrinho, checkout).
//
// A Shopify nao tem webhook para essas tres acoes -- carrinho e checkout
// acontecem no navegador. Entao o snippet do tema avisa aqui, e daqui o NOSSO
// servidor fala com o Google. O ping de conversao continua saindo do servidor:
// o que o navegador faz e avisar que a acao aconteceu, nao falar com o Google.
// Isso importa porque o bloqueador de anuncio derruba a requisicao para
// googleadservices.com, e nao a requisicao para ca.
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
 * Uma acao rende uma linha por destino configurado, entao numa loja com Google e
 * Meta juntos sao duas. Um visitante de verdade faz algo como 10 produtos + 3
 * carrinhos + 1 checkout = 14 acoes = 28 linhas, e o teto nao pode encostar
 * nisso. Contar linha em vez de acao e escolha de custo: distinct por event_id
 * seria outra consulta a cada evento.
 *
 * De todo jeito o teto por visitante nao e a defesa principal -- quem troca o
 * cookie escapa dele. O teto da LOJA e o que limita de verdade.
 */
const TETO_POR_VISITANTE = 120;

/** Teto por loja por hora: se estourar, e abuso ou laco no snippet. */
const TETO_POR_LOJA_HORA = 2000;

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
    /** Do cookie `_gcl_au`, escrito pela tag do Google. Ver google-ads.ts. */
    auid?: string | null;
    fbp?: string | null;
    fbc?: string | null;
    fbclid?: string | null;
    /** De onde a sessao veio, para diagnosticar trafego sem click id. */
    referrer?: string | null;
    /** A URL da pagina, mandada explicita pelo snippet. Ver abaixo. */
    pageUrl?: string | null;
    /** Produto em tela, nos eventos que tem um. Ver `custom_data` abaixo. */
    produto?: { variante?: string | null; produto?: string | null } | null;
    /** 'pixel' quando vem do Web Pixel do checkout; ausente = snippet do tema. */
    fonte?: string | null;
    /** Identificador de visitante da Shopify. A unica chave que o pixel tem. */
    clientId?: string | null;
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
  };
  try {
    corpo = await request.json();
  } catch {
    return recusado("corpo invalido");
  }

  const loja = (corpo.shop || "").trim().toLowerCase();
  const evento = (corpo.evento || "").trim();
  const visitorId = (corpo.visitorId || "").trim().slice(0, 64);
  const eventId = (corpo.eventId || "").trim().slice(0, 200);

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
  // vem do navegador do visitante. Entao o critério e explicito -- entre as
  // linhas ativas, vale a que TEM rastreamento ligado; havendo mais de uma ou
  // nenhuma, a instalacao mais recente. Determinístico, e nunca 500.
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
    : await consulta.eq("shop_domain", loja).order("created_at", { ascending: false });

  if (!candidatas?.length) return recusado("loja desconhecida");

  const ids = candidatas.map((c) => c.id);
  // So o interruptor da loja e o estado do Web Pixel: as credenciais agora
  // moram em tracking_destinations, uma linha por conta.
  const { data: cfgs } = await admin
    .from("tracking_configs")
    .select("store_id, enabled, web_pixel_visto_em")
    .in("store_id", ids);

  const porStore = new Map((cfgs || []).map((c) => [c.store_id, c]));
  // Com id da tag ha uma candidata so. Sem ele (tag antiga), `candidatas` vem da
  // mais nova para a mais velha e vale a primeira com rastreamento ligado.
  const escolhida =
    candidatas.find((c) => porStore.get(c.id)?.enabled) || candidatas[0];

  const registro = escolhida;
  const cfg = porStore.get(registro.id);

  if (!cfg?.enabled) return recusado("rastreamento desligado");

  const doPixel = (corpo.fonte || "").trim() === "pixel";

  const clientId = (corpo.clientId || "").trim().slice(0, 100) || null;

  const clique = {
    gclid: (corpo.gclid || "").trim().slice(0, 200) || null,
    gbraid: (corpo.gbraid || "").trim().slice(0, 200) || null,
    wbraid: (corpo.wbraid || "").trim().slice(0, 200) || null,
    auid: (corpo.auid || "").trim().slice(0, 100) || null,
  };
  let fbp = (corpo.fbp || "").trim().slice(0, 100) || null;
  let fbc = (corpo.fbc || "").trim().slice(0, 300) || null;
  const fbclid = (corpo.fbclid || "").trim().slice(0, 300) || null;

  /**
   * Grava a associacao visitante -> click ids.
   *
   * Uma linha por visitante (`onConflict store_id,visitor_id`), entao reenviar
   * so atualiza: nao ha crescimento de tabela para um abusador explorar.
   */
  async function publicarIdentidade() {
    await admin.from("tracking_identities").upsert(
      {
        store_id: registro.id,
        visitor_id: visitorId,
        shopify_client_id: clientId,
        gclid: clique.gclid,
        gbraid: clique.gbraid,
        wbraid: clique.wbraid,
        auid: clique.auid,
        fbp,
        fbc,
        fbclid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "store_id,visitor_id" }
    );
  }

  // O aviso de identidade termina aqui: sem fila, sem destino, sem conversao.
  // Por isso tambem nao passa pelos tetos abaixo -- eles contam linhas de
  // `tracking_events`, e este caminho nao cria nenhuma.
  if (ehIdentidade) {
    if (!clientId) return recusado("identidade sem clientId");
    await publicarIdentidade();
    return ok({ identidade: "gravada" });
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
  // mudar a decisao. Uma vez por hora basta para a janela de um dia.
  const vistoEm = cfg.web_pixel_visto_em
    ? new Date(cfg.web_pixel_visto_em).getTime()
    : 0;
  if (doPixel && Date.now() - vistoEm > 36e5) {
    const agora = new Date().toISOString();
    await admin
      .from("tracking_configs")
      .update({ web_pixel_visto_em: agora, updated_at: agora })
      .eq("store_id", registro.id);
    cfg.web_pixel_visto_em = agora;
  }

  // Com o Web Pixel cobrindo o checkout, o clique no botao (tema) e o
  // `checkout_started` (pixel) descrevem a MESMA acao, e nao tem como
  // compartilhar event_id -- um nasce do clique, o outro do checkout de verdade.
  //
  // A janela de um dia e o que faz isto se curar: se o pixel parar de mandar,
  // o tema volta a cobrir sozinho, sem ninguem precisar notar.
  const pixelCobrindo = Date.now() - vistoEm < 864e5;
  if (!doPixel && evento === "begin_checkout" && pixelCobrindo) {
    return ok({ ignorado: "checkout coberto pelo Web Pixel" });
  }

  // Os destinos sao LINHAS: a loja pode ter cinco contas Google e dois pixels
  // Meta. Todo destino ativo que aceita este evento recebe uma copia.
  //
  // Mandar para todas as contas Google e seguro: conversao cujo gclid nao
  // pertence a conta e DESCARTADA pelo Google, nao contada sem atribuicao --
  // a conta dona do clique conta e as outras ignoram.
  const { destinosDaLoja, destinoAceita } = await import("@/lib/tracking/destinos");
  const todos = await destinosDaLoja(admin, registro.id, { comToken: true });
  const querem = todos.filter((d) => destinoAceita(d, evento));

  // Nenhum destino quer este evento. Silencio, nao erro: o snippet dispara
  // todos os que sabe e e aqui que se decide o que interessa.
  if (querem.length === 0) return ok({ ignorado: "evento nao configurado" });

  const temMeta = querem.some((d) => d.plataforma === "meta");

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
    return ok({ ignorado: "teto da loja" });
  }

  // ---- identidade ----------------------------------------------------------
  //
  // O Web Pixel roda em sandbox e NAO le os cookies da loja: o evento do
  // checkout chega sabendo que aconteceu e sem saber de qual anuncio veio. A
  // ponte e o identificador de visitante da Shopify, que o snippet do tema
  // tambem conhece.
  //
  // Entao: o tema GRAVA "este clientId tem estes click ids", e o pixel CONSULTA.
  if (doPixel && clientId) {
    // Vem do checkout: recupera o que o tema guardou para este visitante.
    const { data: id } = await admin
      .from("tracking_identities")
      .select("gclid, gbraid, wbraid, auid, fbp, fbc")
      .eq("store_id", registro.id)
      .eq("shopify_client_id", clientId)
      .maybeSingle();
    if (id) {
      clique.gclid = clique.gclid || id.gclid;
      clique.gbraid = clique.gbraid || id.gbraid;
      clique.wbraid = clique.wbraid || id.wbraid;
      clique.auid = clique.auid || id.auid;
      fbp = fbp || id.fbp;
      fbc = fbc || id.fbc;
    }
  } else if (clientId) {
    // Vem do tema: publica a associacao para o checkout consultar depois.
    await publicarIdentidade();
  }

  // ---- fila ---------------------------------------------------------------
  const { enfileirar, entregar } = await import("@/lib/tracking/fila");

  const destinos: {
    destination: "google" | "meta";
    destinationId: string;
    payload: unknown;
  }[] = [];

  const paraGoogle = querem.filter((d) => d.plataforma === "google");
  for (const d of paraGoogle) {
    destinos.push({
      destination: "google",
      destinationId: d.id,
      payload: {
        ...clique,
        pageUrl: (corpo.pageUrl || "").trim().slice(0, 500) || null,
        // `oid` = o proprio event_id. Mesma conversion action com o mesmo oid, o
        // Google descarta -- e a segunda trava contra a mesma acao contar duas
        // vezes, junto com o indice unico da fila.
        orderId: eventId,
        // Sem value/currency de proposito. Ver o cabecalho.
      },
    });
  }

  if (temMeta) {
    // O Meta pontua pela quantidade de sinais que conferem, e num evento de
    // funil nao existe cliente identificado -- nao ha e-mail nem telefone para
    // mandar. O que da para oferecer e o que o pixel do navegador ofereceria:
    // cookie, IP e user agent.
    const ip =
      (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() ||
      request.headers.get("x-real-ip") ||
      null;
    const userAgent = request.headers.get("user-agent");

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
        pais: corpo.pais,
        // Os dois ids estaveis. O do nosso cookie costura o funil com a compra;
        // o da Shopify e o unico que o checkout conhece, e sem ele o evento do
        // pixel seria uma pessoa diferente das outras do mesmo funil.
        externalIds: [visitorId, clientId],
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

    // Variante antes do produto: e o item concreto do catalogo. Os dois juntos
    // aumentam a chance de casar com o feed, que em loja Shopify as vezes usa
    // um e as vezes outro como id de varejista.
    const conteudo = [
      (corpo.produto?.variante || "").trim(),
      (corpo.produto?.produto || "").trim(),
    ].filter((v, i, todos) => v && todos.indexOf(v) === i);

    for (const d of querem.filter((x) => x.plataforma === "meta"))
    destinos.push({
      destination: "meta",
      destinationId: d.id,
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
                // anuncio de catalogo; sem ele, ViewContent e AddToCart chegam
                // sem dizer de QUAL produto.
                //
                // `product`, nunca `product_group`: a documentacao dele e
                // explicita de que AddToCart e Purchase sao sempre sobre o item
                // concreto, porque e um item concreto que a pessoa compra.
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

  try {
    const saida: Record<string, string> = {};
    for (const alvo of destinos) {
      const { id, duplicado } = await enfileirar(admin, {
        storeId: registro.id,
        destination: alvo.destination,
        destinationId: alvo.destinationId,
        evento: { event_name: evento, event_id: eventId },
        orderId: eventId,
        visitorId,
        // Ficam na LINHA, nao no payload: o payload do Meta vai cru para a API
        // deles, e campo desconhecido ali pode derrubar o evento inteiro.
        referrer: (corpo.referrer || "").trim().slice(0, 500) || null,
        // Liga o evento de checkout ao pedido sem depender de cart attribute,
        // que se perde quando a sessao comeca no proprio checkout.
        checkoutToken: (corpo.checkoutToken || "").trim().slice(0, 120) || null,
        payload: alvo.payload,
      });

      if (duplicado) {
        saida[alvo.destination] = "duplicado";
        continue;
      }
      if (!id) {
        saida[alvo.destination] = "na fila";
        continue;
      }

      // Melhor esforco: se falhar, a linha segue pendente e o cron tenta.
      const r = await entregar(admin, {
        id,
        store_id: registro.id,
        destination: alvo.destination,
        destination_id: alvo.destinationId,
        event_name: evento,
        payload: alvo.payload,
        attempts: 0,
      });
      // Chave por DESTINO, nao por plataforma: com duas contas Google a
      // segunda sobrescreveria o resultado da primeira na resposta.
      saida[`${alvo.destination}:${alvo.destinationId.slice(0, 8)}`] = r.ok
        ? "enviado"
        : "na fila";
    }
    return ok({ destinos: saida });
  } catch (e) {
    console.error("[tracking/collect] falha ao enfileirar", e);
    return recusado("falha interna");
  }
}
