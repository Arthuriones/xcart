import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { gravarOrigens } from "@/lib/tracking/origem-banco";
import type { LinhaOrigem } from "@/lib/tracking/origem-pedido";
import type { FinOrderRow, FinSyncStateRow } from "./tipos";
import {
  ehColunaAusente,
  mapearOrigem,
  mapearPedido,
  maiorAtualizado,
  paginarPedidos,
  semCamposDeEnvio,
  type PaginaPedidos,
} from "./mapear-pedido";

// ============================================================================
// Sincronizacao de pedidos: Shopify -> fin_orders, por updated_at.
//
// Polling, nao webhook: o webhook orders/create e do rastreamento (caminho
// quente) e nao ve reembolso, cancelamento nem chargeback. Reler por
// updated_at pega tudo isso com uma query so.
//
// Limite conhecido: com read_orders a Shopify so devolve os ultimos 60 dias.
// Reembolso ou chargeback num pedido mais antigo nao aparece aqui, e a foto
// dele fica velha (lucro de meses antigos pode ficar superestimado).
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

export interface LojaParaSync {
  id: string;
  user_id: string;
  shop_domain: string;
  client_id: string;
  client_secret: string;
  access_token: string | null;
}

/**
 * A origem do pedido (071): os atributos (lista fechada, ver mapear-pedido.ts)
 * e a jornada da Shopify. E a jornada que traz a campanha inteira -- o
 * landing_site do webhook corta em 255, e o `landingPageUrl` do GraphQL vem
 * sem a query. `ready` falso: a Shopify ainda monta, e o pedido e relido
 * quando mudar.
 */
const CAMPOS_DE_ORIGEM = `
      customAttributes { key value }
      customerJourneySummary {
        ready
        firstVisit { occurredAt landingPage utmParameters { source medium campaign content term } }
        lastVisit { occurredAt landingPage utmParameters { source medium campaign content term } }
      }`;

/**
 * Sem customer, email, endereco ou telefone. Custo medido: 83 pontos com 8
 * pedidos; `$n` comeca em 8 e cai pela metade se a Shopify responder
 * MAX_COST_EXCEEDED -- ver paginarPedidos.
 *
 * `tags` e `fulfillments` servem ao contra entrega (068): das tags sai so o
 * sim/nao de COD e de recusa (elas nao sao gravadas); dos envios, a situacao
 * da entrega e as datas, sem rastreio nem endereco.
 */
function queryPedidos(comOrigem: boolean): string {
  return `query FinPedidos($busca: String!, $cursor: String, $n: Int!) {
  shop { ianaTimezone currencyCode }
  orders(first: $n, after: $cursor, sortKey: UPDATED_AT, query: $busca) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id name createdAt processedAt updatedAt cancelledAt test sourceName
      displayFinancialStatus displayFulfillmentStatus
      currencyCode presentmentCurrencyCode paymentGatewayNames
      totalPriceSet { shopMoney { amount } }
      currentTotalPriceSet { shopMoney { amount } presentmentMoney { amount } }
      currentTotalTaxSet { shopMoney { amount } }
      currentTotalDutiesSet { shopMoney { amount } }
      totalTipReceivedSet { shopMoney { amount } }
      totalDiscountsSet { shopMoney { amount } }
      totalShippingPriceSet { shopMoney { amount } }
      totalReceivedSet { shopMoney { amount } }
      totalRefundedSet { shopMoney { amount } }
      netPaymentSet { shopMoney { amount } }
      lineItems(first: 25) {
        nodes {
          sku quantity currentQuantity unfulfilledQuantity
          variant { sku }
          originalUnitPriceSet { shopMoney { amount } }
        }
      }
      returnStatus tags
      fulfillments(first: 5) { status displayStatus createdAt deliveredAt }${comOrigem ? CAMPOS_DE_ORIGEM : ""}
    }
  }
}`;
}

