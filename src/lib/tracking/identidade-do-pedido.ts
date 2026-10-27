import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type { IdentidadeGuardada } from "@/lib/tracking/purchase";
import { limparUtm } from "@/lib/tracking/origem-pedido";
import { hashDoIp } from "@/lib/tracking/ip-balde";

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
//   3. pedido SEM chave nenhuma (app de COD: o Releasit nao leva carrinho nem
//      checkout) -> o IP da nota -> o visitante do tema que o coletor viu nesse
//      IP nos 30 min antes (ver `visitanteDoIp`);
//   4. a URL de chegada do pedido (feito em purchase.ts, que e puro).
//
// O passo 2 e o que fecha o buraco: o `checkout.token` que o Web Pixel ve e o
// `checkout_token` do pedido sao o mesmo valor, e o clientId e a chave que o
// tema publica junto com os click ids.
// ============================================================================

/** Ate quanto antes do pedido um evento do tema no mesmo IP conta (passo 3). */
export const JANELA_VISITANTE_DO_IP_MS = 30 * 60 * 1000;

/** Relogio da Shopify contra o do banco: o evento pode ter hora um pouco depois do pedido. */
const FOLGA_VISITANTE_DO_IP_MS = 60 * 1000;

/** Uma linha do funil no IP do pedido, com os sinais que o payload dela levou. */
export interface LinhaDoIp {
  visitor_id?: string | null;
  created_at?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  ua_meta?: string | null;
  ttp?: string | null;
  ttclid?: string | null;
  ua_tiktok?: string | null;
}

/**
 * O visitante do tema por tras do IP do pedido, ou null.
 *
 * So quando o IP teve UM visitante na janela. Medido na Stepz (10/2026), com
 * pedidos do checkout que traziam o `_xc_vid`: dos 22 que o IP casou, 20
 * tinham um visitante so, e era sempre o comprador; nos 2 com dois, o mais
 * recente errou um. Dois visitantes no IP (wifi da casa, CGNAT da operadora)
 * = nao da para saber quem comprou, e o clique de outra pessoa creditaria o
 * anuncio errado.
 *
 * Os sinais saem do payload do evento mais recente que os tem: o _fbp e o _fbc
 * que o funil mandou, e o user agent do navegador (o pedido do Releasit nao
 * traz nenhum dos tres).
 */
export function visitanteDoIp(linhas: readonly LinhaDoIp[]): IdentidadeGuardada | null {
  const visitantes = new Set(linhas.map((l) => (l.visitor_id || "").trim()).filter(Boolean));
  if (visitantes.size !== 1) return null;
  const [visitorId] = visitantes;
  const recentes = [...linhas].sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  const primeiro = (campo: keyof LinhaDoIp) => {
    for (const l of recentes) {
      const v = l[campo];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return null;
  };
  return {
    visitorId,
    fbp: primeiro("fbp"),
    fbc: primeiro("fbc"),
    ttp: primeiro("ttp"),
    ttclid: primeiro("ttclid"),
    userAgent: primeiro("ua_meta") || primeiro("ua_tiktok"),
  };
}

type Admin = ReturnType<typeof createAdminClient>;

/**
 * As colunas de tracking_identities. `*` e nao a lista, como em destinos.ts:
 * coluna nova que chegue por migration (o `ttp` da 059) antes ou depois do
 * deploy nao derruba a leitura -- e uma leitura que falha aqui vira 503 no
 * webhook de TODA compra, de toda loja, ate a migration entrar.
 */
const COLUNAS = "*";

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
  ttclid?: string | null;
  ttp?: string | null;
  /** UTMs do ultimo clique e a hora dele (071). */
  utm?: Record<string, unknown> | null;
  utm_em?: string | null;
  updated_at?: string | null;
}

/** A UTM mais recente entre duas identidades (pela hora do clique). */
export function utmMaisRecente(
  a: IdentidadeGuardada | null | undefined,
  b: IdentidadeGuardada | null | undefined
): Pick<IdentidadeGuardada, "utm" | "utmEm"> {
  const ms = (x: IdentidadeGuardada | null | undefined) =>
    x?.utm && x.utmEm && Number.isFinite(Date.parse(x.utmEm)) ? Date.parse(x.utmEm) : -Infinity;
  const vence = ms(a) >= ms(b) ? a : b;
  return ms(vence) === -Infinity ? { utm: null, utmEm: null } : { utm: vence?.utm ?? null, utmEm: vence?.utmEm ?? null };
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
  // A UTM inteira de UMA linha, a do clique mais recente: misturar o
  // utm_campaign de um clique com o utm_content de outro criaria um anuncio
  // que nao existe. A ordem das linhas e por updated_at, que muda a cada
  // evento -- nao serve como hora do clique.
  let comUtm: LinhaIdentidade | null = null;
  for (const l of linhas) {
    const em = l.utm && l.utm_em ? Date.parse(l.utm_em) : Number.NaN;
    if (!Number.isFinite(em)) continue;
    if (!comUtm || em > Date.parse(comUtm.utm_em as string)) comUtm = l;
  }

  return {
    gclid: comGoogle?.gclid || null,
    gbraid: comGoogle?.gbraid || null,
    wbraid: comGoogle?.wbraid || null,
    fbc: comMeta?.fbc || null,
    fbclid: comMeta?.fbclid || null,
    ttclid: primeiro("ttclid"),
    auid: primeiro("auid"),
    fbp: primeiro("fbp"),
    ttp: primeiro("ttp"),
    visitorId: primeiro("visitor_id"),
    clientId: primeiro("shopify_client_id"),
    utm: comUtm ? limparUtm(comUtm.utm) : null,
    utmEm: comUtm?.utm_em ?? null,
  };
}

