import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  eventoValido,
  definicaoDoEvento,
  rotuloDoEvento,
  type ChaveEvento,
  type MapaDeRotulos,
} from "@/lib/tracking/eventos";

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

/** Eventos por visitante por dia. Compra nao passa por aqui. */
const TETO_POR_VISITANTE = 40;

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
    evento?: string;
    eventId?: string;
    visitorId?: string;
    gclid?: string | null;
    gbraid?: string | null;
    wbraid?: string | null;
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

  const { data: registro } = await admin
    .from("stores")
    .select("id")
    .eq("shop_domain", loja)
    .is("uninstalled_at", null)
    .maybeSingle();

  if (!registro) return recusado("loja desconhecida");

  const { data: cfg } = await admin
    .from("tracking_configs")
    .select("enabled, google_conversion_id, google_conversion_label, google_labels")
    .eq("store_id", registro.id)
    .maybeSingle();

  if (!cfg?.enabled || !cfg.google_conversion_id) {
    return recusado("rastreamento desligado");
  }

  const rotulo = rotuloDoEvento(
    cfg.google_labels as MapaDeRotulos | null,
    evento as ChaveEvento,
    cfg.google_conversion_label
  );
  // Sem rotulo o lojista nao pediu este evento. Silencio, nao erro: o snippet
  // dispara todos os que sabe e e aqui que se decide o que interessa.
  if (!rotulo) return ok({ ignorado: "evento nao configurado" });

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

  const payload = {
    ...clique,
    // `oid` = o proprio event_id. Mesma conversion action com o mesmo oid, o
    // Google descarta -- e a segunda trava contra a mesma acao contar duas
    // vezes, junto com o indice unico da fila.
    orderId: eventId,
    // Sem value/currency de proposito. Ver o cabecalho.
  };

  try {
    const { id, duplicado } = await enfileirar(admin, {
      storeId: registro.id,
      destination: "google",
      evento: { event_name: evento, event_id: eventId },
      orderId: eventId,
      visitorId,
      payload,
    });

    if (duplicado) return ok({ estado: "duplicado" });
    if (!id) return ok({ estado: "na fila" });

    // Melhor esforco: se falhar, a linha segue pendente e o cron tenta.
    const r = await entregar(admin, {
      id,
      store_id: registro.id,
      destination: "google",
      event_name: evento,
      payload,
      attempts: 0,
    });
    return ok({ estado: r.ok ? "enviado" : "na fila" });
  } catch (e) {
    console.error("[tracking/collect] falha ao enfileirar", e);
    return recusado("falha interna");
  }
}
