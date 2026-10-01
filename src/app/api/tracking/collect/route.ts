import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  eventoValido,
  definicaoDoEvento,
  rotuloDoEvento,
  type ChaveEvento,
  type MapaDeRotulos,
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
    fbp?: string | null;
    fbc?: string | null;
    fbclid?: string | null;
    /** De onde a sessao veio, para diagnosticar trafego sem click id. */
    referrer?: string | null;
    /** A URL da pagina, mandada explicita pelo snippet. Ver abaixo. */
    pageUrl?: string | null;
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
  if (!eventoValido(evento)) {
    return recusado("evento desconhecido");
  }
  const definicao = definicaoDoEvento(evento as ChaveEvento);
  if (definicao.origem !== "navegador") {
    // `purchase` vem do webhook. Aceitar aqui deixaria qualquer um declarar
    // uma venda -- e com o oid do navegador, ainda por cima.
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
  const [{ data: cfgs }, { data: segs }] = await Promise.all([
    admin
      .from("tracking_configs")
      .select(
        "store_id, enabled, google_conversion_id, google_conversion_label, google_labels, meta_pixel_id, meta_test_event_code"
      )
      .in("store_id", ids),
    admin
      .from("tracking_secrets")
      .select("store_id, meta_access_token")
      .in("store_id", ids),
  ]);

  const porStore = new Map((cfgs || []).map((c) => [c.store_id, c]));
  // Com id da tag ha uma candidata so. Sem ele (tag antiga), `candidatas` vem da
  // mais nova para a mais velha e vale a primeira com rastreamento ligado.
  const escolhida =
    candidatas.find((c) => porStore.get(c.id)?.enabled) || candidatas[0];

  const registro = escolhida;
  const cfg = porStore.get(registro.id);
  const seg = (segs || []).find((x) => x.store_id === registro.id);

  if (!cfg?.enabled) return recusado("rastreamento desligado");

  const rotulo = cfg.google_conversion_id
    ? rotuloDoEvento(
        cfg.google_labels as MapaDeRotulos | null,
        evento as ChaveEvento,
        cfg.google_conversion_label
      )
    : null;

  // No Meta um pixel cobre todos os eventos -- nao existe rotulo por evento.
  // Entao "configurado" ja basta, e o que decide por evento e so o nome.
  const temMeta = Boolean(cfg.meta_pixel_id && seg?.meta_access_token);

  // Nenhum dos dois quer este evento. Silencio, nao erro: o snippet dispara
  // todos os que sabe e e aqui que se decide o que interessa.
  if (!rotulo && !temMeta) return ok({ ignorado: "evento nao configurado" });

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

  // ---- fila ---------------------------------------------------------------
  const { enfileirar, entregar } = await import("@/lib/tracking/fila");

  const clique = {
    gclid: (corpo.gclid || "").trim().slice(0, 200) || null,
    gbraid: (corpo.gbraid || "").trim().slice(0, 200) || null,
    wbraid: (corpo.wbraid || "").trim().slice(0, 200) || null,
  };

  const destinos: { destination: "google" | "meta"; payload: unknown }[] = [];

  if (rotulo) {
    destinos.push({
      destination: "google",
      payload: {
        ...clique,
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

    const fbclid = (corpo.fbclid || "").trim().slice(0, 300) || null;
    const userData = montarUserData(
      {
        // O id de visitante do cookie first-party. E o unico identificador
        // estavel que existe num evento de funil -- nao ha cliente logado --
        // e e o mesmo que vai na compra, o que permite ao Meta ligar os dois.
        externalIds: [visitorId],
      },
      {
        fbp: (corpo.fbp || "").trim().slice(0, 100) || null,
        // Sem o cookie _fbc, reconstruir a partir do fbclid e o que mantem a
        // ligacao com o anuncio -- e o caso de quem chega pelo anuncio numa loja
        // que nao tem pixel no tema.
        fbc: (corpo.fbc || "").trim().slice(0, 300) || montarFbc(fbclid, Date.now()),
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

    destinos.push({
      destination: "meta",
      payload: {
        // O nome do Meta, nao a nossa chave: "AddToCart", nao "add_to_cart".
        // Nome fora da lista dele vira evento personalizado, que chega e nao
        // serve para otimizar campanha.
        event_name: definicao.nomeNoMeta,
        // Em segundos. Em milissegundos o Meta recusa o evento.
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: "website",
        user_data: userData,
        ...(origemDaPagina ? { event_source_url: origemDaPagina } : {}),
        // Sem value/currency, igual ao Google: ver o cabecalho.
      },
    });
  }

  try {
    const saida: Record<string, string> = {};
    for (const alvo of destinos) {
      const { id, duplicado } = await enfileirar(admin, {
        storeId: registro.id,
        destination: alvo.destination,
        evento: { event_name: evento, event_id: eventId },
        orderId: eventId,
        visitorId,
        // Fica na LINHA, nao no payload: o payload do Meta vai cru para a API
        // deles, e campo desconhecido ali pode derrubar o evento inteiro.
        referrer: (corpo.referrer || "").trim().slice(0, 500) || null,
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
        event_name: evento,
        payload: alvo.payload,
        attempts: 0,
      });
      saida[alvo.destination] = r.ok ? "enviado" : "na fila";
    }
    return ok({ destinos: saida });
  } catch (e) {
    console.error("[tracking/collect] falha ao enfileirar", e);
    return recusado("falha interna");
  }
}
