import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/current-user";
import { createAdminClient } from "@/lib/supabase/admin";
import { destinosParaTela } from "@/lib/tracking/destinos";
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
//
// A CONTAGEM E POR DESTINO, NAO POR PLATAFORMA
//
// A loja pode ter cinco contas de Google, e cada venda gera uma linha de fila
// para cada uma. Somadas, "1 pedido" viraria "5 compras" e a comparacao com
// pedidos -- que e o alarme -- nunca mais acusaria falta. Cada destino e julgado
// sozinho: uma conta pode estar chegando e a outra nao.
// ============================================================================

/** Contagem de UM destino. */
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

/** Um destino como a tela o enxerga: configuracao + o que saiu por ele. */
export interface DestinoNaTela {
  id: string;
  plataforma: "google" | "meta";
  /** Apelido do lojista. Com duas contas da mesma plataforma, o id nao basta. */
  nome: string | null;
  /** AW-XXXXXXXXX no Google, id do pixel no Meta. */
  conta: string;
  /** So Google: um rotulo por evento. Evento fora do mapa = o lojista nao quis. */
  labels: MapaDeRotulos;
  /** So Meta. */
  testEventCode: string | null;
  ativo: boolean;
  /** O token do CAPI esta gravado? So o booleano -- o valor nunca sai do servidor. */
  temToken: boolean;
  /** Este destino consegue enviar algo, ou falta peca? */
  completo: boolean;
  contagem: ContagemDestino;
}

export interface LojaTracking {
  storeId: string;
  nome: string;
  dominio: string;
  ligado: boolean;

  /**
   * O Custom Pixel esta MANDANDO evento?
   *
   * Nao "foi instalado um dia": o pixel removido da Shopify precisa voltar a
   * aparecer como faltando, senao a tela diria "instalado" enquanto o checkout
   * nao e rastreado por ninguem.
   */
  pixelCheckoutAtivo: boolean;

  destinos: DestinoNaTela[];
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
  const admin = createAdminClient();

  // A config e a fila sao lidas com o cliente do USUARIO (RLS limita ao dono).
  // Os destinos vao pelo admin porque a existencia do token mora numa tabela sem
  // policy -- de proposito: o token posta evento na conta de anuncios do
  // lojista. As lojas acima ja foram filtradas por RLS, entao o admin aqui nao
  // amplia o que o usuario ve.
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();
  const [{ data: configs }, { data: eventos }, destinosPorLoja] = await Promise.all([
    supabase
      .from("tracking_configs")
      .select("store_id, enabled, web_pixel_visto_em")
      .in("store_id", ids),
    supabase
      .from("tracking_events")
      .select(
        "store_id, destination, destination_id, event_name, status, last_error, sent_at, created_at"
      )
      .in("store_id", ids)
      .gte("created_at", desde)
      .order("created_at", { ascending: false }),
    destinosParaTela(admin, ids),
  ]);

  const porLoja = new Map((configs || []).map((c) => [c.store_id, c]));

  /**
   * Para onde vai a linha antiga, de antes da 043.
   *
   * A 043 carimbou o historico ligando por plataforma, e naquele momento existia
   * no maximo UM destino de cada -- criado a partir das colunas de config. Entao
   * o destino mais ANTIGO de uma plataforma e de fato o dono daquelas linhas, e
   * isto nao e chute.
   */
  const legado = new Map<string, string>();
  for (const [storeId, lista] of destinosPorLoja) {
    for (const d of lista) {
      const chave = `${storeId}:${d.plataforma}`;
      if (!legado.has(chave)) legado.set(chave, d.id);
    }
  }

  const contagens = new Map<string, ContagemDestino>();
  const ultimoDaLoja = new Map<string, string>();

  for (const e of eventos || []) {
    const destinoId =
      e.destination_id || legado.get(`${e.store_id}:${e.destination}`) || null;
    if (!destinoId) continue;

    const alvo = contagens.get(destinoId) ?? contagemVazia();

    if (e.status === "enviado") {
      alvo.enviados += 1;
      // chaveDoEvento normaliza a caixa: a compra foi gravada como "Purchase".
      const chave = chaveDoEvento(e.event_name || "");
      if (chave) alvo.porEvento[chave] = (alvo.porEvento[chave] ?? 0) + 1;
      if (!ultimoDaLoja.has(e.store_id) && e.sent_at) {
        ultimoDaLoja.set(e.store_id, e.sent_at);
      }
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

    contagens.set(destinoId, alvo);
  }

  return {
    lojas: lojas.map((l) => {
      const cfg = porLoja.get(l.id);
      return {
        storeId: l.id,
        nome: l.name || l.shop_domain,
        dominio: l.shop_domain,
        ligado: Boolean(cfg?.enabled),
        pixelCheckoutAtivo: cfg?.web_pixel_visto_em
          ? Date.now() - new Date(cfg.web_pixel_visto_em).getTime() < 864e5
          : false,
        destinos: (destinosPorLoja.get(l.id) || []).map((d) => ({
          id: d.id,
          plataforma: d.plataforma,
          nome: d.nome,
          conta: d.conta,
          labels: d.labels,
          testEventCode: d.testEventCode,
          ativo: d.ativo,
          temToken: d.temToken,
          // Mesma regra de `destinoAceita`, sem o evento: no Meta o pixel cobre
          // tudo e o que falta e o token; no Google cada evento e uma action
          // propria, e sem nenhum rotulo nao ha o que enviar.
          completo:
            d.plataforma === "meta"
              ? Boolean(d.conta && d.temToken)
              : Boolean(d.conta) && Object.keys(d.labels).length > 0,
          contagem: contagens.get(d.id) ?? contagemVazia(),
        })),
        ultimoEnvio: ultimoDaLoja.get(l.id) ?? null,
      };
    }),
  };
}
