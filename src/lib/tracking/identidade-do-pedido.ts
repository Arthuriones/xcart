import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IdentidadeGuardada } from "@/lib/tracking/purchase";

// ============================================================================
// De onde vem o clique quando o pedido nao traz.
//
// O caminho normal e o cart attribute: o snippet do tema grava gclid, fbc e o
// id do visitante no carrinho, e o pedido herda. Mas ha compra que nao passa
// pelo carrinho do tema -- "Comprar agora", Shop Pay/Apple Pay na pagina de
// produto, carrinho recriado -- e ai o pedido chega sem nada. Medido: nas
// compras reais, NENHUMA trazia `_xc_vid`, e duas de tres sairam para o Google
// sem click id.
//
// A cascata, do mais especifico para o mais generico:
//
//   1. o visitante do cart attribute -> tracking_identities por visitor_id;
//   2. o checkout do pedido -> tracking_checkouts (gravada pelo Web Pixel) ->
//      clientId da Shopify -> tracking_identities por shopify_client_id;
//   3. a URL de chegada do pedido (feito em purchase.ts, que e puro).
//
// O passo 2 e o que fecha o buraco: o `checkout.token` que o Web Pixel ve e o
// `checkout_token` do pedido sao o mesmo valor, e o clientId e a chave que o
// tema publica junto com os click ids.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

/** As colunas de tracking_identities que viram identidade. */
const COLUNAS =
  "visitor_id, shopify_client_id, gclid, gbraid, wbraid, auid, fbp, fbc, fbclid, updated_at";

export interface LinhaIdentidade {
  visitor_id?: string | null;
  shopify_client_id?: string | null;
  gclid?: string | null;
  gbraid?: string | null;
  wbraid?: string | null;
  auid?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  fbclid?: string | null;
  updated_at?: string | null;
}

/**
 * Varias linhas do mesmo clientId -> uma identidade.
 *
 * Por que pode haver varias: a unicidade da tabela e por visitor_id, nao por
 * clientId. No Safari o ITP apaga o nosso cookie e gera um visitor_id novo,
 * enquanto a Shopify mantem o clientId -- e o mesmo comprador passa a ter duas
 * linhas. A versao anterior lia com `maybeSingle()`, que com duas linhas
 * devolve ERRO e data nulo: o evento do checkout saia sem gclid e sem fbc.
 *
 * As linhas chegam da mais recente para a mais antiga. O clique do Google vem
 * inteiro de UMA linha (gclid, gbraid e wbraid descrevem o mesmo clique e nao
 * se misturam); o resto e o primeiro valor nao nulo.
 */
export function consolidarIdentidades(
  linhas: LinhaIdentidade[]
): IdentidadeGuardada | null {
  if (!linhas.length) return null;

  const primeiro = <K extends keyof LinhaIdentidade>(campo: K) => {
    for (const l of linhas) {
      const v = l[campo];
      if (typeof v === "string" && v.trim()) return v;
    }
    return null;
  };

  const comGoogle = linhas.find((l) => l.gclid || l.gbraid || l.wbraid);
  const comMeta = linhas.find((l) => l.fbc || l.fbclid);

  return {
    gclid: comGoogle?.gclid || null,
    gbraid: comGoogle?.gbraid || null,
    wbraid: comGoogle?.wbraid || null,
    fbc: comMeta?.fbc || null,
    fbclid: comMeta?.fbclid || null,
    auid: primeiro("auid"),
    fbp: primeiro("fbp"),
    visitorId: primeiro("visitor_id"),
    clientId: primeiro("shopify_client_id"),
  };
}

/** A identidade tem algum clique, de qualquer plataforma? */
export function temClique(id: IdentidadeGuardada | null | undefined): boolean {
  return Boolean(id && (id.gclid || id.gbraid || id.wbraid || id.fbc || id.fbclid));
}

/**
 * O clientId zerado que a Shopify usa quando nao ha consentimento.
 *
 * Tratado como real, ele vira um external_id IGUAL para pessoas diferentes, e
 * uma linha de identidade com ele credita o clique de um visitante a outro.
 */
