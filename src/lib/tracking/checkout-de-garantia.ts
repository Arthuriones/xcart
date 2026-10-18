import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import {
  JANELA_CHECKOUT_EXPRESSO_MS,
  PREFIXO_CHECKOUT_EXPRESSO,
  PREFIXO_RESERVA_DO_CHECKOUT,
  PREFIXOS_DE_RESERVA,
} from "@/lib/tracking/eventos";
import { hashDoIp } from "@/lib/tracking/ip-balde";
import { caminhoEhEndpoint, type PedidoShopify } from "@/lib/tracking/purchase";

// ============================================================================
// O comprador deste pedido já teve InitiateCheckout? (IC de garantia)
//
// O webhook manda um IC junto da compra só para quem ainda não teve um -- ver
// montarCheckoutDeGarantia em purchase.ts. "Teve" é uma linha `begin_checkout`
// do mesmo comprador, no mesmo destino, nas 24 h antes do pedido, que saiu
// (`enviado` COM `sent_at`) ou vai sair (`pendente`):
//
//   - o IC do Web Pixel nem precisa de consulta: o id da garantia é o dele
//     (`begin_checkout_ck_<token>`), e o índice único da fila responde
//     `duplicado`, em qualquer ordem de chegada;
//   - o do tema (clique comum, sem pixel cobrindo), o expresso
//     (`begin_checkout_xp_*`) e a reserva do clique comum com o pixel cobrindo
//     (`begin_checkout_rs_*`) têm visitor_id = o `_xc_vid` do tema; o do pixel
//     de OUTRO checkout do mesmo comprador, visitor_id = o clientId;
//   - a reserva PENDENTE (expresso ou clique comum) conta como "teve": o cron
//     a manda minutos depois, com o event_time do clique. Mandar a garantia
//     ao lado dela correria com o drain, que não reserva a linha antes de
//     mandar -- e saíriam dois. A do clique comum, casada por visitante,
//     clientId ou IP, a compra ENRIQUECE: a mesma linha, o mesmo event_id, o
//     payload da garantia (ver `ReservaDoComprador`).
//
// Fica de fora o cancelado (`enviado` sem `sent_at`: foi trocado por outro,
// que a busca acha) e o `falhou` (não chegou).
//
// Uma consulta `.eq` por chave, como no coletor: o `_xc_vid` vem de atributo de
// carrinho, que o comprador escreve -- montá-lo num filtro `or`/`in` seria
// deixar o cliente escrever filtro. Sem chave nenhuma (Shop Pay da página de
// produto: sem carrinho, sem atributo, sem pixel), o IP do pedido contra o do
// coletor, só na janela do expresso.
//
// A RESERVA é conferida à parte, em toda compra: é o que corre com a
// garantia (o cron manda o pendente minutos depois), e a chave do pedido nem
// sempre é a dela. Uma leitura dos `begin_checkout_xp_*` e outra dos
// `begin_checkout_rs_*` da loja na janela do expresso, casados aqui no código
// -- nada do comprador vai para o filtro -- por visitante, clientId
// (`shopify_client_id`, 057), IP OU user agent. O IP sozinho não basta: com
// IPv6 o pedido chega por um endereço e o coletor viu outro (#1016 e #1017 da
// Softnook). E SEM CHAVE, qualquer EXPRESSO pendente da loja barra a garantia:
// pode ser o dele, e não há como saber. A reserva do clique comum não: nasce
// no carrinho, que leva o `_xc_vid` ao pedido.
//
// Erro de banco NÃO lança: sem saber, não manda a garantia -- falta um IC, não
// sai um a mais -- e a compra segue como sempre.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

/** Até quanto antes do pedido um begin_checkout do mesmo comprador conta. */
export const JANELA_CHECKOUT_DE_GARANTIA_MS = 24 * 60 * 60 * 1000;

/** Como o coletor corta o visitorId do corpo (o do pixel e o clientId): a chave tem que bater. */
const MAX_VISITANTE = 64;