/**
 * A loja recusou os campos da origem (app sem acesso a jornada do cliente):
 * o sync financeiro nao pode parar por isso. Erro de read_orders tambem casa
 * aqui -- a pagina sem a origem falha de novo e o erro segue o caminho normal.
 */
function recusouCamposDeOrigem(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e ?? "");
  return /customerJourneySummary|customAttributes|ACCESS_DENIED|access denied|not approved/i.test(m);
}

/** Carga inicial: o mesmo teto do read_orders. */
const DIAS_CARGA_INICIAL = 60;
/** Folga no cursor: pedido gravado no mesmo segundo do ultimo lido nao escapa. */
const FOLGA_CURSOR_MS = 2 * 60 * 1000;
const LOTE_UPSERT = 200;

export const MAX_PAGINAS_PADRAO = 25;

function inicioDaBusca(estado: FinSyncStateRow | null, agora: Date): string {
  const cursorMs = estado?.cursor_atualizado ? Date.parse(estado.cursor_atualizado) : Number.NaN;
  if (Number.isFinite(cursorMs)) return new Date(cursorMs - FOLGA_CURSOR_MS).toISOString();
  return new Date(agora.getTime() - DIAS_CARGA_INICIAL * 86400000).toISOString();
}

export async function sincronizarLoja(
  admin: Admin,
  loja: LojaParaSync,
  estado: FinSyncStateRow | null,
  maxPaginas = MAX_PAGINAS_PADRAO,
  /** Epoch ms: depois disso, nao pede pagina nova (orcamento da funcao). */
  limiteEm?: number
): Promise<{
  pedidos: number;
  terminou: boolean;
  /** A rodada inteira leu e gravou a origem do pedido (071). */
  comOrigem: boolean;
}> {
  const creds = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };
  // Retomada: uma acao em massa que atualiza mais pedidos do que cabem numa
  // rodada dentro da folga de 2 min prenderia o cursor -- recomecando em
  // cursor - folga, as mesmas primeiras paginas voltariam sempre. A rodada que
  // para no meio guarda busca + endCursor e a seguinte continua dali.
  // `in`: sem a migration 053 a coluna nao vem no select("*") e grava-la
  // derrubaria o sync; ai fica o comportamento antigo.
  const temRetomada = estado != null && "retomar_cursor" in estado;
  const retomando = Boolean(temRetomada && estado?.retomar_busca && estado?.retomar_cursor);
  // Aspas simples: o valor tem ":" e a busca da Shopify quebraria nele.
  const busca =
    retomando && estado?.retomar_busca
      ? estado.retomar_busca
      : `updated_at:>='${inicioDaBusca(estado, new Date())}'`;

  let cursorGravado = estado?.cursor_atualizado ?? null;
  let pedidos = 0;
  // Sem a 068, as colunas de envio nao existem: a primeira gravacao recusada
  // por isso marca e o resto da rodada grava sem elas (o sync nao para).
  let semColunasDeEnvio = false;
  // A origem (071) e de carona e nunca para o sync: loja que recusa a jornada
  // segue sem ela nesta rodada; sem a tabela, nao tenta gravar de novo.
  let semOrigemNaQuery = false;
  let semTabelaOrigem = false;

  const r = await paginarPedidos({
    maxPaginas,
    deveParar: limiteEm ? () => Date.now() > limiteEm : undefined,
    cursorInicial: retomando ? (estado?.retomar_cursor ?? null) : null,
    buscar: async (cursor, n) => {
      if (!semOrigemNaQuery) {
        try {
          return (await shopifyGraphQL(creds, queryPedidos(true), { busca, cursor, n })) as PaginaPedidos;
        } catch (e) {
          if (!recusouCamposDeOrigem(e)) throw e;
          semOrigemNaQuery = true;
          console.warn("[fin/pedidos] origem do pedido fora da query nesta rodada", loja.shop_domain);
        }
      }
      return (await shopifyGraphQL(creds, queryPedidos(false), { busca, cursor, n })) as PaginaPedidos;
    },
    aoReceber: async (pagina) => {
      const fuso = pagina.shop?.ianaTimezone || null;
      const moeda = pagina.shop?.currencyCode || null;
      const nos = pagina.orders?.nodes ?? [];
      const agoraIso = new Date().toISOString();

      const linhas: FinOrderRow[] = nos.map((no) => ({
        ...mapearPedido(no, { storeId: loja.id, userId: loja.user_id, fuso }),
        // O default now() so vale no INSERT; regravar tem que mexer aqui.
        sincronizado_em: agoraIso,
      }));

      for (let i = 0; i < linhas.length; i += LOTE_UPSERT) {
        const lote = linhas.slice(i, i + LOTE_UPSERT);
        const gravar = (l: FinOrderRow[]) =>
          admin.from("fin_orders").upsert(l, { onConflict: "store_id,shopify_order_id" });
        let { error } = await gravar(semColunasDeEnvio ? lote.map(semCamposDeEnvio) : lote);
        if (error && !semColunasDeEnvio && ehColunaAusente(error)) {
          semColunasDeEnvio = true;
          ({ error } = await gravar(lote.map(semCamposDeEnvio)));
        }
        if (error) throw new Error(`gravar pedidos: ${error.message}`);
      }
      pedidos += linhas.length;

      // A origem de cada pedido, mesclada com a que o webhook gravou. Falha
      // aqui vai para o log: a foto financeira ja esta gravada.
      if (!semOrigemNaQuery && !semTabelaOrigem) {
        const origens = nos
          .map((no) => mapearOrigem(no, { storeId: loja.id, userId: loja.user_id }))
          .filter((o): o is LinhaOrigem => o !== null);
        try {
          if ((await gravarOrigens(admin, origens)).semTabela) semTabelaOrigem = true;
        } catch (e) {
          console.error("[fin/pedidos] origem dos pedidos", loja.shop_domain, e instanceof Error ? e.message : e);
        }
      }

      // Cursor por pagina e seguro porque a ordem e UPDATED_AT crescente: se a
      // proxima pagina falhar, a proxima rodada continua daqui sem buraco.
      cursorGravado = maiorAtualizado(cursorGravado, nos);
      const info = pagina.orders?.pageInfo;
      const retomar = !temRetomada
        ? {}
        : info?.hasNextPage && info.endCursor
          ? { retomar_busca: busca, retomar_cursor: info.endCursor }
          : { retomar_busca: null, retomar_cursor: null };
      const { error } = await admin
        .from("fin_sync_state")
        .update({ fuso, moeda, cursor_atualizado: cursorGravado, ...retomar, updated_at: agoraIso })
        .eq("store_id", loja.id);
      if (error) throw new Error(`gravar cursor: ${error.message}`);
    },
  });

  return { pedidos, terminou: r.terminou, comOrigem: !semOrigemNaQuery && !semTabelaOrigem };
}

