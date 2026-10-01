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
//
// A CONTAGEM E FEITA NO BANCO
//
// Ler a fila linha a linha batia no corte de 1000 linhas do PostgREST. O funil
// enche a janela (mil view_item num dia de trafego), e como a leitura vinha do
// mais novo para o mais velho, as COMPRAS caiam fora do corte: a tela mostrava
// "0 compras" com venda entrando, e o alarme nunca disparava. A funcao
// `tracking_painel` (migration 049) devolve uma linha por (loja, destino,
// evento, status) -- o tamanho nao depende mais do trafego.
// ============================================================================

/** Contagem de UM destino. */
export interface ContagemDestino {
  enviados: number;
  falharam: number;
  pendentes: number;
  /**
   * Enviados sem click id: conversao que a plataforma nao liga a anuncio.
   * No Google e a falta de gclid/gbraid/wbraid; no Meta, a falta de fbc.
   */
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
  /**
   * Pedidos (id numerico da Shopify) cuja COMPRA saiu por este destino.
   *
   * O numero sozinho nao acusa perda parcial: "8 compras" para "10 pedidos"
   * pode ser 8 dos 10 ou 8 repetidas. Com os ids a tela diz QUAIS faltam.
   */
  pedidosComCompra: string[];
  /** Compras ainda na fila (retentativa do cron): nao sairam, mas nao se perderam. */
  pedidosNaFila: string[];
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
  /** Formato do id de produto. null = {variant_id}. */
  idTemplate: string | null;
  ativo: boolean;
  /** O token do CAPI esta gravado? So o booleano -- o valor nunca sai do servidor. */
  temToken: boolean;
  /** Este destino consegue enviar algo, ou falta peca? */
  completo: boolean;
  /**
   * Quando o destino foi cadastrado. Pedido mais velho que isto nao tinha como
   * ter ido para ele, e nao pode virar "pedido sem compra".
   */
  criadoEm: string | null;
  contagem: ContagemDestino;
}

export interface LojaTracking {
  storeId: string;
  nome: string;
  dominio: string;
  ligado: boolean;

  /**
   * O app foi desinstalado com o rastreamento ainda ligado.
   *
   * Sem o app nao ha webhook de pedido nem credencial: a compra para de sair.
   * Esconder a loja (como era) fazia o rastreamento sumir da tela no exato
   * momento em que parou -- e o lojista nao tinha onde perceber.
   */
  desinstalada: boolean;

  /**
   * O Custom Pixel esta MANDANDO evento?
   *
   * Nao "foi instalado um dia": o pixel removido da Shopify precisa voltar a
   * aparecer como faltando, senao a tela diria "instalado" enquanto o checkout
   * nao e rastreado por ninguem.
   */
  pixelCheckoutAtivo: boolean;

  /**
   * O pixel esta mandando, mas e o trecho ANTIGO, sem o id da loja.
   *
   * Funciona, mas sem a protecao contra outra conta cadastrar o mesmo dominio
   * e desviar os eventos do checkout. A tela pede para trocar o codigo.
   */
  pixelCheckoutDesatualizado: boolean;

  /**
   * O teto por hora do coletor descartou evento recentemente?
   *
   * Loja que cresce bate nele e para de medir parte do funil. Sem isto a tela
   * continuaria dizendo que esta tudo bem, e o primeiro sintoma seria o Meta
   * deixando de otimizar semanas depois.
   */
  tetoAtingidoRecente: boolean;

  /**
   * A contagem da fila FALHOU nesta carga da tela.
   *
   * Sem isto, uma falha da RPC virava "zero compras" em todo destino -- e a
   * comparacao com os pedidos acusava cada venda como perdida, com as compras
   * saindo normalmente. Alarme falso empurra o lojista a trocar token ou
   * rotulo que estao certos.
   */
  contagemIndisponivel: boolean;

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
    pedidosComCompra: [],
    pedidosNaFila: [],
  };
}

/** Uma linha de `tracking_painel` (migration 049). */
export interface LinhaPainel {
  store_id: string;
  destination_id: string | null;
  destination: string;
  /** lower(event_name). */
  event_key: string | null;
  status: string;
  n: number | string;
  n_sem_atribuicao: number | string;
  ultimo_envio: string | null;
  ultimo_erro: string | null;
  ultimo_erro_em: string | null;
  order_ids: string[] | null;
}

/**
 * Para onde vai a linha antiga, de antes da 043.
 *
 * A 043 carimbou o historico ligando por plataforma, e naquele momento existia
 * no maximo UM destino de cada -- criado a partir das colunas de config. Entao
 * o destino mais ANTIGO de uma plataforma e de fato o dono daquelas linhas, e
 * isto nao e chute. A lista de cada loja chega ordenada por created_at.
 */
export function mapaLegado(
  destinosPorLoja: Map<string, { id: string; plataforma: string }[]>
): Map<string, string> {
  const legado = new Map<string, string>();
  for (const [storeId, lista] of destinosPorLoja) {
    for (const d of lista) {
      const chave = `${storeId}:${d.plataforma}`;
      if (!legado.has(chave)) legado.set(chave, d.id);
    }
  }
  return legado;
}

