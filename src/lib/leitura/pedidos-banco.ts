import "server-only";
import { createClient } from "@/lib/supabase/server";
import { filtroResolvido } from "@/lib/filtro-global";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { somarDias, type FiltroGlobal, type Intervalo, type LojaDoSeletor } from "@/lib/financeiro/tipos";
import {
  montarPedidos,
  type DestinoLoja,
  type EventoCompra,
  type OrigemGravada,
  type PedidoTela,
  type ResumoPedidos,
} from "@/lib/leitura/pedidos";
import { semMigration071 } from "@/lib/tracking/origem-banco";
import { CAMPOS_ORIGEM } from "@/lib/tracking/origem-pedido";

// ============================================================================
// Leitura da tela Pedidos. So banco, pela sessao (RLS): os pedidos vem da
// MESMA base do Dashboard (lerBaseLucro, na versao enxuta: so o periodo atual,
// sem gasto de anuncio), e o rastreamento de
// tracking_events (so o Purchase do Meta, que o webhook grava), dos destinos e
// do interruptor da loja. A origem de cada pedido vem de fin_order_origem
// (071), com os nomes de campanha, conjunto e anuncio do sync de gasto.
//
// Erro de banco LANCA: a tela mostra o erro, nunca uma lista vazia.
// ============================================================================

const PAGINA = 1000;

export type DadosPedidos =
  | { vazio: true }
  | {
      vazio: false;
      filtro: FiltroGlobal;
      lojas: LojaDoSeletor[];
      intervalo: Intervalo;
      pedidos: PedidoTela[];
      resumo: ResumoPedidos;
    };

type LinhaEvento = EventoCompra & { teste_marca?: string | null; codigo_teste?: string | null };

export async function lerPedidos(): Promise<DadosPedidos> {
  const { lojaIds: ids } = await filtroResolvido();
  if (!ids.length) return { vazio: true };
  const supabase = await createClient();

  // Pixels e interruptor so precisam das lojas: correm junto com os pedidos.
  const [base, destinos, configs] = await Promise.all([
    lerBaseLucro(true),
    supabase
      .from("tracking_destinations")
      .select("id, store_id, plataforma, nome, ativo, created_at")
      .in("store_id", ids)
      .then(({ data, error }) => {
        if (error) throw new Error(`Falha ao ler os pixels das lojas: ${error.message}`);
        return (data ?? []) as DestinoLoja[];
      }),
    supabase
      .from("tracking_configs")
      .select("store_id, enabled")
      .in("store_id", ids)
      .then(({ data, error }) => {
        if (error) throw new Error(`Falha ao ler o rastreamento das lojas: ${error.message}`);
        return (data ?? []) as { store_id: string; enabled: boolean | null }[];
      }),
  ]);
  if (!base) return { vazio: true };
  const { entrada, lojaIds } = base;
  // O Purchase nasce no webhook, minutos depois do pedido; um dia de folga
  // pega o pedido da meia-noite em qualquer fuso. O teto evita ler ate hoje
  // num periodo passado ("Mes passado").
  const desde = `${somarDias(entrada.intervalos.atual.desde, -1)}T00:00:00Z`;
  const ate = `${somarDias(entrada.intervalos.atual.ate, 2)}T00:00:00Z`;

  const lerEventos = async (): Promise<EventoCompra[]> => {
    const saida: EventoCompra[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("tracking_events")
        .select(
          "store_id, order_id, destination_id, status, attempts, last_error, created_at, sent_at, fbc:payload->user_data->>fbc, url:payload->>event_source_url, teste_marca:payload->>teste, codigo_teste:payload->>test_event_code"
        )
        .in("store_id", lojaIds)
        .eq("destination", "meta")
        .in("event_name", ["Purchase", "purchase"])
        .not("order_id", "is", null)
        .gte("created_at", desde)
        .lt("created_at", ate)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) throw new Error(`Falha ao ler o envio das compras: ${error.message}`);
      const lote = (data ?? []) as unknown as LinhaEvento[];
      for (const { teste_marca, codigo_teste, ...ev } of lote) {
        if (!ev.order_id) continue;
        // A regra de teste da migration 055 (tracking_evento_teste).
        saida.push({ ...ev, teste: teste_marca === "true" || teste_marca === "1" || Boolean(codigo_teste) });
      }
      if (lote.length < PAGINA) return saida;
    }
  };

  // A origem gravada no pedido (071), pela mesma janela do Purchase. Sem a
  // migration, nada: a tela cai no Purchase, como antes.
  const lerOrigens = async (): Promise<OrigemGravada[]> => {
    const saida: OrigemGravada[] = [];
    for (let de = 0; ; de += PAGINA) {
      const { data, error } = await supabase
        .from("fin_order_origem")
        .select(["store_id", "shopify_order_id", ...CAMPOS_ORIGEM].join(", "))
        .in("store_id", lojaIds)
        .gte("pedido_em", desde)
        .lt("pedido_em", ate)
        .order("pedido_em", { ascending: true })
        .order("shopify_order_id", { ascending: true })
        .range(de, de + PAGINA - 1);
      if (error) {
        if (semMigration071(error)) return [];
        throw new Error(`Falha ao ler a origem dos pedidos: ${error.message}`);
      }
      const lote = (data ?? []) as unknown as OrigemGravada[];
      saida.push(...lote);
      if (lote.length < PAGINA) return saida;
    }
  };

  const [eventos, origens] = await Promise.all([lerEventos(), lerOrigens()]);
  const nomesAnuncio = await lerNomesDeAnuncio(supabase, origens);

  const { pedidos, resumo } = montarPedidos({
    entrada,
    lojas: base.lojas,
    fuso: base.fuso,
    eventos,
    destinos,
    lojasLigadas: configs.filter((c) => c.enabled).map((c) => String(c.store_id)),
    agoraMs: Date.now(),
    origens,
    nomesAnuncio,
  });

  return {
    vazio: false,
    filtro: base.filtro,
    lojas: base.lojas,
    intervalo: entrada.intervalos.atual,
    pedidos,
    resumo,
  };
}