// ============================================================================
// Recuperacao da origem dos ultimos 60 dias (071), uma vez por loja.
//
// O sync acima so rele pedido que MUDOU: o pedido de 3 semanas atras que nao
// mexeu mais nunca ganharia a origem. Esta passada le so id, atributos e
// jornada dos pedidos CRIADOS nos 60 dias (o teto do read_orders), do mais
// novo para o mais velho -- medido: ~3 pontos por pedido --, e grava a origem
// mesclada. Nao mexe em fin_orders nem no cursor do sync.
//
// Anda por rodadas: `origem_backfill_ate` guarda o createdAt do pedido mais
// velho ja lido, e a rodada seguinte continua dali. Terminou: carimba
// `origem_backfill_em` e nao roda mais. Sem as colunas (071 por aplicar), nao
// roda.
//
// A identidade do visitante nao entra: a coluna `utm` e nova, nao tem o
// passado.
// ============================================================================

const QUERY_ORIGENS = `query FinOrigens($busca: String!, $cursor: String, $n: Int!) {
  orders(first: $n, after: $cursor, sortKey: CREATED_AT, reverse: true, query: $busca) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id createdAt test sourceName
      totalPriceSet { shopMoney { amount } }${CAMPOS_DE_ORIGEM}
    }
  }
}`;

