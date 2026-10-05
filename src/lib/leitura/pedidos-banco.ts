import "server-only";
import { createClient } from "@/lib/supabase/server";
import { filtroResolvido } from "@/lib/filtro-global";
import { lerBaseLucro } from "@/lib/leitura/base-lucro";
import { somarDias, type FiltroGlobal, type Intervalo, type LojaDoSeletor } from "@/lib/financeiro/tipos";
import {
  montarPedidos,
  type DestinoLoja,
  type EventoCompra,
  type PedidoTela,
  type ResumoPedidos,
} from "@/lib/leitura/pedidos";

// ============================================================================
// Leitura da tela Pedidos. So banco, pela sessao (RLS): os pedidos vem da
// MESMA base do Dashboard (lerBaseLucro, na versao enxuta: so o periodo atual,
// sem gasto de anuncio), e o rastreamento de
// tracking_events (so o Purchase do Meta, que o webhook grava), dos destinos e
// do interruptor da loja.
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

  const eventos = await lerEventos();

  const { pedidos, resumo } = montarPedidos({
    entrada,
    lojas: base.lojas,
    fuso: base.fuso,
    eventos,
    destinos,
    lojasLigadas: configs.filter((c) => c.enabled).map((c) => String(c.store_id)),
    agoraMs: Date.now(),
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
