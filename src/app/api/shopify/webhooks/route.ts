import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeShopDomain } from "@/lib/shopify/domain";
import {
  assinaturaConfere,
  corpoJson,
  dentroDaJanela,
  lerCabecalhos,
} from "@/lib/shopify/webhook";

export const runtime = "nodejs";
// Sem cache: cada entrega e um evento.
export const dynamic = "force-dynamic";

// ============================================================================
// Endpoint unico de webhook da Shopify.
//
// O xcart nao tinha nenhum. O buraco que mais doia era a desinstalacao: quando
// o lojista remove o app, nada avisa. A loja fica no banco com token morto, o
// auto-conserto continua batendo nela de hora em hora, e a rota segue escrita
// "Ativa" na tela enquanto manda o comprador para um checkout que nao responde.
//
// -------------------------------- codigos ---------------------------------
//
// 401  assinatura invalida            -> nao e da Shopify, ou nao e desta loja
// 200  tudo mais, inclusive recusa    -> a Shopify reentrega por 48 h em cima
//                                        de qualquer nao-2xx, entao devolver
//                                        400 para um payload torto rende dois
//                                        dias de retry de algo que nunca vai
//                                        dar certo. Recusa que nao adianta
//                                        repetir sai 200 com motivo no corpo.
// ============================================================================

function ok(detalhe: Record<string, unknown>) {
  return NextResponse.json({ ok: true, ...detalhe });
}

export async function POST(request: NextRequest) {
  const cab = lerCabecalhos(request.headers);

  // CORPO CRU, antes de qualquer parse: a HMAC e sobre estes bytes.
  const corpoCru = await request.text();

  const shopDomain = cab.shopDomain ? normalizeShopDomain(cab.shopDomain) : null;
  if (!shopDomain || !cab.topic) {
    return ok({ ignorado: "cabecalhos incompletos" });
  }

  const admin = createAdminClient();

  // O header so escolhe QUAL segredo testar -- ele nao autoriza nada sozinho.
  // Sem o client_secret da loja, a assinatura nao fecha.
  const { data: lojas } = await admin
    .from("stores")
    .select("id, user_id, shop_domain, client_secret, uninstalled_at")
    .eq("shop_domain", shopDomain);

  if (!lojas || lojas.length === 0) {
    // Loja que nao conhecemos: nao ha segredo para verificar. 200 para a
    // Shopify parar de tentar.
    return ok({ ignorado: "loja desconhecida" });
  }

  // Um mesmo dominio pode estar cadastrado por mais de um usuario (cada um com
  // o proprio app). Vale a primeira loja cuja assinatura fechar.
  const loja = lojas.find((l) =>
    assinaturaConfere(corpoCru, cab.hmac, l.client_secret)
  );

  if (!loja) {
    console.warn("[shopify/webhook] assinatura invalida", {
      topic: cab.topic,
      shopDomain,
    });
    return NextResponse.json({ error: "Assinatura invalida." }, { status: 401 });
  }

  // --- daqui para baixo a entrega e autentica ---

  if (!dentroDaJanela(cab.triggeredAt)) {
    return ok({ ignorado: "fora da janela de replay" });
  }

  // Idempotencia. O insert E a trava: colisao de chave primaria significa que
  // este webhook_id ja foi processado. Fazer select-antes-de-insert deixaria
  // uma janela entre as duas entregas simultaneas do mesmo evento.
  if (cab.webhookId) {
    const { error } = await admin.from("shopify_webhook_events").insert({
      webhook_id: cab.webhookId,
      topic: cab.topic,
      shop_domain: shopDomain,
      store_id: loja.id,
    });
    // 23505 = unique_violation
    if (error?.code === "23505") {
      return ok({ duplicado: true, topic: cab.topic });
    }
    if (error) {
      // Nao da para garantir uso unico: melhor deixar a Shopify reentregar do
      // que processar as cegas.
      console.error("[shopify/webhook] falha ao registrar evento", error.message);
      return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
    }
  }

  const payload = corpoJson(corpoCru);
  if (!payload) {
    // Assinatura fechou mas o corpo nao e JSON. Repetir nao conserta.
    return ok({ ignorado: "payload malformado", topic: cab.topic });
  }

  switch (cab.topic) {
    case "app/uninstalled": {
      const resposta = await tratarDesinstalacao(admin, loja);
      // ==================================================================
      // O marcador de idempotencia foi gravado ANTES do processamento (e
      // tem que ser: e ele que impede duas entregas simultaneas do mesmo
      // evento de rodarem juntas). Mas isso entra em conflito direto com
      // pedir retry:
      //
      //   entrega 1 -> grava marcador -> processamento FALHA -> 503
      //   entrega 2 (retry) -> marcador ja existe -> "duplicado", 200
      //
      // ...e a loja nunca era marcada como desinstalada. A trava anulava
      // exatamente o retry com que ela deveria conviver.
      //
      // Apagar o marcador quando o processamento falha devolve a entrega
      // seguinte ao caminho normal.
      // ==================================================================
      if (resposta.status >= 500 && cab.webhookId) {
        await admin
          .from("shopify_webhook_events")
          .delete()
          .eq("webhook_id", cab.webhookId);
      }
      return resposta;
    }
    default:
      // Topico assinado que ainda nao tratamos: registrado (para idempotencia)
      // e aceito, sem retry.
      return ok({ ignorado: "topico sem tratamento", topic: cab.topic });
  }
}

