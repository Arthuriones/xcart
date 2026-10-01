import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWithConcurrency } from "@/lib/concurrency";
import { shopifyGraphQL } from "@/lib/shopify/client";
import { motivoParaIgnorarPedido } from "@/lib/tracking/filtro-pedido";

// ============================================================================
// O que a tela nao consegue saber olhando so o nosso banco.
//
// Ter pixel e rotulo configurados nao faz evento nenhum acontecer. Faltam duas
// coisas que moram na Shopify, e sao exatamente as que quebram calado:
//
//   - o WEBHOOK orders/create. Sem ele o pedido entra e nada e enfileirado.
//     Nenhuma tela acusa: a fila fica vazia, que e indistinguivel de "ninguem
//     comprou ainda".
//   - o SNIPPET no tema. Sem ele o gclid nunca vira cart attribute, e os
//     eventos de funil nunca saem. A compra ate sai -- sem atribuicao.
//
// Custa 4+ chamadas por loja (pedidos, webhooks, lista de temas, arquivo do
// tema). So roda para loja com rastreamento LIGADO e app instalado, e dentro do
// Suspense da pagina, entao o cabecalho aparece antes.
//
// QUAIS PEDIDOS, NAO QUANTOS
//
// Todo pedido vai para todo destino que aceita a compra -- nao existe "veio de
// fora do anuncio" que justifique um pedido sem compra enviada. Entao o que a
// tela precisa e a LISTA de pedidos que deveriam ter virado compra, para cruzar
// com o que saiu por cada destino e acusar perda parcial (8 de 10), nao so a
// total (0 de 10).
// ============================================================================

export interface DiagnosticoLoja {
  /**
   * Pedidos dos ultimos 7 dias que DEVERIAM ter virado compra: sem teste, PDV,
   * draft e valor zero -- a mesma regra do webhook. Null = nao deu para perguntar.
   */
  pedidos7d: number | null;
  /** Os ids numericos (legacyResourceId) desses pedidos -- o order_id da fila. */
  pedidoIds: string[] | null;
  /** createdAt de cada um, para nao cobrar de um destino pedido anterior a ele. */
  pedidoCriadoEm: Record<string, string> | null;
  temWebhook: boolean | null;
  temSnippet: boolean | null;
  /**
   * A tag do tema carrega `data-xcart-store`?
   *
   * Sem ela o coletor resolve a loja pelo dominio, e o mesmo dominio pode estar
   * cadastrado por mais de uma conta -- ai o evento pode ir para a conta errada.
   * Instalacao antiga fica assim ate o snippet ser reinstalado.
   */
  snippetComId: boolean | null;
  /**
   * A tag do Google de remarketing esta no tema?
   *
   * Remarketing NAO sai do servidor: quem monta o publico e o Google, a partir
   * de um cookie que ele so grava quando o navegador fala com ele. Sem esta tag
   * o rastreamento de conversao funciona e o publico de remarketing fica vazio.
   */
  temRemarketing: boolean | null;
  /** Por que o diagnostico falhou, quando falhou. */
  problema: string | null;
}

const VAZIO: DiagnosticoLoja = {
  pedidos7d: null,
  pedidoIds: null,
  pedidoCriadoEm: null,
  temWebhook: null,
  temSnippet: null,
  snippetComId: null,
  temRemarketing: null,
  problema: null,
};

interface Creds {
  shopDomain: string;
  clientId: string;
  clientSecret: string;
  accessToken?: string | null;
}

/**
 * Pedido mais novo que isto ainda pode estar com o webhook em voo (ou na
 * primeira tentativa de envio). Cobrar dele acenderia o alarme a cada venda.
 */
const CARENCIA_MS = 10 * 60 * 1000;

/** 4 paginas de 250. Acima disso a lista trunca -- e falta deixa de ser acusada, nunca inventada. */
const MAX_PAGINAS = 4;

const QUERY_PEDIDOS = `query PedidosEsperados($busca: String!, $cursor: String) {
  orders(first: 250, query: $busca, after: $cursor, sortKey: CREATED_AT) {
    pageInfo { hasNextPage endCursor }
    nodes {
      legacyResourceId
      test
      sourceName
      createdAt
      totalPriceSet { shopMoney { amount } }
    }
  }
}`;

interface NoPedido {
  legacyResourceId?: string | number | null;
  test?: boolean | null;
  sourceName?: string | null;
  createdAt?: string | null;
  totalPriceSet?: { shopMoney?: { amount?: string | null } | null } | null;
}

function ehNegado(erro: unknown) {
  const texto = erro instanceof Error ? erro.message : String(erro);
  return /ACCESS_DENIED|access denied|read_orders|not approved/i.test(texto);
}

/**
 * Os pedidos que deveriam ter virado compra em cada destino.
 *
 * Sem `financial_status:paid`, ao contrario da tela de Vendas: o webhook
 * orders/create dispara (e envia a compra) para todo pedido criado, pago ou
 * nao. Filtrar aqui por pago faria pedido pendente que SAIU parecer sobra.
 */
async function pedidosEsperados(
  creds: Creds,
  desde: Date
): Promise<
  | { ids: string[]; criadoEm: Record<string, string>; problema: null }
  | { ids: null; criadoEm: null; problema: string }
