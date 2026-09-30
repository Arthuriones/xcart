import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { runWithConcurrency } from "@/lib/concurrency";
import { getOrdersSummary } from "@/lib/shopify/orders";
import { shopifyGraphQL } from "@/lib/shopify/client";

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
// Custa 4 chamadas por loja (pedidos, webhooks, lista de temas, arquivo do
// tema). So roda para loja com rastreamento LIGADO, e dentro do Suspense da
// pagina, entao o cabecalho aparece antes.
// ============================================================================

export interface DiagnosticoLoja {
  /** Pedidos pagos nos ultimos 7 dias. Null = nao deu para perguntar. */
  pedidos7d: number | null;
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
    .select("id, shop_domain, client_id, client_secret, access_token")
    .in("id", storeIds);

  const desde = new Date(Date.now() - 7 * 864e5);

  await runWithConcurrency(lojas || [], 4, async (l) => {
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
      getOrdersSummary(creds, desde).catch(() => null),
      checarWebhook(creds),
      checarSnippet(creds),
    ]);

    saida.set(l.id, {
      pedidos7d: pedidos && !pedidos.problem ? pedidos.orders : null,
      temWebhook: webhook,
      temSnippet: snippet ? snippet.tem : null,
      snippetComId: snippet ? snippet.comId : null,
      temRemarketing: snippet ? snippet.remarketing : null,
      problema: pedidos?.problem ?? null,
    });
  });

  return saida;
}