/**
 * App removido da loja.
 *
 * O token morre no instante da desinstalacao. Limpar aqui e o que faz o resto
 * do sistema parar de bater numa porta fechada:
 *
 *   - access_token vai a null, entao nenhuma chamada sai com credencial morta;
 *   - uninstalled_at marca a loja, e a tela pode dizer o que houve;
 *   - as rotas que dependem dessa loja sao pausadas, porque uma rota apontando
 *     para checkout desinstalado manda o comprador para o lugar errado e o
 *     conserto horario ficaria tentando para sempre.
 *
 * O que NAO se apaga: client_id e client_secret. Reinstalar e comum, e apagar
 * as credenciais obrigaria o lojista a digitar tudo de novo.
 */
async function tratarDesinstalacao(
  admin: ReturnType<typeof createAdminClient>,
  loja: { id: string; user_id: string; shop_domain: string }
) {
  const agora = new Date().toISOString();

  const { error: erroLoja } = await admin
    .from("stores")
    .update({ access_token: null, uninstalled_at: agora })
    .eq("id", loja.id)
    .eq("user_id", loja.user_id);

  if (erroLoja) {
    console.error("[shopify/webhook] app/uninstalled nao gravou", erroLoja.message);
    // 503 para a Shopify tentar de novo -- este e um caso em que o retry ajuda.
    return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
  }

  // Rotas em que esta loja e a vitrine: sem ela nao ha o que rotear.
  //
  // O erro destas duas gravacoes era ignorado: se falhassem, a loja ficava
  // marcada como desinstalada mas as rotas continuavam ligadas, mandando
  // comprador para um checkout morto -- e como o evento ja estava registrado,
  // nenhum retry consertaria. Agora falha aqui pede reentrega.
  const { error: erroRotas } = await admin
    .from("routed_checkout_configs")
    .update({ enabled: false })
    .eq("user_id", loja.user_id)
    .eq("source_store_id", loja.id);
  if (erroRotas) {
    console.error("[shopify/webhook] nao pausei as rotas", erroRotas.message);
    return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
  }

  // Destinos de rodizio que apontam para esta loja: desligar so o destino
  // deixa a rota viva com os outros checkouts, que e o comportamento certo.
  const { data: rotas } = await admin
    .from("routed_checkout_configs")
    .select("id")
    .eq("user_id", loja.user_id);

  const ids = (rotas || []).map((r) => r.id);
  if (ids.length > 0) {
    const { error: erroDestinos } = await admin
      .from("routed_checkout_targets")
      .update({ enabled: false })
      .eq("target_store_id", loja.id)
      .in("route_id", ids);
    if (erroDestinos) {
      console.error("[shopify/webhook] nao desliguei os destinos", erroDestinos.message);
      return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
    }
  }

  console.log("[shopify/webhook] app/uninstalled", { shopDomain: loja.shop_domain });
  return ok({ topic: "app/uninstalled", loja: loja.id });
}