/**
 * Quantos expressos da loja a conferência lê na janela. Página cheia = pode ter
 * ficado o do comprador de fora, e então nenhuma garantia sai.
 */
const MAX_EXPRESSOS = 200;

interface LinhaDoExpresso {
  id?: string | null;
  event_id?: string | null;
  created_at?: string | null;
  /** O event_time do payload (o do clique), em segundos -- texto, pelo `->>`. */
  event_time?: string | number | null;
  destination_id?: string | null;
  status?: string | null;
  sent_at?: string | null;
  visitor_id?: string | null;
  shopify_client_id?: string | null;
  ip_hash?: string | null;
  /** O user agent do evento: `user_data.client_user_agent` no Meta, `user.user_agent` no TikTok. */
  ua_meta?: string | null;
  ua_tiktok?: string | null;
}

/**
 * Por qual sinal a linha casa com o comprador: 2 = visitante ou clientId, 1 =
 * IP, 0.5 = so o user agent, 0 = nenhum.
 */
function forcaDoCasamento(
  linha: LinhaDoExpresso,
  comprador: { chaves: string[]; ipHash: string | null; userAgent: string }
): number {
  const chaves = new Set(comprador.chaves);
  const ua = (v: string | null | undefined) => (v || "").trim();
  if (
    (Boolean(linha.visitor_id) && chaves.has(linha.visitor_id as string)) ||
    (Boolean(linha.shopify_client_id) && chaves.has(linha.shopify_client_id as string))
  ) {
    return 2;
  }
  if (Boolean(comprador.ipHash) && linha.ip_hash === comprador.ipHash) return 1;
  if (
    Boolean(comprador.userAgent) &&
    (ua(linha.ua_meta) === comprador.userAgent || ua(linha.ua_tiktok) === comprador.userAgent)
  ) {
    return 0.5;
  }
  return 0;
}

/**
 * Esta reserva pode ser do comprador do pedido? Por qualquer sinal: faltar um
 * IC custa menos que sair dois.
 *
 * Sem chave do comprador, todo EXPRESSO pendente pode (`semChaveBarra`): o
 * Shop Pay da pagina do produto nao deixa carrinho nem atributo. A reserva do
 * clique comum nao: ela nasce no carrinho, que leva o `_xc_vid` ao pedido --
 * pedido sem chave (app de COD, pedido por API) quase nunca e o dono dela, e
 * nao tem outro IC.
 */
export function expressoDoComprador(
  linha: LinhaDoExpresso,
  comprador: { chaves: string[]; ipHash: string | null; userAgent: string },
  semChaveBarra = true
): boolean {
  if (!checkoutConta(linha)) return false;
  if (semChaveBarra && !comprador.chaves.length && linha.status === "pendente") return true;
  return forcaDoCasamento(linha, comprador) > 0;
}

export interface CheckoutsDoComprador {
  /**
   * Os destinos (destination_id) em que o comprador já tem IC. null = não deu
   * para saber, e então nenhuma garantia sai.
   */
  jaIniciados: Set<string> | null;
  /** URLs dos eventos dele, da mais recente para a mais antiga. */
  paginas: string[];
  /**
   * A reserva do clique comum (`begin_checkout_rs_*`) deste comprador ainda
   * PENDENTE, por destino: a compra a ENRIQUECE em vez de ceder a ela (ver
   * `ReservaDoComprador`). So por visitante, clientId ou IP -- o user agent
   * sozinho e de muita gente, e trocaria o IC de outro comprador.
   */
  reservas: Map<string, ReservaDoComprador>;
}

/**
 * A linha que o webhook troca pelo IC rico da compra. O Shop Pay de comprador
 * reconhecido fecha em segundos, antes de a reserva sair (2 min + o cron): sem
 * isto, o que ia ao Meta era o IC pobre do clique (sem e-mail, valor e itens)
 * no lugar da garantia completa. A MESMA linha e o MESMO event_id: nao ha como
 * sair dois. Ja saiu, o UPDATE (so sobre `pendente`) nao casa e nada muda.
 */
