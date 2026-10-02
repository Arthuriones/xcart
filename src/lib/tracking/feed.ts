import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { EventoFeed } from "@/lib/financeiro/tipos";

// ============================================================================
// Feed de eventos ao vivo: as ultimas linhas da fila de rastreamento.
//
// Le pela RPC tracking_feed (052), que e SECURITY INVOKER: a RLS de
// tracking_events vale la dentro, entao mesmo um storeId alheio que escapasse
// da conferencia da rota voltaria vazio. Ela devolve so colunas tratadas --
// sem payload, IP ou user agent, que a tela nao precisa e nao deve carregar.
//
// Com o cliente da SESSAO, nunca o admin: com service role a RLS nao vale e a
// unica trava passaria a ser o filtro de quem chamou.
// ============================================================================

interface LinhaRpc {
  id: string;
  store_id: string;
  criado_em: string;
  enviado_em: string | null;
  latencia_s: number | string | null;
  evento: string | null;
  fonte: string | null;
  plataforma: string | null;
  destino_id: string | null;
  destino_nome: string | null;
  status: string | null;
  tentativas: number | null;
  erro: string | null;
  com_clique: boolean | null;
  origem_host: string | null;
  utm_source: string | null;
  utm_campaign: string | null;
  pedido: string | null;
}

const FONTES = new Set<EventoFeed["fonte"]>(["tema", "pixel", "webhook"]);
const STATUS = new Set<EventoFeed["status"]>(["pendente", "enviado", "falhou"]);

/** numeric do Postgres chega como string pelo PostgREST; lixo vira null. */
function numeroOuNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function normalizarLinhaFeed(l: LinhaRpc): EventoFeed {
  const fonte = FONTES.has(l.fonte as EventoFeed["fonte"])
    ? (l.fonte as EventoFeed["fonte"])
    : "tema";
  // Status desconhecido vira pendente: "falhou" sem erro assustaria a toa, e
  // "enviado" seria mentira.
  const status = STATUS.has(l.status as EventoFeed["status"])
    ? (l.status as EventoFeed["status"])
    : "pendente";
  return {
    id: String(l.id),
    store_id: String(l.store_id),
    criado_em: String(l.criado_em),
    enviado_em: l.enviado_em ?? null,
    latencia_s: numeroOuNull(l.latencia_s),
    evento: String(l.evento ?? ""),
    fonte,
    plataforma: String(l.plataforma ?? ""),
    destino_id: l.destino_id ?? null,
    destino_nome: l.destino_nome ?? null,
    status,
    tentativas: Number(l.tentativas ?? 0) || 0,
    erro: l.erro ?? null,
    com_clique: typeof l.com_clique === "boolean" ? l.com_clique : null,
    origem_host: l.origem_host ?? null,
    utm_source: l.utm_source ?? null,
    utm_campaign: l.utm_campaign ?? null,
    pedido: l.pedido ?? null,
  };
}

/**
 * Ultimos eventos das lojas pedidas, do mais novo para o mais velho.
 * `antes` pagina para tras (criado_em do ultimo carregado). Erro de banco
 * LANCA: lista vazia diria "nenhum evento", que e outra coisa.
 */
export async function lerFeed(
  storeIds: string[],
  antes: string | null,
  limite = 100
): Promise<EventoFeed[]> {
  if (!storeIds.length) return [];
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("tracking_feed", {
    p_store_ids: storeIds,
    p_antes: antes,
    p_limite: limite,
  });
  if (error) throw new Error(`Falha ao ler os eventos: ${error.message}`);
  return ((data || []) as LinhaRpc[]).map(normalizarLinhaFeed);
}
