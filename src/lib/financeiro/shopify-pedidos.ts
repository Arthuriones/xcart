import "server-only";

import type { createAdminClient } from "@/lib/supabase/admin";
import { shopifyGraphQL } from "@/lib/shopify/client";
import type { FinOrderRow, FinSyncStateRow } from "./tipos";
import {
  mapearPedido,
  maiorAtualizado,
  paginarPedidos,
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
 * Sem customer, email, endereco ou telefone. O custo exato nao foi verificado
 * (a doc so da a tabela por tipo); `$n` comeca em 8 e cai pela metade se a
 * Shopify responder MAX_COST_EXCEEDED -- ver paginarPedidos.
 */
const QUERY_PEDIDOS = `query FinPedidos($busca: String!, $cursor: String, $n: Int!) {
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
          originalUnitPriceSet { shopMoney { amount } }
        }
      }
    }
  }
}`;

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
): Promise<{ pedidos: number; terminou: boolean }> {
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

  const r = await paginarPedidos({
    maxPaginas,
    deveParar: limiteEm ? () => Date.now() > limiteEm : undefined,
    cursorInicial: retomando ? (estado?.retomar_cursor ?? null) : null,
    buscar: async (cursor, n) =>
      (await shopifyGraphQL(creds, QUERY_PEDIDOS, { busca, cursor, n })) as PaginaPedidos,
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
        const { error } = await admin
          .from("fin_orders")
          .upsert(linhas.slice(i, i + LOTE_UPSERT), { onConflict: "store_id,shopify_order_id" });
        if (error) throw new Error(`gravar pedidos: ${error.message}`);
      }
      pedidos += linhas.length;

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

  return { pedidos, terminou: r.terminou };
}