/** O instante mais recente entre dois, tolerando ausencia. */
function maisRecente(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b) > Date.parse(a) ? b : a;
}

/**
 * Linhas agrupadas da fila -> contagem por destino.
 *
 * Pura de proposito: e aqui que mora a regra que a tela inteira usa para
 * julgar se a venda esta saindo, e ela precisa de teste sem banco.
 *
 * O mesmo destino pode receber mais de uma linha do mesmo (evento, status):
 * uma com destination_id e outra legada, sem. Por isso tudo aqui SOMA e une,
 * nunca sobrescreve.
 */
export function contagensDoPainel(
  linhas: LinhaPainel[],
  legado: Map<string, string>
): { contagens: Map<string, ContagemDestino>; ultimoDaLoja: Map<string, string> } {
  const contagens = new Map<string, ContagemDestino>();
  const ultimoDaLoja = new Map<string, string>();
  const erroEm = new Map<string, string | null>();
  const comCompra = new Map<string, Set<string>>();
  const naFila = new Map<string, Set<string>>();

  const juntar = (mapa: Map<string, Set<string>>, id: string, ids: string[] | null) => {
    if (!ids?.length) return;
    const s = mapa.get(id) ?? new Set<string>();
    for (const o of ids) if (o) s.add(String(o));
    mapa.set(id, s);
  };

  for (const l of linhas) {
    const destinoId =
      l.destination_id || legado.get(`${l.store_id}:${l.destination}`) || null;
    if (!destinoId) continue;

    const alvo = contagens.get(destinoId) ?? contagemVazia();
    const n = Number(l.n) || 0;
    // chaveDoEvento normaliza a caixa: a compra foi gravada como "Purchase".
    const chave = chaveDoEvento(l.event_key || "");

    if (l.status === "enviado") {
      alvo.enviados += n;
      if (chave) alvo.porEvento[chave] = (alvo.porEvento[chave] ?? 0) + n;
      const ultimo = maisRecente(ultimoDaLoja.get(l.store_id) ?? null, l.ultimo_envio);
      if (ultimo) ultimoDaLoja.set(l.store_id, ultimo);
      // O envio grava o aviso "sem atribuicao" quando nao havia click id.
      const sem = Number(l.n_sem_atribuicao) || 0;
      if (sem > 0) {
        alvo.semAtribuicao += sem;
        if (chave) {
          alvo.semAtribPorEvento[chave] = (alvo.semAtribPorEvento[chave] ?? 0) + sem;
        }
      }
      if (chave === "purchase") juntar(comCompra, destinoId, l.order_ids);
    } else if (l.status === "falhou") {
      alvo.falharam += n;
      // O erro mais recente entre a linha legada e a nova: depois de trocar o
      // token, o erro velho mandaria consertar o que ja foi consertado.
      if (l.ultimo_erro) {
        const antes = erroEm.get(destinoId) ?? null;
        const vence =
          !alvo.ultimoErro ||
          (l.ultimo_erro_em !== null &&
            antes !== l.ultimo_erro_em &&
            maisRecente(antes, l.ultimo_erro_em) === l.ultimo_erro_em);
        if (vence) {
          alvo.ultimoErro = l.ultimo_erro;
          erroEm.set(destinoId, l.ultimo_erro_em);
        }
      }
    } else {
      alvo.pendentes += n;
      if (chave === "purchase") juntar(naFila, destinoId, l.order_ids);
    }

    contagens.set(destinoId, alvo);
  }

  for (const [id, alvo] of contagens) {
    const sairam = comCompra.get(id) ?? new Set<string>();
    alvo.pedidosComCompra = [...sairam];
    // Compra que ja saiu numa linha e tem outra na fila nao esta "na fila":
    // ja chegou.
    alvo.pedidosNaFila = [...(naFila.get(id) ?? [])].filter((o) => !sairam.has(o));
  }

  return { contagens, ultimoDaLoja };
}

/** Uma pagina do PostgREST. A funcao devolve pouco, mas nao ha teto garantido. */
const PAGINA = 1000;