export interface ReservaDoComprador {
  id: string;
  eventId: string;
  /** O event_time do clique, em segundos; null = o da garantia. */
  eventTime: number | null;
}

/** A linha da fila ainda conta como "o IC saiu ou vai sair"? */
export function checkoutConta(linha: { status?: string | null; sent_at?: string | null }): boolean {
  return linha.status === "pendente" || (linha.status === "enviado" && Boolean(linha.sent_at));
}

export async function checkoutsDoComprador(
  admin: Admin,
  storeId: string,
  pedido: PedidoShopify,
  chaves: {
    /** Os visitantes do tema: o `_xc_vid` do carrinho e o da identidade. */
    visitantes: (string | null | undefined)[];
    /** O clientId da Shopify: o visitor_id das linhas do Web Pixel. */
    clientId?: string | null;
  }
): Promise<CheckoutsDoComprador> {
  const criado = Date.parse(pedido.created_at || "");
  const referencia = Number.isFinite(criado) ? Math.min(criado, Date.now()) : Date.now();
  const desde = new Date(referencia - JANELA_CHECKOUT_DE_GARANTIA_MS).toISOString();

  const visitantes = [
    ...new Set(
      chaves.visitantes
        .map((v) => (v || "").trim().slice(0, MAX_VISITANTE))
        .filter(Boolean)
    ),
  ];
  const cliente = (chaves.clientId || "").trim().slice(0, MAX_VISITANTE);
  const comprador = [...new Set([...visitantes, cliente].filter(Boolean))];
  const ipHash = hashDoIp(pedido.client_details?.browser_ip || pedido.browser_ip);
  const userAgent = (pedido.client_details?.user_agent || "").trim();
  const desdeExpresso = new Date(referencia - JANELA_CHECKOUT_EXPRESSO_MS).toISOString();

  const ics = (coluna: "visitor_id" | "ip_hash", valor: string, aPartirDe: string) =>
    admin
      .from("tracking_events")
      .select("destination_id, status, sent_at")
      .eq("store_id", storeId)
      .eq(coluna, valor)
      .eq("event_name", "begin_checkout")
      .in("status", ["pendente", "enviado"])
      .gte("created_at", aPartirDe)
      .limit(50);

  // A página só quando a chegada do pedido é endpoint: é o caso de exceção, e
  // não se paga uma leitura a mais em toda compra.
  const precisaDePagina = caminhoEhEndpoint(pedido.landing_site) && visitantes.length > 0;

  try {
    const [porComprador, porIp, reservas, pagina] = await Promise.all([
      Promise.all(comprador.map((c) => ics("visitor_id", c, desde))),
      // Sem chave, o IP acha também o clique comum do tema e o IC do pixel.
      !comprador.length && ipHash ? ics("ip_hash", ipHash, desdeExpresso) : null,
      // Uma leitura por prefixo (o expresso e a reserva do clique comum), cada
      // uma com o seu teto: o PostgREST não junta dois LIKE sem `or`.
      //
      // Sem as canceladas (`enviado` sem `sent_at`) já no filtro, que é fixo:
      // todo checkout normal em loja com pixel deixa uma reserva cancelada por
      // destino, e elas enchiam o teto -- e com o teto cheio nenhuma garantia
      // da loja sai.
      Promise.all(
        PREFIXOS_DE_RESERVA.map((prefixo) =>
          admin
            .from("tracking_events")
            .select(
              "id, event_id, created_at, destination_id, status, sent_at, visitor_id, shopify_client_id, ip_hash, ua_meta:payload->user_data->>client_user_agent, ua_tiktok:payload->user->>user_agent, event_time:payload->>event_time"
            )
            .eq("store_id", storeId)
            .eq("event_name", "begin_checkout")
            .like("event_id", `${prefixo}%`)
            .or("status.eq.pendente,and(status.eq.enviado,sent_at.not.is.null)")
            .gte("created_at", desdeExpresso)
            .limit(MAX_EXPRESSOS)
        )
      ),
      precisaDePagina
        ? admin
            .from("tracking_events")
            .select("created_at, url:payload->>event_source_url, pagina:payload->page->>url")
            .eq("store_id", storeId)
            .eq("visitor_id", visitantes[0])
            .gte("created_at", desde)
            .order("created_at", { ascending: false })
            .limit(10)
        : null,
    ]);

    let jaIniciados: Set<string> | null = new Set();
    for (const r of [...porComprador, porIp]) {
      if (!r) continue;
      if (r.error) {
        console.error("[tracking/garantia] falha ao conferir o IC do comprador", r.error.message);
        jaIniciados = null;
        break;
      }
      for (const l of (r.data || []) as { destination_id?: string | null; status?: string; sent_at?: string | null }[]) {
        if (l.destination_id && checkoutConta(l)) jaIniciados.add(l.destination_id);
      }
    }

    const doPedido = { chaves: comprador, ipHash, userAgent };
    const paraEnriquecer = new Map<string, { reserva: ReservaDoComprador; forca: number; criada: string }>();
    for (const [i, leitura] of reservas.entries()) {
      const prefixo = PREFIXOS_DE_RESERVA[i];
      if (leitura.error) {
        console.error("[tracking/garantia] falha ao conferir a reserva", leitura.error.message);
        jaIniciados = null;
        continue;
      }
      const linhasDaReserva = (leitura.data || []) as LinhaDoExpresso[];
      if (linhasDaReserva.length >= MAX_EXPRESSOS) {
        console.error("[tracking/garantia] reservas demais na janela para conferir o comprador");
        jaIniciados = null;
      } else if (jaIniciados) {
        // Sem chave do comprador, so o expresso pendente de qualquer um barra.
        const semChaveBarra = prefixo === PREFIXO_CHECKOUT_EXPRESSO;
        for (const l of linhasDaReserva) {
          if (l.destination_id && expressoDoComprador(l, doPedido, semChaveBarra)) jaIniciados.add(l.destination_id);
        }
      }
      // A reserva do clique comum, PENDENTE, do comprador: a compra a enriquece.
      // Por destino, a de sinal mais forte; empate, a mais recente.
      if (prefixo !== PREFIXO_RESERVA_DO_CHECKOUT) continue;
      for (const l of linhasDaReserva) {
        if (l.status !== "pendente" || !l.destination_id || !l.id || !l.event_id) continue;
        const forca = forcaDoCasamento(l, doPedido);
        if (forca < 1) continue;
        const criada = String(l.created_at ?? "");
        const atual = paraEnriquecer.get(l.destination_id);
        if (atual && (atual.forca > forca || (atual.forca === forca && atual.criada >= criada))) continue;
        const hora = Number(l.event_time);
        paraEnriquecer.set(l.destination_id, {
          reserva: { id: l.id, eventId: l.event_id, eventTime: Number.isFinite(hora) && hora > 0 ? Math.floor(hora) : null },
          forca,
          criada,
        });
      }
    }
    const reservasDoComprador = new Map([...paraEnriquecer].map(([destino, r]) => [destino, r.reserva]));

    if (pagina?.error) {
      console.error("[tracking/garantia] falha ao ler a página do comprador", pagina.error.message);
    }
    const linhas = ((pagina && !pagina.error ? pagina.data : null) || []) as {
      created_at?: string | null;
      url?: string | null;
      pagina?: string | null;
    }[];
    const paginas = [...linhas]
      .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
      .map((l) => l.url || l.pagina || "")
      .filter(Boolean);

    return { jaIniciados, paginas, reservas: reservasDoComprador };
  } catch (e) {
    console.error("[tracking/garantia] falha ao conferir o comprador", e instanceof Error ? e.message : e);
    return { jaIniciados: null, paginas: [], reservas: new Map() };
  }
}