> {
  const busca = `created_at:>='${desde.toISOString()}'`;
  const limite = Date.now() - CARENCIA_MS;
  const ids: string[] = [];
  const criadoEm: Record<string, string> = {};

  try {
    let cursor: string | null = null;
    for (let pagina = 0; pagina < MAX_PAGINAS; pagina += 1) {
      const dados = (await shopifyGraphQL(creds, QUERY_PEDIDOS, { busca, cursor })) as {
        orders?: {
          pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          nodes?: NoPedido[];
        };
      };

      for (const p of dados?.orders?.nodes || []) {
        const id = p.legacyResourceId != null ? String(p.legacyResourceId) : "";
        if (!id) continue;
        const criado = p.createdAt ? Date.parse(p.createdAt) : NaN;
        if (Number.isFinite(criado) && criado > limite) continue;
        // A MESMA regra do webhook: se divergissem, todo pedido de teste
        // apareceria aqui como "sem compra enviada".
        const motivo = motivoParaIgnorarPedido({
          test: p.test,
          source_name: p.sourceName,
          total_price: p.totalPriceSet?.shopMoney?.amount ?? null,
        });
        if (motivo) continue;
        ids.push(id);
        if (p.createdAt) criadoEm[id] = p.createdAt;
      }

      const info = dados?.orders?.pageInfo;
      if (!info?.hasNextPage || !info.endCursor) break;
      cursor = info.endCursor;
    }
    return { ids, criadoEm, problema: null };
  } catch (e) {
    return { ids: null, criadoEm: null, problema: ehNegado(e) ? "denied" : "failed" };
  }
}

async function checarWebhook(creds: Creds): Promise<boolean | null> {
  try {
    const bruto = await shopifyGraphQL(
      creds,
      `{ webhookSubscriptions(first: 50) { nodes { topic } } }`
    );
    const r = bruto as { webhookSubscriptions?: { nodes?: { topic?: string }[] } };
    const nos = r?.webhookSubscriptions?.nodes || [];
    return nos.some((n) => n.topic === "ORDERS_CREATE");
  } catch {
    return null;
  }
}

async function checarSnippet(
  creds: Creds
): Promise<{ tem: boolean; comId: boolean; remarketing: boolean } | null> {
  try {
    const temas = (await shopifyGraphQL(
      creds,
      `{ themes(first: 20) { nodes { id role } } }`
    )) as { themes?: { nodes?: { id?: string; role?: string }[] } };

    const principal = (temas?.themes?.nodes || []).find((t) => t.role === "MAIN");
    if (!principal?.id) return null;

    const arquivo = (await shopifyGraphQL(
      creds,
      `query($id: ID!, $n: [String!]) {
         theme(id: $id) {
           files(filenames: $n, first: 5) {
             nodes { body { ... on OnlineStoreThemeFileBodyText { content } } }
           }
         }
       }`,
      { id: principal.id, n: ["layout/theme.liquid"] }
    )) as {
      theme?: { files?: { nodes?: { body?: { content?: string } }[] } };
    };

    const corpo = arquivo?.theme?.files?.nodes?.[0]?.body?.content || "";
    if (!corpo) return null;

    return {
      tem: corpo.includes("data-xcart-click"),
      comId: corpo.includes("data-xcart-store"),
      remarketing: corpo.includes("data-xcart-remarketing"),
    };
  } catch {
    return null;
  }
}

/**
 * Diagnostico das lojas com rastreamento ligado.
 *
 * Falha de uma loja nao derruba as outras: cada checagem devolve null em vez de
 * estourar, e a tela mostra "nao deu para verificar" em vez de sumir com o
 * painel inteiro por causa de uma credencial vencida.
 */
export async function diagnosticar(
  storeIds: string[]
): Promise<Map<string, DiagnosticoLoja>> {
  const saida = new Map<string, DiagnosticoLoja>();
  if (storeIds.length === 0) return saida;

  const admin = createAdminClient();
  const { data: lojas } = await admin
    .from("stores")
    .select("id, shop_domain, client_id, client_secret, access_token, uninstalled_at")
    .in("id", storeIds);

  const desde = new Date(Date.now() - 7 * 864e5);

  await runWithConcurrency(lojas || [], 4, async (l) => {
    // App desinstalado: a credencial nao vale mais, e cada checagem so gastaria
    // tempo para voltar "nao deu para verificar". A tela ja acusa a loja pelo
    // `desinstalada` do painel.
    if (l.uninstalled_at) return;

    if (!l.client_id || !l.client_secret) {
      saida.set(l.id, { ...VAZIO, problema: "loja sem credencial do app" });
      return;
    }
    const creds: Creds = {
      shopDomain: l.shop_domain,
      clientId: l.client_id,
      clientSecret: l.client_secret,
      accessToken: l.access_token,
    };

    const [pedidos, webhook, snippet] = await Promise.all([
      pedidosEsperados(creds, desde),
      checarWebhook(creds),
      checarSnippet(creds),
    ]);

    saida.set(l.id, {
      pedidos7d: pedidos.ids ? pedidos.ids.length : null,
      pedidoIds: pedidos.ids,
      pedidoCriadoEm: pedidos.criadoEm,
      temWebhook: webhook,
      temSnippet: snippet ? snippet.tem : null,
      snippetComId: snippet ? snippet.comId : null,
      temRemarketing: snippet ? snippet.remarketing : null,
      problema: pedidos.problema,
    });
  });

  return saida;
}