export function ehClientIdSentinela(id: string | null | undefined): boolean {
  return /^0{8}-0{4}-0{4}-[0-9a-f]0{3}-0{12}$/i.test((id || "").trim());
}

/** Identidade por clientId, consolidando as linhas que existirem. */
export async function identidadePorCliente(
  admin: Admin,
  storeId: string,
  clientId: string
): Promise<IdentidadeGuardada | null> {
  if (!clientId || ehClientIdSentinela(clientId)) return null;
  const { data, error } = await admin
    .from("tracking_identities")
    .select(COLUNAS)
    .eq("store_id", storeId)
    .eq("shopify_client_id", clientId)
    .order("updated_at", { ascending: false })
    .limit(5);
  if (error) throw new Error(`falha ao ler identidade por clientId: ${error.message}`);
  return consolidarIdentidades((data || []) as LinhaIdentidade[]);
}

export type OrigemDaIdentidade = "visitante" | "checkout" | "nenhuma";

/**
 * A identidade guardada para o comprador deste pedido.
 *
 * Erro de banco LANCA: o webhook transforma em 503 e a Shopify reentrega. Uma
 * identidade "nao encontrada" por soluco do Supabase mandaria a compra sem
 * clique -- e o oid do Google e o event_id do Meta impediriam corrigir depois.
 */
export async function recuperarIdentidadeDoPedido(
  admin: Admin,
  storeId: string,
  pedido: { checkout_token?: string | null },
  visitorIdDoAtributo: string | null
): Promise<{ identidade: IdentidadeGuardada | null; origem: OrigemDaIdentidade }> {
  // 1. Pelo visitante que veio no carrinho.
  let doVisitante: IdentidadeGuardada | null = null;
  if (visitorIdDoAtributo) {
    const { data, error } = await admin
      .from("tracking_identities")
      .select(COLUNAS)
      .eq("store_id", storeId)
      .eq("visitor_id", visitorIdDoAtributo)
      .limit(1);
    if (error) throw new Error(`falha ao ler identidade do visitante: ${error.message}`);
    doVisitante = consolidarIdentidades((data || []) as LinhaIdentidade[]);
    if (temClique(doVisitante)) return { identidade: doVisitante, origem: "visitante" };
  }

  // 2. Pelo checkout. So entra quando o passo 1 nao trouxe clique: e o caso do
  // "Comprar agora", em que o carrinho do tema nunca existiu.
  const token = (pedido.checkout_token || "").trim();
  if (token) {
    const { data: ponte, error } = await admin
      .from("tracking_checkouts")
      .select("shopify_client_id")
      .eq("store_id", storeId)
      .eq("checkout_token", token)
      .maybeSingle();
    if (error) throw new Error(`falha ao ler a ponte do checkout: ${error.message}`);

    let clientId = ponte?.shopify_client_id || null;

    // Reserva para checkout de antes da tabela existir: a linha de evento do
    // pixel tambem carrega o token, e o visitor_id dela e o clientId.
    if (!clientId) {
      const { data: linha, error: erroLinha } = await admin
        .from("tracking_events")
        .select("visitor_id")
        .eq("store_id", storeId)
        .eq("checkout_token", token)
        .not("visitor_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1);
      if (erroLinha) {
        throw new Error(`falha ao ler evento do checkout: ${erroLinha.message}`);
      }
      clientId = linha?.[0]?.visitor_id || null;
    }

    if (clientId) {
      const doCheckout = await identidadePorCliente(admin, storeId, clientId);
      if (doCheckout) {
        return {
          // O visitante do carrinho, se houve, continua sendo o external_id
          // certo: e o que o funil do tema mandou.
          identidade: {
            ...doCheckout,
            visitorId: doVisitante?.visitorId || doCheckout.visitorId,
            fbp: doVisitante?.fbp || doCheckout.fbp,
            clientId,
          },
          origem: "checkout",
        };
      }
    }
  }

  return { identidade: doVisitante, origem: doVisitante ? "visitante" : "nenhuma" };
}
