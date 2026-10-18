import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { JANELA_CHECKOUT_EXPRESSO_MS } from "@/lib/tracking/eventos";
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
//   - o do tema (clique comum, sem pixel cobrindo) e o expresso
//     (`begin_checkout_xp_*`) têm visitor_id = o `_xc_vid` do tema; o do pixel
//     de OUTRO checkout do mesmo comprador, visitor_id = o clientId;
//   - o expresso PENDENTE conta como "teve": o cron manda em até 5 min, com o
//     event_time do clique. Trocá-lo pela garantia correria com o drain, que
//     não reserva a linha antes de mandar -- e saíriam dois.
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
// Erro de banco NÃO lança: sem saber, não manda a garantia -- falta um IC, não
// sai um a mais -- e a compra segue como sempre.
// ============================================================================

type Admin = ReturnType<typeof createAdminClient>;

/** Até quanto antes do pedido um begin_checkout do mesmo comprador conta. */
export const JANELA_CHECKOUT_DE_GARANTIA_MS = 24 * 60 * 60 * 1000;

/** Como o coletor corta o visitorId do corpo (o do pixel e o clientId): a chave tem que bater. */
const MAX_VISITANTE = 64;

export interface CheckoutsDoComprador {
  /**
   * Os destinos (destination_id) em que o comprador já tem IC. null = não deu
   * para saber, e então nenhuma garantia sai.
   */
  jaIniciados: Set<string> | null;
  /** URLs dos eventos dele, da mais recente para a mais antiga. */
  paginas: string[];
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
  const ip = comprador.length
    ? null
    : hashDoIp(pedido.client_details?.browser_ip || pedido.browser_ip);

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
    const [porComprador, porIp, pagina] = await Promise.all([
      Promise.all(comprador.map((c) => ics("visitor_id", c, desde))),
      ip
        ? ics("ip_hash", ip, new Date(referencia - JANELA_CHECKOUT_EXPRESSO_MS).toISOString())
        : null,
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

    return { jaIniciados, paginas };
  } catch (e) {
    console.error("[tracking/garantia] falha ao conferir o comprador", e instanceof Error ? e.message : e);
    return { jaIniciados: null, paginas: [] };
  }
}