/**
 * A identidade tem clique do Meta ou do Google?
 *
 * O ttclid NAO conta aqui de proposito: isto decide se a cascata para no
 * visitante ou segue para o checkout, e contar o TikTok mudaria de onde vem o
 * clique do Meta e do Google. O ttclid do visitante e carregado junto no passo
 * do checkout (ver `recuperarIdentidadeDoPedido`).
 */
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

export type OrigemDaIdentidade = "visitante" | "checkout" | "ip" | "nenhuma";

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
  pedido: { checkout_token?: string | null; created_at?: string | null },
  visitorIdDoAtributo: string | null,
  /** O IP do comprador (ipDoPedido): o do checkout ou o da nota do Releasit. */
  ipDoComprador: string | null = null
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
            // O TikTok nao para a cascata no visitante (ver temClique): o
            // clique dele, quando o carrinho trouxe, continua sendo o do
            // carrinho.
            ttclid: doVisitante?.ttclid || doCheckout.ttclid,
            ttp: doVisitante?.ttp || doCheckout.ttp,
            clientId,
            // A origem do pedido: o clique mais recente dos dois lados.
            ...utmMaisRecente(doVisitante, doCheckout),
          },
          origem: "checkout",
        };
      }
    }
  }

  // 3. Pelo IP, so no pedido SEM chave nenhuma: sem visitante no carrinho e
  // sem checkout (o Releasit cria o pedido pela API). Com chave, o IP casaria
  // outra pessoa da mesma rede no lugar de quem o carrinho ja identifica.
  const ipHash = !visitorIdDoAtributo && !token ? hashDoIp(ipDoComprador) : null;
  if (ipHash) {
    const criado = Date.parse(pedido.created_at || "");
    const referencia = Number.isFinite(criado) ? Math.min(criado, Date.now()) : Date.now();
    // So linha do coletor (a compra e a garantia nao tem ip_hash) e do tema ou
    // da ponte: o visitor_id da linha do pixel e o clientId, nao o visitante.
    const { data, error } = await admin
      .from("tracking_events")
      .select(
        "visitor_id, created_at, fbp:payload->user_data->>fbp, fbc:payload->user_data->>fbc, ua_meta:payload->user_data->>client_user_agent, ttp:payload->user->>ttp, ttclid:payload->user->>ttclid, ua_tiktok:payload->user->>user_agent"
      )
      .eq("store_id", storeId)
      .eq("ip_hash", ipHash)
      .is("checkout_token", null)
      .not("visitor_id", "is", null)
      .gte("created_at", new Date(referencia - JANELA_VISITANTE_DO_IP_MS).toISOString())
      .lte("created_at", new Date(referencia + FOLGA_VISITANTE_DO_IP_MS).toISOString())
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(`falha ao ler o visitante do IP: ${error.message}`);
    const doIp = visitanteDoIp((data || []) as LinhaDoIp[]);
    if (doIp?.visitorId) {
      // O clique guardado do visitante (o fbc do cookie, o gclid, a UTM) vence
      // o do evento; o evento completa o que a identidade nao tem.
      const { data: linhas, error: erroIdentidade } = await admin
        .from("tracking_identities")
        .select(COLUNAS)
        .eq("store_id", storeId)
        .eq("visitor_id", doIp.visitorId)
        .limit(1);
      if (erroIdentidade) throw new Error(`falha ao ler identidade do visitante do IP: ${erroIdentidade.message}`);
      const guardada = consolidarIdentidades((linhas || []) as LinhaIdentidade[]);
      return {
        identidade: {
          ...guardada,
          visitorId: doIp.visitorId,
          fbp: guardada?.fbp || doIp.fbp,
          fbc: guardada?.fbc || doIp.fbc,
          ttp: guardada?.ttp || doIp.ttp,
          ttclid: guardada?.ttclid || doIp.ttclid,
          userAgent: doIp.userAgent,
        },
        origem: "ip",
      };
    }
  }

  return { identidade: doVisitante, origem: doVisitante ? "visitante" : "nenhuma" };
}