export async function getPainelTracking(): Promise<PainelTracking> {
  const [supabase, user] = await Promise.all([createClient(), getCurrentUser()]);
  if (!user) return { lojas: [] };

  // Sem filtrar por uninstalled_at aqui: loja desinstalada com rastreamento
  // LIGADO precisa aparecer, porque e justamente onde a venda parou de sair.
  const { data: todas } = await supabase
    .from("stores")
    .select("id, name, shop_domain, uninstalled_at")
    .order("created_at", { ascending: true });

  if (!todas?.length) return { lojas: [] };

  const { data: configs } = await supabase
    .from("tracking_configs")
    .select("store_id, enabled, web_pixel_visto_em, web_pixel_com_id_em, teto_atingido_em")
    .in(
      "store_id",
      todas.map((l) => l.id)
    );
  const porLoja = new Map((configs || []).map((c) => [c.store_id, c]));

  // Desinstalada SEM rastreamento ligado continua escondida: nao ha nada a
  // fazer nela por esta tela.
  const lojas = todas.filter(
    (l) => !l.uninstalled_at || Boolean(porLoja.get(l.id)?.enabled)
  );
  if (!lojas.length) return { lojas: [] };

  const ids = lojas.map((l) => l.id);
  const admin = createAdminClient();

  // A fila e lida com o cliente do USUARIO: tracking_painel e SECURITY INVOKER,
  // entao a RLS de tracking_events vale la dentro. NUNCA pelo admin -- ai o
  // uuid de uma loja alheia em p_store_ids devolveria os numeros dela.
  //
  // Os destinos vao pelo admin porque a existencia do token mora numa tabela sem
  // policy -- de proposito: o token posta evento na conta de anuncios do
  // lojista. As lojas acima ja foram filtradas por RLS, entao o admin aqui nao
  // amplia o que o usuario ve.
  const desde = new Date(Date.now() - 7 * 864e5).toISOString();

  // Qualquer erro, inclusive numa pagina depois da primeira, invalida a
  // leitura INTEIRA: contagem parcial geraria alarme parcial, igualmente falso.
  let painelFalhou = false;

  async function lerPainel(): Promise<LinhaPainel[]> {
    const saida: LinhaPainel[] = [];
    for (let de = 0; ; de += PAGINA) {
      // Ordem total pelas colunas do agrupamento: sem ela a paginacao do
      // PostgREST pode repetir ou pular linha entre paginas.
      const { data, error } = await supabase
        .rpc("tracking_painel", { p_store_ids: ids, p_desde: desde })
        .order("store_id")
        .order("destination")
        .order("destination_id", { nullsFirst: true })
        .order("event_key")
        .order("status")
        .range(de, de + PAGINA - 1);
      if (error) {
        console.error("[tracking/painel] falha ao contar a fila", error.message);
        painelFalhou = true;
        return [];
      }
      const pagina = (data || []) as LinhaPainel[];
      saida.push(...pagina);
      if (pagina.length < PAGINA) break;
    }
    return saida;
  }

  const [linhas, destinosPorLoja, { data: criados }] = await Promise.all([
    lerPainel(),
    destinosParaTela(admin, ids),
    // created_at do destino: a policy do dono cobre a leitura.
    supabase.from("tracking_destinations").select("id, created_at").in("store_id", ids),
  ]);

  const criadoEm = new Map(
    ((criados || []) as { id: string; created_at: string | null }[]).map((c) => [
      c.id,
      c.created_at,
    ])
  );

  const { contagens, ultimoDaLoja } = contagensDoPainel(
    linhas,
    mapaLegado(destinosPorLoja)
  );

  return {
    lojas: lojas.map((l) => {
      const cfg = porLoja.get(l.id);
      return {
        storeId: l.id,
        nome: l.name || l.shop_domain,
        dominio: l.shop_domain,
        ligado: Boolean(cfg?.enabled),
        desinstalada: Boolean(l.uninstalled_at),
        tetoAtingidoRecente: cfg?.teto_atingido_em
          ? Date.now() - new Date(cfg.teto_atingido_em).getTime() < 864e5
          : false,
        // Ativo, mas sem evento COM o id da loja nas ultimas 24 h: e o trecho
        // antigo que esta colado.
        pixelCheckoutDesatualizado:
          Boolean(cfg?.web_pixel_visto_em) &&
          Date.now() - new Date(cfg!.web_pixel_visto_em!).getTime() < 864e5 &&
          !(
            cfg?.web_pixel_com_id_em &&
            Date.now() - new Date(cfg.web_pixel_com_id_em).getTime() < 864e5
          ),
        pixelCheckoutAtivo: cfg?.web_pixel_visto_em
          ? Date.now() - new Date(cfg.web_pixel_visto_em).getTime() < 864e5
          : false,
        contagemIndisponivel: painelFalhou,
        destinos: (destinosPorLoja.get(l.id) || []).map((d) => ({
          id: d.id,
          plataforma: d.plataforma,
          nome: d.nome,
          conta: d.conta,
          labels: d.labels,
          testEventCode: d.testEventCode,
          idTemplate: d.idTemplate,
          ativo: d.ativo,
          temToken: d.temToken,
          // Mesma regra de `destinoAceita`, sem o evento: no Meta o pixel cobre
          // tudo e o que falta e o token; no Google cada evento e uma action
          // propria, e sem nenhum rotulo nao ha o que enviar.
          completo:
            d.plataforma === "meta"
              ? Boolean(d.conta && d.temToken)
              : Boolean(d.conta) && Object.keys(d.labels).length > 0,
          criadoEm: criadoEm.get(d.id) ?? null,
          contagem: contagens.get(d.id) ?? contagemVazia(),
        })),
        ultimoEnvio: ultimoDaLoja.get(l.id) ?? null,
      };
    }),
  };
}