const ORIGENS_POR_PAGINA = 50;
const MAX_PAGINAS_ORIGEM = 20;

/** Ainda falta recuperar a origem desta loja (e a 071 esta aplicada)? */
export function faltaRecuperarOrigens(estado: FinSyncStateRow | null): boolean {
  return Boolean(estado && "origem_backfill_em" in estado && !estado.origem_backfill_em);
}

export async function recuperarOrigens(
  admin: Admin,
  loja: LojaParaSync,
  estado: FinSyncStateRow | null,
  limiteEm?: number
): Promise<{ pedidos: number; terminou: boolean } | null> {
  if (!faltaRecuperarOrigens(estado)) return null;
  const creds = {
    shopDomain: loja.shop_domain,
    clientId: loja.client_id,
    clientSecret: loja.client_secret,
    accessToken: loja.access_token,
  };
  const desde = new Date(Date.now() - DIAS_CARGA_INICIAL * 86400000).toISOString();
  // `<=`: pedidos do mesmo segundo da fronteira sao relidos, nao pulados.
  const ate = estado?.origem_backfill_ate ?? null;
  const busca = `created_at:>='${desde}'${ate ? ` AND created_at:<='${new Date(ate).toISOString()}'` : ""}`;

  const encerrar = async () => {
    const { error } = await admin
      .from("fin_sync_state")
      .update({ origem_backfill_em: new Date().toISOString() })
      .eq("store_id", loja.id);
    if (error) throw new Error(`fechar recuperacao da origem: ${error.message}`);
  };

  let pedidos = 0;
  let semTabela = false;
  let r: { terminou: boolean };
  try {
    r = await paginarPedidos({
      maxPaginas: MAX_PAGINAS_ORIGEM,
      nInicial: ORIGENS_POR_PAGINA,
      deveParar: () => semTabela || (limiteEm ? Date.now() > limiteEm : false),
      buscar: async (cursor, n) =>
        (await shopifyGraphQL(creds, QUERY_ORIGENS, { busca, cursor, n })) as PaginaPedidos,
      aoReceber: async (pagina) => {
        const nos = pagina.orders?.nodes ?? [];
        const origens = nos
          .map((no) => mapearOrigem(no, { storeId: loja.id, userId: loja.user_id }))
          .filter((o): o is LinhaOrigem => o !== null);
        if ((await gravarOrigens(admin, origens)).semTabela) {
          semTabela = true;
          return;
        }
        pedidos += nos.length;
        const maisVelho = nos.reduce<string | null>(
          (menor, no) => (menor === null || Date.parse(no.createdAt) < Date.parse(menor) ? no.createdAt : menor),
          null
        );
        if (maisVelho) {
          const { error } = await admin
            .from("fin_sync_state")
            .update({ origem_backfill_ate: maisVelho })
            .eq("store_id", loja.id);
          if (error) throw new Error(`gravar progresso da origem: ${error.message}`);
        }
      },
    });
  } catch (e) {
    // A loja nao deixa ler a jornada (o read_orders o sync acima ja provou):
    // nao ha o que recuperar, e tentar a cada 15 min so faria barulho.
    if (!recusouCamposDeOrigem(e)) throw e;
    console.warn("[fin/pedidos] recuperacao da origem sem acesso a jornada", loja.shop_domain);
    await encerrar();
    return null;
  }
  if (semTabela) return null;
  if (r.terminou) await encerrar();
  return { pedidos, terminou: r.terminou };
}
