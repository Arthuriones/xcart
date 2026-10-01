import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  chaveDoEvento,
  type ChaveEvento,
  type MapaDeRotulos,
} from "@/lib/tracking/eventos";

// ============================================================================
// Dados da tela de rastreamento.
//
// Alem da configuracao, esta consulta responde a pergunta que decide se o
// rastreamento esta saudavel: "quantos pedidos entraram e quantas conversoes
// sairam?".
//
// Isso importa porque o endpoint de conversao do Google responde 200 mesmo
// quando ignora o conteudo -- "enviado" nao prova que foi contado. A unica
// forma de perceber que quebrou e a AUSENCIA: pedidos entrando e conversoes
// parando. Por isso a divergencia aparece na tela, nao so a fila.
// ============================================================================

/** Contagem de UM destino. Separado porque cada venda gera uma linha por
 *  destino configurado -- somados, "1 pedido" viraria "2 compras". */
export interface ContagemDestino {
  enviados: number;
  falharam: number;
  pendentes: number;
  /** Enviados sem nenhum click id: conversao que o Google nao liga a anuncio. */
  semAtribuicao: number;
  ultimoErro: string | null;
  porEvento: Partial<Record<ChaveEvento, number>>;
  /**
   * Sem click id, POR evento.
   *
   * O total sozinho mistura funil com venda, e sao leituras diferentes: 300
   * view_item sem click id e normal (trafego organico entra na loja tambem);
   * 2 de 2 COMPRAS sem click id quer dizer que nenhuma venda foi creditada a
   * anuncio nenhum, que e a informacao que decide se a campanha esta medindo.
   */
  semAtribPorEvento: Partial<Record<ChaveEvento, number>>;
}

export interface LojaTracking {
  storeId: string;
  nome: string;
  dominio: string;
  ligado: boolean;

  googleConversionId: string | null;
  /** Rotulo por evento. Evento fora do mapa = o lojista nao pediu. */
  googleLabels: MapaDeRotulos;

  /** O Custom Pixel do checkout esta instalado? Ele se anuncia no 1o evento. */
  pixelCheckoutAtivo: boolean;
  metaPixelId: string | null;
  /** O token do CAPI esta gravado? So o booleano -- o valor nunca sai do servidor. */
  temTokenMeta: boolean;

  google: ContagemDestino;
  meta: ContagemDestino;
  ultimoEnvio: string | null;
}

export interface PainelTracking {
  lojas: LojaTracking[];
}

function contagemVazia(): ContagemDestino {
  return {
    enviados: 0,
    falharam: 0,
    pendentes: 0,
    semAtribuicao: 0,
    ultimoErro: null,
    porEvento: {},
    semAtribPorEvento: {},
  };
}

export async function getPainelTracking(): Promise<PainelTracking> {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return { lojas: [] };

  const { data: lojas } = await supabase
    .from("stores")
    .select("id, name, shop_domain")
    .is("uninstalled_at", null)
    .order("created_at", { ascending: true });

  if (!lojas?.length) return { lojas: [] };

  const ids = lojas.map((l) => l.id);

  // A configuracao e lida com o cliente do usuario (RLS garante que so vem a
  // dele). A fila tambem: a policy de leitura ja limita por dono.
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: configs }, { data: eventos }] = await Promise.all([
    supabase
      .from("tracking_configs")
      .select(
        "store_id, enabled, google_conversion_id, google_conversion_label, google_labels, meta_pixel_id, web_pixel_ativo"
      )
      .in("store_id", ids),
    supabase
      .from("tracking_events")
      .select("store_id, destination, event_name, status, last_error, sent_at, created_at")
      .in("store_id", ids)
      .gte("created_at", desde)
      .order("created_at", { ascending: false }),
  ]);

  const porLoja = new Map((configs || []).map((c) => [c.store_id, c]));

  // O token do CAPI mora em tracking_secrets, que so o service_role alcanca --
  // de proposito: ele posta evento na conta de anuncios do lojista. A tela nao
  // precisa do valor, so de saber se existe. As lojas ja foram filtradas por
  // RLS acima, entao este admin nao amplia o que o usuario ve.
  const comToken = new Set<string>();
  {
    const { data } = await createAdminClient()
      .from("tracking_secrets")
      .select("store_id, meta_access_token")
      .in("store_id", ids);
    for (const l of data || []) {
      if (l.meta_access_token) comToken.add(l.store_id);
    }
  }

  const contagem = new Map<
    string,
    { google: ContagemDestino; meta: ContagemDestino; ultimo: string | null }
  >();

  for (const e of eventos || []) {
    const atual =
      contagem.get(e.store_id) || {
        google: contagemVazia(),
        meta: contagemVazia(),
        ultimo: null,
      };

    // Cada venda rende uma linha POR DESTINO. Somar os dois num numero so faria
    // "1 pedido, 2 compras" -- e ai a comparacao com pedidos, que e o alarme,
    // nunca mais acusaria falta.
    const alvo =
      e.destination === "meta"
        ? atual.meta
        : e.destination === "google"
          ? atual.google
          : null;
    if (!alvo) {
      contagem.set(e.store_id, atual);
      continue;
    }

    if (e.status === "enviado") {
      alvo.enviados += 1;
      // chaveDoEvento normaliza a caixa: a compra foi gravada como "Purchase".
      const chave = chaveDoEvento(e.event_name || "");
      if (chave) alvo.porEvento[chave] = (alvo.porEvento[chave] ?? 0) + 1;
      if (!atual.ultimo && e.sent_at) atual.ultimo = e.sent_at;
      // O envio grava este aviso quando nao havia click id nenhum.
      if ((e.last_error || "").includes("sem atribuicao")) {
        alvo.semAtribuicao += 1;
        if (chave) {
          alvo.semAtribPorEvento[chave] = (alvo.semAtribPorEvento[chave] ?? 0) + 1;
        }
      }
    } else if (e.status === "falhou") {
      alvo.falharam += 1;
      if (!alvo.ultimoErro && e.last_error) alvo.ultimoErro = e.last_error;
    } else {
      alvo.pendentes += 1;
    }

    contagem.set(e.store_id, atual);
  }

  return {
    lojas: lojas.map((l) => {
      const cfg = porLoja.get(l.id);
      const c = contagem.get(l.id);
      return {
        storeId: l.id,
        nome: l.name || l.shop_domain,
        dominio: l.shop_domain,
        ligado: Boolean(cfg?.enabled),
        googleConversionId: cfg?.google_conversion_id ?? null,
        googleLabels: (cfg?.google_labels as MapaDeRotulos | null) ?? {},
        pixelCheckoutAtivo: Boolean(cfg?.web_pixel_ativo),
        metaPixelId: cfg?.meta_pixel_id ?? null,
        temTokenMeta: comToken.has(l.id),
        google: c?.google ?? contagemVazia(),
        meta: c?.meta ?? contagemVazia(),
        ultimoEnvio: c?.ultimo ?? null,
      };
    }),
  };
}
