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
  const { data: lojas, error: erroLojas } = await admin
    .from("stores")
    .select("id, user_id, name, shop_domain, client_secret, uninstalled_at")
    .eq("shop_domain", shopDomain);

  // Soluco do banco nao e "loja desconhecida": com 200 a Shopify desiste, e a
  // venda daquele pedido nunca mais seria enviada.
  if (erroLojas) {
    console.error("[shopify/webhook] falha ao ler lojas", erroLojas.message);
    return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
  }

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
    // Fica no log de proposito. Antes a recusa nao deixava rastro nenhum --
    // nem marcador, nem linha, nem log --, e por isso ninguem soube que a
    // janela de 5 min descartava toda reentrega da Shopify.
    console.warn("[shopify/webhook] fora da janela de replay", {
      topic: cab.topic,
      shopDomain,
      webhookId: cab.webhookId,
      triggeredAt: cab.triggeredAt,
    });
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
      const resposta = await executarComRetentativa(cab.topic, () =>
        tratarDesinstalacao(admin, loja)
      );
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
    case "orders/create": {
      const resposta = await executarComRetentativa(cab.topic, () =>
        tratarPedidoCriado(admin, loja, payload)
      );
      // Mesmo cuidado do uninstalled: o marcador de idempotencia foi gravado
      // ANTES do processamento, entao pedir retry sem apaga-lo faria a
      // entrega seguinte bater em "duplicado" e a conversao nunca sairia.
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

async function notificarVenda(
  admin: ReturnType<typeof createAdminClient>,
  loja: { user_id?: string | null; name?: string | null; shop_domain: string },
  pedido: Record<string, unknown>
) {
  try {
    const { webhookDeVendaDoDono, enviarNotificacaoDeVenda, vendaDoPedido } = await import(
      "@/lib/alertas/venda-webhook"
    );
    const url = await webhookDeVendaDoDono(admin, loja.user_id as string);
    if (!url) return;
    const r = await enviarNotificacaoDeVenda(
      url,
      vendaDoPedido(pedido as Parameters<typeof vendaDoPedido>[0], loja.name || loja.shop_domain)
    );
    if (!r.ok) console.warn("[shopify/webhook] notificacao de venda falhou", r.erro);
  } catch (e) {
    console.error("[shopify/webhook] notificacao de venda", e instanceof Error ? e.message : e);
  }
}

/**
 * Excecao vira 503, nao 500 cru.
 *
 * O marcador de idempotencia ja foi gravado quando o tratador roda. Uma
 * excecao que escapasse dele subia como 500 do Next -- e o bloco que apaga o
 * marcador so olha a RESPOSTA, que nunca existia. A reentrega da Shopify caia
 * em "duplicado" e a compra nao saia nunca. Convertida em 503, ela passa pelo
 * mesmo caminho de qualquer falha: marcador apagado, Shopify reentrega.
 */
async function executarComRetentativa(
  topico: string,
  tratar: () => Promise<NextResponse>
): Promise<NextResponse> {
  try {
    return await tratar();
  } catch (e) {
    console.error(`[shopify/webhook] falha ao tratar ${topico}`, e);
    return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
  }
}

/**
 * Pedido criado -> Purchase no CAPI do Meta e na Events API do TikTok.
 *
 * Este e o unico evento de conversao que nao depende do navegador do
 * comprador: bloqueador de anuncio derruba o pixel e o ITP do Safari apaga o
 * cookie em 7 dias, mas o pedido chega aqui do servidor da Shopify.
 *
 * O evento entra na FILA antes de qualquer chamada de rede. A entrega e
 * tentada na hora porque o Meta prefere evento fresco, mas se falhar a linha
 * continua pendente e o cron tenta de novo -- perder conversao justo no pico
 * de venda, que e quando o Meta limita taxa, seria o pior momento possivel.
 */
async function tratarPedidoCriado(
  admin: ReturnType<typeof createAdminClient>,
  loja: { id: string; user_id?: string | null; name?: string | null; shop_domain: string },
  payload: Record<string, unknown>
) {
  const { rastreamentoLigado, enfileirar, entregar } = await import(
    "@/lib/tracking/fila"
  );
  const { montarPurchase, montarPurchaseTiktok, sinaisDoPedido } = await import(
    "@/lib/tracking/purchase"
  );
  const { vaiPeloServidor } = await import("@/lib/tracking/eventos");
  const { contarSinais } = await import("@/lib/tracking/normalizar");

  const pedido = payload as Parameters<typeof montarPurchase>[0];

  // Pedido de teste, valor zero, PDV e draft order nao viram conversao. O
  // draft de reenvio e o pior: carrega a PII do cliente real, e o Meta contaria
  // uma segunda compra com valor. Ver filtro-pedido.ts.
  const { motivoParaIgnorarPedido } = await import("@/lib/tracking/filtro-pedido");
  const motivo = motivoParaIgnorarPedido(pedido);

  // Teto de pedidos por dia do rodizio: conta todo pedido real da loja, com
  // ou sem rastreamento -- o teto e da conta de pagamento, nao do pixel. Por
  // isso vem ANTES da trava do rastreamento. Falha aqui nao segura a compra.
  if (!motivo && pedido.id != null) {
    const { registrarPedidoDoRodizio } = await import("@/lib/checkout-routes/pedidos-24h");
    const novo = await registrarPedidoDoRodizio(admin, loja.id, String(pedido.id), pedido.created_at ?? null);
    // Notificacao de venda no celular (Pushcut, ntfy...). So na primeira vez
    // que o pedido entra -- reentrega da Shopify nao toca de novo -- e nunca
    // segura nem derruba a compra: falhou, so vai para o log.
    if (novo && loja.user_id) await notificarVenda(admin, loja, payload);
  }

  if (!(await rastreamentoLigado(admin, loja.id))) {
    return ok({ ignorado: "rastreamento desligado", topic: "orders/create" });
  }

  if (motivo) {
    return ok({ ignorado: motivo, topic: "orders/create", pedido: pedido.id ?? null });
  }

  // O clique, em cascata: cart attribute -> visitante -> checkout -> URL de
  // chegada. Os tres primeiros aqui; a URL de chegada em purchase.ts.
  //
  // Antes so existia o primeiro passo, e ele dependia do MESMO cart attribute
  // que ja trazia os click ids: compra por "Comprar agora" ou checkout
  // expresso perdia tudo de uma vez. Ver identidade-do-pedido.ts.
  const sinais = sinaisDoPedido(pedido);
  const { recuperarIdentidadeDoPedido } = await import(
    "@/lib/tracking/identidade-do-pedido"
  );
  const { identidade, origem } = await recuperarIdentidadeDoPedido(
    admin,
    loja.id,
    pedido,
    sinais.visitorId
  );

  const { evento, userData } = montarPurchase(pedido, {
    identidade,
    dominioLoja: loja.shop_domain,
  });

  // Uma linha de fila por DESTINO ativo que aceita a compra: Meta e TikTok.
  //
  // Destino e linha, nao coluna, desde a 043: a loja pode ter dois pixels
  // Meta, e uma linha falhar nao pode impedir a outra de sair.
  //
  // O GOOGLE NAO SAI DAQUI: a compra do Google e disparada pelo Web Pixel do
  // checkout (checkout_completed), pela tag do Google no navegador.
  const { destinosDaLoja, destinoAceita } = await import("@/lib/tracking/destinos");
  const querem = (await destinosDaLoja(admin, loja.id, { comToken: true })).filter(
    (d) => vaiPeloServidor(d.plataforma) && destinoAceita(d)
  );

  if (querem.length === 0) {
    return ok({ ignorado: "nenhum destino configurado", topic: "orders/create" });
  }

  // Compra de teste que o filtro do pedido nao pega: o dono pagando de verdade
  // depois do ?xcart_teste=1 (atributo _xc_teste), ou com um gclid TESTE_*.
  // Fica na fila para conferir e so sai para o Meta ou o TikTok com codigo de
  // teste. Ver teste.ts.
  const { marcasDoPedido, enviaAoDestino, payloadComMarcas, registrarSemEnviar } =
    await import("@/lib/tracking/teste");
  const marcas = marcasDoPedido(pedido, [
    sinais.gclid, sinais.gbraid, sinais.wbraid, sinais.fbclid, sinais.fbc, sinais.ttclid,
    identidade?.gclid, identidade?.gbraid, identidade?.wbraid, identidade?.fbclid, identidade?.fbc,
    identidade?.ttclid,
  ]);

  const destinos = querem.map((d) => {
    const envia = enviaAoDestino(d, marcas.teste);
    // O payload e no formato da PLATAFORMA. O nome na fila continua
    // "Purchase" e o event_id o mesmo (purchase_<id>) para os dois: a tela,
    // os alertas e a dedupe do indice unico leem por eles.
    //
    // O id de produto e do DESTINO: dois pixels Meta na mesma loja podem
    // apontar para catalogos montados de formas diferentes. Sem template
    // configurado o Meta reusa o evento ja montado -- e o caso comum, e
    // remontar so repetiria os hashes do user_data.
    const base =
      d.plataforma === "tiktok"
        ? montarPurchaseTiktok(pedido, {
            identidade,
            dominioLoja: loja.shop_domain,
            idTemplate: d.idTemplate,
          })
        : d.idTemplate
          ? montarPurchase(pedido, {
              identidade,
              dominioLoja: loja.shop_domain,
              idTemplate: d.idTemplate,
            }).evento
          : evento;
    return {
      destination: d.plataforma === "tiktok" ? ("tiktok" as const) : ("meta" as const),
      destinationId: d.id,
      destino: d,
      envia,
      payload: payloadComMarcas(d.plataforma, base, marcas, envia),
    };
  });

  try {
    const saida: Record<string, string> = {};

    // EM PARALELO, nao em fila.
    //
    // Cada destino e uma chamada de rede para outra empresa, e elas nao
    // dependem umas das outras: linhas de fila distintas, contas distintas. Em
    // serie, somariam idas e voltas antes de o webhook responder -- e a
    // Shopify tem limite de tempo para a resposta.
    //
    // Uma falhar continua nao impedindo as outras: cada `entregar` trata o
    // proprio erro e grava o desfecho na linha dela.
    await Promise.all(
      destinos.map(async (alvo) => {
        // A chave do mapa carrega o id do destino: com dois pixels Meta, uma
        // chave "meta" sozinha faria o segundo sobrescrever o primeiro e o log
        // mentiria sobre o que saiu.
        const chave = `${alvo.destination}:${alvo.destinationId.slice(0, 8)}`;

        if (!alvo.envia) {
          const { duplicado } = await registrarSemEnviar(admin, {
            storeId: loja.id,
            destination: alvo.destination,
            destinationId: alvo.destinationId,
            eventName: evento.event_name,
            eventId: evento.event_id,
            orderId: String(pedido.id ?? ""),
            payload: alvo.payload,
          });
          saida[chave] = duplicado ? "duplicado" : "teste: nao enviado";
          return;
        }

        const { id, duplicado } = await enfileirar(admin, {
          storeId: loja.id,
          destination: alvo.destination,
          destinationId: alvo.destinationId,
          // So o nome ("Purchase") e o id: o payload de cada plataforma vai
          // em `payload`.
          evento: { event_name: evento.event_name, event_id: evento.event_id },
          orderId: String(pedido.id ?? ""),
          payload: alvo.payload,
        });

        if (duplicado) {
          saida[chave] = "duplicado";
          return;
        }
        if (!id) {
          saida[chave] = "na fila";
          return;
        }

        // Melhor esforco: falhou, a linha segue pendente para o cron.
        const r = await entregar(
          admin,
          {
            id,
            store_id: loja.id,
            destination: alvo.destination,
            destination_id: alvo.destinationId,
            event_name: evento.event_name,
            payload: alvo.payload,
            attempts: 0,
          },
          // `destinosDaLoja` ja trouxe destino e token, e o interruptor foi
          // checado no inicio. Reler seria tres consultas por destino, por venda.
          { destino: alvo.destino, lojaLigada: true }
        );
        saida[chave] = r.ok ? "enviado" : "na fila";
      })
    );


    return ok({
      topic: "orders/create",
      eventId: evento.event_id,
      destinos: saida,
      // De onde veio a identidade. "nenhuma" com o carrinho tambem vazio e a
      // compra que sai sem clique -- o numero que importa acompanhar.
      identidade: origem,
      // Quantos sinais foram junto: e o que vira Event Match Quality.
      sinais: contarSinais(userData),
    });
  } catch (e) {
    console.error("[shopify/webhook] falha ao enfileirar Purchase", e);
    // 503 para a Shopify reentregar: conversao perdida nao se recupera.
    return NextResponse.json({ error: "Tente de novo." }, { status: 503 });
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