/** Ids por consulta: `in` com 25 ids de 18 digitos cabe folgado na URL. */
const IDS_POR_CONSULTA = 25;

/**
 * O nome de cada campanha, conjunto e anuncio das origens, pelo sync de gasto
 * (ad_insights_granular, e ad_spend_daily no nivel campanha). O mais recente
 * vence: o anuncio renomeado aparece com o nome de hoje. Sem nome, a tela
 * mostra o id -- entao falha aqui nao derruba a tela, so vai para o log.
 */
async function lerNomesDeAnuncio(
  supabase: Awaited<ReturnType<typeof createClient>>,
  origens: readonly OrigemGravada[]
): Promise<Record<string, string>> {
  const ids = [
    ...new Set(origens.flatMap((o) => [o.campanha_id, o.conjunto_id, o.anuncio_id]).filter((v): v is string => Boolean(v))),
  ];
  const nomes: Record<string, string> = {};
  const lotes: string[][] = [];
  for (let i = 0; i < ids.length; i += IDS_POR_CONSULTA) lotes.push(ids.slice(i, i + IDS_POR_CONSULTA));
  const lerLote = (lote: string[]) =>
    Promise.all([
      supabase
        .from("ad_insights_granular")
        .select("objeto_id, objeto_nome")
        .in("objeto_id", lote)
        .order("data", { ascending: false })
        .limit(1000),
      supabase
        .from("ad_spend_daily")
        .select("campanha_id, campanha_nome")
        .eq("nivel", "campanha")
        .in("campanha_id", lote)
        .order("data", { ascending: false })
        .limit(1000),
    ]);
  // Os lotes correm juntos (como em Campanhas); o resultado e lido na ordem
  // deles, entao o nome que vence e o mesmo da leitura um a um.
  for (const [granular, campanhas] of await Promise.all(lotes.map(lerLote))) {
    if (granular.error) console.error("[pedidos] nomes dos anuncios", granular.error.message);
    for (const r of (granular.data ?? []) as { objeto_id: string; objeto_nome: string | null }[]) {
      const nome = (r.objeto_nome || "").trim();
      if (nome && !nomes[r.objeto_id]) nomes[r.objeto_id] = nome;
    }
    if (campanhas.error) console.error("[pedidos] nomes das campanhas", campanhas.error.message);
    for (const r of (campanhas.data ?? []) as { campanha_id: string; campanha_nome: string | null }[]) {
      const nome = (r.campanha_nome || "").trim();
      if (nome && !nomes[r.campanha_id]) nomes[r.campanha_id] = nome;
    }
  }
  return nomes;
}
